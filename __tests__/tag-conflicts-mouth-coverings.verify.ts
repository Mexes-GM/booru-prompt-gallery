/**
 * Regression and validation tests for Smart Tag Exclusion:
 * Lips vs Mask, Mouth Mask, Veil, and other mouth coverings.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/tag-conflicts-mouth-coverings.verify.ts
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

function conflictsWith(base: string[], added: string[], targetTag: string, reasonTrigger?: string): boolean {
  const result = resolveTagConflicts(base, added)
  const conflict = result.conflictingTags.find(c => c.tag.toLowerCase().replace(/_/g, " ") === targetTag.toLowerCase().replace(/_/g, " "))
  if (!conflict) return false
  if (reasonTrigger) {
    return conflict.reason.includes(reasonTrigger)
  }
  return true
}

function isValid(base: string[], added: string[], targetTag: string): boolean {
  const result = resolveTagConflicts(base, added)
  return result.validTags.some(t => t.toLowerCase().replace(/_/g, " ") === targetTag.toLowerCase().replace(/_/g, " "))
}

// ── 1) Base has mask variants, adding lips or lip variants -> BLOCKED ──
{
  assert(conflictsWith(["1girl", "mask"], ["lips"], "lips", "mask"), "mask blocks lips")
  assert(conflictsWith(["1girl", "mouth_mask"], ["lips"], "lips", "mouth_mask"), "mouth_mask blocks lips")
  assert(conflictsWith(["1girl", "surgical mask"], ["lips"], "lips", "surgical_mask"), "surgical mask blocks lips")
  assert(conflictsWith(["1girl", "face_mask"], ["lips"], "lips", "face_mask"), "face_mask blocks lips")
  assert(conflictsWith(["1girl", "gas mask"], ["lips"], "lips", "gas_mask"), "gas mask blocks lips")
  assert(conflictsWith(["1girl", "balaclava"], ["lips"], "lips", "balaclava"), "balaclava blocks lips")
  assert(conflictsWith(["1girl", "ski mask"], ["lips"], "lips", "ski_mask"), "ski mask blocks lips")
  assert(conflictsWith(["1girl", "ninja mask"], ["lips"], "lips", "ninja_mask"), "ninja mask blocks lips")
  assert(conflictsWith(["1girl", "half mask"], ["lips"], "lips", "half_mask"), "half mask blocks lips")
  assert(conflictsWith(["1girl", "oni mask"], ["lips"], "lips", "oni_mask"), "oni mask blocks lips")
}

// ── 2) Lip variants (parted lips, glossy lips, lipstick, biting lip) blocked by mask ──
{
  assert(conflictsWith(["1girl", "mask"], ["parted lips"], "parted lips"), "mask blocks parted lips")
  assert(conflictsWith(["1girl", "surgical mask"], ["glossy lips"], "glossy lips"), "surgical mask blocks glossy lips")
  assert(conflictsWith(["1girl", "mouth mask"], ["red lips"], "red lips"), "mouth mask blocks red lips")
  assert(conflictsWith(["1girl", "mask"], ["puckered lips"], "puckered lips"), "mask blocks puckered lips")
  assert(conflictsWith(["1girl", "mask"], ["biting lip"], "biting lip"), "mask blocks biting lip")
  assert(conflictsWith(["1girl", "mask"], ["lipstick"], "lipstick"), "mask blocks lipstick")
  assert(conflictsWith(["1girl", "surgical mask"], ["red lipstick"], "red lipstick"), "surgical mask blocks red lipstick")
  assert(conflictsWith(["1girl", "mask"], ["black_lipstick"], "black_lipstick"), "mask blocks black_lipstick")
  assert(conflictsWith(["1girl", "mouth mask"], ["lip gloss"], "lip gloss"), "mouth mask blocks lip gloss")
}

// ── 3) Veils and face coverings block lips ──
{
  assert(conflictsWith(["1girl", "veil"], ["lips"], "lips", "veil"), "veil blocks lips")
  assert(conflictsWith(["1girl", "face veil"], ["lips"], "lips", "face_veil"), "face veil blocks lips")
  assert(conflictsWith(["1girl", "mouth_veil"], ["lips"], "lips", "mouth_veil"), "mouth_veil blocks lips")
  assert(conflictsWith(["1girl", "niqab"], ["lips"], "lips", "niqab"), "niqab blocks lips")
  assert(conflictsWith(["1girl", "face veil"], ["lipstick"], "lipstick"), "face veil blocks lipstick")
  assert(conflictsWith(["1girl", "veil"], ["parted lips"], "parted lips"), "veil blocks parted lips")
}

// ── 4) Gags, muzzles and mouth coverings block lips ──
{
  assert(conflictsWith(["1girl", "gag"], ["lips"], "lips", "gag"), "gag blocks lips")
  assert(conflictsWith(["1girl", "ball gag"], ["lips"], "lips", "ball_gag"), "ball gag blocks lips")
  assert(conflictsWith(["1girl", "tape gag"], ["lips"], "lips", "tape_gag"), "tape gag blocks lips")
  assert(conflictsWith(["1girl", "muzzle"], ["lips"], "lips", "muzzle"), "muzzle blocks lips")
  assert(conflictsWith(["1girl", "leather muzzle"], ["lipstick"], "lipstick"), "leather muzzle blocks lipstick")
  assert(conflictsWith(["1girl", "scarf over mouth"], ["lips"], "lips", "scarf_over_mouth"), "scarf over mouth blocks lips")
  assert(conflictsWith(["1girl", "hand over mouth"], ["lips"], "lips", "hand_over_mouth"), "hand over mouth blocks lips")
  assert(conflictsWith(["1girl", "covering mouth"], ["parted lips"], "parted lips"), "covering mouth blocks parted lips")
}

// ── 5) Symmetry: Base has lips / lipstick, adding mouth coverings -> BLOCKED ──
{
  assert(conflictsWith(["1girl", "lips"], ["mask"], "mask", "lips"), "lips blocks mask")
  assert(conflictsWith(["1girl", "lips"], ["mouth mask"], "mouth mask", "lips"), "lips blocks mouth mask")
  assert(conflictsWith(["1girl", "lips"], ["surgical mask"], "surgical mask", "lips"), "lips blocks surgical mask")
  assert(conflictsWith(["1girl", "lips"], ["veil"], "veil", "lips"), "lips blocks veil")
  assert(conflictsWith(["1girl", "lips"], ["ball gag"], "ball gag", "lips"), "lips blocks ball gag")
  assert(conflictsWith(["1girl", "parted lips"], ["mask"], "mask", "parted_lips"), "parted lips blocks mask")
  assert(conflictsWith(["1girl", "glossy lips"], ["mouth mask"], "mouth mask", "glossy_lips"), "glossy lips blocks mouth mask")
  assert(conflictsWith(["1girl", "lipstick"], ["surgical mask"], "surgical mask", "lipstick"), "lipstick blocks surgical mask")
  assert(conflictsWith(["1girl", "red lips"], ["veil"], "veil", "red_lips"), "red lips blocks veil")
  assert(conflictsWith(["1girl", "biting lip"], ["muzzle"], "muzzle", "biting_lip"), "biting lip blocks muzzle")
}

// ── 6) Realistic exceptions: Mask removed or not covering mouth -> ALLOWED ──
{
  assert(isValid(["1girl", "mask", "mask pulled down"], ["lips"], "lips"), "mask pulled down allows lips")
  assert(isValid(["1girl", "mask", "mask around neck"], ["lips"], "lips"), "mask around neck allows lips")
  assert(isValid(["1girl", "mask", "mask on head"], ["lips"], "lips"), "mask on head allows lips")
  assert(isValid(["1girl", "mouth mask", "mask removed"], ["lips"], "lips"), "mask removed allows lips")
  assert(isValid(["1girl", "surgical mask", "unworn mask"], ["lips"], "lips"), "unworn mask allows lips")
  assert(isValid(["1girl", "mask", "see-through mask"], ["lips"], "lips"), "see-through mask allows lips")
}

// ── 7) Non-mouth mask exceptions (eye mask, domino mask, sleep mask) -> ALLOWED ──
{
  assert(isValid(["1girl", "mask", "eye mask"], ["lips"], "lips"), "eye mask with mask tag allows lips")
  assert(isValid(["1girl", "mask", "domino mask"], ["lips"], "lips"), "domino mask with mask tag allows lips")
  assert(isValid(["1girl", "mask", "sleep mask"], ["lips"], "lips"), "sleep mask with mask tag allows lips")
}

// ── 8) Veil exceptions: Bridal veil / wedding veil and see-through veil -> ALLOWED ──
{
  assert(isValid(["1girl", "wedding dress", "veil", "bridal veil"], ["lips"], "lips"), "bridal veil allows lips")
  assert(isValid(["1girl", "wedding dress", "veil", "wedding veil"], ["lips"], "lips"), "wedding veil allows lips")
  assert(isValid(["1girl", "veil", "see-through veil"], ["lips"], "lips"), "see-through veil allows lips")
  assert(isValid(["1girl", "veil", "sheer veil"], ["lipstick"], "lipstick"), "sheer veil allows lipstick")
  assert(isValid(["1girl", "face veil", "translucent veil"], ["parted lips"], "parted lips"), "translucent veil allows parted lips")
  assert(isValid(["1girl", "veil", "veil lift"], ["lips"], "lips"), "veil lift allows lips")
}

// ── 9) Non-conflicting facial features are unaffected by mask ──
{
  assert(isValid(["1girl", "mask"], ["blue eyes"], "blue eyes"), "mask does not block eyes")
  assert(isValid(["1girl", "surgical mask"], ["blush"], "blush"), "surgical mask does not block blush")
  assert(isValid(["1girl", "veil"], ["long hair"], "long hair"), "veil does not block hair")
  assert(isValid(["1girl", "mouth mask"], ["earrings"], "earrings"), "mouth mask does not block earrings")
}

// ── 10) Multi-character exception preserves added tags ──
{
  // When multiple characters are present, 1 might wear a mask while the other has lips
  assert(isValid(["2girls", "mask"], ["lips"], "lips"), "2girls invalidates character-specific mask block on lips")
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`)

if (failed > 0) {
  process.exit(1)
}
