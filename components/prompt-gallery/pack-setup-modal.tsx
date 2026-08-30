"use client"

/**
 * Pack Mode's pre-seeding questionnaire. Shown once a card is picked as the
 * pack base, BEFORE any post is fetched — the answers here configure Pack
 * Mode's own, independent seeding fetch (hooks/use-pack-seed-search.ts),
 * separate from the main gallery's search bar / rating filter. Confirming
 * this modal is the ONLY thing that triggers the first fetch (see
 * PackSeedFetcher in prompt-gallery.tsx, which only mounts — and therefore
 * only calls usePackSeedSearch — after this resolves).
 */
import { useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Package, Search, Pencil, Ban, Users, User, AlertTriangle, Shirt, Mountain, Smile } from "lucide-react"
import type { PackRatingMode } from "@/hooks/use-pack-seed-search"
import { hasMultipleTags, getProviderTagLimit, type BooruProvider, type BooruPost } from "@/lib/api-client"
import { classifyPostForPack } from "@/lib/pack/pack-generator"
import type { TagCategory } from "@/lib/tag-classifier"
import { TagAutocompleteTextarea } from "./tag-autocomplete-textarea"

export type PackTagsSource = "current" | "custom" | "empty"

export interface PackSetupAnswers {
  ratingMode: PackRatingMode
  soloOnly: boolean
  tagsSource: PackTagsSource
  /** The actual tags to search — resolved from tagsSource at confirm time
   *  (currentSearchTags when "current", the edited draft when "custom", ""
   *  when "empty"). Kept separate from tagsSource so callers don't need to
   *  re-derive it. */
  searchTags: string
  /** Which booru to sample from — independent of the main gallery's tab. */
  booruProvider: BooruProvider
}

export interface PackSetupModalProps {
  isOpen: boolean
  /** The card picked as the pack's base — shown here so the user can see
   *  exactly what's really being pulled from it (tags, by category) while
   *  configuring the rest, before any post is fetched. */
  baseCard: BooruPost | null
  /** The main gallery's current search tags — used as the "Current search"
   *  option and as the starting point if the user switches to "Custom". */
  currentSearchTags: string
  /** The main gallery's currently selected provider — used as this modal's
   *  starting point (the user can still switch it just for this pack). */
  currentBooruProvider: BooruProvider
  /** Pack Mode's free-text base prompt (usePackMode's customBaseText) — shown
   *  here in place of the "From your base card" preview when there's no base
   *  card (the "Full Setup" flow), since that's the only source of constant
   *  tags a baseless pack has. Same field the pack builder footer edits;
   *  wiring it up here too lets the user fill it in before the builder even
   *  opens instead of hunting for it afterward. */
  customBaseText: string
  onCustomBaseTextChange: (text: string) => void
  onConfirm: (answers: PackSetupAnswers) => void
  onCancel: () => void
}

const RATING_OPTIONS: { value: "sfw" | "nsfw"; label: string; description: string }[] = [
  { value: "sfw", label: "SFW", description: "Safe only — no explicit content" },
  { value: "nsfw", label: "NSFW", description: "Adult content" },
]

const NSFW_SUB_OPTIONS: { value: "questionable" | "explicit" | "both"; label: string; description: string }[] = [
  { value: "questionable", label: "Questionable", description: "Mostly nudity, no explicit acts" },
  { value: "explicit", label: "Explicit", description: "Fully explicit content" },
  { value: "both", label: "Both", description: "Half questionable, half explicit" },
]

const PROVIDERS: BooruProvider[] = ['danbooru', 'gelbooru', 'aibooru', 'rule34', 'e621']
const PROVIDER_LABELS: Record<BooruProvider, string> = {
  danbooru: 'Danbooru',
  gelbooru: 'Gelbooru',
  aibooru: 'Aibooru',
  rule34: 'Rule34',
  e621: 'e621',
}

const CATEGORY_ORDER: TagCategory[] = ['appearance', 'clothing', 'pose', 'scenery', 'other']
const CATEGORY_ICON: Record<TagCategory, typeof Smile> = {
  appearance: Smile,
  pose: User,
  clothing: Shirt,
  scenery: Mountain,
  other: Package,
}
const CATEGORY_CHIP_CLASS: Record<TagCategory, string> = {
  appearance: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
  pose: 'text-purple-500 bg-purple-500/10 border-purple-500/20',
  clothing: 'text-green-500 bg-green-500/10 border-green-500/20',
  scenery: 'text-orange-500 bg-orange-500/10 border-orange-500/20',
  other: 'text-muted-foreground bg-muted border-transparent',
}

/** Counts how many limit-consuming tags a raw comma-separated string has —
 *  same "free metatag" rules as lib/booru/tag-limits.ts's own counting, but
 *  exposed here as a plain count (not a boolean) so the UI can say exactly
 *  how many tags are over the limit, not just that it's exceeded. */
