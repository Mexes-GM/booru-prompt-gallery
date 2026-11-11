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
import { isEnvironmentTag } from "../lib/pack/background-coherence"
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
const main = buildScenePool([P1, P2, P3, P4, P5], { ...ctx, identity: IDENTITY })
assert(main.scenes.length === 4 && main.stats.incompatible === 1, "fixture pool: the pair scene does not fit a solo identity")
assert(main.situations.length === 2, "fixture pool: standing and lying")
const pairPool = buildScenePool([P5], { ...ctx, identity: ["1girl", "1boy"] })
const SITUATION_OF = (id: number) => main.situations.find((s) => s.sceneIds.includes(id))!.id
const tagsOf = (id: number) => Object.values(main.scenes.find((s) => s.postId === id)!.units).flat()
const idx = (p: ScenePrompt, tag: string) => p.tags.indexOf(tag)

// ── Order and header ──
{
  const { prompts, shortBy } = composePack(main, options({ count: 5 }))
  assert(prompts.length === 4 && shortBy === 1, "one prompt per scene, one short")
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

  // the identity brings the counts and the scene adds the pairing
  const pair = composePack(pairPool, options({ identity: ["1girl", "1boy", "long hair", "blue hair"], count: 1 })).prompts[0]
  assert(pair.tags.slice(0, 5).join() === "1girl,1boy,hetero,long hair,blue hair", "identity counts first, then the pairing of the scene, then the rest of the identity")
  assert(!pair.tags.includes("solo"), "solo never stays with two people")
  assert(pair.locked.join() === "1girl,1boy,hetero,long hair,blue hair", "locked = header + identity")

  // the identity has no count: it is written from the scene
  const bare = composePack(main, options({ identity: ["long hair", "blue hair"], count: 4 })).prompts
  const b1 = bare.find((p) => p.sources.skeleton === 1)!
  assert(b1.tags.slice(0, 4).join() === "1girl,solo,long hair,blue hair", "counts and pairing are written from the scene when the identity has none")
  const withPartner = buildScenePool([P5], { ...ctx, identity: ["long hair"], people: { girls: 1, boys: 1 } })
  const b5 = composePack(withPartner, options({ identity: ["long hair", "blue hair"], count: 1 })).prompts[0]
  assert(b5.tags.slice(0, 5).join() === "1girl,1boy,hetero,long hair,blue hair", "pair scene header")

  const crowd = buildScenePool([makePost(40, "2girls solo_focus standing smile from_above bedroom bed indoors skirt shirt")], { ...ctx, identity: ["2girls"] })
  const c = composePack(crowd, options({ identity: ["2girls", "long hair"], count: 1 })).prompts[0]
  assert(!c.tags.includes("solo focus") && !c.tags.includes("solo"), "solo focus never stays with more than one person")
  const single = buildScenePool([makePost(41, "1girl solo_focus standing smile from_above bedroom bed indoors skirt shirt")], { ...ctx, identity: ["1girl"] })
  assert(composePack(single, options({ identity: ["1girl"], count: 1 })).prompts[0].tags.includes("solo focus"), "solo focus is kept for one person")
}

// ── Faithful ──
{
  const { prompts } = composePack(main, options({ count: 4 }))
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
        if (base === 3) assert(p.sources.place === 1, `seed ${seed}: a bed anchor needs a place with a bed`)
        if ([1, 3].includes(base)) assert(![2, 4].includes(p.sources.place), `seed ${seed}: indoors never gets an outdoors place`)
        if ([2, 4].includes(base)) assert(![1, 3].includes(p.sources.place), `seed ${seed}: outdoors never gets an indoors place`)
      }
      if (p.sources.outfit !== undefined) {
        swaps++
        // exposure goes with the outfit: only scene 3 shows a navel
        assert(p.tags.includes("navel") === (p.sources.outfit === 3), `seed ${seed}: the exposure of the outfit's scene comes with it`)
      }
    }
  }
  assert(swaps > 20, "remix does swap units")
  const a = composePack(main, options({ mix: "remix", count: 4, seed: 9 }))
  assert(JSON.stringify(a) === JSON.stringify(composePack(main, options({ mix: "remix", count: 4, seed: 9 }))), "same seed, same remix")
  assert(JSON.stringify(a) !== JSON.stringify(composePack(main, options({ mix: "remix", count: 4, seed: 10 }))), "another seed, another remix")
}

