// Web Vitals debug instrumentation (P0 of the performance plan).
//
// Dev / flag-gated ONLY. This module is loaded via a dynamic import guarded by
// `process.env.NEXT_PUBLIC_PERF_DEBUG === "1"` (see instrumentation-client.ts),
// so when the flag is unset the import is dead-code-eliminated and ships zero
// bytes to production.
//
// It uses the native PerformanceObserver API (no `web-vitals` dependency) to
// surface attribution that the synthetic traces could not pin down:
//   - layout-shift: each shift's score AND the DOM nodes that moved (the CLS
//     culprits), plus a CSS-path so you can find them in source.
//   - largest-contentful-paint: the LCP element and its timing.
//   - event / first-input: INP candidates with the interaction target.
//
// Read the live summary at any time from the console: `window.__perfDebug()`.

type ShiftRecord = {
  value: number
  cumulative: number
  selectors: string[]
  at: number
}

type LcpRecord = {
  value: number
  selector: string
  url?: string
}

type InpRecord = {
  duration: number
  selector: string
  name: string
}

interface PerfDebugState {
  cls: number
  shifts: ShiftRecord[]
  lcp: LcpRecord | null
  worstInp: InpRecord | null
  inputs: InpRecord[]
}

// Build a short, human-readable CSS path for a node so culprits are findable
// in source (id > data-testid > tag.class chain, truncated).
function cssPath(node: Node | null): string {
  const el = node as Element | null
  if (!el || el.nodeType !== 1) return "(non-element)"
  const parts: string[] = []
  let cur: Element | null = el
  let depth = 0
  while (cur && depth < 4) {
    let part = cur.tagName.toLowerCase()
    if (cur.id) {
      part += `#${cur.id}`
      parts.unshift(part)
      break
    }
    const cls = (cur.getAttribute("class") || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join(".")
    if (cls) part += `.${cls}`
    parts.unshift(part)
    cur = cur.parentElement
    depth++
  }
  return parts.join(" > ")
}

let started = false

export function initWebVitalsDebug(): void {
  if (started || typeof window === "undefined" || typeof PerformanceObserver === "undefined") {
    return
  }
  started = true

  const state: PerfDebugState = {
    cls: 0,
    shifts: [],
    lcp: null,
    worstInp: null,
    inputs: [],
  }

  // Expose a live summary getter on window for ad-hoc inspection.
  ;(window as unknown as { __perfDebug?: () => PerfDebugState }).__perfDebug = () => state

  // --- Cumulative Layout Shift (with source attribution) ---
  try {
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number
        hadRecentInput: boolean
        sources?: { node?: Node }[]
      })[]) {
        if (entry.hadRecentInput) continue
        state.cls += entry.value
        const selectors = (entry.sources || [])
          .map((s) => cssPath(s.node ?? null))
          .filter((s) => s !== "(non-element)")
        state.shifts.push({
          value: entry.value,
          cumulative: state.cls,
          selectors,
          at: Math.round(entry.startTime),
        })
        // Only surface meaningful shifts to avoid console spam.
        if (entry.value >= 0.01) {
          // eslint-disable-next-line no-console
          console.warn(
            `[web-vitals] layout-shift +${entry.value.toFixed(4)} (CLS=${state.cls.toFixed(
              4,
            )}) culprits:`,
            selectors.length ? selectors : "(no source nodes)",
          )
        }
      }
    })
    clsObserver.observe({ type: "layout-shift", buffered: true })
  } catch {
    /* layout-shift not supported */
  }

  // --- Largest Contentful Paint ---
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries() as (PerformanceEntry & {
        element?: Element
        url?: string
        renderTime: number
        loadTime: number
      })[]
      const last = entries[entries.length - 1]
      if (!last) return
      state.lcp = {
        value: Math.round(last.renderTime || last.loadTime || last.startTime),
        selector: cssPath(last.element ?? null),
        url: last.url || undefined,
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[web-vitals] LCP=${state.lcp.value}ms element:`,
        state.lcp.selector,
        state.lcp.url ? `(${state.lcp.url})` : "",
      )
    })
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true })
  } catch {
    /* lcp not supported */
  }

  // --- Interaction to Next Paint (INP) candidates ---
  try {
    const inpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        duration: number
        target?: Node
        name: string
      })[]) {
        if (entry.duration < 40) continue
        const rec: InpRecord = {
          duration: Math.round(entry.duration),
          selector: cssPath(entry.target ?? null),
          name: entry.name,
        }
        state.inputs.push(rec)
        if (!state.worstInp || rec.duration > state.worstInp.duration) {
          state.worstInp = rec
          // eslint-disable-next-line no-console
          console.warn(
            `[web-vitals] INP candidate ${rec.duration}ms (${rec.name}) target:`,
            rec.selector,
          )
        }
      }
    })
    // durationThreshold keeps the observer cheap; 40ms catches sluggish work.
    inpObserver.observe({ type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit)
  } catch {
    /* event timing not supported */
  }
}
