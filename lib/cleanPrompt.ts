/**
 * Refactored, robust prompt cleaner for Booru-style tags.
 * - Normalizes tags (lowercase, underscores -> spaces)
 * - Removes artist/meta/urls/numbers/symbol-only/noisy tags
 * - Optional optimization: combines adjectives for same noun and removes redundancies
 * - Preserves public API and output format from previous implementation
 */

import { classifyTags } from "./tag-classifier"
import { TAG_CATEGORY_IDS } from "./tag-taxonomy"
import { processBackgroundTags, BackgroundMode } from "./background-detector"
import { type BackgroundContext, type MatchStrictness } from "./background-context"
import { splitTags, splitCommaSeparatedTags } from "./utils/tag-utils"

// --------------- Types ---------------
interface TagData {
  name: string
  category: number
  aliases?: string[]
}

// Curated list of common meta/utility tags to remove during cleaning
const FALLBACK_META_TAGS = [
  "signature", "twitter username", "artist name", "watermark", "copyright", 
  "artist", "unknown artist", "official art", "fan art", "commission", 
  "pointless censoring", "web address", "original", "sound effects", 
  "motion lines", "patreon logo", "copyright notice", "commissioner name", 
  "borrowed character", "borrowed character name", "bad id", "bad pixiv id",
  "request", "commentary", "translated", "highres", "absurdres", "translated"
];

export interface WordReplacementRule {
  find: string
  replace: string
}

/** A replacement that was actually applied while cleaning a specific prompt. */
export interface AppliedWordReplacement {
  from: string
  to: string
}

export interface TagAppendRule {
  id: string
  find: string
  append: string[]
}

/** Tags added after an exact source-tag match while cleaning a prompt. */
export interface AppliedTagAppend {
  from: string
  append: string[]
}

export interface CleanPromptOptions {
  includeCharacters?: boolean
  includeCopyrights?: boolean
  optimizeTags?: boolean
  exclude?: string[]
  addedTags?: string[]
  tagOverrides?: Record<string, string>
  escapeOutput?: boolean
  metaTags?: string
  backgroundMode?: BackgroundMode
  simpleBackgroundReplacementTags?: string
  randomBackgroundPatterns?: boolean

  randomBackgroundIncludeGradients?: boolean
  detailedBackgroundsList?: string[][]
  backgroundSeed?: number
  /**
   * Scene context that steers the 'detailed_random' pick toward a background
   * that fits the post (see lib/background-context.ts). Derive it once per post
   * and pass the SAME value to every pipeline rendering that post — the pure
   * and display pipelines run on slightly different tag lists, so deriving it
   * separately in each would let them pick different backgrounds for one card.
   */
  backgroundContext?: BackgroundContext
  /** How strictly backgroundContext gates the 'detailed_random' pick. */
  backgroundMatchStrictness?: MatchStrictness

  /**
   * "Find & Replace" rules for outdated booru tag renames (e.g. Danbooru
   * renamed "jinx (league of legends)" -> "jinx (league)", but image
   * generation models were trained on the old tag). Matching is restricted to
   * the exact content between parentheses of a tag ("personaje (serie)"
   * pattern) to avoid false positives like "league of champions" mutating
   * into "league of legends of champions" from a loose substring match.
   */
  wordReplacements?: WordReplacementRule[]
  /**
   * Optional out-parameter: when provided, every replacement actually applied
   * while cleaning this prompt is pushed here. Lets callers (e.g. the UI)
   * know which tags changed without altering cleanPrompt's return type.
   */
  onWordReplacementsApplied?: (applied: AppliedWordReplacement[]) => void

  /**
   * Exact source-tag rules that add one or more normalized tags without
   * removing the matching source tag or triggering rule chains.
   */
  tagAppendRules?: TagAppendRule[]
  /** Reports every append rule that matched source tags in this clean pass. */
  onTagAppendsApplied?: (applied: AppliedTagAppend[]) => void

  /**
   * When set, prepends "@<artist>," at the very start of the returned prompt.
   * Caller is responsible for resolving the artist name (e.g. the post's
   * first artist tag) — cleanPrompt just formats and prepends it verbatim.
   * Only meaningful for checkpoints that support "@artist" invocation syntax
   * (e.g. Anima Pencil-XL); harmless no-op literal tag on other checkpoints.
   */
  prependArtistTag?: string
}

// --------------- Utilities ---------------
export const toSpace = (s: string) => s.replace(/_/g, " ")
export const toUnderscore = (s: string) => s.replace(/\s+/g, "_")

// Diccionario de auto-correcciones rapidas
const COMMON_TYPOS: Record<string, string> = {
  "1 girl": "1girl",
  "2 girls": "2girls",
  "3 girls": "3girls",
  "4 girls": "4girls",
  "5 girls": "5girls",
  "6 girls": "6girls",
  "1 boy": "1boy",
  "2 boys": "2boys",
  "3 boys": "3boys",
  "4 boys": "4boys",
  "5 boys": "5boys",
  "6 boys": "6boys",
}

export const normalize = (s: string) => {
  const norm = toSpace(s).toLowerCase().trim().replace(/\s{2,}/g, " ")
  
  const match = norm.match(/^([\[\(\{<]*\s*)(.*?)(\s*(?::\s*[\d.]+)?\s*[\]\)\}>]*)$/)
  if (match) {
    const prefix = match[1]
    const coreTag = match[2]
    const suffix = match[3]
    
    if (COMMON_TYPOS[coreTag]) {
      return prefix + COMMON_TYPOS[coreTag] + suffix
    }
  }
  
  return COMMON_TYPOS[norm] || norm
}
const escapeParentheses = (s: string) => s.replace(/\(/g, "\\(").replace(/\)/g, "\\)")

function withNormalizedVariants(list: string[]): Set<string> {
  const set = new Set<string>()
  for (const raw of list) {
    const space = normalize(raw)
    const under = toUnderscore(space)
    set.add(space)
    set.add(under)
  }
  return set
}

