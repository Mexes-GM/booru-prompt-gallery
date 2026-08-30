/**
 * Pure, framework-free core for Bulk Send's "Synthetic" mode (see
 * docs/superpowers/specs/2026-07-19-extension-bulk-send-design.md).
 *
 * Given a handful of seed posts fetched for the current search query, this
 * builds N pack-style prompts (lib/pack/pack-generator.ts) where the search
 * bar tags are locked (constant in every prompt) and the remaining
 * appearance/clothing/pose/scenery axes vary — then runs each generated
 * prompt through the SAME cleaner pipeline (cleanPrompt + Smart Tag Exclusion
 * + global weights) real cards use, driven by the same prompt-settings bundle
 * (UseCardPromptOptions) as the "Real posts" mode, so both Bulk Send modes are
 * equally affected by includeCharacters/exclude/find&replace/background/etc.
 *
 * No React/DOM here — testable with ts-node like pack-generator.verify.ts.
 */
import { BooruPost } from "../booru/types"
import { TagCategory, classifyTags } from "../tag-classifier"
import { cleanPrompt, type CleanPromptOptions } from "../cleanPrompt"
import { applyWeights } from "../weight-utils"
import { resolveTagConflicts } from "../tag-conflicts"
import { splitCommaSeparatedTags, splitTags } from "../utils/tag-utils"
import {
  PACK_AXES,
  MAX_PACK_PROMPTS,
  classifyPostForPack,
  extractAxisValues,
  generatePackPrompts,
  withAxisFallback,
  normalizeTagForPack,
} from "./pack-generator"

/** A subset of UseCardPromptOptions (hooks/use-card-prompt.ts) — the prompt
 *  settings bundle shared with the "Real posts" bulk-send mode. Duplicated
 *  as a plain interface here (rather than imported) to keep this pure module
 *  free of any dependency on React-only hook types. */
export interface BulkSendCleanOptions {
  excludeInput: string
  addInput: string
  findInput?: string
  replaceInput?: string
  includeCharacters: boolean
  optimizeTags: boolean
  smartTagExclusion?: boolean
  tagOverrides?: Record<string, string>
  globalWeights?: Record<string, number>
  isGlobalWeightsEnabled?: boolean
}

export interface SyntheticBulkPrompt {
  /** Final, cleaned prompt string ready to send to the generator. */
  prompt: string
  /** The sampled axis values (pre-clean) that produced this prompt, for debugging/telemetry. */
  values: string[]
}

/** Below this many seed posts, axis pools are likely too sparse to be useful. */
export const MIN_RECOMMENDED_SEED_POSTS = 10

/**
 * Normalize the free-text search bar into the "locked tags" that stay
 * constant across every synthetic prompt (see spec decision #2 — whatever is
 * in the search bar is fixed, the rest varies).
 */
export function extractLockedTagsFromSearch(searchTags: string): string[] {
  const raw = splitCommaSeparatedTags(searchTags)
  const normalized = raw
    .map(normalizeTagForPack)
    // Drop booru meta-operators that aren't real descriptive tags (e.g.
    // "order:random", "score:>=50", "-tag" exclusions) — they don't belong
    // in a generated prompt and would otherwise get locked in verbatim.
    .filter((t) => t && !t.includes(":") && !t.startsWith("-"))
  return Array.from(new Set(normalized)).filter(Boolean)
}

/**
 * Detects a single "character folder name" for the CURRENT search query, used
 * by the extension's Auto-Downloading feature to group downloaded images by
 * character (see Auto-Downloading character subfolders). Reuses the exact
 * same locked-tags + tag_string_character matching detectCharacterTags already
 * does for synthetic Bulk Send, so "what counts as the searched character"
 * stays consistent across features.
 *
 * Returns null when the search isn't locked to exactly one character tag —
 * multiple characters (e.g. a ship/duo search) or none intentionally opt out
 * of subfoldering rather than guessing which one to use.
 */
export function detectSearchCharacterName(
  searchTags: string,
  seedPosts: BooruPost[],
  tagOverrides: Record<string, string> = {}
): string | null {
  const lockedTags = extractLockedTagsFromSearch(searchTags)
  if (lockedTags.length === 0) return null

  const characterTags = detectCharacterTags(lockedTags, seedPosts, tagOverrides)
  if (characterTags.length !== 1) return null

  return characterTagToFolderName(characterTags[0])
}

/** "mona_(genshin_impact)" -> "mona (genshin impact)" — underscores back to
 *  spaces (booru convention) so the resulting folder name reads naturally. */
export function characterTagToFolderName(characterTag: string): string {
  return characterTag.replace(/_/g, " ").trim()
}

/**
 * Build the per-axis candidate pools from the seed posts, excluding any value
 * that's already part of lockedTags (so a searched tag like "from_side" never
 * gets re-varied or duplicated alongside itself).
 */
export function buildAxesFromSeedPosts(
  seedPosts: BooruPost[],
  lockedTags: string[],
  tagOverrides: Record<string, string> = {}
): Partial<Record<TagCategory, string[]>> {
  const lockedSet = new Set(lockedTags.map(normalizeTagForPack))
  const axes: Partial<Record<TagCategory, string[]>> = {}
  for (const category of PACK_AXES) {
    const sampled = extractAxisValues(seedPosts, category, tagOverrides).filter(
      (v) => !lockedSet.has(v)
    )
    if (sampled.length > 0) axes[category] = withAxisFallback(sampled, undefined)
  }
  return axes
}

