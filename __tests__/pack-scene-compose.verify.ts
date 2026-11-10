/**
 * Tests for lib/pack/scene/scene-compose.ts (composePack).
 *
 * Covers:
 *   1. Fixed order: header, identity, skeleton, face, outfit, body, camera, place, extras, loose.
 *   2. Header: identity counts are respected and the scene adds what is missing; counts
 *      are written from the scene when the identity has none; solo / solo focus never
 *      stay with more than one person.
 *   3. Faithful uses a scene whole; remix swaps units only between compatible scenes
 *      (anchors, situation, rating and people count).
 *   4. Clothing / scenery / extras options.
 *   5. Dangling clothing references are removed from the form of the tag.
 *   6. The identity wins conflicts; scenes are not checked against themselves.
 *   7. shortBy, determinism and no duplicate prompts.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-compose.verify.ts
 */
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { composePack, dropDanglingReferences, type ComposeOptions, type ScenePrompt } from "../lib/pack/scene/scene-compose"
import { createPermanence } from "../lib/pack/scene/permanence"
import { OVERRIDES, PERMANENCE_DATA, makeAssert, makePost } from "./fixtures/pack-scene-data"
import type { BooruPost } from "../lib/booru/types"

const { assert, done } = makeAssert()
const ctx = { overrides: OVERRIDES, permanence: createPermanence(PERMANENCE_DATA, OVERRIDES), subject: "girl" as const }
const pool = (posts: BooruPost[]) => buildScenePool(posts, ctx)

const IDENTITY = ["1girl", "solo", "long hair", "blue hair"]
const options = (over: Partial<ComposeOptions> = {}): ComposeOptions => ({
  identity: IDENTITY, subject: "girl", mix: "faithful", clothing: "scene", scenery: "scene",
  extras: false, count: 5, seed: 1, overrides: OVERRIDES, ...over,
})

const P1 = makePost(1, "1girl solo standing smile from_above bedroom bed indoors skirt shirt")
const P2 = makePost(2, "1girl solo standing blush looking_at_viewer park outdoors sunset dress boots")
const P3 = makePost(3, "1girl solo lying on_bed smile from_side bedroom bed indoors shirt skirt navel")
const P4 = makePost(4, "1girl solo lying on_back blush looking_at_viewer beach outdoors sunset dress boots")
const P5 = makePost(5, "1girl 1boy hetero sitting hug smile from_side bedroom bed indoors skirt shirt")
const main = pool([P1, P2, P3, P4, P5])
assert(main.scenes.length === 5 && main.situations.length === 4, "fixture pool: five scenes, four situations")
const SITUATION_OF = (id: number) => main.situations.find((s) => s.sceneIds.includes(id))!.id
const tagsOf = (id: number) => Object.values(main.scenes.find((s) => s.postId === id)!.units).flat()
const idx = (p: ScenePrompt, tag: string) => p.tags.indexOf(tag)

// ── Order and header ──
{
  const { prompts, shortBy } = composePack(main, options({ count: 5 }))
  assert(prompts.length === 5 && shortBy === 0, "one prompt per scene, nothing short")
  const p1 = prompts.find((p) => p.sources.skeleton === 1)!
  const order = ["1girl", "solo", "long hair", "blue hair", "standing", "smile", "skirt", "shirt", "from above", "bedroom", "bed", "indoors"]
  assert(
    order.every((tag, i) => idx(p1, tag) >= 0 && (i === 0 || idx(p1, order[i - 1]) < idx(p1, tag))),
    "fixed order: header, identity, skeleton, face, outfit, camera, place"
  )
  const p3 = prompts.find((p) => p.sources.skeleton === 3)!
  assert(idx(p3, "navel") > idx(p3, "shirt") && idx(p3, "navel") < idx(p3, "from side"), "body goes between outfit and camera")
  assert(p1.locked.join() === IDENTITY.join(), "locked = header + identity")
  assert(p1.rating === "g" && p1.aspect !== undefined, "rating and aspect come from the scene")

  // the identity brings the count and the scene adds a partner and the pairing
  const p5 = prompts.find((p) => p.sources.skeleton === 5)!
  assert(p5.tags.slice(0, 5).join() === "1girl,1boy,hetero,long hair,blue hair", "identity count kept; the scene adds 1boy and hetero before the rest of the identity")
  assert(!p5.tags.includes("solo"), "solo never stays with two people")

  // the identity has no count: it is written from the scene
  const bare = composePack(main, options({ identity: ["long hair", "blue hair"], count: 5 })).prompts
  const b1 = bare.find((p) => p.sources.skeleton === 1)!
  assert(b1.tags.slice(0, 4).join() === "1girl,solo,long hair,blue hair", "counts and pairing are written from the scene when the identity has none")
  const b5 = bare.find((p) => p.sources.skeleton === 5)!
  assert(b5.tags.slice(0, 5).join() === "1girl,1boy,hetero,long hair,blue hair", "pair scene header")

  const crowd = pool([makePost(40, "2girls solo_focus standing smile from_above bedroom bed indoors skirt shirt")])
  const c = composePack(crowd, options({ identity: ["1girl", "long hair"], count: 1 })).prompts[0]
  assert(!c.tags.includes("solo focus") && !c.tags.includes("solo"), "solo focus never stays with more than one person")
  const single = pool([makePost(41, "1girl solo_focus standing smile from_above bedroom bed indoors skirt shirt")])
  assert(composePack(single, options({ identity: ["1girl"], count: 1 })).prompts[0].tags.includes("solo focus"), "solo focus is kept for one person")
}