// Matches a tag of the form "something (content)" and captures the prefix
// (everything before the opening paren, trimmed) and the parenthesized content.
const PARENTHESIZED_TAG_RE = /^(.*?)\(([^()]+)\)\s*$/

/**
 * Strips a single pair of wrapping parentheses, if present, so the user can
 * type either "league" or "(league)" in the Find/Replace fields and get the
 * same result — matching how the tag actually looks on the booru.
 */
function stripWrappingParens(s: string): string {
  const trimmed = s.trim()
  const match = trimmed.match(/^\(([^()]*)\)$/)
  return match ? match[1].trim() : trimmed
}

/**
 * Applies "Find & Replace" rules to a single already-normalized tag.
 *
 * Two matching modes, both restricted to *exact* matches (never a loose
 * substring) to avoid corrupting unrelated tags:
 *
 * 1. Parenthesized tags ("character (series)" pattern): the rule matches the
 *    exact content between parentheses. E.g. find="league" only turns
 *    "jinx (league)" into "jinx (league of legends)" — it does NOT touch
 *    "league of champions" (no parentheses), which a loose substring match
 *    would have corrupted into "league of legends of champions".
 * 2. Plain tags (no parentheses): the rule matches the exact, whole tag only.
 *    E.g. find="long hair" only replaces the standalone tag "long hair" with
 *    "short hair" — it never touches "long hair ribbon" or "very long hair",
 *    which a substring match would have mangled.
 */
function applyWordReplacements(
  tag: string,
  rules: { find: string; replace: string }[],
): { result: string; applied: AppliedWordReplacement | null } {
  if (!rules.length) return { result: tag, applied: null }

  const parenMatch = tag.match(PARENTHESIZED_TAG_RE)

  if (parenMatch) {
    const prefix = parenMatch[1]
    const content = normalize(parenMatch[2])

    for (const rule of rules) {
      const find = normalize(stripWrappingParens(rule.find))
      if (!find) continue
      if (content === find) {
        const replace = normalize(stripWrappingParens(rule.replace))
        const result = `${prefix}(${replace})`.trim()
        if (result === tag) return { result: tag, applied: null }
        return { result, applied: { from: tag, to: result } }
      }
    }
    return { result: tag, applied: null }
  }

  // Plain tag (no parentheses): match the whole tag by exact equality only.
  const whole = normalize(tag)
  for (const rule of rules) {
    const find = normalize(rule.find)
    if (!find) continue
    if (whole === find) {
      const replace = normalize(rule.replace)
      if (replace === whole) return { result: tag, applied: null }
      return { result: replace, applied: { from: tag, to: replace } }
    }
  }

  return { result: tag, applied: null }
}

/**
 * Applies `applyWordReplacements` to a whole list of tags, collecting every
 * replacement that was actually made (for UI indicators) via `onApplied`.
 */
export function applyWordReplacementsToList(
  tags: string[],
  rules: { find: string; replace: string }[] | undefined,
  onApplied?: (applied: AppliedWordReplacement[]) => void,
): string[] {
  if (!rules || rules.length === 0) return tags

  const validRules = rules.filter((r) => r.find && r.find.trim().length > 0)
  if (validRules.length === 0) return tags

  const appliedList: AppliedWordReplacement[] = []
  const result = tags.map((tag) => {
    const { result: newTag, applied } = applyWordReplacements(tag, validRules)
    if (applied) appliedList.push(applied)
    return newTag
  })

  if (appliedList.length > 0) onApplied?.(appliedList)

  return result
}

/**
 * Collects tags to append for exact source-tag matches. The returned tags are
 * never used as further rule sources, so append rules cannot chain or cycle.
 */
export function collectTagAppends(
  tags: string[],
  rules: TagAppendRule[] | undefined,
  onApplied?: (applied: AppliedTagAppend[]) => void,
): string[] {
  if (!rules || rules.length === 0) return []

  const validRules = rules.flatMap((rule) => {
    const find = normalize(rule.find)
    const append = rule.append
      .map((tag) => normalize(tag))
      .filter((tag) => tag.length > 0)
    return find && append.length > 0 ? [{ find, append }] : []
  })
  if (validRules.length === 0) return []

  const applied: AppliedTagAppend[] = []
  const appended: string[] = []
  for (const tag of tags) {
    const source = normalize(tag)
    if (!source) continue

    for (const rule of validRules) {
      if (source !== rule.find) continue
      appended.push(...rule.append)
      applied.push({ from: source, append: rule.append })
    }
  }

  if (applied.length > 0) onApplied?.(applied)
  return appended
}

export function parseTagList(input: string): string[] {
  if (!input) return []
  const trimmed = input.trim()
  if (!trimmed) return []

  // La coma es el separador canónico de los prompts ya limpiados (y del aiPrompt /
  // CSV). Priorizarla hace que la salida de cleanPrompt sea segura de re-parsear.
  if (trimmed.includes(",")) {
    return splitCommaSeparatedTags(trimmed)
  }

  // Sin comas: los tag_string crudos del booru vienen separados por espacios y
  // codifican los tags multi-palabra con guiones bajos ("1girl long_hair blue_eyes"),
  // por lo que cada token separado por espacio es un tag completo.
  if (trimmed.includes("_")) {
    return splitTags(trimmed)
  }

  // Sin comas y sin guiones bajos: es prácticamente imposible que un tag_string
  // crudo (siempre rico en tags multi-palabra) no tenga guiones bajos, así que esta
  // forma corresponde a un único tag ya limpiado y multi-palabra (p. ej. "long white
  // hair"). Tratarlo como UN solo tag garantiza la idempotencia de cleanPrompt en
  // lugar de explotarlo en palabras sueltas ("hair, long, white").
  if (trimmed.includes(" ")) {
    return [trimmed]
  }

  return [trimmed]
}

// --------------- Domain Sets ---------------
const BREAST_SIZES_SET = new Set([
  "flat chest",
  "small breasts",
  "medium breasts",
  "large breasts",
  "huge breasts",
  "gigantic breasts",
].map(normalize))

