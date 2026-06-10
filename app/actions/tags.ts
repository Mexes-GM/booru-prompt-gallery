'use server'

import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Low-level fetcher — paginates through ALL tags.
 * Not exported directly; use {@link getAllTagOverrides} (cached wrapper).
 */
async function _fetchAllTagOverrides(): Promise<Record<string, string>> {
  const overrides: Record<string, string> = {}
  let page = 0
  const pageSize = 1000
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabaseAdmin
      .from('tags')
      .select('name, category')
      .range(page * pageSize, (page + 1) * pageSize - 1)

    if (error) {
      console.error('Error fetching tag overrides:', error)
      break
    }

    if (data && data.length > 0) {
      data.forEach(tag => {
        overrides[tag.name] = tag.category
      })

      if (data.length < pageSize) {
        hasMore = false
      } else {
        page++
      }
    } else {
      hasMore = false
    }
  }

  return overrides
}

/**
 * Cached tag overrides — shared across all requests.
 * Revalidates every hour. Falls back to paginated fetch if cache is cold.
 *
 * Use `revalidateTag('tag-overrides')` to invalidate manually after tag updates.
 */
export const getAllTagOverrides = unstable_cache(
  _fetchAllTagOverrides,
  ['tag-overrides'],
  { revalidate: 3600, tags: ['tag-overrides'] }
)
