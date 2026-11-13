/**
 * Pack Mode's pool with the added-tags dataset (lib/pack/dataset-tags.ts):
 * which posts get tags, the setting and other boorus, the time budget, no
 * duplicates, and a Scenes donor bringing its added clothing and place.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-dataset-tags.verify.ts
 */
import fs from "fs"
import path from "path"
import { enrichPoolPosts, prefetchPoolDatasetTags, withDatasetTags } from "../lib/pack/dataset-tags"
import { peekDatasetTags } from "../lib/dataset-tags-cache"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { cleanSyntheticPrompt } from "../lib/pack/bulk-send"
import { DEFAULT_SCENE_SETTINGS, generateScenePack, tagKindsFromPosts } from "../lib/pack/scene-pack"
import { classifyPostForPack } from "../lib/pack/pack-generator"
import { makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()

async function main() {
  // ── Enrichment of the pool ──
  {
    const tags: Record<number, string[]> = { 10: ["outdoors", "tree"], 20_000_000: ["scarf"] }
    const lookup = (id: number) => tags[id]
    const inRange = makePost(10, "1girl solo outdoors smile")
    const outOfRange = makePost(20_000_000, "1girl solo smile")
    const none = makePost(11, "1girl solo")
    const pool = [inRange, outOfRange, none]

    const out = enrichPoolPosts(pool, true, "danbooru", lookup)
    assert(out[0].tag_string === "1girl solo outdoors smile tree", `a post in range gains only its new tags (${out[0].tag_string})`)
    assert(out[1] === outOfRange, "a post past the dataset is left as is")
    assert(out[2] === none, "a post without dataset tags is the same object")
    assert(inRange.tag_string === "1girl solo outdoors smile", "the fetched post itself is never changed")
    assert(enrichPoolPosts(pool, true, "danbooru", lookup)[0] === out[0], "reading the pool again returns the same enriched object")
    assert(enrichPoolPosts(pool, false, "danbooru", lookup) === pool, "setting off: the pool is untouched")
    assert(enrichPoolPosts(pool, true, "gelbooru", lookup) === pool, "Gelbooru: the pool is untouched")

    const twice = withDatasetTags(makePost(12, "1girl jacket"), ["Jacket", "jacket", "scarf", "scarf"])
    assert(twice.tag_string === "1girl jacket scarf", `no duplicates, whatever the spelling (${twice.tag_string})`)
  }

  // ── Classic: the added tags land in the axes like the post's own ──
  {
    const post = makePost(13, "1girl solo standing smile white_shirt")
    const [filled] = enrichPoolPosts([post], true, "danbooru", () => ["blazer", "classroom", "white_shirt"])
    const core: Record<string, string> = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public/tags-core.json"), "utf8"))
    const slots: Record<string, string> = {}
    for (const [tag, slot] of Object.entries(core)) slots[tag.replace(/_/g, " ")] = slot
    const buckets = classifyPostForPack(filled, slots)
    assert(buckets.clothing.includes("blazer"), `added clothing goes to the clothing axis (${buckets.clothing.join(", ")})`)
    assert(buckets.scenery.includes("classroom"), `added place goes to the scenery axis (${buckets.scenery.join(", ")})`)
    assert(buckets.clothing.filter((t) => t === "white shirt").length === 1, "a tag the post had stays single")
  }

  // ── Requests: setting, booru, range, time budget ──
  {
    let calls = 0
    const counting = async () => { calls++; return ["scarf"] }
    const posts = [makePost(501, "1girl"), makePost(502, "1girl")]
    await prefetchPoolDatasetTags(posts, { enabled: false, provider: "danbooru", fetcher: counting })
    await prefetchPoolDatasetTags(posts, { enabled: true, provider: "gelbooru", fetcher: counting })
    await prefetchPoolDatasetTags([makePost(20_000_001, "1girl")], { enabled: true, provider: "danbooru", fetcher: counting })
    assert(calls === 0, "setting off, Gelbooru and posts past the dataset make zero requests")

    const got = await prefetchPoolDatasetTags(posts, { enabled: true, provider: "danbooru", fetcher: counting })
    assert(calls === 2 && got === 2, "in range with the setting on: one request per post")
    assert(peekDatasetTags(501)?.[0] === "scarf", "and the tags are kept for the page")
    await prefetchPoolDatasetTags(posts, { enabled: true, provider: "danbooru", fetcher: counting })
    assert(calls === 2, "posts already known aren't asked again")

    const capped = Array.from({ length: 10 }, (_, i) => makePost(600 + i, "1girl"))
    await prefetchPoolDatasetTags(capped, { enabled: true, provider: "danbooru", fetcher: counting, maxPosts: 4 })
    assert(calls === 6, "at most maxPosts requests per prefetch")

    let release: () => void = () => {}
    const slow = () => new Promise<string[]>((resolve) => { release = () => resolve(["scarf", "building"]) })
    const late = makePost(700, "1girl solo smile")
    const start = Date.now()
    const inTime = await prefetchPoolDatasetTags([late], { enabled: true, provider: "danbooru", fetcher: slow, budgetMs: 60 })
    const waited = Date.now() - start
    assert(inTime === 0 && waited < 1000, `the budget runs out: the pack doesn't wait (${waited}ms)`)
    assert(enrichPoolPosts([late], true, "danbooru")[0] === late, "and is built with the post's own tags")
    release()
    await new Promise((r) => setTimeout(r, 10))
    assert(enrichPoolPosts([late], true, "danbooru")[0].tag_string === "1girl solo smile scarf building", "a late answer serves the next pack")
  }

  // ── Scenes: a donor's added tags are part of its scene ──
  {
    const root = path.join(__dirname, "..")
    const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
    const PERMANENCE: PermanenceData = JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8"))
    const overrides: Record<string, string> = {}
    for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
    const permanence = createPermanence(PERMANENCE, overrides)
    const scene = (id: number, tags: string) => makePost(id, tags, { rating: "general" })
    const POSTS = [
      scene(101, "1girl solo standing smile looking_at_viewer bedroom bed indoors white_shirt pleated_skirt"),
      scene(102, "1girl solo standing blush looking_at_viewer park outdoors tree day blue_dress boots"),
      scene(103, "1girl solo standing closed_eyes from_side street outdoors night jacket jeans"),
      scene(104, "1girl solo sitting smile looking_at_viewer classroom indoors chair desk shirt skirt"),
      scene(105, "1girl solo sitting open_mouth from_above cafe indoors table cup sweater skirt"),
      scene(106, "1girl solo sitting crossed_legs looking_at_viewer couch indoors living_room shirt shorts"),
      scene(107, "1girl solo lying on_back smile from_above bed bedroom indoors pajamas pillow"),
      scene(108, "1girl solo lying on_stomach looking_at_viewer grass outdoors flower day dress"),
    ]
    const IDENTITY = ["my character", "long hair", "blue hair", "red eyes"]
    const clean = (tags: string[], locked: string[]) => cleanSyntheticPrompt(tags, ["my character"], {
      excludeInput: "", addInput: "", includeCharacters: true, optimizeTags: true, smartTagExclusion: true, tagOverrides: overrides, lockedTags: locked,
    }, locked)
    const donorPrompt = (posts: typeof POSTS) => {
      const pool = buildScenePool(posts, { overrides, permanence, subject: "girl", tagKind: (tag) => tagKindsFromPosts(posts).get(tag) })
      const { prompts } = generateScenePack(pool, {
        identity: IDENTITY, alwaysAdd: [], subject: "girl", settings: DEFAULT_SCENE_SETTINGS, count: 30, seed: 3, overrides, clean,
        resolution: () => ({ width: 1024, height: 1024 }),
      })
      return prompts.find((p) => p.scene?.postId === 103)?.prompt.split(",").map((t) => t.trim()) ?? []
    }
    const lookup = (id: number) => (id === 103 ? ["scarf", "building", "jacket"] : undefined)
    const plain = donorPrompt(POSTS)
    const filled = donorPrompt(enrichPoolPosts(POSTS, true, "danbooru", lookup))
    assert(plain.length > 0 && filled.length > 0, "the donor makes a prompt both times")
    assert(!plain.includes("scarf") && !plain.includes("building"), "without the dataset: the post's own scene")
    assert(filled.includes("scarf"), `its added clothing joins the scene (${filled.join(", ")})`)
    assert(filled.includes("building"), `its added place joins the scene (${filled.join(", ")})`)
    assert(filled.filter((t) => t === "jacket").length === 1, "a garment it already had appears once")
    const gelbooru = donorPrompt(enrichPoolPosts(POSTS, true, "gelbooru", lookup))
    assert(!gelbooru.includes("scarf"), "a Gelbooru pool gets nothing")
  }

  done()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