// ── Faithful ──
{
  const { prompts } = composePack(main, options({ count: 5 }))
  for (const p of prompts) {
    const scene = new Set(tagsOf(p.sources.skeleton))
    const body = p.tags.filter((t) => !p.locked.includes(t))
    assert(body.every((t) => scene.has(t)), `faithful prompt of ${p.sources.skeleton} only has tags of its scene`)
    assert(Object.keys(p.sources).join() === "skeleton", "faithful has a single source")
  }
}

// ── Remix ──
{
  let swaps = 0
  for (let seed = 1; seed <= 25; seed++) {
    const { prompts } = composePack(main, options({ mix: "remix", count: 5, seed }))
    for (const p of prompts) {
      const base = p.sources.skeleton
      if (p.sources.camera !== undefined) {
        swaps++
        assert(SITUATION_OF(p.sources.camera) === SITUATION_OF(base), `seed ${seed}: camera only from the same situation`)
      }
      if (p.sources.face !== undefined) swaps++
      if (p.sources.place !== undefined) {
        swaps++
        if (base === 3) assert([1, 5].includes(p.sources.place), `seed ${seed}: a bed anchor needs a place with a bed`)
        if ([1, 3, 5].includes(base)) assert(![2, 4].includes(p.sources.place), `seed ${seed}: indoors never gets an outdoors place`)
        if ([2, 4].includes(base)) assert(![1, 3, 5].includes(p.sources.place), `seed ${seed}: outdoors never gets an indoors place`)
      }
      if (p.sources.outfit !== undefined) {
        swaps++
        assert((p.sources.outfit === 5) === (base === 5), `seed ${seed}: outfit only between scenes with the same people`)
      }
    }
  }
  assert(swaps > 20, "remix does swap units")
  const a = composePack(main, options({ mix: "remix", count: 5, seed: 9 }))
  assert(JSON.stringify(a) === JSON.stringify(composePack(main, options({ mix: "remix", count: 5, seed: 9 }))), "same seed, same remix")
  assert(JSON.stringify(a) !== JSON.stringify(composePack(main, options({ mix: "remix", count: 5, seed: 10 }))), "another seed, another remix")
}

// ── shortBy and reuse ──
{
  const faithful = composePack(main, options({ count: 8 }))
  assert(faithful.prompts.length === 5 && faithful.shortBy === 3, "faithful returns the scenes there are and reports the gap")
  const remix = composePack(main, options({ mix: "remix", count: 8, seed: 3 }))
  assert(remix.prompts.length > 5 && remix.shortBy === 8 - remix.prompts.length, "remix reuses skeletons with other swaps")
  assert(new Set(remix.prompts.map((p) => p.tags.join())).size === remix.prompts.length, "no exact duplicates")
  const empty = composePack(pool([]), options({ count: 4 }))
  assert(empty.prompts.length === 0 && empty.shortBy === 4, "empty pool")
  const off = composePack(main, options({ disabledSituations: [SITUATION_OF(1)], count: 5 }))
  assert(!off.prompts.some((p) => [1, 2].includes(p.sources.skeleton)), "switched-off situation is skipped")
}

