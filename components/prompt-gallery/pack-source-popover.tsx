"use client"

/**
 * Pack Mode's "source of variations" popover — the rating/solo/tags-source/
 * provider questions that used to be a mandatory modal (PackSetupModal),
 * moved into a popover the builder's header opens on demand (design spec
 * §2.2). Same logic as before, just relocated: nothing about tag-limit
 * checking, provider recommendation, or the answers shape changed.
 */
import { useEffect, useMemo, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Search, Pencil, Ban, Users, User, AlertTriangle, SlidersHorizontal } from "lucide-react"
import type { PackRatingMode } from "@/hooks/use-pack-seed-search"
import { hasMultipleTags, getProviderTagLimit, type BooruProvider } from "@/lib/api-client"

export type PackTagsSource = "current" | "custom" | "empty"

export interface PackSourceAnswers {
  ratingMode: PackRatingMode
  soloOnly: boolean
  tagsSource: PackTagsSource
  /** The actual tags to search — resolved from tagsSource at Apply time
   *  (currentSearchTags when "current", the edited draft when "custom", ""
   *  when "empty"). Kept separate from tagsSource so callers don't need to
   *  re-derive it. */
  searchTags: string
  /** Which booru to sample from — independent of the main gallery's tab. */
  booruProvider: BooruProvider
}

/** Back-compat alias — the answers shape used to live in pack-setup-modal.tsx. */
export type PackSetupAnswers = PackSourceAnswers