const HAIR_LENGTHS_SET = new Set([
  "bald",
  "very short hair",
  "short hair",
  "medium hair",
  "long hair",
  "very long hair",
  "absurdly long hair",
].map(normalize))

const EYE_COLORS_SET = new Set([
  "blue eyes",
  "brown eyes",
  "green eyes",
  "red eyes",
  "purple eyes",
  "yellow eyes",
  "pink eyes",
  "orange eyes",
  "black eyes",
  "white eyes",
  "gray eyes",
  "grey eyes",
].map(normalize))

export const QUALITY_TAGS_SET = new Set([
  "masterpiece",
  "best quality",
  "high quality",
  "ultra-detailed",
  "detailed",
  "extremely detailed",
  "highly detailed",
  "amazing quality",
  "newest",
  "beautiful lighting",
  "soft reflections",
  "amazing composition",
  "flat color",
].map(normalize))

const SUBJECT_TAGS_SET = new Set(
  ["1girl", "1boy", "2girls", "2boys", "multiple girls", "multiple boys"].map(normalize),
)

const COMPOSITION_TAGS_SET = new Set(
  ["portrait", "full body", "upper body", "close-up", "wide shot"].map(normalize),
)

// --------------- Meta tags (curated list) ---------------
function loadTagsToRemove(category?: number): Set<string> {
  // Category 5 is usually "Meta" in booru systems
  const tagsToRemove = new Set<string>()
  
  // We use a curated list instead of the 21MB JSON to keep the build light and stable
  for (const tag of FALLBACK_META_TAGS) {
    tagsToRemove.add(normalize(tag))
  }
  
  return tagsToRemove
}

