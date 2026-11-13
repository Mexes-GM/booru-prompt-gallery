/**
 * A pack kept aside (lib/pack/kept-pack.ts): the bar's message, and picking the
 * pack's own base again, which reopens the pack as it is with either method.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-kept.verify.ts
 */
import { isSamePackBase, keptPackMessage } from "../lib/pack/kept-pack"

let failed = 0
let passed = 0
const assert = (ok: unknown, label: string) => {
  if (ok) passed++
  else { failed++; console.log("FAIL: " + label) }
}

assert(keptPackMessage(0) === "Your pack is kept.", "no prompts yet: no count")
assert(keptPackMessage(1) === "Your pack is kept, with 1 prompt.", "one prompt, singular")
assert(keptPackMessage(12) === "Your pack is kept, with 12 prompts.", "several prompts, plural")

// Picking the base again
assert(isSamePackBase({ kind: "card", id: 42 }, { kind: "card", id: 42 }), "the same card reopens the pack")
assert(!isSamePackBase({ kind: "card", id: 42 }, { kind: "card", id: 7 }), "another card starts a new pack")
assert(!isSamePackBase(null, { kind: "card", id: 42 }), "no pack yet: nothing to reopen")
assert(isSamePackBase({ kind: "character", names: ["hatsune_miku"] }, { kind: "character", names: ["Hatsune Miku"] }), "the same character, however it is written")
assert(isSamePackBase({ kind: "character", names: ["alice", "bob"] }, { kind: "character", names: ["alice", "bob"] }), "the same group")
assert(!isSamePackBase({ kind: "character", names: ["alice", "bob"] }, { kind: "character", names: ["bob", "alice"] }), "another base character is another pack")
assert(!isSamePackBase({ kind: "character", names: ["alice"] }, { kind: "character", names: ["alice", "bob"] }), "someone added is another pack")
assert(isSamePackBase({ kind: "prompt", text: "1girl, red hair" }, { kind: "prompt", text: " 1girl,  red hair " }), "the same prompt text")
assert(!isSamePackBase({ kind: "prompt", text: "1girl, red hair" }, { kind: "prompt", text: "1girl, blue hair" }), "an edited prompt is a new base")
assert(!isSamePackBase({ kind: "card", id: 42 }, { kind: "prompt", text: "42" }), "different kinds never match")

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
