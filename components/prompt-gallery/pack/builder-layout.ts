/**
 * How the Pack builder lays out the brief and its prompts at each window width.
 *
 * - `columns` (1024 px and up): the brief on the left and the prompts on the right, side by
 *   side from the moment Pack opens, each scrolling on its own. The brief never folds.
 * - `stacked` (768 to 1023 px): one column; the brief folds into its one-line summary once a
 *   pack is made (and when a pack with prompts comes back after a reload), and opens again
 *   from that line.
 * - `line` (under 768 px): one column; the brief is a line that opens and closes in place.
 */
import { useSyncExternalStore } from "react"

export type BuilderLayout = "columns" | "stacked" | "line"

/** Tailwind's `lg`: where the two columns start. */
export const COLUMNS_MIN_WIDTH = 1024
/** Under this the brief is a line (the app's phone breakpoint, hooks/use-mobile.tsx). */
export const LINE_BELOW_WIDTH = 768

export function builderLayoutFor(width: number): BuilderLayout {
  if (width >= COLUMNS_MIN_WIDTH) return "columns"
  if (width < LINE_BELOW_WIDTH) return "line"
  return "stacked"
}

/** Whether the brief itself is on screen. */
export function briefShown(layout: BuilderLayout, state: { folded: boolean; lineOpen: boolean }): boolean {
  if (layout === "columns") return true
  if (layout === "line") return state.lineOpen
  return !state.folded
}

/** Whether the one-line summary that opens the brief is shown (it has nothing to open in columns). */
export function summaryLineShown(layout: BuilderLayout, folded: boolean): boolean {
  if (layout === "columns") return false
  if (layout === "line") return true
  return folded
}

const QUERIES = [`(min-width: ${COLUMNS_MIN_WIDTH}px)`, `(max-width: ${LINE_BELOW_WIDTH - 1}px)`]

function subscribe(onChange: () => void) {
  const lists = QUERIES.map((q) => window.matchMedia(q))
  lists.forEach((l) => l.addEventListener("change", onChange))
  return () => lists.forEach((l) => l.removeEventListener("change", onChange))
}

const snapshot = (): BuilderLayout => builderLayoutFor(window.innerWidth)
// Pack loads on the client only; before that, the phone's layout is the safe guess.
const serverSnapshot = (): BuilderLayout => "line"

/** The layout for the window as it is now, updated when it crosses a breakpoint. */
export function useBuilderLayout(): BuilderLayout {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}