// Representative list; variants (space/underscore) are auto-generated.
const CURATED_META_LIST = withNormalizedVariants([
  // resolution/commentary
  "highres",
  "absurdres",
  "commentary",
  "commentary request",
  "english commentary",
  "chinese commentary",
  "korean commentary",
  "mixed-language commentary",
  "partial commentary",
  "translated",
  "translation request",
  // common meme tag
  "one-hour drawing challenge",
  "one hour drawing challenge",
  // web/url/logo/ids
  "web address",
  "+web address+",
  "patreon logo",
  "copyright notice",
  "official art",
  "commission",
  "bad id",
  "bad pixiv id",
  "bad artstation id",
  "bad facebook id",
  "bad instagram id",
  "bad tiktok id",
  "bad reddit id",
  "bad github id",
  "bad discord id",
  "bad telegram id",
  "bad skype id",
  "bad other id",
  "bad twitter id",
  "photoshop (medium)",
  "symbol-only commentary",
  "artist request",
  "copyright request",
  "non-web source",
  "signature",
  "watermark",
  "artist name",
  "twitter username",
  "request",
  // backgrounds - disabled
  /*
  "white background",
  "red background",
  "gradient background",
  "purple background",
  "simple background",
  "solid background",
  "colored background",
  "black background",
  "blue background",
  "green background",
  "yellow background",
  "orange background",
  "pink background",
  "grey background",
  "gray background",
  "brown background",
  "beige background",
  "cream background",
  "abstract background",
  "plain background",
  "minimal background",
  "clean background",
  "empty background",
  "neutral background",
  "pastel background",
  "dark background",
  "light background",
  "vibrant background",
  "soft background",
  "blurred background",
  "bokeh background",
  "gradient",
  "solid color",
  "monochrome",
  "two-tone background",
  "geometric background",
  "pattern background",
  "texture background",
  */
  // text/logos/usernames
  "english text",
  "japanese text",
  "chinese text",
  "korean text",
  "text",
  "speech bubble",
  "dialogue",
  "subtitle",
  "caption",
  "logo",
  "brand logo",
  "company logo",
  "game logo",
  "anime logo",
  "manga logo",
  "instagram logo",
  "pixiv logo",
  "twitter logo",
  "ko fi logo",
  "ko-fi logo",
  "character name",
  "series name",
  "franchise name",
  "copyright name",
  "trademark",
  "patreon username",
  "pixiv username",
  "deviantart username",
  "artstation username",
  "instagram username",
  "facebook username",
  "bluesky username",
  "tumblr username",
  "discord username",
  "username",
  "handle",
  "inactive account",
  "deleted account",
  "banned account",
  "virtual youtuber",
  "vtuber",
  "streamer",
  "content creator",
  // social platform watermarks
  "weibo watermark",
  "tiktok watermark",
  "instagram watermark",
  "facebook watermark",
  "social media watermark",
  "website watermark",
  "url",
  "link",
  "qr code",
  "barcode",
  "metadata",
  "file info",
  "image info",
  "photo info",
  "camera info",
  "timestamp",
  "date",
  "time",
  // additional variants
  "artist logo",
 "pixiv request",
  "twitter request",
  "source request",
  "character request",
  "pool request",
  "post request",
  "source edit",
  "artist edit",
  "character edit",
  "copyright edit",
  "banned artist",
  "duplicate",
  "replaced",
  "repost",
  "inaccurate tag",
  "poorly drawn",
  "bad anatomy",
  "bad hands",
  "bad proportions",
  "bad perspective",
  "bad source",
  "missing tag",
  "partially translated",
  "check translation",
  "tagme",
  "tag request",
  "tag update",
  "needs tags",
  "needs source",
  "needs id",
  "needs commentary",
  "needs translation",
  "unneeded tag",
  "wrong tag",
  "deletion request",
  "hard translated",
  "partially hard translated",
  "third-party edit",
  "revision",
  "sample",
  "resized",
  "upscaled",
  "downscaled",
  "lossy-lossless",
  "jpeg artifacts",
  "compression artifacts",
  "alternate source",
  "secondary source",
  "copyright text",
  "watermark text",
  "logo text",
  "brand name",
  "company name",
  "studio name",
  "production name",
  "fanbox username",
  "gumroad username",
  "ko fi username",
  "ko-fi username",
  "subscribestar username",
  "fanbox watermark",
  "gumroad watermark",
  "ko fi watermark",
  "subscribestar watermark",
  "transparent background",
  "white background only",
  "solid color background",
  "single color background",
  "minimalist background",
  "empty space",
  "negative space",
  "simple color background",
  // censorship and variants
  "censored",
  "censorship",
  "bar",
  "mosaic",
  "blur",
  "pixelated",
  "censor",
  "uncensored",
  "decensor",
  "uncensored version",
  "censored version",
  "black bar",
  "white bar",
  "mosaic censorship",
  "pixel censorship",
  "light censorship",
  "heavy censorship",
  "partial censorship",
  "full censorship",
  "genital censor",
  "nipple censor",
  "penis censor",
  "vagina censor",
  "pussy censor",
  "ass censor",
  "butt censor",
  "breast censor",
  "nipple bar",
  "genital bar",
  "penis bar",
  "vagina bar",
  "pussy bar",
  "ass bar",
  "butt bar",
  "breast bar",
  "nipple blur",
  "genital blur",
  "penis blur",
  "vagina blur",
  "pussy blur",
  "ass blur",
  "butt blur",
  "breast blur",
  "nipple mosaic",
  "genital mosaic",
  "penis mosaic",
  "vagina mosaic",
  "pussy mosaic",
  "ass mosaic",
  "butt mosaic",
  "breast mosaic",
  "bar censor",
  "mosaic censor",
  "blur censor",
  "mosaic censoring",
  "censoring",
  "dated",
  "original",
  // Additional meta tags from Danbooru API (May 2026) — category 5 tags not previously covered
  "lowres",
  "variant set",
  "game asset",
  "partial commentary",
  "untranslatable commentary",
  "paid reward available",
  "traditional media",
  "md5 mismatch",
  "skeb commission",
  "large variant set",
  "third-party source",
  "animated", // meta tag for animated GIF/PNG, NOT the general tag
  "incredible absurdres",
  "nominated",
  "unlisted",
  "screencap",
  "video",
  "webm",
  "image",
  "flash",
  "uncompressed file",
  "colorized",
  "pre-rendered 3d",

  // AI provenance. Danbooru marks all of these category 5 (ai-generated: 6,759
  // posts, ai-assisted: 2,964, stable_diffusion: 208) but they were never in
  // this list, so they reached prompts as if they described the image. They are
  // provenance, not content. Listed in the hyphen spelling Danbooru uses; the
  // underscore/space spellings other providers use are matched too, because
  // isMetaTag also tests a hyphen-flattened form.
  "ai-generated",
  "ai-assisted",
  "ai-generated background",
  "stable diffusion",

  // Funding platform / reward provenance. The curated list already covered the
  // "<platform> username / logo / watermark" variants but not the bare platform
  // names, nor the "<platform> reward" ones Danbooru does mark as meta
  // (paid_reward: 15,723 posts, patreon_reward: 8,233, fanbox_reward: 3,512,
  // fantia_reward: 1,033, pixiv_commission: 24,312). Bare "patreon"/"fanbox"/
  // "fantia" are not Danbooru tags at all, so they only ever arrive from the
  // other providers and no upstream taxonomy would flag them.
  "patreon",
  "fanbox",
  "fantia",
  "skeb",
  "gumroad",
  "subscribestar",
  "paid reward",
  "patreon reward",
  "fanbox reward",
  "fantia reward",
  "pixiv commission",

  // Upload/provenance metadata native to Gelbooru and Rule34, which
  // `auto_suggest_tags` cannot be relied on to classify: either the tag does not
  // exist on Danbooru at all ("2d", "year_request"), or Danbooru spells it with a
  // hyphen while those providers use an underscore ("self-upload" vs
  // "self_upload"), so the exact-match category lookup never resolved it.
  // Listing them here makes the filter independent of that lookup: entries are
  // written in Danbooru's spelling and withHyphenVariants derives the
  // space/underscore forms the other providers serve.
  "self-upload",
  "year request",
  "source request",
  "character request",
  "third-party edit",
  "third-party source",
  "second-party source",
  "pixel-perfect duplicate",
  "md5 mismatch",
  "resolution mismatch",
  // e621 / Rule34 resolution vocabulary. Same axis as Danbooru's
  // "highres"/"absurdres", which were already here, just spelled differently.
  "hi res",
  "absurd res",
  "absurd resolution",
  "high resolution",
  "superabsurdres",
  "lowres",
])

/**
 * Hyphens are meaningful in plenty of real tags ("off-shoulder", "t-shirt",
 * "close-up"), so `normalize` deliberately leaves them alone. Meta lookups are
 * the one place a hyphen must not decide the match: Danbooru writes
 * "ai-generated" and "third-party_source", while other providers serve
 * "ai_generated" (which normalizes to "ai generated") — without flattening
 * those are three separate keys and the tag leaks into the prompt. Only ever
 * used to widen matching against the meta sets, never against arbitrary tags.
 */
const flattenHyphens = (s: string) => s.replace(/-/g, " ").replace(/\s{2,}/g, " ").trim()

function withHyphenVariants(entries: Iterable<string>): Set<string> {
  const set = new Set<string>()
  for (const entry of entries) {
    set.add(entry)
    const flat = flattenHyphens(entry)
    if (flat && flat !== entry) {
      set.add(flat)
      set.add(toUnderscore(flat))
    }
  }
  return set
}

export const META_TAGS_SET = withHyphenVariants([
  ...loadTagsToRemove(5),
  ...CURATED_META_LIST,
])

const EMPTY_META_TAG_SET: ReadonlySet<string> = new Set<string>()

