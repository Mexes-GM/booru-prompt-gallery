import { STORAGE_KEYS } from "@/lib/storage"

/**
 * The donation appeal targets returning users — people the site has actually
 * worked for — not first-time visitors. Both conditions must hold:
 *  - copies were made on at least SUPPORT_MIN_ACTIVE_DAYS distinct days
 *    (just opening the site doesn't count; a "day" only counts once they copy)
 *  - at least SUPPORT_MIN_TOTAL_COPIES copies overall, so someone who copies
 *    one stray prompt per visit doesn't qualify.
 */
export const SUPPORT_MIN_ACTIVE_DAYS = 3
export const SUPPORT_MIN_TOTAL_COPIES = 10

/** Window event fired when the user qualifies and the modal hasn't been seen yet. */
export const SUPPORT_PROMPT_EVENT = "bpg:support-prompt"

export function hasSeenSupportModal(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.SUPPORT_MODAL_SEEN) === "true"
  } catch {
    // Storage unavailable (private mode, blocked) — treat as seen so we never nag
    // on every visit when we can't remember the dismissal.
    return true
  }
}

export function markSupportModalSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SUPPORT_MODAL_SEEN, "true")
    localStorage.removeItem(STORAGE_KEYS.SUPPORT_COPY_COUNT)
    localStorage.removeItem(STORAGE_KEYS.SUPPORT_ACTIVE_DAYS)
  } catch { /* ignore */ }
}

/** Local calendar day (YYYY-MM-DD), so "a different day" matches the user's own sense of it. */
function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function readActiveDays(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.SUPPORT_ACTIVE_DAYS) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === "string") : []
  } catch {
    return []
  }
}

/**
 * Count a successful prompt/tag copy and record today as an active day. Once
 * the user qualifies (see thresholds above), notify SupportModal via
 * SUPPORT_PROMPT_EVENT. Fires on every qualifying copy until the modal is
 * actually shown, so a copy made while another dialog is open doesn't lose
 * the chance.
 */
export function recordPromptCopy(): void {
  if (hasSeenSupportModal()) return
  try {
    const count = (parseInt(localStorage.getItem(STORAGE_KEYS.SUPPORT_COPY_COUNT) ?? "0", 10) || 0) + 1
    localStorage.setItem(STORAGE_KEYS.SUPPORT_COPY_COUNT, String(count))

    const days = readActiveDays()
    const day = today()
    if (!days.includes(day)) {
      // Only the count matters, so keep just the most recent few.
      const next = [...days, day].slice(-SUPPORT_MIN_ACTIVE_DAYS)
      localStorage.setItem(STORAGE_KEYS.SUPPORT_ACTIVE_DAYS, JSON.stringify(next))
      days.splice(0, days.length, ...next)
    }

    if (days.length >= SUPPORT_MIN_ACTIVE_DAYS && count >= SUPPORT_MIN_TOTAL_COPIES) {
      window.dispatchEvent(new Event(SUPPORT_PROMPT_EVENT))
    }
  } catch { /* ignore */ }
}