function countUserTags(tags: string): number {
  return tags.split(',').map((t) => t.trim()).filter(Boolean).length
}

function normalizeForDedup(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "_")
}

/** Builds the exact tag string that will actually be sent for seeding —
 *  same logic as buildTags in hooks/use-pack-seed-search.ts (kept in sync
 *  manually since one is UI-only and the other is the real fetch input).
 *  Needed so the tag-limit warning below counts what's REALLY going out,
 *  including the "solo" tag the switch above adds — someone who both flips
 *  "Solo character only" on AND types "solo" into Custom manually should see
 *  one tag counted, not two, and should see the count that already accounts
 *  for the switch's own addition when it's on. */
function buildEffectiveTagsForCount(customTags: string, soloOnly: boolean): string {
  const userTags = customTags.split(",").map((t) => t.trim()).filter(Boolean)
  if (!soloOnly) return userTags.join(", ")
  const alreadyHasSolo = userTags.some((t) => normalizeForDedup(t) === "solo")
  return (alreadyHasSolo ? userTags : [...userTags, "solo"]).join(", ")
}

/** Picks the best alternative provider for a given tag count: the smallest
 *  limit that still fits everything (minimizes truncation elsewhere the user
 *  might not expect), falling back to the most permissive (Infinity) provider
 *  if nothing fits. Never recommends the provider already selected. */
function recommendProvider(tagCount: number, exclude: BooruProvider): BooruProvider | null {
  const candidates = PROVIDERS.filter((p) => p !== exclude)
  const fitting = candidates
    .filter((p) => getProviderTagLimit(p) >= tagCount)
    .sort((a, b) => getProviderTagLimit(a) - getProviderTagLimit(b))
  if (fitting.length > 0) return fitting[0]
  // Nothing fits exactly — recommend the most permissive provider available.
  const mostPermissive = [...candidates].sort((a, b) => getProviderTagLimit(b) - getProviderTagLimit(a))[0]
  return mostPermissive ?? null
}