/**
 * Splits a `tag_string_meta` into individual tag names.
 *
 * NOT `parseTagList`. That helper has to guess how an arbitrary string was
 * delimited, and its no-comma branch only splits on whitespace when the string
 * contains an underscore — a string with neither a comma nor an underscore is
 * treated as ONE already-cleaned multi-word tag, which is right for a cleaned
 * prompt ("long white hair") and catastrophically wrong here.
 *
 * `tag_string_meta` needs no guessing: it is always the booru wire format —
 * space-separated, multi-word tags carrying underscores. So under `parseTagList`
 * whether this set was usable came down to whether some UNRELATED meta tag on
 * the same post happened to contain an underscore:
 *
 *   "hard-translated highres self-upload source_request"  -> split correctly
 *   "animated highres self-upload video"                  -> one bogus entry,
 *                                                            whole set useless
 *
 * That is why `self-upload` leaked on roughly half of the Gelbooru posts that
 * carried it, and it silently degraded Danbooru too (masked there because
 * META_TAGS_SET already covers most of Danbooru's meta vocabulary).
 *
 * Commas are tolerated as well so a caller that hands over an already-joined
 * list is not silently mis-parsed.
 */
const splitTagStringMeta = (tagStringMeta: string): string[] =>
  tagStringMeta.split(/[,\s]+/).filter(Boolean)

/**
 * Normalized lookup built from a post's own `tag_string_meta` — Danbooru's real
 * category-5 tags for THAT post.
 *
 * Every provider populates it: Danbooru/Aibooru request the field directly
 * (`only=...,tag_string_meta,...`), and the flat-tag ones (Gelbooru, Rule34)
 * get it resolved from `auto_suggest_tags` by
 * `BaseBooruProvider.enrichPostsWithCategories`. So this is a per-post,
 * always-current meta vocabulary that needs no hardcoded list and no extra
 * request — the same source a static "category = 5" snapshot would be built
 * from, minus the staleness.
 */
export function buildPostMetaTagSet(tagStringMeta?: string): ReadonlySet<string> {
  if (!tagStringMeta) return EMPTY_META_TAG_SET
  const set = new Set<string>()
  for (const tag of splitTagStringMeta(tagStringMeta)) {
    const normalized = normalize(tag)
    if (!normalized) continue
    set.add(normalized)
    // Same hyphen tolerance as META_TAGS_SET: a post can carry "ai-generated"
    // in tag_string_meta while tag_string spells it "ai_generated".
    const flat = flattenHyphens(normalized)
    if (flat && flat !== normalized) set.add(flat)
  }
  return set
}

/**
 * True when `tag` should be stripped from a prompt as metadata.
 *
 * Unions two sources that do NOT overlap and cannot replace each other:
 *
 * - `META_TAGS_SET` (curated, hand-maintained): mostly tags Danbooru classifies
 *   as **general**, not meta — `signature`, `artist name`, `watermark`,
 *   `speech bubble`, `english text`, `censored`/`bar censor`, `web address` —
 *   plus vocabulary from providers that aren't in `auto_suggest_tags` at all
 *   (`bad_tiktok_id`, `bad_reddit_id`). Since Danbooru never marks these
 *   category 5, no query against its taxonomy would ever return them.
 * - `postMetaTags` (per post, from `buildPostMetaTagSet`): Danbooru's actual
 *   category-5 tags for the post at hand. Covers the long tail the curated list
 *   never enumerated (`scan`, `game_cg`, `bad_link`, `resolution_mismatch`,
 *   `spoilers`, `pixel-perfect_duplicate`, `ugoira`, ...).
 *
 * Pass `postMetaTags` whenever a post is in scope. Omitting it falls back to
 * the curated list alone, which is the correct behavior for tag strings with no
 * post attached (e.g. tags typed into the search bar).
 */
export function isMetaTag(tag: string, postMetaTags?: ReadonlySet<string>): boolean {
  const normalized = normalize(tag)
  if (META_TAGS_SET.has(normalized)) return true
  if (postMetaTags?.has(normalized)) return true

  const flat = flattenHyphens(normalized)
  if (flat === normalized) return false
  return META_TAGS_SET.has(flat) || (postMetaTags?.has(flat) ?? false)
}

// --------------- Optimizations ---------------
function optimizeTags(tags: string[]): string[] {
  let working = [...tags]

  // Detectar múltiples sujetos (desactivar combinación de adjetivos en prendas)
  const subjectTagsInPrompt = working.filter((t) => SUBJECT_TAGS_SET.has(t))
  const subjectSet = new Set(subjectTagsInPrompt)
  const hasPluralSubject =
    subjectSet.has("2girls") ||
    subjectSet.has("2boys") ||
    subjectSet.has("multiple girls") ||
    subjectSet.has("multiple boys")
  const multipleDistinctSubjects = subjectSet.size > 1
  const disableCombination = hasPluralSubject || multipleDistinctSubjects

  // 1) Mantener solo la talla de pechos más específica
  const breastHierarchy = [
    "gigantic breasts",
    "huge breasts",
    "large breasts",
    "medium breasts",
    "small breasts",
    "flat chest",
  ].map(normalize)
  const workingSetForBreasts = new Set(working)
  const presentBreasts = breastHierarchy.filter((b) => workingSetForBreasts.has(b))
  if (presentBreasts.length > 1) {
    const bestBreast = presentBreasts[0]
    working = working.filter((t) => !BREAST_SIZES_SET.has(t) || t === bestBreast)
  }

  // 2) Mantener solo el largo de pelo más específico (jerarquía, igual que pechos).
  //    Evita contradicciones como "short hair" + "long hair" que luego se
  //    fusionarían en un tag sin sentido ("short long hair").
  const hairHierarchy = [
    "absurdly long hair",
    "very long hair",
    "long hair",
    "medium hair",
    "short hair",
    "very short hair",
    "bald",
  ].map(normalize)
  const workingSetForHair = new Set(working)
  const presentHair = hairHierarchy.filter((h) => workingSetForHair.has(h))
  if (presentHair.length > 1) {
    const bestHair = presentHair[0]
    working = working.filter((t) => !HAIR_LENGTHS_SET.has(t) || t === bestHair)
  }
  // Dedupe de duplicados exactos de largo de pelo restantes (keep first)
  const seenHair = new Set<string>()
  working = working.filter((t) => {
    if (!HAIR_LENGTHS_SET.has(t)) return true
    if (seenHair.has(t)) return false
    seenHair.add(t)
    return true
  })

  // 3) Dedupe eye colors (keep first)
  const seenEyes = new Set<string>()
  working = working.filter((t) => {
    if (!EYE_COLORS_SET.has(t)) return true
    if (seenEyes.has(t)) return false
    seenEyes.add(t)
    return true
  })

  // 4) Combinar adjetivos para el mismo sustantivo (si aplica)
  if (!disableCombination) {
    working = combineSharedNounTags(working)
  }

  // 5) Eliminar redundancias por inclusión
  working = removeRedundantByInclusion(working)

  return working
}

