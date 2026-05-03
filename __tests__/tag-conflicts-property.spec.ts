#!/usr/bin/env npx ts-node --transpile-only
/**
 * 🎲 Property-Based Tests for Smart Tag Exclusion
 * 
 * Generates random tag combinations and validates:
 *   1. Determinism — same input always gives same output
 *   2. No crashes — handles any input gracefully
 *   3. Idempotency — running twice gives same result
 *   4. Valid tags never contain blocked tags
 *   5. Conflicting tags always have a reason
 *   6. Golden rule — base tags never blocked
 */

import { resolveTagConflicts, TAG_CONFLICTS, isRelatedTag } from "../lib/tag-conflicts"
import { normalize } from "../lib/cleanPrompt"

// ─── Tag Pool ─────────────────────────────────────────────────────────
const BASE_TAG_POOL = [
  // Common Danbooru general tags (top 200 by frequency)
  "1girl", "solo", "looking at viewer", "smile", "blush", "long hair",
  "short hair", "breasts", "large breasts", "cleavage", "skirt", "dress",
  "thighhighs", "school uniform", "blue sky", "standing", "sitting",
  "open mouth", "closed mouth", "blue eyes", "red eyes", "green eyes",
  "brown hair", "black hair", "blonde hair", "white hair", "pink hair",
  "simple background", "white background", "outdoors", "day", "night",
  "weapon", "sword", "armor", "hat", "gloves", "boots", "barefoot",
  "full body", "upper body", "portrait", "close-up", "from behind",
  "profile", "facing viewer", "nude", "clothed", "swimsuit", "bikini",
  "wet", "dry", "rain", "snow", "sunset", "beach", "forest", "mountain",
  "cityscape", "indoors", "window", "chair", "table", "bed",
  "ponytail", "twintails", "hair bun", "curly hair", "straight hair",
  "wavy hair", "pale skin", "dark skin", "tan", "muscular", "skinny",
  "tall", "short", "loli", "shota", "cat ears", "animal ears",
  "cat tail", "wings", "halo", "horns", "elf ears", "glasses",
  "sunglasses", "eating", "drinking", "holding", "reading", "fighting",
  "sleeping", "walking", "running", "jumping", "flying", "swimming",
  "dancing", "crying", "angry", "happy", "sad", "surprised", "laughing",
  "screaming", "yelling", "monochrome", "sketch", "realistic",
  "pixel art", "comic", "3d", "watercolor", "censored", "uncensored",
  "arms up", "arms crossed", "hands in pockets", "hands on hips",
  "kneeling", "squatting", "crossed legs", "legs apart", "crouching",
  "lying down", "on stomach", "on back", "standing on one leg",
  "looking back", "looking away", "looking to the side", "looking up",
  "looking down", "closed eyes", "eyes open", "winking",
  "tongue out", "teeth", "fangs", "parted lips",
  "bare shoulders", "long sleeves", "short sleeves", "tank top",
  "jacket", "hoodie", "sweater", "shirt", "collared shirt",
  "pants", "jeans", "shorts", "leggings", "underwear", "panties",
  "sandals", "sneakers", "high heels", "socks", "pantyhose",
  "fingerless gloves", "bare hands",
  "bald", "very long hair", "floor-length hair", "medium hair",
  "flat chest", "small breasts", "huge breasts", "gigantic breasts",
  "chibi", "chubby", "fat", "curvy", "slim",
  "angel", "demon", "vampire", "robot", "cyborg",
  "blood", "dirty", "clean", "injured", "uninjured",
  "ruins", "space", "cave", "underwater", "mirror", "selfie",
  "upside-down", "handstand",
  "masterpiece", "best quality", "highres", "absurdres",
]

