/**
 * Tests for lib/pack/always-add.ts (Pack Mode: "Always add" tags go first,
 * as typed, and Pony-style quality tags keep their underscores).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/always-add.verify.ts
 */
import { finalizePackPrompt, parseAlwaysAddTags, restoreUnderscoreTag } from "../lib/pack/always-add"

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

// 1. Underscore restoration
assert(restoreUnderscoreTag("score 7") === "score_7", "score 7 -> score_7")
assert(restoreUnderscoreTag("score 8 up") === "score_8_up", "score 8 up -> score_8_up")
assert(restoreUnderscoreTag("source anime") === "source_anime", "source anime -> source_anime")
assert(restoreUnderscoreTag("rating safe") === "rating_safe", "rating safe -> rating_safe")
assert(restoreUnderscoreTag("long hair") === "long hair", "ordinary tag untouched")
assert(restoreUnderscoreTag("scoreboard") === "scoreboard", "no false positive on 'scoreboard'")

// 2. Parsing keeps what was typed
const always = parseAlwaysAddTags(" score_9, score_8_up , MyLoRA_trigger, score_9 ")
assert(always.join("|") === "score_9|score_8_up|MyLoRA_trigger", "verbatim, trimmed, deduped")

// 3. Final prompt: always-add first, normalized copies dropped
const out = finalizePackPrompt("1girl, long hair, score 9, mylora trigger, smile, score 8 up", always)
assert(out === "score_9, score_8_up, MyLoRA_trigger, 1girl, long hair, smile", `always-add first: ${out}`)
assert(finalizePackPrompt("1girl, score 7, smile", []) === "1girl, score_7, smile", "base score tag keeps underscore")
assert(finalizePackPrompt("1girl, smile", []) === "1girl, smile", "no-op without quality tags")

console.log(`always-add: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
