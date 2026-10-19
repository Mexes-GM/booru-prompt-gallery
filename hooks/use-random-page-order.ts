"use client"

/**
 * Random page order for a Pack Mode feed on Danbooru or Aibooru (see
 * lib/booru/page-range.ts for why). The range comes from Aibooru's counts
 * endpoint, or — since Danbooru returns no count for multi-tag searches — a
 * short binary search over lightweight `only=id` requests.
 *
 * Undefined while the range is loading, on other providers, or if the probe
 * fails: the feed then pages in the provider's own order, as before.
 */
import { useEffect, useState } from "react"
import { buildBooruQuery } from "@/lib/api-client"
import type { BooruProvider } from "@/lib/booru/types"
import { PROVIDER_URLS } from "@/lib/constants"
import { findLastPage, lastPageFromCount, randomPageOrder } from "@/lib/booru/page-range"
import { createSeededRng } from "@/lib/pack/pack-generator"

const PER_PAGE: Partial<Record<BooruProvider, number>> = { danbooru: 30, aibooru: 60 }

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function lastPageFor(provider: BooruProvider, query: string, signal: AbortSignal): Promise<number> {
  const tags = encodeURIComponent(query)
  if (provider === "aibooru") {
    const data = await getJson(`${PROVIDER_URLS.AIBOORU}/counts/posts.json?tags=${tags}`, signal) as { counts?: { posts?: number | null } }
    const total = data?.counts?.posts
    if (typeof total !== "number") throw new Error("No count")
    return lastPageFromCount(total, PER_PAGE.aibooru!)
  }
  return findLastPage(async (page) => {
    const posts = await getJson(`${PROVIDER_URLS.DANBOORU}/posts.json?limit=${PER_PAGE.danbooru}&page=${page}&only=id&tags=${tags}`, signal)
    return Array.isArray(posts) && posts.length > 0
  })
}

export function useRandomPageOrder(tags: string, ratingFilter: string, provider: BooruProvider, seed: number): number[] | undefined {
  const enabled = provider === "danbooru" || provider === "aibooru"
  const query = enabled ? buildBooruQuery(tags, ratingFilter, "recent", provider) : ""
  const key = `${provider}|${query}|${seed}`
  const [result, setResult] = useState<{ key: string; order: number[] } | null>(null)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    lastPageFor(provider, query, controller.signal)
      .then((lastPage) => setResult({ key, order: randomPageOrder(lastPage, createSeededRng(seed)) }))
      .catch(() => {
        // Best-effort: the feed keeps paging in order.
      })
    return () => controller.abort()
  }, [enabled, provider, query, seed, key])

  return result?.key === key ? result.order : undefined
}