// Adjetivos que en realidad son verbos/interacciones (gerundios). Un tag como
// "grabbing shirt" describe una acción, no una prenda, por lo que NO debe
// fusionarse como si "grabbing" fuera un adjetivo descriptivo.
const ACTION_VERB_ADJECTIVES = new Set(
  [
    "grabbing", "holding", "pulling", "lifting", "adjusting", "removing",
    "gripping", "clutching", "tugging", "untying", "unbuttoning", "unzipping",
    "unfastening", "hiking", "raising", "fixing", "touching", "hugging",
    "wearing", "showing", "covering", "opening", "closing", "wringing",
  ].map(normalize),
)

// Familias de adjetivos mutuamente excluyentes. Si un grupo de tags con el mismo
// sustantivo contiene dos adjetivos de la misma familia (p. ej. "long" y "short"),
// combinarlos produce contradicciones ("long short skirt"), así que se omite la fusión.
const EXCLUSIVE_ADJ_FAMILIES: string[][] = [
  ["long", "short", "medium", "micro", "mini", "maxi"],
  ["torn", "intact"],
  ["open", "closed", "unbuttoned", "buttoned"],
  ["wet", "dry"],
  ["sleeveless", "long-sleeved", "short-sleeved"],
]
const ADJ_FAMILY_MAP: Record<string, number> = (() => {
  const map: Record<string, number> = {}
  EXCLUSIVE_ADJ_FAMILIES.forEach((family, familyId) => {
    family.forEach((adj) => {
      map[normalize(adj)] = familyId
    })
  })
  return map
})()

function combineSharedNounTags(original: string[]): string[] {
  const MERGE_NOUNS = new Set(
    [
      "skirt",
      "dress",
      "shirt",
      "jacket",
      "coat",
      "cape",
      "hat",
      "hood",
      "boots",
      "socks",
      "stockings",
      "gloves",
      "pants",
      "shorts",
      "leggings",
      "tights",
      "apron",
      "kimono",
      "yukata",
      "armor",
      "bikini",
      "swimsuit",
      "underwear",
      "panties",
      "bra",
      // Rasgo físico selectivo
      "hair", // (long hair + white hair -> long white hair)
    ].map(normalize),
  )

  interface GroupInfo {
    indices: number[]
    adjectives: string[]
  }

  const groups: Record<string, GroupInfo> = {}

  original.forEach((tag, idx) => {
    const parts = tag.split(" ")
    if (parts.length !== 2) return
    const [adj, noun] = parts
    if (!MERGE_NOUNS.has(normalize(noun))) return
    // No fusionar tags de acción/interacción ("grabbing shirt", "holding hat", ...)
    if (ACTION_VERB_ADJECTIVES.has(normalize(adj))) return

    if (!groups[noun]) groups[noun] = { indices: [], adjectives: [] }
    groups[noun].indices.push(idx)
    if (!groups[noun].adjectives.includes(adj)) groups[noun].adjectives.push(adj)
  })

  const toSkip = new Set<number>()
  const insertionMap = new Map<number, string>()

  Object.entries(groups).forEach(([noun, info]) => {
    if (info.indices.length <= 1) return

    // No combinar si hay adjetivos mutuamente excluyentes (p. ej. long + short).
    const seenFamilies = new Set<number>()
    const hasConflict = info.adjectives.some((adj) => {
      const familyId = ADJ_FAMILY_MAP[normalize(adj)]
      if (familyId === undefined) return false
      if (seenFamilies.has(familyId)) return true
      seenFamilies.add(familyId)
      return false
    })
    if (hasConflict) return

    const combined = `${info.adjectives.join(" ")} ${noun}`.trim()
    const alreadyExists = original.some((t) => t === combined)
    if (alreadyExists) {
      info.indices.forEach((i) => toSkip.add(i))
      const combinedIndex = original.indexOf(combined)
      if (combinedIndex >= 0) toSkip.delete(combinedIndex)
    } else {
      insertionMap.set(info.indices[0], combined)
      info.indices.forEach((i) => toSkip.add(i))
    }
  })

  if (insertionMap.size === 0) return original

  const result: string[] = []
  original.forEach((tag, idx) => {
    if (insertionMap.has(idx)) result.push(insertionMap.get(idx)!)
    else if (!toSkip.has(idx)) result.push(tag)
  })
  return result
}

function removeRedundantByInclusion(tagList: string[]): string[] {
  // Sort longest tags first so potential parents are processed before children
  const items = tagList.map((t) => {
    const words = t.split(" ").reduce<string[]>((acc, w) => {
      const trimmed = w.trim()
      if (trimmed) acc.push(trimmed)
      return acc
    }, []);
    return {
      tag: t,
      words,
      wordsSet: new Set(words)
    };
  });
  items.sort((a, b) => b.tag.length - a.tag.length);

  const keptSet = new Set<string>();
  const keptList: typeof items = [];

  for (const item of items) {
    if (keptSet.has(item.tag)) continue;

    // Check if the current item is fully covered by any already kept parent tag
    const isCovered = keptList.some(parent => {
      // Pre-filter: parent tag must contain the child tag as a substring
      // This is a fast character-level check and ensures contiguous/semantic relation
      if (!parent.tag.includes(item.tag)) return false;

      // Word-level check: every word in child must be a word in parent
      return item.words.every(w => parent.wordsSet.has(w));
    });

    if (!isCovered) {
      keptSet.add(item.tag);
      keptList.push(item);
    }
  }

  // Preserve original relative order of the tags
  return tagList.filter(t => keptSet.has(t));
}


