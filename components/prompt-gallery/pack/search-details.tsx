"use client"

/**
 * What the pack searches, opened from the fit line: one row per search of the source
 * plan (whose posts, the tags as the site gets them, the posts it has brought), where
 * each character's look comes from, the ratings, any tag the site's limit left out, and
 * the rule that only Doing is searched.
 */
import { memo } from "react"
import type { PackSourceProgress } from "@/hooks/use-pack-sources"
import type { SourcePlan } from "@/lib/pack/source-plan"
import { cn } from "@/lib/utils"
import { showTag } from "./slots"
import { DONOR_ROLE, SEARCH_RULE, donorDescription, leftOutSentence, lookDescription, noPostsSentence, ratingsSentence, searchCount, searchDescription, searchTagsText } from "./search-text"

export interface SearchDetailsProps {
  id: string
  plan: SourcePlan
  /** Progress of each search, by id; missing while the searches start. */
  progress: readonly PackSourceProgress[]
  /** The name the card shows for the first character, for their own search. */
  character: string | null
  /** One character per prompt: the name the card shows for each character, by brief tag, for their own searches. */
  characterNames?: Readonly<Record<string, string>>
  site: string
  /** The site's tag limit per search. */
  limit: number
  className?: string
}

export const SearchDetails = memo(function SearchDetails({ id, plan, progress, character, characterNames, site, limit, className }: SearchDetailsProps) {
  const leftOut = leftOutSentence(plan.leftOut, site, limit)
  return (
    <div id={id} className={cn("space-y-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs", className)}>
      <ul className="space-y-2">
        {plan.scenes.map((search) => {
          const p = progress.find((x) => x.id === search.id)
          const posts = p?.posts ?? 0
          const none = !!p && posts === 0 && p.exhausted && !p.loading && !p.failed
          const count = !p || (p.loading && posts === 0) ? "Searching…" : searchCount(p.adds, posts, p.exhausted, p.earlier)
          return (
            <li key={search.id} className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium text-foreground">{searchDescription(search, search.character ? characterNames?.[search.character] ?? search.character : character, plan.people)}</span>
                <span className={cn("tabular-nums", none ? "text-warning-text" : "text-muted-foreground")}>{count}</span>
              </div>
              <code className="block break-all font-mono text-[11px] text-muted-foreground">{searchTagsText(search)}</code>
              {none && <p className="text-warning-text">{noPostsSentence(search.kind, site)}</p>}
            </li>
          )
        })}
        {plan.donors.map((search) => {
          const p = progress.find((x) => x.id === search.id)
          const posts = p?.posts ?? 0
          const none = !!p && posts === 0 && p.exhausted && !p.loading && !p.failed
          const count = !p || (p.loading && posts === 0) ? "Searching…" : searchCount(p.adds, posts, p.exhausted, p.earlier)
          return (
            <li key={search.id} className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium text-foreground">{donorDescription(search.kind, search.conditions)}</span>
                <span className={cn("tabular-nums", none ? "text-warning-text" : "text-muted-foreground")}>{count}</span>
              </div>
              <code className="block break-all font-mono text-[11px] text-muted-foreground">{searchTagsText(search)}</code>
              <p className="text-muted-foreground">{DONOR_ROLE[search.kind]}</p>
              {none && <p className="text-warning-text">{noPostsSentence("theme", site)}</p>}
            </li>
          )
        })}
        {plan.appearance.map((search) => (
          <li key={search.id} className="min-w-0">
            <span className="font-medium text-foreground">{lookDescription(characterNames?.[search.character] ?? showTag(search.character))}</span>
            <code className="block break-all font-mono text-[11px] text-muted-foreground">{searchTagsText(search)}</code>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">{ratingsSentence(plan.ratings)}</p>
      {leftOut && <p className="text-warning-text">{leftOut}</p>}
      <p className="text-muted-foreground">{SEARCH_RULE}</p>
      {/* Room for what happens next: posts found → scenes that fit, with the reasons. */}
    </div>
  )
})
