/**
 * What the pack builder keeps for itself instead of sharing with the gallery: the tag slots it
 * looks up, its prompt format and its content rating.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-own-state.verify.ts
 */
import assert from "node:assert/strict"
import { createTagSlotEnricher, withFetchedSlots, type TagSlotFetch } from "../lib/pack/tag-slot-enricher"
import { packPromptFormat, sanitizePackPreferences } from "../lib/pack/pack-config-migration"
import { withRowDefaults } from "../lib/pack/brief-history"
import { storedPackRating, withPackRating } from "../lib/pack/pack-rating"
import { savedPackPromptCount, type SavedPack } from "../lib/pack/saved-pack"
import type { PackPreferences, StoredPackSourceAnswers } from "../lib/storage"

let passed = 0
const check = async (fn: () => void | Promise<void>) => { await fn(); passed++ }

async function main() {
  // ── Tag slots: each owner's lookups stay its own ───────────────────────────────
  await check(async () => {
    const asked: string[][] = []
    const fetch: TagSlotFetch = async (names) => {
      asked.push(names)
      return Object.fromEntries(names.map((n) => [n, "clothing:top"]))
    }
    const packChanges: Record<string, string>[] = []
    const classicChanges: Record<string, string>[] = []
    const pack = createTagSlotEnricher(fetch, (f) => packChanges.push(f))
    const classic = createTagSlotEnricher(fetch, (f) => classicChanges.push(f))

    assert.equal(await pack.enrich(["shirt", "hat"], { hat: "clothing:headwear" }), true)
    assert.deepEqual(asked, [["shirt"]], "a tag the app knows is not looked up")
    assert.deepEqual(pack.fetched(), { shirt: "clothing:top" })
    assert.equal(packChanges.length, 1)
    // The classic builder heard nothing and has nothing.
    assert.equal(classicChanges.length, 0)
    assert.deepEqual(classic.fetched(), {})

    // Asked again: nothing new goes out, nothing changes.
    assert.equal(await pack.enrich(["shirt"], {}), false)
    assert.equal(asked.length, 1)
    assert.equal(packChanges.length, 1)
  })

  await check(async () => {
    let fail = true
    const fetch: TagSlotFetch = async (names, onFailed) => {
      if (fail) {
        onFailed(names)
        return {}
      }
      return Object.fromEntries(names.map((n) => [n, "pose:standing"]))
    }
    const enricher = createTagSlotEnricher(fetch, () => {})
    assert.equal(await enricher.enrich(["standing"], {}), false)
    fail = false
    // A failed lookup is asked again on the next pass.
    assert.equal(await enricher.enrich(["standing"], {}), true)
    assert.deepEqual(enricher.fetched(), { standing: "pose:standing" })
  })

  await check(async () => {
    const enricher = createTagSlotEnricher(async () => { throw new Error("offline") }, () => {})
    assert.equal(await enricher.enrich(["skirt"], {}), false)
    assert.deepEqual(enricher.fetched(), {})
  })

  await check(() => {
    const app = { shirt: "clothing:top" }
    assert.equal(withFetchedSlots(app, {}), app, "nothing fetched: the app's slots as they are")
    assert.deepEqual(withFetchedSlots(app, { shirt: "other", hat: "clothing:headwear" }), { shirt: "clothing:top", hat: "clothing:headwear" })
  })

  // ── Prompt format: the builder's own preference ────────────────────────────────
  const prefs = (extra: Partial<PackPreferences> = {}): PackPreferences => ({ promptCount: 10, neverDefaults: [], includeSensitive: false, ...extra })

  await check(() => {
    // No choice made in the builder: it starts in the gallery's format.
    assert.equal(packPromptFormat(prefs(), "anima"), "anima")
    assert.equal(packPromptFormat(prefs(), "tags"), "tags")
    // A choice made in the builder holds whatever the gallery uses.
    assert.equal(packPromptFormat(prefs({ promptFormat: "flux2" }), "anima"), "flux2")
    assert.equal(packPromptFormat(prefs({ promptFormat: "tags" }), "moss"), "tags")
  })

  await check(() => {
    assert.equal(sanitizePackPreferences(prefs({ promptFormat: "moss" })).promptFormat, "moss")
    // A value the app doesn't know is dropped, and the gallery's format applies again.
    const odd = sanitizePackPreferences({ ...prefs(), promptFormat: "prose" } as unknown as PackPreferences)
    assert.equal("promptFormat" in odd, false)
    assert.equal("promptFormat" in sanitizePackPreferences(prefs()), false)
    // Other preference changes keep it.
    const withDefaults = sanitizePackPreferences(withRowDefaults(prefs({ promptFormat: "anima" }), "never", ["smile"]))
    assert.equal(withDefaults.promptFormat, "anima")
  })

  // ── Rating: saved in the preference, never in the gallery ──────────────────────
  const answers: StoredPackSourceAnswers = { ratingMode: "sfw", tagsSource: "custom", searchTags: "frieren", booruProvider: "gelbooru" }

  await check(() => {
    assert.equal(storedPackRating(answers, "explicit"), "sfw")
    assert.equal(storedPackRating(null, "questionable"), "questionable")
  })

  await check(() => {
    const before = { ...answers }
    const next = withPackRating(answers, "explicit", { ...answers, tagsSource: "current" })
    assert.deepEqual(next, { ...answers, ratingMode: "explicit" }, "only the rating changes")
    assert.deepEqual(answers, before, "the stored answers given are not changed")
    const fresh = withPackRating(null, "both", { ratingMode: "sfw", tagsSource: "current", searchTags: "", booruProvider: "danbooru" })
    assert.deepEqual(fresh, { ratingMode: "both", tagsSource: "current", searchTags: "", booruProvider: "danbooru" })
  })

  // ── A card asks before it replaces a pack with prompts ─────────────────────────
  await check(() => {
    assert.equal(savedPackPromptCount(null), 0)
    const base = { result: null } as unknown as SavedPack
    assert.equal(savedPackPromptCount(base), 0)
    const made = { result: { prompts: [{ prompt: "a" }, { prompt: "b" }] } } as unknown as SavedPack
    assert.equal(savedPackPromptCount(made), 2)
  })

  console.log(`pack-own-state: ${passed} checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
