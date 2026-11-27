/**
 * Artists saved on e6ai read as Floofgens artists: provider id and thumbnail host.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/e6ai-saved-artists.verify.ts
 */
import assert from "node:assert/strict"
import { migrateRetiredArtist } from "../lib/booru/retired-providers"

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

const old = { provider: "e6ai", artistTag: "someone", thumbnailUrl: "https://static1.e6ai.net/data/aa/bb/aabb.jpg", thumbnailPostId: 7, timestamp: 1 }

check(() => {
  const moved = migrateRetiredArtist(old)
  assert.equal(moved.provider, "floofgens")
  assert.equal(moved.thumbnailUrl, "https://static1.floofgens.net/data/aa/bb/aabb.jpg")
  assert.equal(moved.artistTag, "someone")
  const current = { ...old, provider: "danbooru", thumbnailUrl: "https://cdn.donmai.us/x.jpg" }
  assert.equal(migrateRetiredArtist(current), current, "a current artist is the same object")
  assert.equal(migrateRetiredArtist({ ...old, thumbnailUrl: null }).thumbnailUrl, null)
})

check(() => {
  data.set(STORAGE_KEYS.SAVED_ARTISTS, JSON.stringify([old]))
  assert.equal(userPreferences.getSavedArtists()[0].provider, "floofgens")
  // Saving the same artist from Floofgens is a duplicate; removing it removes the old row.
  assert.equal(userPreferences.addSavedArtist({ ...old, provider: "floofgens" }).length, 1)
  assert.equal(userPreferences.removeSavedArtist("floofgens", "someone").length, 0)
})

console.log(`e6ai-saved-artists: ${passed} checks passed`)
// A BroadcastChannel may be open; do not wait for it.
process.exit(0)
