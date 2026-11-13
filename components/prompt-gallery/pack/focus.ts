/**
 * Keeping keyboard focus in place when the focused control goes away (a chip is
 * removed, an offer is taken, a notice closes). Each helper runs after React has
 * committed the change, and only moves focus if it was actually lost.
 */
import type { SlotId } from "./slots"

const lost = () => {
  const active = document.activeElement
  return !active || active === document.body
}

/** Runs `fn` on the next frame, after the update that removed the focused control. */
export function afterUpdate(fn: () => void) {
  requestAnimationFrame(fn)
}

/** The field of a card row, inside `root` (the card or anything around it). */
export function slotEntry(root: ParentNode | null | undefined, slot: SlotId): HTMLInputElement | null {
  return root?.querySelector<HTMLInputElement>(`input[data-slot-entry="${slot}"]`) ?? null
}

/** Focuses the card row's field if focus was lost. */
export function focusSlotEntry(root: ParentNode | null | undefined, slot: SlotId) {
  afterUpdate(() => {
    if (lost()) slotEntry(root, slot)?.focus()
  })
}

/**
 * Puts focus back where it was before an action (if that control still exists),
 * otherwise in the field of the row the action touched.
 */
export function restoreFocus(previous: Element | null, root: ParentNode | null | undefined, slot?: SlotId) {
  afterUpdate(() => {
    if (!lost()) return
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    else if (slot) slotEntry(root, slot)?.focus()
  })
}

/** Selector for the controls a chip row moves focus between. */
export const CHIP_ACTION = "[data-chip-action]"
