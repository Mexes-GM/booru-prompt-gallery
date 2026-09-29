// Recovery for stale-build chunk failures ("version skew").
//
// A tab opened on an older deployment still references chunk hashes from that
// build. After a new deploy (or a Vercel <-> Netlify failover, which serves a
// different build), lazily-loaded chunks 404 and Next throws a ChunkLoadError
// the first time the user opens something that wasn't loaded yet (e.g. the
// settings panel). Retrying in place can't help — only a full reload picks up
// the new build's manifest.

const RELOAD_KEY = "chunk_reload_at"
// If we already reloaded this recently and it still fails, the chunk is
// genuinely broken: stop reloading and let the error UI show.
const RELOAD_COOLDOWN_MS = 30_000

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  if (name === "ChunkLoadError") return true
  if (typeof message !== "string") return false
  return (
    message.includes("Failed to load chunk") ||
    /Loading (CSS )?chunk [\w-]+ failed/.test(message) ||
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("Importing a module script failed")
  )
}

/**
 * Reload the page once to pick up the current build. Returns true when a
 * reload was triggered, false when one already happened within the cooldown
 * (caller should fall back to its normal error handling).
 */
export function reloadForChunkError(): boolean {
  if (typeof window === "undefined") return false
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    // sessionStorage unavailable: without a guard we could loop, so don't reload.
    return false
  }
  window.location.reload()
  return true
}