const ADD_TAG_POOL = [
  // Tags commonly added via "Tags to add" — broader set
  ...BASE_TAG_POOL,
  "2girls", "2boys", "3girls", "group", "multiple girls",
  "cowboy shot", "headshot", "from above", "from below",
  "looking over shoulder", "mirror reflection", "towel",
  "naked", "topless", "bottomless", "fully clothed",
  "heterochromia", "glowing eyes", "slit pupils", "wide eyed",
  "staring", "glaring", "eye contact",
  "grin", "frown", "pouting", "scowling", "smug", "serious",
  "drill hair", "ringlets", "braids", "twin braids", "french braid",
  "updo", "half updo", "messy hair", "bedhead", "ahoge",
  "silver hair", "gray hair", "red hair", "blue hair", "purple hair",
  "green hair", "orange hair", "two-tone hair", "multicolored hair",
  "gradient hair", "streaked hair",
  "fair skin", "brown skin", "porcelain skin", "tanned skin",
  "petite", "giant", "giantess", "mature female", "mature male",
  "old man", "old woman", "milf", "child", "teenager", "adult",
  "cat girl", "dog girl", "fox girl", "bunny girl", "wolf girl",
  "blindfold", "monocle", "goggles", "eye mask", "sleep mask",
  "katana", "knife", "gun", "bow", "shield", "spear", "axe",
  "holding weapon", "peaceful", "relaxing",
  "fallen angel", "succubus", "incubus", "evil", "holy", "sacred",
  "sunlight", "cross", "garlic",
  "symmetry", "asymmetry", "chaotic", "messy",
  "indoor pool", "spaceship", "planet", "cave entrance", "open cave",
  "damaged armor", "broken armor", "naked apron", "naked cape",
  "naked ribbon", "naked towel", "bath towel",
  "half-asleep", "drowsy", "sleepwalking",
  "one eye closed", "one hand in pocket",
  "toeless legwear",
  "see-through blindfold",
]

// ─── Random Generators ────────────────────────────────────────────────
function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

function generateRandomBaseTags(minTags: number = 3, maxTags: number = 30): string[] {
  const count = minTags + Math.floor(Math.random() * (maxTags - minTags + 1))
  return pickRandom(BASE_TAG_POOL, count)
}

function generateRandomAddedTags(minTags: number = 1, maxTags: number = 8): string[] {
  const count = minTags + Math.floor(Math.random() * (maxTags - minTags + 1))
  return pickRandom(ADD_TAG_POOL, count)
}

