/**
 * Pauses for long work done in slices on the main thread (Pack Mode's generation):
 * the page stays responsive between slices, and the work still finishes in a tab
 * that isn't being painted (in the background, minimized, covered).
 */

/** Longest wait for a paint: ~3 frames at 60 Hz, so a painting page always paints first and a hidden one waits no longer. */
export const PAINT_WAIT_MS = 50

/**
 * Lets the browser handle input (and paint, if it is going to) before the next slice.
 * A message task, not `setTimeout(0)`: hidden tabs throttle chained timers to one a
 * second or slower, which turned a generation of many slices into minutes.
 */
export function yieldToPage(): Promise<void> {
  if (typeof MessageChannel !== 'function') return new Promise((resolve) => setTimeout(resolve, 0))
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

/**
 * Resolves once the page has painted (a busy state set just before shows up), or after
 * PAINT_WAIT_MS when no frame comes: `requestAnimationFrame` never fires in a tab that
 * isn't painted, and waiting on it alone left Generate stuck there.
 */
export function nextPaint(waitMs: number = PAINT_WAIT_MS): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, waitMs)
    // After the frame, one more task: the paint itself happens right after rAF callbacks.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { void yieldToPage().then(finish) })
  })
}