// --------------- Main API ---------------
export function cleanPrompt(
  tagString: string,
  artistTags: string,
  characterTags: string,
  copyrightTags: string,
  options?: CleanPromptOptions,
): string {
  const includeCharacters = options?.includeCharacters !== false
  const includeCopyrights = options?.includeCopyrights !== false
  const optimizeAll = options?.optimizeTags !== false

  const userExcludeSet = new Set(
    (options?.exclude || [])
      .map((t) => normalize(t))
      .filter((t) => t.length > 0),
  )

  // Parse inputs
  let allTags = parseTagList(tagString)
  const artistTagsSet = new Set(parseTagList(artistTags).map((t) => normalize(t)))

  // Collects every "Find & Replace" hit across all tag sources for this call,
  // reported to the caller via options.onWordReplacementsApplied.
  const wordReplacementsApplied: AppliedWordReplacement[] = []
  const collectReplacements = (applied: AppliedWordReplacement[]) => {
    wordReplacementsApplied.push(...applied)
  }
  const tagAppendsApplied: AppliedTagAppend[] = []
  const collectAppends = (applied: AppliedTagAppend[]) => {
    tagAppendsApplied.push(...applied)
  }

  // "Find & Replace" targets the "character (series)" pattern, which lives in
  // characterTags/copyrightTags (general tags with a trailing "(qualifier)"
  // suffix, like e621's "(anatomy)"/"(marking)" tags, are NOT filtered out
  // below anymore — see invalidBracketOnly/wholeTagWrappedInParens further
  // down for exactly what still is), so it's applied right after parsing/
  // normalizing those two sources, before classification/exclusion run.
  const characterTagsArray = applyWordReplacementsToList(
    parseTagList(characterTags).map((t) => normalize(t)),
    options?.wordReplacements,
    collectReplacements,
  )
  const copyrightTagsArray = applyWordReplacementsToList(
    parseTagList(copyrightTags).map((t) => normalize(t)),
    options?.wordReplacements,
    collectReplacements,
  )
  
  // Meta tags for THIS post (post.tag_string_meta, passed by callers) unioned
  // with the curated list inside isMetaTag. Built through buildPostMetaTagSet so
  // it gets the same hyphen tolerance as META_TAGS_SET.
  const apiMetaTagsSet = buildPostMetaTagSet(options?.metaTags)

  // Sliding-window early removal for multi-word meta sequences when input is space-separated
  try {
    const multiWordRemovalBase = new Set<string>([
      ...Array.from(META_TAGS_SET).filter((t) => t.includes(" ")),
    ])
      // explicitly ensure both variants present
      ;["web address", "web_address"].forEach((v) => multiWordRemovalBase.add(normalize(v)))

    if (multiWordRemovalBase.size > 0 && allTags.length > 1) {
      const lowered = allTags.map((t) => normalize(t))
      const newTokens: string[] = []
      let i = 0
      while (i < lowered.length) {
        let matched = false
        for (let span = 4; span >= 2; span--) {
          if (i + span > lowered.length) continue
          const slice = lowered.slice(i, i + span)
          const candidateSpace = slice.join(" ")
          const candidateUnderscore = toUnderscore(candidateSpace)
          if (multiWordRemovalBase.has(candidateSpace) || multiWordRemovalBase.has(candidateUnderscore)) {
            i += span
            matched = true
            break
          }
        }
        if (!matched) {
          newTokens.push(allTags[i])
          i++
        }
      }
      if (newTokens.length !== allTags.length) allTags = newTokens
    }
  } catch {
    // ignore
  }

  const normalizedCharacterSet = new Set(
    characterTagsArray.reduce<string[]>((acc, t) => {
      const n = normalize(t)
      if (n.length > 0) acc.push(n)
      return acc
    }, []),
  )
  const normalizedCopyrightSet = new Set(
    copyrightTagsArray.reduce<string[]>((acc, t) => {
      const n = normalize(t)
      if (n.length > 0) acc.push(n)
      return acc
    }, []),
  )

  // Filtering rules
  const numberRegex = /^\d+$/
  const hasUrlLike = /:/ // simple heuristic for schemes
  // Square/curly brackets are near-always leftover wildcard/weight syntax
  // that failed to parse (e.g. "{tag}", "[tag]") rather than real tag
  // content — booru tag vocabularies don't use them. Parentheses are
  // different: many real content tags use a trailing "(qualifier)" suffix
  // for disambiguation that is NOT the "character (series)" pattern this
  // filter was originally trying to catch — e.g. e621's "(anatomy)" suffix
  // ("horn (anatomy)", "membrane (anatomy)") or "(marking)"/"(color)" on
  // creature-marking tags. Rejecting every tag containing ANY parenthesis
  // silently dropped that legitimate content. Only reject a tag when the
  // parenthesized part IS THE WHOLE TAG (optionally with a leading/trailing
  // weight-syntax colon-number, e.g. "(explicit content)" or
  // "(tag:1.3)") — that shape is never a real qualifier suffix, it's stray
  // weight/grouping syntax that leaked into a plain tag string.
  const invalidBracketOnly = /[\[\]{}]/
  const wholeTagWrappedInParens = /^\(.*\)$/

  const filteredTags = allTags.filter((raw) => {
    if (raw.length <= 1) return false
    const lower = raw.toLowerCase()

    if (artistTagsSet.has(lower)) return false
    if (artistTagsSet.has(normalize(lower))) return false
    if (isMetaTag(lower, apiMetaTagsSet)) return false
    if (numberRegex.test(raw)) return false
    if (raw.includes("@") || raw.includes("#") || hasUrlLike.test(raw)) return false
    if (invalidBracketOnly.test(raw)) return false
    if (wholeTagWrappedInParens.test(raw.trim())) return false

    return true
  })

  // Resolve replacements before capturing append-rule sources. The source
  // snapshot deliberately precedes user exclusions so generated tags pass
  // through the same final exclusion logic as every other content tag.
  const normalizedContentTags = applyWordReplacementsToList(
    filteredTags.map((t) => normalize(t)),
    options?.wordReplacements,
    collectReplacements,
  )
  const formatted = normalizedContentTags.filter((tag) => !userExcludeSet.has(tag))

  const appendSourceTags = [
    ...normalizedContentTags,
    ...characterTagsArray,
    ...copyrightTagsArray,
  ]
  const appendedTags = collectTagAppends(
    Array.from(new Set(appendSourceTags)),
    options?.tagAppendRules,
    collectAppends,
  ).filter((tag) => !userExcludeSet.has(tag))

  const processedInput = [...formatted, ...appendedTags]
  const processed = optimizeAll ? optimizeTags(processedInput) : processedInput

  // Partition quality vs content
  const qualityTags: string[] = []
  const contentTags: string[] = []
  for (const t of processed) {
    if (QUALITY_TAGS_SET.has(t)) qualityTags.push(t)
    else contentTags.push(t)
  }

  // Classify content tags. Emission order comes from the taxonomy's canonical
  // order (Appearance -> Clothing -> Pose -> Scenery -> Other), so a new
  // category slots in without touching this.
  const classified = classifyTags(contentTags, options?.tagOverrides)
  let sortedContentTags = TAG_CATEGORY_IDS.flatMap((category) => classified[category])

  // Optional: Process Backgrounds based on rules
  if (options?.backgroundMode && Array.isArray(sortedContentTags)) {
    sortedContentTags = processBackgroundTags(
      sortedContentTags,
      options.backgroundMode,
      options.simpleBackgroundReplacementTags,
      options.tagOverrides,
      {
        patternsEnabled: options.randomBackgroundPatterns,
        includeGradients: options.randomBackgroundIncludeGradients,
      },
      options.detailedBackgroundsList,
      options.backgroundSeed,
      options.backgroundContext,
      options.backgroundMatchStrictness,
    )
  }

  const characterAndFranchiseTags = [
    ...(includeCharacters ? characterTagsArray : []),
    ...(includeCopyrights ? copyrightTagsArray : []),
  ]
    .map((t) => normalize(t))
    .filter(Boolean)

  const allFinal = new Set<string>()

  // 1. User Added Tags
  const addedTagsProcessed = applyWordReplacementsToList(
    (options?.addedTags || [])
      // .flatMap((t) => parseTagList(t)) // Don't split spaces in added tags (fixes "red eyes" -> "red, eyes")
      .map((t) => normalize(t))
      .filter((t) => !userExcludeSet.has(t)),
    options?.wordReplacements,
    collectReplacements,
  )

  for (const t of addedTagsProcessed) allFinal.add(t)

  // 2. Character / Copyright
  for (const t of characterAndFranchiseTags) {
    if (!userExcludeSet.has(t)) allFinal.add(t)
  }

  // 3. Content Tags (Ordered) + Quality Tags (at end)
  const combinedPre = [...sortedContentTags, ...qualityTags]

  for (const t of combinedPre) {
    if (!includeCharacters && normalizedCharacterSet.has(t)) continue
    if (!includeCopyrights && normalizedCopyrightSet.has(t)) continue
    if (!includeCharacters && (t.startsWith("official ") || t.startsWith("alternate "))) continue
    if (userExcludeSet.has(t)) continue
    allFinal.add(t)
  }

  const shouldEscape = options?.escapeOutput !== false
  const addedTagsSet = new Set(addedTagsProcessed)

  if (wordReplacementsApplied.length > 0) {
    options?.onWordReplacementsApplied?.(wordReplacementsApplied)
  }
  if (tagAppendsApplied.length > 0) {
    options?.onTagAppendsApplied?.(tagAppendsApplied)
  }

  // Classification determines the canonical order for ordinary tags. Append
  // targets intentionally override that order so each target stays immediately
  // after the source tag that generated it. Rules were already evaluated only
  // against the source snapshot, so this traversal cannot create new matches.
  const orderedTags = (() => {
    const baseTags = Array.from(allFinal)
    if (tagAppendsApplied.length === 0) return baseTags

    const finalTagSet = new Set(baseTags)
    const appendBySource = new Map<string, string[]>()
    const appendTargets = new Set<string>()

    for (const { from, append } of tagAppendsApplied) {
      if (!finalTagSet.has(from)) continue

      const targets = appendBySource.get(from) || []
      for (const tag of append) {
        if (!finalTagSet.has(tag) || targets.includes(tag)) continue
        targets.push(tag)
        appendTargets.add(tag)
      }
      if (targets.length > 0) appendBySource.set(from, targets)
    }

    if (appendBySource.size === 0) return baseTags

    const ordered: string[] = []
    const emitted = new Set<string>()
    const emitWithAppends = (tag: string) => {
      if (emitted.has(tag) || !finalTagSet.has(tag)) return

      emitted.add(tag)
      ordered.push(tag)
      for (const appendedTag of appendBySource.get(tag) || []) {
        emitWithAppends(appendedTag)
      }
    }

    // Do not emit an append target in its canonical position before the source.
    for (const tag of baseTags) {
      if (!appendTargets.has(tag)) emitWithAppends(tag)
    }
    // Preserves targets whose source was filtered from the final prompt.
    for (const tag of baseTags) emitWithAppends(tag)

    return ordered
  })()

  const finalTags = orderedTags
    .map((t) => (shouldEscape && !addedTagsSet.has(t) ? escapeParentheses(t) : t))

  // Anima-style "@artist" invocation: prepended raw (never escaped/normalized
  // like a regular tag) so it reaches the model exactly as "@artistname".
  const artistTag = options?.prependArtistTag?.trim()
  if (artistTag) {
    return [`@${artistTag}`, ...finalTags].join(", ")
  }

  return finalTags.join(", ")
}
