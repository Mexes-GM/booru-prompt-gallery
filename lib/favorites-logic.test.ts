/**
 * Unit tests for the pure favorites decision logic (lib/favorites-logic.ts).
 *
 * These lock in the fixes for three recurring favorites bugs:
 *   F1 — removeFolderFromFavorites: deleting a folder must strip its id from
 *        every referencing favorite so the item does not vanish from all views.
 *   F2 — buildFavoriteUpsertRow: `position` is stamped ONLY on creation, never on
 *        edits, so folder toggles no longer reorder favorites.
 *   F3 — favoritesSetToItems: stable Set→items mapping used by the optimistic-add
 *        rollback (single source of truth for SWR cache keys).
 *
 * Uses Node's built-in `assert` (no test framework installed). Self-running:
 *   npx ts-node lib/favorites-logic.test.ts
 */

import assert from "assert"
import {
  removeFolderFromFavorites,
  buildFavoriteUpsertRow,
  favoritesSetToItems,
  favKey,
} from "./favorites-logic"

// ---------------------------------------------------------------------------
// Minimal self-contained runner
// ---------------------------------------------------------------------------

let passed = 0
let failed = 0
const failures: string[] = []

function test(name: string, fn: () => void): void {
  try {
    fn()
    passed++
    console.log(`  \u2713 ${name}`)
  } catch (e) {
    failed++
    const msg = e instanceof Error ? e.message : String(e)
    failures.push(`${name}: ${msg}`)
    console.error(`  \u2717 ${name}\n      ${msg}`)
  }
}

// ---------------------------------------------------------------------------
// F1 — removeFolderFromFavorites
// ---------------------------------------------------------------------------

console.log("\nremoveFolderFromFavorites (F1: orphaned folder_ids)")

test("strips the deleted folder id from every referencing favorite", () => {
  const map = {
    "danbooru:1": ["folderA", "folderB"],
    "danbooru:2": ["folderA"],
    "e621:3": ["folderB"],
    "danbooru:4": [],
  }
  const { newMap, affected } = removeFolderFromFavorites(map, "folderA")

  assert.deepStrictEqual(newMap["danbooru:1"], ["folderB"])
  assert.deepStrictEqual(newMap["danbooru:2"], [])
  assert.deepStrictEqual(newMap["e621:3"], ["folderB"], "unrelated item untouched")
  assert.deepStrictEqual(newMap["danbooru:4"], [])

  // Only rows that actually referenced the folder are reported as affected.
  const keys = affected.map((a) => a.key).sort()
  assert.deepStrictEqual(keys, ["danbooru:1", "danbooru:2"])
})

test("returns no affected rows when the folder is referenced nowhere", () => {
  const map = { "danbooru:1": ["folderB"], "danbooru:2": [] }
  const { newMap, affected } = removeFolderFromFavorites(map, "ghost")
  assert.strictEqual(affected.length, 0)
  assert.deepStrictEqual(newMap, map)
})

test("does not mutate the input map (immutability)", () => {
  const map = { "danbooru:1": ["folderA"] }
  removeFolderFromFavorites(map, "folderA")
  assert.deepStrictEqual(map["danbooru:1"], ["folderA"], "original map preserved")
})

// ---------------------------------------------------------------------------
// F2 — buildFavoriteUpsertRow
// ---------------------------------------------------------------------------

console.log("\nbuildFavoriteUpsertRow (F2: position reorder)")

test("stamps position ONLY when creating a new favorite", () => {
  const row = buildFavoriteUpsertRow({
    userId: "u1",
    provider: "danbooru",
    postId: 10,
    folderIds: [],
    isNewFavorite: true,
    now: 1000,
  })
  assert.strictEqual(row.position, -1000)
})

test("OMITS position when editing an existing favorite (folder toggle)", () => {
  const row = buildFavoriteUpsertRow({
    userId: "u1",
    provider: "danbooru",
    postId: 10,
    folderIds: ["folderA"],
    isNewFavorite: false,
    now: 2000,
  })
  assert.ok(
    !("position" in row),
    "position must be absent so a PostgREST upsert preserves the original order",
  )
  assert.deepStrictEqual(row, {
    user_id: "u1",
    provider: "danbooru",
    post_id: 10,
    folder_ids: ["folderA"],
  })
})

// ---------------------------------------------------------------------------
// F3 — favoritesSetToItems
// ---------------------------------------------------------------------------

console.log("\nfavoritesSetToItems (F3: stable cache-key mapping)")

test("maps provider:postId keys to FavoriteItem[] preserving order", () => {
  const items = favoritesSetToItems(new Set(["danbooru:5", "e621:6"]))
  assert.deepStrictEqual(items, [
    { provider: "danbooru", id: 5 },
    { provider: "e621", id: 6 },
  ])
})

test("drops malformed keys that do not parse to a numeric id", () => {
  const items = favoritesSetToItems(["danbooru:abc", "danbooru:7"])
  assert.deepStrictEqual(items, [{ provider: "danbooru", id: 7 }])
})

test("legacy bare-number key falls back to danbooru provider", () => {
  const items = favoritesSetToItems(["42"])
  assert.deepStrictEqual(items, [{ provider: "danbooru", id: 42 }])
})

// ---------------------------------------------------------------------------
// F9 — favKey
// ---------------------------------------------------------------------------

console.log("\nfavKey (F9: canonical key normalization)")

test("lowercases the provider so keys are stable across code paths", () => {
  assert.strictEqual(favKey("Danbooru", 5), "danbooru:5")
  assert.strictEqual(favKey("DANBOORU", 5), "danbooru:5")
  assert.strictEqual(favKey("danbooru", 5), "danbooru:5")
})

test("produces a key that round-trips through favoritesSetToItems", () => {
  const key = favKey("e621", 99)
  const items = favoritesSetToItems([key])
  assert.deepStrictEqual(items, [{ provider: "e621", id: 99 }])
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error("\nFailures:\n" + failures.map((f) => "  - " + f).join("\n"))
  process.exit(1)
}
