"use client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AlertTriangle, Infinity as InfinityIcon } from "lucide-react"
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
}: QueryStatusPanelProps) {
  return (
    <div className="space-y-2">
      {/* Active Query Display */}
      {(() => {
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
                      ? "border-sky-300/60 bg-sky-50 text-sky-700 dark:border-sky-800/60 dark:bg-sky-900/20 dark:text-sky-400"
                      : isAtLimit
                        ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
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
                  className="h-full rounded-full bg-gradient-to-r from-sky-400/70 via-sky-400/30 to-transparent bg-[length:200%_100%] animate-[shimmer_2.5s_linear_infinite]"
                  style={{ width: '100%' }}
                />
              ) : (
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    isAtLimit ? "bg-amber-500" : "bg-primary/70"
                  )}
                  style={{ width: `${Math.min(100, (queryMeta.slotsUsed / queryMeta.slotLimit) * 100)}%` }}
                />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {queryMeta.tags.map((tag, index) => (
                <Tooltip key={index}>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px] px-1.5 py-0 h-5 font-mono cursor-help",
                        tag.dropped && "opacity-50 line-through border border-destructive/40 text-destructive/80 bg-destructive/5",
                        !tag.dropped && tag.countsTowardsLimit && (isUnlimited ? "border border-sky-300/40" : "border border-primary/30"),
                        !tag.dropped && !tag.countsTowardsLimit && "border border-emerald-300/50 text-emerald-700 bg-emerald-50 dark:border-emerald-800/50 dark:text-emerald-400 dark:bg-emerald-900/20"
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
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-green-600 border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
                  has:prompt
                </Badge>
              )}
            </div>
          </div>
        )
      })()}

      {/* Simplified status display logic */}
      {hasMultipleTags(searchTags, booruProvider, 0) && (
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
        <Alert key={index} className="py-2 border-amber-300/60 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-900/20">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-xs text-amber-800 dark:text-amber-300">
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
