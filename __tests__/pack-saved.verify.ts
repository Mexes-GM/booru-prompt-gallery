/**
 * The pack kept across a reload (lib/pack/saved-pack.ts): what goes in comes back the same,
 * a broken or foreign value is dropped, and one too large keeps the brief without the prompts.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-saved.verify.ts
 */
import assert from "node:assert/strict"
import {
  SAVED_PACK_MAX_CHARS,
  SAVED_PACK_VERSION,
  readSavedPack,
  savedPackToStore,
  savedResultOf,
  type LiveResult,
  type SavedPackInput,
} from "../lib/pack/saved-pack"
import type { PackBrief } from "../lib/pack/brief"
import type { BriefOutfit } from "../lib/pack/brief-pack"
import type { PackPrompt } from "../lib/pack/pack-generator"

let passed = 0
const check = (fn: () => void) => { fn(); passed++ }
/** Through storage: localStorage holds JSON text. */
const stored = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

const brief: PackBrief = {
  who: [{ tag: "frieren", role: "girl", addedLook: ["twintails"], removedLook: ["earrings"] }],
  requests: [
    { tag: "bikini", role: "wearing" },
    { tag: "beach", role: "where", exact: true },
    { tag: "sitting", role: "doing" },
    { tag: "night", role: "where", ambience: true },
  ],
  never: ["hat"],
  literal: ["masterpiece", "best quality"],
  others: [],
  people: { girls: 1, boys: 0 },
  changes: "scene",
  leftOut: ["101", "202"],
  outfitStyles: ["swimwear"],
  peopleMix: [{ girls: 2, boys: 0 }],
}
const outfit: BriefOutfit = { kind: "official", name: "Mage outfit" }

/** A prompt as the scenes engine makes it: about forty tags, a size, a scene with its donors. */
function prompt(i: number): PackPrompt {
  const tags = ["frieren", "1girl", "solo", "white hair", "green eyes", "pointy ears", "twintails", "white bikini", "beach", "night", "sitting"]
  for (let t = 0; tags.length < 40; t++) tags.push(`descriptive scene tag ${i}-${t}`)
  return {
    prompt: tags.join(", "),
    values: [],
    sceneRating: "s",
    width: 832,
    height: 1216,
    scene: {
      postId: 9_000_000 + i,
      preview: `https://cdn.example.org/data/preview/ab/cd/abcdef0123456789abcdef01234567${String(i).padStart(2, "0")}.jpg`,
      situation: "at the beach",
      donors: [9_000_000 + i, 8_000_000 + i, 7_000_000 + i],
    },
  }
}

function live(count: number, extra: Partial<Omit<LiveResult, "made">> = {}): LiveResult & { made: LiveResult["made"] & { pool: object } } {
  const prompts = Array.from({ length: count }, (_, i) => prompt(i))
  return {
    prompts,
    locked: [0, 3],
    shortBy: 0,
    issues: [
      { kind: "condition-variety", role: "wearing", tags: ["bikini"], styles: ["swimwear"], variants: 12, fromScene: 20, fromDonors: 10, fromLibrary: 18, imposed: 2, partial: 1 } as unknown as LiveResult["issues"][number],
      { kind: "pose-imposed", tag: "sitting", prompts: 4 },
    ],
    count,
    brief,
    outfit,
    made: {
      pool: { scenes: ["never stored"] },
      seed: 123456789,
      genCount: count - 2,
      preferredPosts: [9_000_000, 9_000_001],
      lockedScenes: [8_999_999],
      skipScenes: [7_777_777],
      slots: Array.from({ length: count - 2 }, (_, i) => i + 1),
      baseScene: 9_000_005,
      rerolls: [{ index: 4, seed: 42, slot: 3 }, { index: 7, seed: 43 }],
      sourceKey: "danbooru|sfw|false|frieren",
    },
    ...extra,
  }
}

const input = (result: LiveResult | null): SavedPackInput => ({
  brief,
  outfit,
  provider: "danbooru",
  gallerySearch: "frieren rating:general",
  result: result ? savedResultOf(result, brief, outfit) : null,
})

