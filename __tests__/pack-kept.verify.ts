/**
 * The bar shown while a pack is kept aside with the builder closed (lib/pack/kept-pack.ts).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-kept.verify.ts
 */
import { keptPackMessage } from "../lib/pack/kept-pack"

let failed = 0
let passed = 0
const assert = (ok: unknown, label: string) => {
  if (ok) passed++
  else { failed++; console.log("FAIL: " + label) }
}

assert(keptPackMessage(0) === "Your pack is kept.", "no prompts yet: no count")
assert(keptPackMessage(1) === "Your pack is kept, with 1 prompt.", "one prompt, singular")
assert(keptPackMessage(12) === "Your pack is kept, with 12 prompts.", "several prompts, plural")

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
