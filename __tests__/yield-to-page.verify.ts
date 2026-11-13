/**
 * The pauses of Pack Mode's sliced generation (lib/utils/yield-to-page.ts): they
 * resolve whether or not the page paints, so Generate never waits on a hidden tab.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/yield-to-page.verify.ts
 */
import { PAINT_WAIT_MS, nextPaint, yieldToPage } from "../lib/utils/yield-to-page"

let failed = 0
let passed = 0
const assert = (ok: unknown, label: string) => {
  if (ok) passed++
  else { failed++; console.log("FAIL: " + label) }
}
const g = globalThis as { requestAnimationFrame?: (cb: () => void) => number }

;(async () => {
  let start = Date.now()
  await yieldToPage()
  assert(Date.now() - start < PAINT_WAIT_MS, "a pause between slices resolves right away")

  // A tab that isn't painted: requestAnimationFrame never calls back.
  g.requestAnimationFrame = () => 0
  start = Date.now()
  await nextPaint()
  const waited = Date.now() - start
  assert(waited >= PAINT_WAIT_MS - 5 && waited < PAINT_WAIT_MS + 500, `with no frame, the wait ends on its own (${waited}ms)`)

  // A painting page: the frame comes first.
  g.requestAnimationFrame = (cb) => { setTimeout(cb, 5); return 1 }
  start = Date.now()
  await nextPaint()
  assert(Date.now() - start < PAINT_WAIT_MS, "a frame ends the wait before the time limit")

  // No requestAnimationFrame at all (not a browser).
  delete g.requestAnimationFrame
  start = Date.now()
  await nextPaint(10)
  assert(Date.now() - start < 500, "without requestAnimationFrame it still resolves")

  console.log(`${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
})()
