"use client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AlertTriangle, EyeOff, Infinity as InfinityIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  hasMultipleTags,
  getFinalQueryTagsWithMeta,
  getProviderTagLimit,
  detectMisusedMetatags,
  type BooruProvider,
  type ScoreTier,
} from "@/lib/api-client"

interface QueryStatusPanelProps {
  searchTags: string
  ratingFilter: string
  order: string
  appliedTagCountFilter: string
  appliedScoreTier: ScoreTier
  booruProvider: BooruProvider
  /**
   * "card" (default) is the boxed breakdown with a usage bar (extension side
   * panel). "inline" is a single quiet line for right under the main search
   * input: query chips on the left, slot usage (+ blacklist count) on the right.
   */
  variant?: "card" | "inline"
  /** Shown on the inline variant's right side when > 0. */
  blacklistCount?: number
}

/**
 * Search status area below the filters form: the "Active Query" breakdown
 * (per-tag limit usage bar + tooltip explaining which tags count towards the
 * provider's tag limit), the "API limit" warning when too many tags were
 * typed, and warnings for manually-typed metatags (rating:/order:/tagcount:)
 * that are invalid or misleading on the selected provider.
 */
export function QueryStatusPanel({
  searchTags,
  ratingFilter,
  order,
  appliedTagCountFilter,
  appliedScoreTier,
  booruProvider,
  variant = "card",
  blacklistCount = 0,
}: QueryStatusPanelProps) {
  return (
    <div className="space-y-2">
      {/* Active Query Display */}
      {variant === "inline" && (() => {
        const queryMeta = getFinalQueryTagsWithMeta(searchTags, ratingFilter, order, appliedTagCountFilter, booruProvider, appliedScoreTier)
        const isUnlimited = queryMeta.slotLimit === Infinity
        const isAtLimit = !isUnlimited && queryMeta.slotsUsed >= queryMeta.slotLimit
        const providerLabel = booruProvider.charAt(0).toUpperCase() + booruProvider.slice(1)

        return (
          <div className="flex flex-col gap-1.5 px-0.5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="hidden sm:inline">Sending to {providerLabel}:</span>
              {queryMeta.tags.map((tag, index) => (
                <Tooltip key={`${tag.value}-${index}`}>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        "cursor-help rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/80",
                        tag.dropped && "line-through text-destructive-text/80 bg-destructive/10"
                      )}
                    >
                      {tag.value}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {tag.dropped
                      ? `Dropped — ${providerLabel}'s ${queryMeta.slotLimit}-tag limit was already reached.`
                      : tag.countsTowardsLimit
                        ? isUnlimited ? "Counted, but this provider has no tag limit" : "Counts towards the tag limit"
                        : "Free — doesn't count towards the tag limit"}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-3.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn("flex cursor-help items-center gap-1.5", isAtLimit && "text-warning-text")}>
                    {isUnlimited ? (
                      <>
                        <InfinityIcon className="h-3.5 w-3.5" />
                        No tag limit
                      </>
                    ) : (
                      <>
                        <span className="flex gap-0.5" aria-hidden="true">
                          {Array.from({ length: Math.min(queryMeta.slotLimit, 6) }, (_, i) => (
                            <span
                              key={i}
                              className={cn(
                                "h-1.5 w-3.5 rounded-full transition-colors duration-150 ease-out",
                                i < queryMeta.slotsUsed ? (isAtLimit ? "bg-warning" : "bg-primary") : "bg-muted-foreground/25"
                              )}
                            />
                          ))}
                        </span>
                        {queryMeta.slotsUsed} of {queryMeta.slotLimit} tag slots used
                      </>
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[260px] text-xs">
                  {isUnlimited
                    ? `${providerLabel} has no documented tag limit — add as many tags as you like.`
                    : `${providerLabel} allows ${queryMeta.slotLimit} tag${queryMeta.slotLimit === 1 ? '' : 's'} per search. Filters like rating and tag count don't count against this limit, but order/random and every plain or excluded (-tag) tag do.`}
                </TooltipContent>
              </Tooltip>
              {blacklistCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <EyeOff className="h-3.5 w-3.5" />
                  {blacklistCount} tag{blacklistCount === 1 ? '' : 's'} blacklisted
                </span>
              )}
            </div>
          </div>
        )
      })()}

      {variant === "card" && (() => {
        const queryMeta = getFinalQueryTagsWithMeta(searchTags, ratingFilter, order, appliedTagCountFilter, booruProvider, appliedScoreTier)
        const hasPromptTag = booruProvider === "aibooru" && searchTags.includes("has:prompt")

        const isUnlimited = queryMeta.slotLimit === Infinity
        const isAtLimit = !isUnlimited && queryMeta.slotsUsed >= queryMeta.slotLimit
        const providerLabel = booruProvider.charAt(0).toUpperCase() + booruProvider.slice(1)

        return (
          <div className="flex flex-col gap-2 text-xs text-foreground/80 bg-muted/30 p-2 rounded-md border border-border/30">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Active Query:</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn(
                    "flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full border cursor-help",
                    isUnlimited
                      ? "border-info-border bg-info-soft text-info-text"
                      : isAtLimit
                        ? "border-warning-border bg-warning-soft text-warning-text"
                        : "border-border/50 bg-background/60 text-muted-foreground"
                  )}>
                    {isUnlimited ? (
                      <>
                        <InfinityIcon className="h-3 w-3" />
                        {queryMeta.slotsUsed} tag{queryMeta.slotsUsed === 1 ? '' : 's'} used
                      </>
                    ) : (
                      `${queryMeta.slotsUsed}/${queryMeta.slotLimit} tags used`
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[260px] text-xs">
                  {isUnlimited
                    ? `${providerLabel} has no documented tag limit — add as many tags as you like.`
                    : `${providerLabel} allows ${queryMeta.slotLimit} tag${queryMeta.slotLimit === 1 ? '' : 's'} per search. Filters like rating and tag count don't count against this limit, but order/random and every plain or excluded (-tag) tag do.`}
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="h-1.5 w-full rounded-full bg-border/40 overflow-hidden">
              {isUnlimited ? (
                <div
                  className="h-full rounded-full bg-gradient-to-r from-info/70 via-info/30 to-transparent bg-[length:200%_100%] animate-[shimmer_2.5s_linear_infinite]"
                  style={{ width: '100%' }}
                />
              ) : (
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    isAtLimit ? "bg-warning" : "bg-primary/70"
                  )}
                  style={{ width: `${Math.min(100, (queryMeta.slotsUsed / queryMeta.slotLimit) * 100)}%` }}
                />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {queryMeta.tags.map((tag, index) => (
                <Tooltip key={`${tag.value}-${index}`}>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px] px-1.5 py-0 h-5 font-mono cursor-help",
                        tag.dropped && "opacity-50 line-through border border-destructive/40 text-destructive-text/80 bg-destructive/5",
                        !tag.dropped && tag.countsTowardsLimit && (isUnlimited ? "border border-info-border" : "border border-primary/30"),
                        !tag.dropped && !tag.countsTowardsLimit && "border border-success-border text-success-text bg-success-soft"
                      )}
                    >
                      {tag.value}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {tag.dropped
                      ? `Dropped — ${providerLabel}'s ${queryMeta.slotLimit}-tag limit was already reached.`
                      : tag.countsTowardsLimit
                        ? isUnlimited ? "Counted, but this provider has no tag limit" : "Counts towards the tag limit"
                        : "Free — doesn't count towards the tag limit"}
                  </TooltipContent>
                </Tooltip>
              ))}
              {hasPromptTag && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-success-text border-success-border bg-success-soft">
                  has:prompt
                </Badge>
              )}
            </div>
          </div>
        )
      })()}

      {/* Simplified status display logic — the extra-slot count must mirror the
          systemOrderTagCount logic getFinalQueryTagsWithMeta uses above, or this
          warning and the "Active Query" slot bar above it disagree: with
          Shuffle on Danbooru (2-tag limit), the bar correctly shows 2/2 with a
          tag dropped, while this alert — previously hardcoded to extraTagsCount=0 —
          would silently fail to fire. */}
      {hasMultipleTags(searchTags, booruProvider, order === 'popular' || order === 'random' ? 1 : 0) && (
        <Alert variant="destructive" className="py-2">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            {booruProvider.charAt(0).toUpperCase() + booruProvider.slice(1)} API limit: Only first {getProviderTagLimit(booruProvider)} user tag{getProviderTagLimit(booruProvider) === 1 ? '' : 's'} will be used.
          </AlertDescription>
        </Alert>
      )}

      {/* Warns advanced users who type raw metatags (rating:/order:/sort:/tagcount:)
          by hand when those metatags are invalid, unsupported, or misleading on the
          currently selected provider. Never triggers from tags the app itself
          generates (the rating toggle, sort dropdown, tag-count slider already
          handle per-provider syntax correctly) — only from what's typed manually. */}
      {detectMisusedMetatags(searchTags, booruProvider).map((warning, index) => (
        <Alert key={`${warning.tag}-${index}`} className="py-2 border-warning-border bg-warning-soft">
          <AlertTriangle className="h-4 w-4 text-warning-text" />
          <AlertDescription className="text-xs text-warning-text">
            <span className="font-mono font-medium">{warning.tag}</span>: {warning.message}
            {warning.suggestion && (
              <> Try <span className="font-mono font-medium">{warning.suggestion}</span> instead.</>
            )}
          </AlertDescription>
        </Alert>
      ))}
    </div>
  )
}
