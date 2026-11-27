/**
 * The folded "Customize prompt" line of the pack builder: what differs from the defaults.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-prompt-options.verify.ts
 */
import assert from "node:assert/strict"
import { PROMPT_OPTIONS_TEXT, promptOptionsSummary } from "../components/prompt-gallery/pack/pack-text"

let passed = 0
const check = (fn: () => void) => { fn(); passed++ }

const base = {
  added: 0,
  removed: 0,
  replaced: 0,
  weights: 0,
  weightsPaused: false,
  includeCharacters: true,
  smartTagExclusion: true,
  experimentalPromptRules: false,
  maxLongSide: 1536,
  defaultMaxLongSide: 1536,
}

check(() => {
  assert.equal(promptOptionsSummary(base), PROMPT_OPTIONS_TEXT.defaults)
})

check(() => {
  assert.equal(promptOptionsSummary({ ...base, added: 3, removed: 1, replaced: 2 }), "+3 tags · −1 tag · 2 replace rules")
  assert.equal(promptOptionsSummary({ ...base, weights: 1 }), "1 weight")
  assert.equal(promptOptionsSummary({ ...base, weights: 2, weightsPaused: true }), "2 weights paused")
})

check(() => {
  assert.equal(promptOptionsSummary({ ...base, includeCharacters: false }), "no character names")
  assert.equal(promptOptionsSummary({ ...base, experimentalPromptRules: true }), "experimental rules")
  assert.equal(promptOptionsSummary({ ...base, maxLongSide: 1024 }), "sizes up to 1024 px")
})

check(() => {
  // Tag exclusion only says something when there are added tags to keep.
  assert.equal(promptOptionsSummary({ ...base, smartTagExclusion: false }), PROMPT_OPTIONS_TEXT.defaults)
  assert.equal(promptOptionsSummary({ ...base, added: 1, smartTagExclusion: false }), "+1 tag · keeps every added tag")
})

console.log(`pack-prompt-options: ${passed} checks passed`)
