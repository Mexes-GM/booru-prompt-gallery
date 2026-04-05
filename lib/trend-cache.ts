import { supabaseAdmin } from '@/lib/supabase-admin'
import { TrendItem } from '@/lib/booru/types'

const TABLE = 'trend_cache'

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
            // Cache has expired
            return null
        }

        return data.data as TrendItem[]
    } catch {
        console.error('[trend-cache] Failed to read cache')
        return null
    }
}

/**
 * Write fresh trends to the Supabase cache.
 * Uses the admin client (service role) to bypass RLS for writes.
 * Overwrites the single existing row.
 */
export async function setCachedTrends(trends: TrendItem[]): Promise<void> {
    try {
        const now = new Date()
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000) // +24 hours

        // Get the existing row's id to update it
        const { data: existing } = await supabaseAdmin
            .from(TABLE)
            .select('id')
            .limit(1)
            .single()

        if (existing) {
            // Update the existing row
            await supabaseAdmin
                .from(TABLE)
                .update({
                    data: trends,
                    fetched_at: now.toISOString(),
                    expires_at: expiresAt.toISOString(),
                })
                .eq('id', existing.id)
        } else {
            // Insert a new row (should only happen if seed row was deleted)
            await supabaseAdmin
                .from(TABLE)
                .insert({
                    data: trends,
                    fetched_at: now.toISOString(),
                    expires_at: expiresAt.toISOString(),
                })
        }
    } catch (error) {
        console.error('[trend-cache] Failed to write cache:', error)
    }
}
