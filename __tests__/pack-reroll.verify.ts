/**
 * Tests for lib/pack/reroll.ts's pickReplacement (Pack Mode "re-roll one prompt", §6).
 *
 * Covers:
 *   1. Returns null when every candidate is a near-duplicate of `others`.
 *   2. Never returns a candidate whose cleaned text exactly matches one of `others`.
 *   3. Returns the first candidate (in order) that IS accepted.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-reroll.verify.ts
 */
import type { PackPrompt } from "../lib/pack/pack-generator"
import { pickReplacement } from "../lib/pack/reroll"

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

function candidate(prompt: string): PackPrompt {
  return { prompt, values: prompt.split(", ") }
}

const identityClean = (tags: string[]) => tags.join(", ")

// ── All candidates near-duplicate `others` -> null ──
// Jaccard similarity ignores locked tags (["base"]); each candidate here
// shares 20 of its 21 non-locked tags with `others[0]` (similarity ~0.91 >=
// the default 0.85 threshold), so every one is rejected as a near-duplicate.
{
  const shared = Array.from({ length: 20 }, (_, i) => `t${i + 1}`)
  const others = [["base", ...shared, "t10"].join(", ")]
  const candidates = [
    candidate(["base", ...shared, "t11"].join(", ")),
    candidate(["base", ...shared, "t12"].join(", ")),
  ]
  const result = pickReplacement(candidates, others, identityClean, ["base"])
  assert(result === null, "returns null when every candidate is near-duplicate of others")
}

// ── Never returns a candidate whose cleaned text exactly matches `others` ──
{
  const others = ["base, pose_a", "base, pose_b"]
  const candidates = [
    candidate("base, pose_a"), // exact match to others[0] -> rejected
    candidate("base, pose_c"), // distinct -> accepted
  ]
  const result = pickReplacement(candidates, others, identityClean, ["base"])
  assert(result !== null && result.prompt === "base, pose_c", "skips the exact-match candidate, accepts the next")
}

// ── Returns the first valid candidate in order ──
{
  const others: string[] = []
  const candidates = [candidate("base, pose_a"), candidate("base, pose_b")]
  const result = pickReplacement(candidates, others, identityClean, ["base"])
  assert(result !== null && result.prompt === "base, pose_a", "returns the first candidate when nothing blocks it")
}

// ── A candidate the cleaner rejects (returns null) is skipped ──
{
  const others: string[] = []
  const cleanRejectsFirst = (tags: string[]) => (tags.includes("pose_a") ? null : tags.join(", "))
  const candidates = [candidate("base, pose_a"), candidate("base, pose_b")]
  const result = pickReplacement(candidates, others, cleanRejectsFirst, ["base"])
  assert(result !== null && result.prompt === "base, pose_b", "skips a candidate the cleaner rejects")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