/**
 * Best-effort detection of which locked tags represent the character's
 * identity (as opposed to a pose/setting tag the user also typed, e.g.
 * "from_side"), so the cleaner's `includeCharacters` toggle behaves the same
 * way it would for a real card. A locked tag counts as a character tag when
 * either: (a) it literally appears in a seed post's tag_string_character, or
 * (b) classifyPostForPack's "appearance" bucket contains it for some seed post.
 */
export function detectCharacterTags(
  lockedTags: string[],
  seedPosts: BooruPost[],
  tagOverrides: Record<string, string> = {}
): string[] {
  const lockedSet = new Set(lockedTags.map(normalizeTagForPack))
  const characterTags = new Set<string>()

  for (const post of seedPosts) {
    // tag_string_character is booru's underscore-joined tag list (e.g.
    // "mona_(genshin_impact)"), NOT space-joined prose — splitTags treats
    // whitespace as the tag separator, same as pack-generator.ts's own
    // normalizedTagList, so a tag's internal spaces (post-normalization)
    // survive intact instead of being shredded by a raw split(/\s+/).
    const fromCharField = splitTags(post.tag_string_character || "").map(normalizeTagForPack).filter(Boolean)
    for (const t of fromCharField) {
      if (lockedSet.has(t)) characterTags.add(t)
    }

    const classified = classifyPostForPack(post, tagOverrides)
    for (const t of classified.appearance) {
      if (lockedSet.has(t)) characterTags.add(t)
    }
  }

  return Array.from(characterTags)
}

/**
 * Run one pack-generated tag combination through the same cleaner pipeline a
 * real card uses (cleanPrompt -> Smart Tag Exclusion for addInput ->
 * cleanPrompt with resolved added tags -> global weights), so
 * includeCharacters/exclude/find&replace/background settings apply exactly
 * like they would for a real post.
 */
export function cleanSyntheticPrompt(
  tags: string[],
  characterTags: string[],
  options: BulkSendCleanOptions
): string {
  const {
    excludeInput,
    addInput,
    findInput = "",
    replaceInput = "",
    includeCharacters,
    optimizeTags,
    smartTagExclusion = true,
    tagOverrides,
    globalWeights = {},
    isGlobalWeightsEnabled = false,
  } = options

  const excludeList = splitCommaSeparatedTags(excludeInput)
  const addList = splitCommaSeparatedTags(addInput)

  const finds = splitCommaSeparatedTags(findInput)
  const replaces = splitCommaSeparatedTags(replaceInput)
  const pairCount = Math.min(finds.length, replaces.length)
  const wordReplacements = Array.from({ length: pairCount }, (_, i) => ({
    find: finds[i],
    replace: replaces[i],
  }))

  // Character tags are passed via the dedicated characterTags parameter (4th
  // arg of cleanPrompt), same convention cleanPrompt already uses for real
  // posts (tag_string_character) — general tags go through tagString, minus
  // whatever we've identified as the character's own tags to avoid double
  // counting them in both slots.
  const characterSet = new Set(characterTags.map(normalizeTagForPack))
  const generalTags = tags.filter((t) => !characterSet.has(normalizeTagForPack(t)))

  const sharedOpts: CleanPromptOptions = {
    includeCharacters,
    includeCopyrights: false,
    optimizeTags,
    exclude: excludeList,
    addedTags: [],
    tagOverrides,
    backgroundMode: "keep",
    escapeOutput: false,
    wordReplacements,
  }
  const pureContent = cleanPrompt(generalTags.join(", "), "", characterTags.join(" "), "", sharedOpts)

  const conflictResolution = !pureContent || addList.length === 0 || !smartTagExclusion
    ? { validTags: addList, conflictingTags: [] }
    : resolveTagConflicts(pureContent.split(",").map((t) => t.trim()), addList)

  const finalOpts: CleanPromptOptions = {
    ...sharedOpts,
    addedTags: conflictResolution.validTags,
  }
  const baseContent = cleanPrompt(generalTags.join(", "), "", characterTags.join(" "), "", finalOpts)

  return isGlobalWeightsEnabled && baseContent ? applyWeights(baseContent, globalWeights) : baseContent
}

/**
 * Build up to `count` distinct, cleaned synthetic prompts for the given
 * search query, seeded from `seedPosts`. Returns fewer than `count` when the
 * combination space (after Smart Tag Exclusion + cleaning + dedup) can't
 * support it — callers should report the actual number produced.
 */
export function buildSyntheticPrompts(
  seedPosts: BooruPost[],
  searchTags: string,
  count: number,
  cleanOptions: BulkSendCleanOptions,
  rng?: () => number
): SyntheticBulkPrompt[] {
  const lockedTags = extractLockedTagsFromSearch(searchTags)
  if (lockedTags.length === 0 && seedPosts.length === 0) return []

  const tagOverrides = cleanOptions.tagOverrides ?? {}
  const axes = buildAxesFromSeedPosts(seedPosts, lockedTags, tagOverrides)
  const characterTags = detectCharacterTags(lockedTags, seedPosts, tagOverrides)

  const packPrompts = generatePackPrompts({
    lockedTags,
    axes,
    count,
    maxPrompts: Math.min(count, MAX_PACK_PROMPTS),
    rng,
  })

  const seen = new Set<string>()
  const results: SyntheticBulkPrompt[] = []

  for (const packPrompt of packPrompts) {
    const tags = packPrompt.prompt.split(",").map((t) => t.trim()).filter(Boolean)
    const cleaned = cleanSyntheticPrompt(tags, characterTags, cleanOptions)
    if (!cleaned || seen.has(cleaned)) continue
    seen.add(cleaned)
    results.push({ prompt: cleaned, values: packPrompt.values })
  }

  return results
}
