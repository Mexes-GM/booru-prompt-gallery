/**
 * Smart Tag Exclusion and framing: added lower-body tags ("thick thighs",
 * "wide hips") stay out of shots that don't show the legs.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/tag-conflicts-framing.verify.ts
 */
import { resolveTagConflicts } from "../lib/tag-conflicts"

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

const key = (t: string) => t.toLowerCase().replace(/_/g, " ")

function blocked(base: string[], added: string[], target: string, reasonPart?: string): boolean {
  const conflict = resolveTagConflicts(base, added).conflictingTags.find((c) => key(c.tag) === key(target))
  return !!conflict && (!reasonPart || conflict.reason.includes(reasonPart))
}

function kept(base: string[], added: string[], target: string): boolean {
  return resolveTagConflicts(base, added).validTags.some((t) => key(t) === key(target))
}

const BODY = ["thick thighs", "wide hips", "shiny skin"]

// ── 1) Close selfie of two characters, no framing tag (danbooru post 10040782) ──
{
  const base = [
    "1boy", "1girl", "black hair", "black jacket", "blue background", "blush", "bowtie", "brown eyes",
    "brown hair", "couple", "crossed bangs", "earrings", "gakuran", "glasses", "green nails",
    "hands on another's cheeks", "hands on another's face", "hetero", "jacket", "looking at viewer",
    "one eye closed", "pink sweater", "school uniform", "smile", "sweatdrop", "sweater",
  ]
  assert(blocked(base, BODY, "thick thighs", "Close shot"), "cheek squeeze without legs drops thick thighs")
  assert(blocked(base, BODY, "wide hips", "Close shot"), "cheek squeeze without legs drops wide hips")
  assert(kept(base, BODY, "shiny skin"), "region-free tags are still added")
}

// ── 2) A close-shot hint loses to tags that show the legs ──
{
  assert(kept(["1girl", "selfie", "mirror", "black thighhighs"], BODY, "thick thighs"), "thighhighs show the legs")
  assert(kept(["1girl", "selfie", "sitting on bed"], BODY, "wide hips"), "sitting shows the legs")
  assert(kept(["1girl", "selfie", "pleated skirt"], BODY, "thick thighs"), "a skirt shows the legs")
}

// ── 3) Neither close shot nor legs: added tags go in, as before ──
{
  assert(kept(["1girl", "smile", "school uniform"], BODY, "thick thighs"), "neutral post keeps thick thighs")
  assert(kept(["1girl", "smile", "school uniform"], BODY, "wide hips"), "neutral post keeps wide hips")
}

// ── 4) Framing tags in the post ──
{
  assert(blocked(["1girl", "upper body"], BODY, "thick thighs", "upper body"), "upper body drops thick thighs")
  assert(blocked(["1girl", "upper body"], ["huge ass"], "huge ass"), "upper body drops huge ass")
  assert(blocked(["1girl", "portrait"], BODY, "wide hips"), "portrait drops wide hips")
  assert(blocked(["1girl", "close-up"], BODY, "thick thighs", "close up"), "Danbooru's hyphenated close-up triggers the rule")
  assert(kept(["1girl", "cowboy shot"], BODY, "thick thighs"), "cowboy shot keeps thighs")
  assert(kept(["1girl", "upper body", "cowboy shot"], BODY, "wide hips"), "cowboy shot exception still applies")
  assert(kept(["1girl", "full body"], BODY, "thick thighs"), "full body keeps thighs")
  assert(kept(["1girl", "upper body", "thick thighs"], ["thick thighs"], "thick thighs"), "a tag the post already has is never dropped")
}

// ── 5) Framing applies to every character in the scene ──
{
  assert(blocked(["2girls", "upper body"], BODY, "thick thighs"), "2girls upper body drops thick thighs")
  assert(blocked(["1boy", "1girl", "upper body"], BODY, "wide hips"), "1boy 1girl upper body drops wide hips")
  // The multi-character exception itself still works for character-specific rules.
  assert(kept(["1boy", "1girl", "mask"], ["lips"], "lips"), "1boy + 1girl counts as several characters")
}

// ── 6) A framing tag in Tags to add acts like one in the post ──
{
  const result = resolveTagConflicts(["1girl", "smile"], ["upper body", "thick thighs", "shiny skin"])
  assert(result.validTags.join(",") === "upper body,shiny skin", "added upper body drops added thick thighs, order kept")
  assert(blocked(["1girl", "full body"], ["upper body", "thick thighs"], "upper body"), "an added framing tag the post contradicts is dropped")
  assert(kept(["1girl", "full body"], ["upper body", "thick thighs"], "thick thighs"), "a dropped framing tag blocks nothing")
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`)

if (failed > 0) {
  process.exit(1)
}
