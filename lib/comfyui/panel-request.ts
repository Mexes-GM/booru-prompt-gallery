/**
 * Lets any Send button open the ComfyUI panel, with the reason it was opened.
 * A host component mounted once renders the panel; this module stays tiny so
 * the gallery can import it without the panel's code.
 */

/** Why Send opened the panel instead of sending. */
export type ComfyPanelReason = "workflow" | "prompt-role"

export interface ComfyPanelRequest {
  /** Changes on every request, so asking twice reopens the panel. */
  id: number
  reason: ComfyPanelReason | null
  /** What had focus when Send asked, to return to when the panel closes. */
  returnFocus: HTMLElement | null
}

type Listener = () => void

let current: ComfyPanelRequest | null = null
let counter = 0
const listeners = new Set<Listener>()

/**
 * Opens the panel. Focus returns to `returnFocus` when it closes, or by
 * default to whatever has focus now.
 */
export function openComfyPanel(reason: ComfyPanelReason | null = null, returnFocus?: HTMLElement | null): void {
  const active = returnFocus !== undefined ? returnFocus : typeof document !== "undefined" ? document.activeElement : null
  current = { id: ++counter, reason, returnFocus: active instanceof HTMLElement ? active : null }
  for (const l of Array.from(listeners)) l()
}

export function subscribeComfyPanel(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getComfyPanelRequest(): ComfyPanelRequest | null {
  return current
}