// ── Options ──
{
  const own = composePack(main, options({ clothing: "own", identity: [...IDENTITY, "maid outfit"] })).prompts
  assert(own.every((p) => !["skirt", "shirt", "dress", "boots"].some((t) => p.tags.includes(t))), "own clothing leaves the scene outfit out")
  const library = composePack(main, options({ clothing: { library: [["dress", "boots"]] } })).prompts
  assert(library.every((p) => p.tags.includes("dress") && p.tags.includes("boots") && !p.tags.includes("skirt")), "library outfit replaces the scene outfit")
  const plain = composePack(main, options({ scenery: "plain" })).prompts
  assert(
    plain.every((p) => p.tags.includes("simple background") && !["bed", "bedroom", "park", "beach", "sunset", "indoors"].some((t) => p.tags.includes(t))),
    "plain scenery"
  )
  const vary = composePack(main, options({ scenery: "vary", mix: "faithful" })).prompts
  assert(vary.some((p) => p.sources.place !== undefined), "vary swaps the place even in faithful mix")
  const armed = pool([makePost(50, "1girl standing smile from_above bedroom bed indoors skirt shirt sword cat")])
  assert(!composePack(armed, options({ count: 1 })).prompts[0].tags.some((t) => t === "sword" || t === "cat"), "extras are off by default")
  assert(composePack(armed, options({ count: 1, extras: true })).prompts[0].tags.includes("sword"), "extras can be switched on")
}

// ── Dangling references ──
{
  const lone = pool([makePost(60, "1girl standing skirt_lift arms_up smile from_above bedroom bed indoors shirt")])
  const p = composePack(lone, options({ count: 1 })).prompts[0]
  assert(!p.tags.includes("skirt lift"), "a lifted skirt without a skirt is removed")
  assert(p.tags.includes("arms up"), "other 'up' tags stay")
  const dressed = pool([makePost(61, "1girl standing skirt_lift smile from_above bedroom bed indoors shirt black_skirt")])
  assert(composePack(dressed, options({ count: 1 })).prompts[0].tags.includes("skirt lift"), "kept when another tag names the skirt")
  const generic = pool([makePost(62, "1girl standing clothes_lift smile from_above bedroom bed indoors shirt")])
  assert(composePack(generic, options({ count: 1 })).prompts[0].tags.includes("clothes lift"), "generic clothes are satisfied by any clothing tag")
  assert(!composePack(generic, options({ count: 1, clothing: "own" })).prompts[0].tags.includes("clothes lift"), "no clothing left: the generic reference goes")
  assert(
    composePack(generic, options({ count: 1, clothing: "own", identity: ["1girl", "maid outfit"] })).prompts[0].tags.includes("clothes lift"),
    "the identity's clothing satisfies it"
  )
  const opened = pool([makePost(63, "1girl standing smile from_above bedroom bed indoors open_shirt")])
  assert(!composePack(opened, options({ count: 1 })).prompts[0].tags.includes("open shirt"), "an open shirt alone does not name the shirt")
}

// the rule can be applied again to tags changed afterwards
assert(
  dropDanglingReferences(["1girl", "standing", "skirt lift", "shirt"], ["1girl"], OVERRIDES).join() === "1girl,standing,shirt",
  "dropDanglingReferences removes a lifted skirt when no skirt is left"
)
assert(
  dropDanglingReferences(["skirt lift", "red skirt"], [], OVERRIDES).join() === "skirt lift,red skirt",
  "dropDanglingReferences keeps it when a tag names the skirt"
)

// ── Identity wins ──
{
  const p = composePack(main, options({ identity: ["1girl", "nude"], count: 5 })).prompts.find((x) => x.sources.skeleton === 1)!
  assert(p.tags.includes("nude") && !p.tags.includes("skirt") && !p.tags.includes("shirt"), "scene clothing that contradicts the identity is removed")
  assert(p.tags.includes("standing") && p.tags.includes("bedroom"), "the rest of the scene stays")
  // two tags of one scene that the resolver would flag are not checked against each other
  const clash = pool([makePost(70, "1girl standing sitting smile from_above bedroom bed indoors skirt shirt")])
  const tags = composePack(clash, options({ identity: ["1girl"], count: 1 })).prompts[0].tags
  assert(tags.includes("standing") && tags.includes("sitting"), "tags of the same scene are not checked against each other")
}

done()
