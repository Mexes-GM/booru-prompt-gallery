/**
 * The Pack builder's layout by window width (components/prompt-gallery/pack/builder-layout.ts):
 * two columns from 1024 px with the brief always open, the folding one column from 768 px, and
 * the phone's line under that.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-builder-layout.verify.ts
 */
import assert from "node:assert/strict"
import { COLUMNS_MIN_WIDTH, LINE_BELOW_WIDTH, briefShown, builderLayoutFor, summaryLineShown } from "../components/prompt-gallery/pack/builder-layout"

let passed = 0
const check = (name: string, fn: () => void) => {
  try { fn(); passed++ } catch (err) { console.error(`FAIL: ${name}`); throw err }
}

check("breakpoints: Tailwind's lg for the columns, the app's phone breakpoint for the line", () => {
  assert.equal(COLUMNS_MIN_WIDTH, 1024)
  assert.equal(LINE_BELOW_WIDTH, 768)
})

check("layout by width", () => {
  assert.equal(builderLayoutFor(375), "line")
  assert.equal(builderLayoutFor(767), "line")
  assert.equal(builderLayoutFor(768), "stacked")
  assert.equal(builderLayoutFor(1023), "stacked")
  assert.equal(builderLayoutFor(1024), "columns")
  assert.equal(builderLayoutFor(1920), "columns")
})

check("columns: the brief is always open, folded or not, and has no line to open it", () => {
  for (const folded of [false, true]) for (const lineOpen of [false, true]) {
    assert.equal(briefShown("columns", { folded, lineOpen }), true)
  }
  assert.equal(summaryLineShown("columns", false), false)
  assert.equal(summaryLineShown("columns", true), false)
})

check("one column: the brief folds into its line", () => {
  assert.equal(briefShown("stacked", { folded: false, lineOpen: false }), true)
  assert.equal(briefShown("stacked", { folded: true, lineOpen: true }), false)
  assert.equal(summaryLineShown("stacked", false), false)
  assert.equal(summaryLineShown("stacked", true), true)
})

check("phone: the line is always there and opens the brief in place", () => {
  assert.equal(briefShown("line", { folded: false, lineOpen: false }), false)
  assert.equal(briefShown("line", { folded: true, lineOpen: true }), true)
  assert.equal(summaryLineShown("line", false), true)
  assert.equal(summaryLineShown("line", true), true)
})

console.log(`pack-builder-layout: ${passed} checks passed`)