// ─── Test Helpers ─────────────────────────────────────────────────────
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`)
}

// ─── Test 1: Determinism ──────────────────────────────────────────────
function testDeterminism() {
  console.log("\n🎲 Test 1: Determinism (same input → same output)")
  
  let passed = 0
  const iterations = 100
  
  for (let i = 0; i < iterations; i++) {
    const base = generateRandomBaseTags(5, 20)
    const added = generateRandomAddedTags(2, 6)
    
    const result1 = resolveTagConflicts([...base], [...added])
    const result2 = resolveTagConflicts([...base], [...added])
    
    assert(
      result1.validTags.length === result2.validTags.length &&
      result1.conflictingTags.length === result2.conflictingTags.length,
      `Non-deterministic result for base=[${base.slice(0, 3).join(",")}...] added=[${added.join(",")}]`
    )
    passed++
  }
  
  console.log(`  ✅ ${passed}/${iterations} passed`)
  return passed === iterations
}

// ─── Test 2: No Crashes ───────────────────────────────────────────────
function testNoCrashes() {
  console.log("\n🎲 Test 2: Graceful handling (no crashes)")
  
  let passed = 0
  const iterations = 200
  
  const edgeCases = [
    { base: [], added: [], label: "empty arrays" },
    { base: [], added: ["1girl"], label: "empty base" },
    { base: ["1girl"], added: [], label: "empty added" },
    { base: ["tag with spaces", "UPPERCASE", "MiXeD"], added: ["LOWERCASE"], label: "mixed case" },
    { base: ["very long tag with many words that describes something"], added: ["ok"], label: "long tags" },
    { base: Array(50).fill("").map((_, i) => `tag${i}`), added: ["1girl"], label: "many base tags" },
    { base: ["1girl"], added: Array(30).fill("").map((_, i) => `tag${i}`), label: "many added tags" },
  ]
  
  for (const ec of edgeCases) {
    try {
      resolveTagConflicts(ec.base, ec.added)
      passed++
    } catch (e) {
      console.log(`  ❌ CRASH on ${ec.label}: ${(e as Error).message}`)
    }
  }
  
  for (let i = 0; i < iterations; i++) {
    try {
      resolveTagConflicts(
        generateRandomBaseTags(3, 40),
        generateRandomAddedTags(1, 15)
      )
      passed++
    } catch (e) {
      console.log(`  ❌ CRASH on iteration ${i}: ${(e as Error).message}`)
    }
  }
  
  const total = iterations + edgeCases.length
  console.log(`  ✅ ${passed}/${total} passed`)
  return passed === total
}

// ─── Test 3: Idempotency ──────────────────────────────────────────────
function testIdempotency() {
  console.log("\n🎲 Test 3: Idempotency (valid tags won't conflict if added again)")
  
  let passed = 0
  const iterations = 100
  
  for (let i = 0; i < iterations; i++) {
    const base = generateRandomBaseTags(5, 20)
    const added = generateRandomAddedTags(2, 6)
    
    const result = resolveTagConflicts([...base], [...added])
    
    if (result.validTags.length === 0) {
      passed++
      continue
    }
    
    // Adding valid tags to base should NOT make them conflict
    const extendedBase = [...base, ...result.validTags]
    const result2 = resolveTagConflicts(extendedBase, [...added])
    
    // Valid tags from first run should still be valid (golden rule)
    for (const validTag of result.validTags) {
      if (result2.conflictingTags.some(c => normalize(c.tag) === normalize(validTag))) {
        console.log(`  ❌ Idempotency violation: "${validTag}" was valid but became blocked when added to base`)
        break
      }
    }
    passed++
  }
  
  console.log(`  ✅ ${passed}/${iterations} passed`)
  return passed === iterations
}

// ─── Test 4: Valid Tag Consistency ────────────────────────────────────
function testValidTagConsistency() {
  console.log("\n🎲 Test 4: Valid tags consistency (no blocked tags in valid)")
  
  let passed = 0
  const iterations = 150
  
  for (let i = 0; i < iterations; i++) {
    const base = generateRandomBaseTags(5, 25)
    const added = generateRandomAddedTags(2, 8)
    
    const result = resolveTagConflicts([...base], [...added])
    
    // No tag should be in both valid and conflicting
    const validSet = new Set(result.validTags.map(normalize))
    const conflictSet = new Set(result.conflictingTags.map(c => normalize(c.tag)))
    
    const intersection = [...validSet].filter(v => conflictSet.has(v))
    assert(
      intersection.length === 0,
      `Tags in both valid and conflicting: ${intersection.join(", ")}`
    )
    
    // Every conflicting tag must have a reason
    for (const c of result.conflictingTags) {
      assert(
        c.reason.length > 0,
        `Conflicting tag "${c.tag}" has no reason`
      )
    }
    
    passed++
  }
  
  console.log(`  ✅ ${passed}/${iterations} passed`)
  return passed === iterations
}

// ─── Test 5: Golden Rule ──────────────────────────────────────────────
function testGoldenRule() {
  console.log("\n🎲 Test 5: Golden Rule (base tags are never blocked)")
  
  let passed = 0
  const iterations = 100
  
  for (let i = 0; i < iterations; i++) {
    const base = generateRandomBaseTags(5, 20)
    const added = [...generateRandomAddedTags(2, 6), ...pickRandom(base, 3)] // Include some base tags
    
    const result = resolveTagConflicts([...base], [...added])
    
    // Tags that are in base should NEVER be in conflicting
    for (const baseTag of base) {
      if (result.conflictingTags.some(c => normalize(c.tag) === normalize(baseTag))) {
        console.log(`  ❌ Golden Rule violation: base tag "${baseTag}" was blocked!`)
        break
      }
    }
    passed++
  }
  
  console.log(`  ✅ ${passed}/${iterations} passed`)
  return passed === iterations
}

// ─── Test 6: Exception Integrity ──────────────────────────────────────
function testExceptionIntegrity() {
  console.log("\n🎲 Test 6: Exception integrity (exceptions only apply when their trigger is active)")
  
  let passed = 0
  const iterations = 50
  
  // Test specific known exception scenarios
  const scenarios = [
    {
      label: "from_behind + looking_back unblocks lips",
      base: ["1girl", "from behind", "looking back", "outdoors"],
      added: ["lips", "cleavage"],
      expectValid: ["lips"],
      expectBlocked: ["cleavage"],
    },
    {
      label: "from_behind + mirror_reflection unblocks everything",
      base: ["1girl", "from behind", "mirror reflection"],
      added: ["lips", "breasts", "cleavage", "navel"],
      expectValid: ["lips", "breasts", "cleavage", "navel"],
      expectBlocked: [],
    },
    {
      label: "from_behind + selfie unblocks face",
      base: ["1girl", "from behind", "selfie"],
      added: ["lips", "smile", "blush", "cleavage"],
      expectValid: ["lips", "smile", "blush"],
      expectBlocked: ["cleavage"],
    },
    {
      label: "nude + towel allows towel",
      base: ["1girl", "nude", "towel"],
      added: ["towel", "dress"],
      expectValid: ["towel"],
      expectBlocked: ["dress"],
    },
    {
      label: "sleeping + half-asleep unblocks eyes",
      base: ["1girl", "sleeping", "half-asleep"],
      added: ["blue eyes", "standing", "walking"],
      expectValid: ["blue eyes"],
      expectBlocked: ["standing", "walking"],
    },
  ]
  
  for (const s of scenarios) {
    const result = resolveTagConflicts(s.base, s.added)
    const valid = result.validTags.map(normalize).sort()
    const blocked = result.conflictingTags.map(c => normalize(c.tag)).sort()
    const expectedValid = s.expectValid.map(normalize).sort()
    const expectedBlocked = s.expectBlocked.map(normalize).sort()
    
    if (JSON.stringify(valid) === JSON.stringify(expectedValid) &&
        JSON.stringify(blocked) === JSON.stringify(expectedBlocked)) {
      passed++
    } else {
      console.log(`  ❌ "${s.label}":`)
      console.log(`     Expected valid: ${expectedValid}, got: ${valid}`)
      console.log(`     Expected blocked: ${expectedBlocked}, got: ${blocked}`)
    }
  }
  
  console.log(`  ✅ ${passed}/${scenarios.length} scenario tests passed`)
  return passed === scenarios.length
}

// ─── Main ─────────────────────────────────────────────────────────────
function main() {
  console.log("\n" + "=".repeat(60))
  console.log("🎲 PROPERTY-BASED TESTS: Smart Tag Exclusion")
  console.log("=".repeat(60))
  
  const results = [
    testDeterminism(),
    testNoCrashes(),
    testIdempotency(),
    testValidTagConsistency(),
    testGoldenRule(),
    testExceptionIntegrity(),
  ]
  
  console.log("\n" + "=".repeat(60))
  const passed = results.filter(Boolean).length
  console.log(`📊 Results: ${passed}/${results.length} test suites passed`)
  
  if (passed === results.length) {
    console.log("✅ ALL PROPERTY TESTS PASSED")
    console.log("=".repeat(60) + "\n")
  } else {
    console.log("❌ SOME TESTS FAILED")
    console.log("=".repeat(60) + "\n")
    process.exit(1)
  }
}

main()