export interface PackSourcePopoverProps {
  /** Currently-applied answers — also this popover's draft starting point every time it opens. */
  answers: PackSourceAnswers
  onApply: (answers: PackSourceAnswers) => void
  /** The main gallery's current search tags — used as the "Current search" option. */
  currentSearchTags: string
  /** How many posts are currently loaded for these answers, shown on the trigger chip. */
  postCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
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

export const PROVIDERS: BooruProvider[] = ['danbooru', 'gelbooru', 'aibooru', 'rule34', 'e621']
export const PROVIDER_LABELS: Record<BooruProvider, string> = {
  danbooru: 'Danbooru',
  gelbooru: 'Gelbooru',
  aibooru: 'Aibooru',
  rule34: 'Rule34',
  e621: 'e621',
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
 *  manually since one is UI-only and the other is the real fetch input). */
function buildEffectiveTagsForCount(customTags: string, soloOnly: boolean): string {
  const userTags = customTags.split(",").map((t) => t.trim()).filter(Boolean)
  if (!soloOnly) return userTags.join(", ")
  const alreadyHasSolo = userTags.some((t) => normalizeForDedup(t) === "solo")
  return (alreadyHasSolo ? userTags : [...userTags, "solo"]).join(", ")
}

/** Picks the best alternative provider for a given tag count: the smallest
 *  limit that still fits everything, falling back to the most permissive
 *  provider if nothing fits. Never recommends the provider already selected. */
function recommendProvider(tagCount: number, exclude: BooruProvider): BooruProvider | null {
  const candidates = PROVIDERS.filter((p) => p !== exclude)
  const fitting = candidates
    .filter((p) => getProviderTagLimit(p) >= tagCount)
    .sort((a, b) => getProviderTagLimit(a) - getProviderTagLimit(b))
  if (fitting.length > 0) return fitting[0]
  const mostPermissive = [...candidates].sort((a, b) => getProviderTagLimit(b) - getProviderTagLimit(a))[0]
  return mostPermissive ?? null
}

/** Short label for the trigger chip, e.g. "NSFW · Explicit · Gelbooru". */
export function summarizePackSourceAnswers(answers: PackSourceAnswers): string {
  const rating = answers.ratingMode === "sfw" ? "SFW" : answers.ratingMode === "both" ? "NSFW · Both" : `NSFW · ${answers.ratingMode[0].toUpperCase()}${answers.ratingMode.slice(1)}`
  return `${rating} · ${PROVIDER_LABELS[answers.booruProvider]}`
}

export function PackSourcePopover({ answers, onApply, currentSearchTags, postCount, open, onOpenChange, children }: PackSourcePopoverProps) {
  const [ratingTier, setRatingTier] = useState<"sfw" | "nsfw">(answers.ratingMode === "sfw" ? "sfw" : "nsfw")
  const [nsfwSub, setNsfwSub] = useState<"questionable" | "explicit" | "both">(
    answers.ratingMode === "sfw" ? "questionable" : answers.ratingMode
  )
  const [soloOnly, setSoloOnly] = useState(answers.soloOnly)
  const [tagsSource, setTagsSource] = useState<PackTagsSource>(answers.tagsSource)
  const [customTags, setCustomTags] = useState(answers.tagsSource === "custom" ? answers.searchTags : currentSearchTags)
  const [booruProvider, setBooruProvider] = useState<BooruProvider>(answers.booruProvider)

  // Reset the draft to the currently-applied answers every time the popover
  // opens, so a cancelled edit (closing without Apply) never leaks in next time.
  /* eslint-disable react-hooks/set-state-in-effect -- mirrors the externally-
     applied `answers` prop into local draft state on open; not derived from
     render inputs (the draft must diverge from `answers` while being edited). */
  useEffect(() => {
    if (!open) return
    setRatingTier(answers.ratingMode === "sfw" ? "sfw" : "nsfw")
    setNsfwSub(answers.ratingMode === "sfw" ? "questionable" : answers.ratingMode)
    setSoloOnly(answers.soloOnly)
    setTagsSource(answers.tagsSource)
    setCustomTags(answers.tagsSource === "custom" ? answers.searchTags : currentSearchTags)
    setBooruProvider(answers.booruProvider)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  /* eslint-enable react-hooks/set-state-in-effect */

  const effectiveTags = tagsSource === "current" ? currentSearchTags : tagsSource === "custom" ? customTags : ""

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

  const handleApply = () => {
    onApply({ ratingMode, soloOnly, tagsSource, searchTags: effectiveTags, booruProvider })
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80 max-h-[70vh] overflow-y-auto space-y-4" align="end">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Source of variations
          <span className="ml-auto normal-case font-normal text-[11px]">{postCount} posts loaded</span>
        </div>

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
                  className={`relative overflow-hidden flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium rounded-md border transition-all duration-200 ${isSelected ? 'bg-mode-pack-soft border-mode-pack-border text-mode-pack-text shadow-sm' : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
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
                    className={`relative overflow-hidden flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium rounded-md border transition-all duration-200 ${isSelected ? 'bg-warning-soft border-warning-border text-warning-text shadow-sm' : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
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
            {soloOnly ? <User className="w-4 h-4 text-mode-pack-text" /> : <Users className="w-4 h-4 text-muted-foreground" />}
            <div>
              <Label htmlFor="pack-source-solo-only" className="text-xs font-medium cursor-pointer">Solo character only</Label>
              <p className="text-[10px] text-muted-foreground">Adds the &quot;solo&quot; tag. Skipped if already in your tags below.</p>
            </div>
          </div>
          <Switch id="pack-source-solo-only" checked={soloOnly} onCheckedChange={setSoloOnly} />
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
                  className={`relative overflow-hidden flex items-center justify-center py-2 text-[11px] font-medium rounded-md border transition-all duration-200 ${isSelected ? 'bg-mode-pack-soft border-mode-pack-border text-mode-pack-text shadow-sm' : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
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
              className={`relative overflow-hidden flex items-center justify-center gap-1 py-2 text-[11px] font-medium rounded-md border transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${tagsSource === "current" ? 'bg-mode-pack-soft border-mode-pack-border text-mode-pack-text shadow-sm' : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
            >
              <Search className="w-3 h-3" />
              Current
            </button>
            <button
              type="button"
              onClick={() => setTagsSource("custom")}
              className={`relative overflow-hidden flex items-center justify-center gap-1 py-2 text-[11px] font-medium rounded-md border transition-all duration-200 ${tagsSource === "custom" ? 'bg-mode-pack-soft border-mode-pack-border text-mode-pack-text shadow-sm' : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
            >
              <Pencil className="w-3 h-3" />
              Custom
            </button>
            <button
              type="button"
              onClick={() => setTagsSource("empty")}
              className={`relative overflow-hidden flex items-center justify-center gap-1 py-2 text-[11px] font-medium rounded-md border transition-all duration-200 ${tagsSource === "empty" ? 'bg-mode-pack-soft border-mode-pack-border text-mode-pack-text shadow-sm' : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
            >
              <Ban className="w-3 h-3" />
              Empty
            </button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            {tagsSource === "current" && "Samples only from posts matching your current search tags."}
            {tagsSource === "custom" && "Samples only from posts matching the tags you type below."}
            {tagsSource === "empty" && "Samples from general, unfiltered results — the widest pool."}
          </p>

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

          {tagLimitWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-soft p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 text-warning-text flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <p className="text-[11px] text-warning-text">
                  {PROVIDER_LABELS[booruProvider]} only allows {tagLimitWarning.limit} search tag{tagLimitWarning.limit === 1 ? '' : 's'} — you have {tagLimitWarning.tagCount}. The rest will be dropped.
                </p>
                {tagLimitWarning.recommended && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] px-2 border-warning-border text-warning-text hover:bg-warning-soft"
                    onClick={() => setBooruProvider(tagLimitWarning.recommended!)}
                  >
                    Switch to {PROVIDER_LABELS[tagLimitWarning.recommended]} ({getProviderTagLimit(tagLimitWarning.recommended) === Infinity ? 'no limit' : `up to ${getProviderTagLimit(tagLimitWarning.recommended)} tags`})
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" size="sm" onClick={handleApply}>Apply</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