// ── shortBy and reuse ──
{
  const faithful = composePack(main, options({ count: 8 }))
  assert(faithful.prompts.length === 4 && faithful.shortBy === 4, "faithful returns the scenes there are and reports the gap")
  const remix = composePack(main, options({ mix: "remix", count: 8, seed: 3 }))
  assert(remix.prompts.length > 4 && remix.shortBy === 8 - remix.prompts.length, "remix reuses skeletons with other swaps")
  assert(new Set(remix.prompts.map((p) => p.tags.join())).size === remix.prompts.length, "no exact duplicates")
  const empty = composePack(pool([]), options({ count: 4 }))
  assert(empty.prompts.length === 0 && empty.shortBy === 4, "empty pool")
  const off = composePack(main, options({ disabledSituations: [SITUATION_OF(1)], count: 4 }))
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
{
  const compound = { ...OVERRIDES, miniskirt: "clothing:bottom", "black miniskirt": "clothing:bottom", sundress: "clothing:top" }
  assert(
    dropDanglingReferences(["skirt lift", "black miniskirt"], [], compound).join() === "skirt lift,black miniskirt",
    "a compound garment word (miniskirt) names its base garment"
  )
  assert(
    dropDanglingReferences(["dress lift", "sundress"], [], compound).join() === "dress lift,sundress",
    "a sundress is a dress"
  )
  assert(
    dropDanglingReferences(["skirt lift", "miniskirt"], [], OVERRIDES).join() === "miniskirt",
    "only clothing tags count: a word the taxonomy does not know as clothing names nothing"
  )
}

// ── Verbs that need an object ──
{
  const ov = { ...OVERRIDES, holding: "pose:gesture", "holding sword": "equipment:weapon", riding: "pose:kinetic", horse: "creature:animal" }
  assert(dropDanglingReferences(["1girl", "holding", "standing"], [], ov).join() === "1girl,standing", "a bare 'holding' with nothing held goes")
  assert(dropDanglingReferences(["holding", "holding sword"], [], ov).includes("holding"), "kept with a 'holding X' tag")
  assert(dropDanglingReferences(["holding", "sword"], [], ov).includes("holding"), "kept with a held object")
  assert(!dropDanglingReferences(["riding", "smile"], [], ov).includes("riding") && dropDanglingReferences(["riding", "horse"], [], ov).includes("riding"), "same for riding")
  assert(dropDanglingReferences(["holding"], ["holding"], ov).includes("holding"), "a kept (identity) tag is never dropped")
  const ov2 = { ...ov, "holding hands": "pose:interaction", "dual wielding": "pose:combat", "fighting stance": "pose:combat" }
  assert(!dropDanglingReferences(["holding", "holding hands"], [], ov2).includes("holding"), "holding hands is an interaction, not something held")
  assert(dropDanglingReferences(["holding", "holding hands"], [], ov2).includes("holding hands"), "the interaction itself stays")
  assert(!dropDanglingReferences(["dual wielding", "reverse grip", "smile"], [], ov2).some((t) => t === "dual wielding" || t === "reverse grip"), "how a weapon is held needs the weapon")
  assert(dropDanglingReferences(["dual wielding", "sword"], [], ov2).includes("dual wielding"), "kept with the weapon")
  assert(dropDanglingReferences(["fighting stance"], [], ov2).includes("fighting stance"), "a stance needs no weapon")
  const armed = buildScenePool([makePost(80, "1girl standing holding sword smile from_above bedroom bed indoors skirt shirt")], { ...ctx, overrides: ov })
  const off = composePack(armed, options({ count: 1, overrides: ov })).prompts[0]
  assert(!off.tags.includes("holding") && !off.tags.includes("sword"), "extras off: the object and the bare verb go together")
  assert(composePack(armed, options({ count: 1, extras: true, overrides: ov })).prompts[0].tags.includes("holding"), "extras on: the verb stays with its object")
}

// ── Another outfit leaves the scene's exposure behind ──
{
  const shown = pool([makePost(81, "1girl standing navel smile from_above bedroom bed indoors shirt skirt")])
  assert(composePack(shown, options({ count: 1 })).prompts[0].tags.includes("navel"), "the scene's own outfit keeps its exposure")
  assert(!composePack(shown, options({ count: 1, clothing: { library: [["dress"]] } })).prompts[0].tags.includes("navel"), "a library outfit drops it")
  assert(!composePack(shown, options({ count: 1, clothing: "own" })).prompts[0].tags.includes("navel"), "the character's own clothing drops it")
}

// ── The surroundings of a prompt are those of one scene ──
{
  const ov = {
    ...OVERRIDES, "gradient background": "scenery:background", "pink background": "scenery:background", "striped background": "scenery:background",
    "white background": "scenery:background", "cloud": "scenery:atmosphere", "cloudy sky": "scenery:atmosphere", "night": "scenery:atmosphere",
  }
  const envPool = buildScenePool(
    [
      makePost(90, "1girl solo standing smile from_above gradient_background pink_background skirt shirt"),
      makePost(91, "1girl solo standing blush from_side striped_background white_background dress boots"),
      makePost(92, "1girl solo standing open_mouth looking_at_viewer park outdoors cloud cloudy_sky skirt boots"),
      makePost(93, "1girl solo standing smile from_side bedroom indoors bed night shirt dress"),
      makePost(94, "1girl solo standing blush from_above beach outdoors sunset pink_sky skirt shirt"),
    ],
    { ...ctx, overrides: ov }
  )
  const byId = new Map(envPool.scenes.map((scene) => [scene.postId, scene]))
  let checked = 0
  for (const mix of ["faithful", "remix"] as const) {
    for (const scenery of ["scene", "vary", "plain"] as const) {
      for (let seed = 1; seed <= 15; seed++) {
        for (const p of composePack(envPool, options({ mix, scenery, count: 5, seed, overrides: ov })).prompts) {
          checked++
          const source = byId.get(p.sources.place ?? p.sources.skeleton)!
          const expected = scenery === "plain" ? ["simple background"] : source.units.place
          const env = p.tags.filter((t) => isEnvironmentTag(t, ov) || expected.includes(t))
          assert(env.slice().sort().join() === expected.slice().sort().join(), `${mix}/${scenery} seed ${seed}: the surroundings are one scene's (${env.join()})`)
        }
      }
    }
  }
  assert(checked > 100, "the invariant was checked on many prompts")
}

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