// ── Round trip ─────────────────────────────────────────────────────────────────
check(() => {
  const result = live(12)
  const value = savedPackToStore(input(result), 1_700_000_000_000)
  assert.ok(value)
  const back = readSavedPack(stored(value))
  assert.ok(back, "a saved pack reads back")
  assert.equal(back.version, SAVED_PACK_VERSION)
  assert.equal(back.savedAt, 1_700_000_000_000)
  assert.equal(back.resultsDropped, undefined)
  // The brief, the outfit choice and where it searched.
  assert.deepEqual(back.brief, brief)
  assert.deepEqual(back.outfit, outfit)
  assert.equal(back.provider, "danbooru")
  assert.equal(back.gallerySearch, "frieren rating:general")
  // The rows: text, size, scene, locks.
  assert.ok(back.result)
  assert.deepEqual(back.result.prompts, result.prompts)
  assert.deepEqual(back.result.locked, [0, 3])
  assert.equal(back.result.shortBy, 0)
  assert.equal(back.result.count, 12)
  assert.deepEqual(back.result.issues, result.issues)
  // How it was made: all of it but the pool.
  const { pool: _pool, ...made } = result.made
  void _pool
  assert.deepEqual(back.result.made, made)
  assert.equal("pool" in back.result.made, false)
  // Made from the pack's own brief and outfit: neither is stored twice.
  assert.equal(back.result.brief, undefined)
  assert.equal(back.result.outfit, undefined)
})

check(() => {
  // A brief changed after Generate: the prompts are out of date, and stay so after a reload.
  const older: PackBrief = { ...brief, never: [] }
  const scene: BriefOutfit = { kind: "scene" }
  const back = readSavedPack(stored(savedPackToStore(input(live(5, { brief: older, outfit: scene })), 1)))
  assert.ok(back?.result)
  assert.deepEqual(back.result.brief, older)
  assert.deepEqual(back.result.outfit, scene)
  assert.deepEqual(back.brief, brief)
})

check(() => {
  // No prompts yet: the brief alone.
  const back = readSavedPack(stored(savedPackToStore(input(null), 5)))
  assert.ok(back)
  assert.equal(back.result, null)
  assert.deepEqual(back.brief, brief)
  // Optional fields left out stay left out.
  const plain: PackBrief = { who: [{ tag: null, addedLook: [], removedLook: [] }], requests: [], never: [], literal: [], others: [], people: null, changes: "outfit", leftOut: [] }
  const again = readSavedPack(stored(savedPackToStore({ ...input(null), brief: plain, outfit: { kind: "scene" } }, 5)))
  assert.deepEqual(again?.brief, plain)
})

// ── Broken or foreign values ───────────────────────────────────────────────────
check(() => {
  const good = stored(savedPackToStore(input(live(4)), 1)) as Record<string, unknown>
  assert.ok(readSavedPack(good))
  const broken: unknown[] = [
    null,
    undefined,
    "pack",
    42,
    [],
    {},
    { ...good, version: SAVED_PACK_VERSION + 1 },
    { ...good, version: undefined },
    { ...good, savedAt: "yesterday" },
    { ...good, provider: "another-site" },
    { ...good, gallerySearch: null },
    { ...good, outfit: { kind: "official" } },
    { ...good, brief: { ...brief, who: [] } },
    { ...good, brief: { ...brief, changes: "everything" } },
    { ...good, brief: { ...brief, requests: [{ tag: "bikini", role: "holding" }] } },
    { ...good, brief: { ...brief, people: { girls: "one" } } },
    { ...good, result: { ...(good.result as object), prompts: [{ prompt: 1, values: [] }] } },
    { ...good, result: { ...(good.result as object), locked: [99] } },
    { ...good, result: { ...(good.result as object), made: { seed: 1 } } },
    { ...good, result: { ...(good.result as object), brief: { who: "frieren" } } },
    { ...good, result: undefined },
  ]
  broken.forEach((value, i) => assert.equal(readSavedPack(value), null, `broken value ${i} is dropped`))
})

// ── Too large ──────────────────────────────────────────────────────────────────
check(() => {
  const whole = savedPackToStore(input(live(50)), 1)
  assert.ok(whole)
  const size = JSON.stringify(whole).length
  const lean = savedPackToStore(input(null), 1)
  const leanSize = JSON.stringify({ ...lean, resultsDropped: true }).length
  // Room for the brief but not the prompts: the brief is saved, and it says so.
  const dropped = savedPackToStore(input(live(50)), 1, size - 1)
  assert.ok(dropped)
  assert.equal(dropped.result, null)
  assert.equal(dropped.resultsDropped, true)
  assert.deepEqual(readSavedPack(stored(dropped))?.brief, brief)
  assert.equal(readSavedPack(stored(dropped))?.resultsDropped, true)
  assert.ok(JSON.stringify(dropped).length <= size - 1)
  // Not even the brief: nothing.
  assert.equal(savedPackToStore(input(live(50)), 1, leanSize - 1), null)
})

check(() => {
  // A pack of 50 prompts fits well within the limit.
  const size = JSON.stringify(savedPackToStore(input(live(50)), 1)).length
  assert.ok(size < SAVED_PACK_MAX_CHARS / 4, `a 50-prompt pack takes ${size} characters`)
  console.log(`  a 50-prompt pack: ${size} characters`)
})

console.log(`pack-saved: ${passed} checks passed`)