export function PackSetupModal({ isOpen, baseCard, currentSearchTags, currentBooruProvider, customBaseText, onCustomBaseTextChange, onConfirm, onCancel }: PackSetupModalProps) {
  const [ratingTier, setRatingTier] = useState<"sfw" | "nsfw">("sfw")
  const [nsfwSub, setNsfwSub] = useState<"questionable" | "explicit" | "both">("questionable")
  const [soloOnly, setSoloOnly] = useState(false)
  const [tagsSource, setTagsSource] = useState<PackTagsSource>("empty")
  const [customTags, setCustomTags] = useState(currentSearchTags)
  const [booruProvider, setBooruProvider] = useState<BooruProvider>(currentBooruProvider)

  // What's REALLY being pulled from the chosen base card, classified into
  // the same 5 buckets Pack Mode itself uses (lib/pack/pack-generator.ts) —
  // shown up front so the user sees exactly what they're working with before
  // touching any of the questions below, not just an abstract "card #123".
  const baseClassified = useMemo(() => {
    if (!baseCard) return null
    return classifyPostForPack(baseCard)
  }, [baseCard])

  // A crossover/group-art base card lists more than one character in its
  // own tag_string_character. usePackMode already mitigates the worst case
  // (only the first character tag ends up locked, see its own docstring),
  // but the user should still see this BEFORE confirming — silently locking
  // in a base whose "character" is actually 6 unrelated names produces a
  // pack whose generated prompts mostly get rejected by Smart Tag Exclusion.
  const baseCharacterCount = useMemo(() => {
    if (!baseCard?.tag_string_character) return 0
    return new Set(baseCard.tag_string_character.trim().split(/\s+/).filter(Boolean)).size
  }, [baseCard])

  const effectiveTags = tagsSource === "current" ? currentSearchTags : tagsSource === "custom" ? customTags : ""

  // Tag-limit check — same pipeline every other search input already uses
  // (lib/booru/tag-limits.ts, surfaced via query-status-panel.tsx elsewhere).
  // Only meaningful for "custom" (the only source with truly free-form user
  // input here) — "current" mirrors the main search bar, which already warns
  // about this itself, and "empty" has nothing to exceed. Counts against the
  // EFFECTIVE tags (including the "solo" tag the switch above adds, deduped
  // if already typed manually) so the warning matches what's actually sent.
  const tagLimitWarning = useMemo(() => {
    if (tagsSource !== "custom") return null
    const effectiveCustomTags = buildEffectiveTagsForCount(customTags, soloOnly)
    if (!hasMultipleTags(effectiveCustomTags, booruProvider, 0)) return null
    const limit = getProviderTagLimit(booruProvider)
    const tagCount = countUserTags(effectiveCustomTags)
    const recommended = recommendProvider(tagCount, booruProvider)
    return { limit, tagCount, recommended }
  }, [tagsSource, customTags, soloOnly, booruProvider])

  const ratingMode: PackRatingMode = ratingTier === "sfw" ? "sfw" : nsfwSub

  const handleConfirm = () => {
    onConfirm({
      ratingMode,
      soloOnly,
      tagsSource,
      searchTags: effectiveTags,
      booruProvider,
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="max-w-lg" onEscapeKeyDown={onCancel}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            Set up your pack
          </DialogTitle>
          <DialogDescription>
            Quick questions to shape which posts Pack Mode samples from — nothing is fetched until you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* What's actually in the chosen base — the real tags Pack Mode
              will pull from it, classified by category, before any of the
              questions below are even answered. Read-only preview. */}
          {baseClassified ? (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                From your base card {baseCard && `(#${baseCard.id})`}
              </Label>
              <div className="rounded-lg border border-border/50 bg-muted/30 p-2.5 space-y-2 max-h-48 overflow-y-auto">
                {CATEGORY_ORDER.filter((cat) => baseClassified[cat].length > 0).map((cat) => {
                  const Icon = CATEGORY_ICON[cat]
                  return (
                    <div key={cat} className="flex items-start gap-2">
                      <div className="flex items-center gap-1 w-20 flex-shrink-0 pt-0.5">
                        <Icon className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[10px] font-medium text-muted-foreground capitalize">{cat}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 flex-1">
                        {baseClassified[cat].map((tag) => (
                          <span
                            key={tag}
                            className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${CATEGORY_CHIP_CLASS[cat]}`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {CATEGORY_ORDER.every((cat) => baseClassified[cat].length === 0) && (
                  <p className="text-[11px] text-muted-foreground italic">No usable tags found on this card.</p>
                )}
              </div>
              {baseCharacterCount > 1 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    This card lists {baseCharacterCount} characters. Only the first one will be locked as the pack&apos;s constant
                    character — the rest are excluded from every generated prompt. Pick a single-character card as the base if
                    you want a clean character pack.
                  </p>
                </div>
              )}
            </div>
          ) : (
            // Full Setup (no base card): the only source of tags that stay
            // constant across every generated prompt is this free-text base
            // prompt — same field the pack builder footer edits (usePackMode's
            // customBaseText), shown here up front instead of leaving the user
            // to hunt for it after confirming.
            <div className="space-y-1.5">
              <Label htmlFor="pack-setup-custom-base" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Base prompt (always included)
              </Label>
              <TagAutocompleteTextarea
                id="pack-setup-custom-base"
                value={customBaseText}
                onValueChange={onCustomBaseTextChange}
                placeholder="e.g. 1girl, mona (genshin impact), masterpiece..."
                className="text-xs font-mono min-h-[4.5rem] max-h-40 resize-none"
              />
            </div>
          )}

          {/* Rating */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Content rating</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {RATING_OPTIONS.map((opt) => {
                const isSelected = ratingTier === opt.value
                return (
                    <button
                        type="button"
                        key={opt.value}
                        onClick={() => setRatingTier(opt.value)}
                        className={`relative overflow-hidden flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium rounded-md border transition-all duration-200 ${isSelected ? 'bg-teal-500/15 border-teal-500/30 text-teal-600 dark:text-teal-400 shadow-sm' : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                    >
                        <span>{opt.label}</span>
                        <span className="text-[10px] font-normal opacity-70">{opt.description}</span>
                    </button>
                )
              })}
            </div>

            {ratingTier === "nsfw" && (
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                {NSFW_SUB_OPTIONS.map((opt) => {
                  const isSelected = nsfwSub === opt.value
                  return (
                    <button
                        type="button"
                        key={opt.value}
                        onClick={() => setNsfwSub(opt.value)}
                        className={`relative overflow-hidden flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium rounded-md border transition-all duration-200 ${isSelected ? 'bg-orange-500/15 border-orange-500/30 text-orange-600 dark:text-orange-400 shadow-sm' : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                    >
                        <span>{opt.label}</span>
                        <span className="text-[9px] font-normal opacity-70 leading-tight text-center">{opt.description}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Solo character */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              {soloOnly ? <User className="w-4 h-4 text-teal-600 dark:text-teal-400" /> : <Users className="w-4 h-4 text-muted-foreground" />}
              <div>
                <Label htmlFor="pack-solo-only" className="text-xs font-medium cursor-pointer">Solo character only</Label>
                <p className="text-[10px] text-muted-foreground">Adds the &quot;solo&quot; tag — mostly single-character results. Skipped if already in your tags below.</p>
              </div>
            </div>
            <Switch id="pack-solo-only" checked={soloOnly} onCheckedChange={setSoloOnly} />
          </div>

          {/* Provider */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sample from</Label>
            <div className="grid grid-cols-5 gap-1.5">
              {PROVIDERS.map((p) => {
                const isSelected = booruProvider === p
                return (
                  <button
                    type="button"
                    key={p}
                    onClick={() => setBooruProvider(p)}
                    className={`relative overflow-hidden flex items-center justify-center py-2 text-[11px] font-medium rounded-md border transition-all duration-200 ${isSelected ? 'bg-teal-500/15 border-teal-500/30 text-teal-600 dark:text-teal-400 shadow-sm' : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                  >
                    {PROVIDER_LABELS[p]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Tags source */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Posts to sample from</Label>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => setTagsSource("current")}
                disabled={!currentSearchTags.trim()}
                className={`relative overflow-hidden flex items-center justify-center gap-1 py-2 text-[11px] font-medium rounded-md border transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${tagsSource === "current" ? 'bg-teal-500/15 border-teal-500/30 text-teal-600 dark:text-teal-400 shadow-sm' : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
              >
                <Search className="w-3 h-3" />
                Current search
              </button>
              <button
                type="button"
                onClick={() => setTagsSource("custom")}
                className={`relative overflow-hidden flex items-center justify-center gap-1 py-2 text-[11px] font-medium rounded-md border transition-all duration-200 ${tagsSource === "custom" ? 'bg-teal-500/15 border-teal-500/30 text-teal-600 dark:text-teal-400 shadow-sm' : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
              >
                <Pencil className="w-3 h-3" />
                Custom
              </button>
              <button
                type="button"
                onClick={() => setTagsSource("empty")}
                className={`relative overflow-hidden flex items-center justify-center gap-1 py-2 text-[11px] font-medium rounded-md border transition-all duration-200 ${tagsSource === "empty" ? 'bg-teal-500/15 border-teal-500/30 text-teal-600 dark:text-teal-400 shadow-sm' : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
              >
                <Ban className="w-3 h-3" />
                Empty
              </button>
            </div>

            {/* Explains what each option actually samples from — "empty" in
                particular isn't self-explanatory (it still returns posts,
                just unfiltered ones), and it's the one to recommend when the
                goal is variety (clothing, poses, etc.) rather than a specific
                character/series. */}
            <p className="text-[11px] text-muted-foreground">
              {tagsSource === "current" && "Samples only from posts matching your current search tags — narrower pool, closer to what you already searched."}
              {tagsSource === "custom" && "Samples only from posts matching the tags you type below — narrower pool, targeted at something specific."}
              {tagsSource === "empty" && "Samples from general, unfiltered results — the widest and most varied pool. Recommended if you want variety in clothing, poses, scenery, etc."}
            </p>

            {/* Preview — becomes an editable field only in "custom" mode. In
                "current"/"empty" it's a read-only preview of what will
                actually be searched (including the rating + solo additions),
                so there's no ambiguity about what's about to be fetched. */}
            {tagsSource === "custom" ? (
              <Textarea
                value={customTags}
                onChange={(e) => setCustomTags(e.target.value)}
                placeholder="e.g. mona (genshin impact), 1girl"
                className="text-xs font-mono min-h-[3rem] resize-none"
              />
            ) : (
              <div className="text-xs font-mono min-h-[3rem] rounded-md border border-border/50 bg-muted/30 p-2.5 text-muted-foreground">
                {tagsSource === "empty"
                  ? <span className="italic">No tags — samples from general results</span>
                  : (currentSearchTags.trim() || <span className="italic">No tags in the current search</span>)}
              </div>
            )}

            {/* Tag-limit warning — only "custom" can exceed it here (see
                tagLimitWarning above). Recommends the least-restrictive
                provider that still fits every tag, one click to switch. */}
            {tagLimitWarning && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1.5">
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    {PROVIDER_LABELS[booruProvider]} only allows {tagLimitWarning.limit} search tag{tagLimitWarning.limit === 1 ? '' : 's'} — you have {tagLimitWarning.tagCount}. The rest will be dropped.
                  </p>
                  {tagLimitWarning.recommended && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2 border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15"
                      onClick={() => setBooruProvider(tagLimitWarning.recommended!)}
                    >
                      Switch to {PROVIDER_LABELS[tagLimitWarning.recommended]} ({getProviderTagLimit(tagLimitWarning.recommended) === Infinity ? 'no limit' : `up to ${getProviderTagLimit(tagLimitWarning.recommended)} tags`})
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="button" onClick={handleConfirm}>
            <Package className="w-3.5 h-3.5 mr-1.5" />
            Start sampling
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
