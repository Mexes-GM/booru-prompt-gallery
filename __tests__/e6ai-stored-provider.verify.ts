/**
 * Provider ids saved while e6ai was open ("e6ai") read as Floofgens:
 *   - the Pack source answers kept in storage
 *   - the saved pack
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/e6ai-stored-provider.verify.ts
 */
import assert from "node:assert/strict"
import { readSavedPack, savedPackToStore } from "../lib/pack/saved-pack"
import { emptyBrief, type PackBrief } from "../lib/pack/brief"

// Minimal browser: a Map-backed localStorage.
const data = new Map<string, string>()
const g = globalThis as unknown as Record<string, unknown>
g.window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} }
g.localStorage = {
  getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
  setItem: (k: string, v: string) => void data.set(k, String(v)),
  removeItem: (k: string) => void data.delete(k),
}

/* eslint-disable @typescript-eslint/no-require-imports */
const { STORAGE_KEYS, userPreferences } = require("../lib/storage") as typeof import("../lib/storage")

let passed = 0
const check = (fn: () => void) => { fn(); passed++ }
const stored = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

const answers = { ratingMode: "both", tagsSource: "current", searchTags: "1girl", booruProvider: "e6ai" }

check(() => {
  data.set(STORAGE_KEYS.PACK_SOURCE_ANSWERS, JSON.stringify(answers))
  assert.equal(userPreferences.getPackSourceAnswers()?.booruProvider, "floofgens")
  assert.equal(userPreferences.getPackSourceAnswers()?.searchTags, "1girl")
})

check(() => {
  data.set(STORAGE_KEYS.PACK_SOURCE_ANSWERS, JSON.stringify({ ...answers, booruProvider: "Danbooru" }))
  assert.equal(userPreferences.getPackSourceAnswers()?.booruProvider, "danbooru")
  data.set(STORAGE_KEYS.PACK_SOURCE_ANSWERS, JSON.stringify({ ...answers, booruProvider: 5 }))
  assert.equal(userPreferences.getPackSourceAnswers(), null)
})

const brief: PackBrief = emptyBrief()

check(() => {
  const pack = savedPackToStore({ brief, outfit: { kind: "scene" }, provider: "danbooru", gallerySearch: "", result: null }, 1)
  assert.ok(pack)
  const read = readSavedPack(stored({ ...pack, provider: "e6ai" }))
  assert.ok(read, "a pack saved on e6ai is kept")
  assert.equal(read.provider, "floofgens")
  assert.equal(readSavedPack(stored(pack))?.provider, "danbooru")
  assert.equal(readSavedPack(stored({ ...pack, provider: "nowhere" })), null)
  assert.equal(readSavedPack(stored({ ...pack, provider: 3 })), null)
})

console.log(`e6ai-stored-provider: ${passed} checks passed`)
