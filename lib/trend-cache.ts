import { supabaseAdmin } from '@/lib/supabase-admin'
import { TrendItem } from '@/lib/booru/types'

const TABLE = 'trend_cache'

/**
 * Maximum time a fetch lock is considered valid (seconds).
 * If the lock holder crashes, another worker can take over after this.
 */
const FETCH_LOCK_TTL_SECONDS = 90

/**
 * Read cached trends from Supabase.
 * Returns the cached TrendItem[] if the cache is still valid (not expired),
 * or null if expired / missing.
 */
export async function getCachedTrends(): Promise<TrendItem[] | null> {
    try {
        const { data, error } = await supabaseAdmin
            .from(TABLE)
            .select('data, expires_at')
            .limit(1)
            .single()

        if (error || !data) return null

        const expiresAt = new Date(data.expires_at)
        if (expiresAt <= new Date()) {
            return null
        }

        return data.data as TrendItem[]
    } catch {
        console.error('[trend-cache] Failed to read cache')
        return null
    }
}

/**
 * Try to acquire the right to fetch fresh trends from Danbooru.
 * Only one Vercel function invocation should win this lock.
 *
 * Returns true if this invocation should proceed with the fetch,
 * false if another invocation is already fetching.
 */
export async function tryAcquireTrendFetchLock(): Promise<boolean> {
    try {
        // Get the current row
        const { data: existing } = await supabaseAdmin
            .from(TABLE)
            .select('id, fetching_since')
            .limit(1)
            .single()

        if (!existing) {
            // No row exists yet — create one with a fetching lock
            const { error: insertError } = await supabaseAdmin
                .from(TABLE)
                .insert({
                    data: [],
                    fetched_at: new Date().toISOString(),
                    expires_at: new Date(Date.now() - 1).toISOString(), // already expired
                    fetching_since: new Date().toISOString(),
                })

            return !insertError
        }

        // Check if an existing lock is still valid
        if (existing.fetching_since) {
            const lockTime = new Date(existing.fetching_since).getTime()
            const lockAge = (Date.now() - lockTime) / 1000

            if (lockAge < FETCH_LOCK_TTL_SECONDS) {
                return false
            }
            // Lock has expired — stale lock from a crashed worker, we can take over
        }

        // Try to claim the lock atomically.
        const { error: updateError } = await supabaseAdmin
            .from(TABLE)
            .update({ fetching_since: new Date().toISOString() })
            .eq('id', existing.id)
            .is('fetching_since', null)

        if (updateError) {
            return false
        }

        // Re-read to verify
        const { data: verify } = await supabaseAdmin
            .from(TABLE)
            .select('fetching_since')
            .eq('id', existing.id)
            .single()

        if (!verify?.fetching_since) {
            return false
        }

        return true
    } catch (error) {
        console.error('[trend-cache] Failed to acquire fetch lock:', error)
        return true
    }
}

/**
 * Write fresh trends to the Supabase cache and release the fetch lock.
 */
export async function setCachedTrends(trends: TrendItem[]): Promise<void> {
    try {
        const now = new Date()
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)

        const { data: existing } = await supabaseAdmin
            .from(TABLE)
            .select('id')
            .limit(1)
            .single()

        if (existing) {
            await supabaseAdmin
                .from(TABLE)
                .update({
                    data: trends,
                    fetched_at: now.toISOString(),
                    expires_at: expiresAt.toISOString(),
                    fetching_since: null, // release lock
                })
                .eq('id', existing.id)
        } else {
            await supabaseAdmin
                .from(TABLE)
                .insert({
                    data: trends,
                    fetched_at: now.toISOString(),
                    expires_at: expiresAt.toISOString(),
                    fetching_since: null,
                })
        }

    } catch (error) {
        console.error('[trend-cache] Failed to write cache:', error)
    }
}
