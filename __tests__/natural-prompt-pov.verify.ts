/**
 * Experimental point-of-view rule: in a pov picture of one woman and one man,
 * the man is the camera, so the pose, expression and gaze nobody owns are hers
 * instead of "They are..." / "One of them is...".
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/natural-prompt-pov.verify.ts
 */
import { readFileSync } from "fs"
import { formatPrompt, naturalPromptInput } from "../lib/prompt/natural-format"

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

const phrases = JSON.parse(readFileSync("public/natural-prompt-phrases.json", "utf8"))

function flux(prompt: string, experimental: boolean, characters?: string): string {
  const input = naturalPromptInput({ prompt, characters, rating: "e", provider: "danbooru", experimental }, {})
  return formatPrompt("flux2", input, {}, { phrases, fullDetail: true }).text
}

const POV = "1boy, 1girl, hetero, watson amelia, pov, lying, on stomach, on bed, looking at viewer, tongue out, blush"

// ── 1) Named woman, pov: the sentence is hers ──
{
  const on = flux(POV, true, "watson_amelia")
  assert(on.includes("Watson Amelia is"), "pose sentence names her")
  assert(!/\bThey are\b/.test(on) && !/One of them is/.test(on), "no shared or 'one of them' pose sentence")
  assert(/her stomach/.test(on), "her possessive")
  const off = flux(POV, false, "watson_amelia")
  assert(/\bThey are\b/.test(off), "without experimental rules the sentence stays shared")
}

// ── 2) Unnamed couple, pov: the woman's ──
{
  const on = flux("1boy, 1girl, hetero, pov, lying, on stomach, looking at viewer", true)
  assert(/The woman is/.test(on), "unnamed woman gets the pose")
}

// ── 3) Not applied: no pov, female pov, two women ──
{
  assert(/\bThey are\b/.test(flux("1boy, 1girl, hetero, lying, on stomach, looking at viewer", true)), "no pov: unchanged")
  assert(!/The woman is lying/.test(flux("1boy, 1girl, hetero, pov, female pov, lying, on stomach", true)), "female pov: the camera is her")
  assert(!/The woman is lying/.test(flux("2girls, pov, lying, on stomach", true)), "two women: unchanged")
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`)

if (failed > 0) {
  process.exit(1)
}
