import type { KeyboardEvent } from "react"

/**
 * Arrow keys for a group of role="radio" buttons (WAI-ARIA radio group): the
 * arrows move to the previous or next option and select it, wrapping around;
 * Home and End go to the first and last. Pair it with `tabIndex={active ? 0 : -1}`
 * on the options so the group is a single tab stop.
 */
export function radioGroupKeyDown<T>(
  e: KeyboardEvent<HTMLElement>,
  values: readonly T[],
  current: T,
  select: (value: T) => void
): void {
  if (values.length === 0) return
  const index = Math.max(0, values.indexOf(current))
  let next: number | null = null
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % values.length
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + values.length) % values.length
  else if (e.key === "Home") next = 0
  else if (e.key === "End") next = values.length - 1
  if (next === null) return
  e.preventDefault()
  select(values[next])
  e.currentTarget.querySelectorAll<HTMLElement>("[role='radio']")[next]?.focus()
}
