"use client"

/**
 * Random page order for a Pack Mode feed on Danbooru or Aibooru (see
 * lib/booru/page-range.ts for why). The range comes from the site's counts
 * endpoint (`/counts/posts.json`, one request, multi-tag searches included);
 * only when that gives no count, from a short binary search over lightweight
 * `only=id` requests. A count is kept for a day (lib/booru/page-count-cache.ts).
 *
 * The range is only needed from page 2 on (page 1 comes first in any order), so
 * it is asked for once `wanted` is true; a count kept from an earlier pack gives it
 * at once. Its requests go through the site's pacer and count in the pack's budget.
 *
 * `pageOrder` is undefined while the range is loading, on other providers, or if
 * it can't be had: the feed then pages in the provider's own order, as before.
 * `settled` is true once waiting longer won't bring one.
 */
import { useEffect, useMemo, useRef } from "react"
import useSWR from "swr"
import { buildBooruQuery } from "@/lib/api-client"
import type { BooruProvider } from "@/lib/booru/types"
import { PROVIDER_URLS } from "@/lib/constants"
import { countFromResponse, lastPageFromCount, lastPageOf, randomPageOrder } from "@/lib/booru/page-range"
import { readCachedCount, writeCachedCount } from "@/lib/booru/page-count-cache"
import { sitePacer } from "@/lib/booru/request-pacer"
import { createSeededRng } from "@/lib/pack/pack-generator"
import type { PackRequestBudget } from "@/lib/pack/request-budget"

const PER_PAGE: Partial<Record<BooruProvider, number>> = { danbooru: 30, aibooru: 60 }
const SITE_URL: Partial<Record<BooruProvider, string>> = { danbooru: PROVIDER_URLS.DANBOORU, aibooru: PROVIDER_URLS.AIBOORU }

/** One paced page-range request, counted in the pack's budget (as a range request: lib/pack/request-budget.ts). */
async function getJson(url: string, provider: BooruProvider, budget: PackRequestBudget | null): Promise<unknown> {
  await sitePacer(provider).acquire()
  budget?.record(1, "range")
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function lastPageFor(provider: BooruProvider, query: string, budget: PackRequestBudget | null): Promise<number> {
  const site = SITE_URL[provider]!
  const perPage = PER_PAGE[provider]!
  const tags = encodeURIComponent(query)
  const { lastPage, count } = await lastPageOf({
    perPage,
    count: async () => countFromResponse(await getJson(`${site}/counts/posts.json?tags=${tags}`, provider, budget)),
    hasPosts: async (page) => {
      const posts = await getJson(`${site}/posts.json?limit=${perPage}&page=${page}&only=id&tags=${tags}`, provider, budget)
      return Array.isArray(posts) && posts.length > 0
    },
  })
  if (count !== null) writeCachedCount(provider, query, count)
  return lastPage
}

export interface RandomPageOrder {
  pageOrder: number[] | undefined
  settled: boolean
}

export function useRandomPageOrder(
  tags: string,
  ratingFilter: string,
  provider: BooruProvider,
  seed: number,
  { wanted = true, budget = null }: { wanted?: boolean; budget?: PackRequestBudget | null } = {},
): RandomPageOrder {
  const enabled = provider === "danbooru" || provider === "aibooru"
  const query = enabled ? buildBooruQuery(tags, ratingFilter, "recent", provider) : ""
  const cached = useMemo(() => (enabled ? readCachedCount(provider, query) : null), [enabled, provider, query])
  const budgetRef = useRef(budget)
  useEffect(() => { budgetRef.current = budget }, [budget])
  const { data: fetched, error } = useSWR(
    enabled && cached === null && wanted ? (["pack-page-range", provider, query] as const) : null,
    ([, p, q]: readonly [string, BooruProvider, string]) => lastPageFor(p, q, budgetRef.current),
    { revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false, revalidateIfStale: false }
  )
  const lastPage = cached !== null ? lastPageFromCount(cached, PER_PAGE[provider]!) : fetched
  const pageOrder = useMemo(
    () => (lastPage === undefined ? undefined : randomPageOrder(lastPage, createSeededRng(seed))),
    [lastPage, seed]
  )
  return { pageOrder, settled: !enabled || pageOrder !== undefined || !!error }
}
