/**
 * Tests for the scene pool built page by page with a cache (lib/pack/scene/scene-cache.ts,
 * buildScenePool's `cache`), and for the conflict check's tag comparison (lib/tag-conflicts.ts
 * isRelatedTag) that the pack runs millions of times.
 *
 * Covers:
 *   C. Posts arrive in pages of 100 and, after each page, the slots of its tags (a new, larger
 *      overrides object). At every build the pool made with the cache is exactly the pool made
 *      from nothing (scenes, every scene, situations, stats), and so are the scenes that fit
 *      (sceneCandidates). The posts are made to move under the cache: tags that reach the support
 *      a loose tag needs only later, a word ending ("bed") whose slot arrives after the tag that
 *      ends with it ("bunk bed"), a trait whose family grows ("light-skinned female"), a named
 *      uniform (read against the whole vocabulary), names that only later posts type, a post
 *      that comes back with other tags. And the cache is used: most old posts are not read again.
 *   R. isRelatedTag gives what it gave before it kept its comparisons (a copy of the old body).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-pool-cache.verify.ts
 */
import fs from "fs"
import path from "path"
import { buildScenePool, createScenePoolCache } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { DEFAULT_SCENE_SETTINGS, sceneCandidates, tagKindsFromPosts, type ScenePackArgs } from "../lib/pack/scene-pack"
import { isRelatedTag } from "../lib/tag-conflicts"
import { normalize } from "../lib/cleanPrompt"
import type { BooruPost } from "../lib/booru/types"
import { makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const SLOTS: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) SLOTS[tag.replace(/_/g, " ")] = slot
const PERMANENCE = JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8")) as PermanenceData

// ── C. Page by page ──────────────────────────────────────────────────────────
let seed = 7
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]
const POSES = ["standing", "sitting", "lying", "kneeling", "squatting", "all fours", "on back", "leaning forward"]
const ACTS = ["sex", "hug", "kiss", "holding hands", "arm grab", "carrying", "princess carry", "waving"]
const FACES = ["smile", "blush", "open mouth", "closed eyes", "tears", "looking at viewer", "one eye closed"]
const CLOTHES = ["skirt", "shirt", "bikini", "dress", "school uniform", "thighhighs", "jacket", "black skirt", "white shirt", "apron", "summer pockets uniform"]
const PLACES = ["bedroom", "beach", "classroom", "bunk bed", "indoors", "outdoors", "night", "kitchen"]
const TRAITS = ["long hair", "blue eyes", "light-skinned female", "fat male", "nude female", "black-haired female", "dark-skinned male"]
const LOOSE = ["glowing aura", "sparkle trail", "rare prop thing", "odd word", "faint glow"]
const PEOPLE = [["1girl", "solo"], ["1girl", "1boy", "hetero"], ["1girls", "female", "male"], ["2girls", "yuri"], ["1girl", "2boys"]]
function post(id: number, extra: string[] = []): BooruPost {
  const tags = [...pick(PEOPLE), pick(POSES), pick(ACTS), pick(FACES), pick(FACES), pick(CLOTHES), pick(CLOTHES), pick(PLACES), pick(PLACES), pick(TRAITS), ...(rand() < 0.3 ? [pick(LOOSE)] : []), ...extra]
  const character = rand() < 0.2 ? `hero_${id % 5}_(test)` : ""
  return makePost(id, [...tags.map((t) => t.replace(/ /g, "_")), ...(character ? [character] : [])].join(" "), {
    rating: rand() < 0.5 ? "explicit" : "questionable",
    tag_string_character: character,
  })
}
const pages: BooruPost[][] = []
for (let p = 0; p < 5; p++) pages.push(Array.from({ length: 100 }, (_, i) => post(1000 + p * 100 + i)))
// A post of the first page comes back on the last with other tags (the booru retagged it).
pages[4][99] = post(1000, ["glowing aura"])
// The slot of a word ending ("bed") is only known once a later page brings that tag.
pages[3][0] = makePost(1300, "1girl solo lying smile bed bedroom indoors blush skirt", { rating: "explicit" })

const slotsFor = (posts: readonly BooruPost[]) => {
  const out: Record<string, string> = {}
  for (const p of posts) for (const raw of p.tag_string.split(" ")) {
    const tag = raw.replace(/_/g, " ")
    if (SLOTS[tag]) out[tag] = SLOTS[tag]
  }
  // A family member that arrives with page 3: "light skin" spelled out would change the trait's reading.
  if (posts.length > 300) out["olive skin"] = "appearance:anatomy"
  return out
}
const json = (pool: ReturnType<typeof buildScenePool>) => JSON.stringify({ scenes: pool.scenes, allScenes: pool.allScenes, situations: pool.situations, stats: pool.stats })

for (const provider of [undefined, "rule34"] as const) {
  const cache = createScenePoolCache()
  let shown: BooruPost[] = []
  let overrides: Record<string, string> = {}
  let builds = 0
  let same = 0
  let candidatesSame = 0
  for (const page of pages) {
    shown = [...shown.filter((p) => !page.some((q) => q.id === p.id)), ...page]
    for (const phase of ["posts", "slots"] as const) {
      if (phase === "slots") overrides = slotsFor(shown)
      const permanence = createPermanence(PERMANENCE, overrides)
      const kinds = tagKindsFromPosts(shown)
      const ctx = { overrides, permanence, subject: "girl" as const, tagKind: (t: string) => kinds.get(t), ...(provider ? { provider } : {}) }
      const fresh = buildScenePool(shown, ctx)
      const cached = buildScenePool(shown, { ...ctx, cache })
      builds++
      if (json(fresh) === json(cached)) same++
      else assert(false, `C1 ${provider ?? "no site"}: build ${builds} differs`)
      const args: ScenePackArgs = { identity: ["alice (test)", "long hair"], alwaysAdd: [], subject: "girl", settings: DEFAULT_SCENE_SETTINGS, count: 1, seed: 1, overrides, people: fresh.stats.composition, permanence, clean: (tags: string[]) => tags.join(", ") }
      if (JSON.stringify(sceneCandidates(fresh, args)) === JSON.stringify(sceneCandidates(cached, args))) candidatesSame++
      else assert(false, `C2 ${provider ?? "no site"}: build ${builds}, the scenes that fit differ`)
    }
  }
  assert(same === builds, `C1 ${provider ?? "no site"}: ${same} of ${builds} builds identical`)
  assert(candidatesSame === builds, `C2 ${provider ?? "no site"}: ${candidatesSame} of ${builds} lists of scenes that fit identical`)
  const { sceneHits, sceneMisses } = cache.stats
  assert(sceneHits > sceneMisses, `C3 ${provider ?? "no site"}: most scenes come from the cache (${sceneHits} hits, ${sceneMisses} misses)`)
}

// ── R. isRelatedTag ──────────────────────────────────────────────────────────
function oldIsRelatedTag(blockedTag: string, targetTag: string): boolean {
  const flat = (t: string) => t.replace(/-/g, " ").replace(/\s{2,}/g, " ").trim()
  const normBlocked = normalize(blockedTag)
  const normTarget = normalize(targetTag)
  if (flat(normBlocked) === flat(normTarget)) return true
  const suffixMap: Record<string, string[]> = {
    eyes: ["eyes"], hair: ["hair"], breasts: ["breasts"], skin: ["skin"], legs: ["legs", "leg"], arms: ["arms", "arm"],
    clothes: ["clothes", "clothing", "clothed"], shoes: ["shoes", "shoe"], ears: ["ears", "ear"], tail: ["tail", "tails"],
    background: ["background"], sleeves: ["sleeves", "sleeve"], body: ["body"], face: ["face"], hands: ["hands", "hand"],
    feet: ["feet", "foot"], skirt: ["skirt", "skirts"], dress: ["dress", "dresses"], pants: ["pants"], socks: ["socks", "sock"],
    uniform: ["uniform", "uniforms"], headwear: ["hat", "hood", "helmet", "cap", "beanie"], neck: ["neck", "necks"],
    teeth: ["teeth", "tooth", "fangs"], tongue: ["tongue", "tongues"], mouth: ["mouth", "mouths"], lips: ["lips", "lip", "lipstick"],
    lipstick: ["lipstick"], lip_gloss: ["lip gloss"], mouth_mask: ["mouth mask", "mouth masks"], surgical_mask: ["surgical mask", "surgical masks"],
    face_mask: ["face mask", "face masks"], gas_mask: ["gas mask", "gas masks"], veil: ["veil", "veils", "niqab"], gag: ["gag", "gags", "gagged"],
    muzzle: ["muzzle", "muzzles"], nose: ["nose", "noses"], eyebrows: ["eyebrows", "eyebrow"], shoulders: ["shoulders", "shoulder"],
    knees: ["knees", "knee"], elbows: ["elbows", "elbow"], wrists: ["wrists", "wrist"], ankles: ["ankles", "ankle"], toes: ["toes", "toe"],
    fingers: ["fingers", "finger"], thighs: ["thighs", "thigh"], hips: ["hips", "hip"], chest: ["chest", "chests"], stomach: ["stomach", "stomachs"],
    waist: ["waist", "waists"], back: ["back", "backs"], navel: ["navel", "navels"], butt: ["butt", "butts", "ass"], pussy: ["pussy"], penis: ["penis"],
  }
  for (const [category, suffixes] of Object.entries(suffixMap)) {
    if (normBlocked === category) {
      for (const suffix of suffixes) if (normTarget === suffix || normTarget.endsWith(" " + suffix) || normTarget.startsWith(suffix + " ")) return true
    }
  }
  return false
}
{
  const blocked = ["eyes", "hair", "legs", "butt", "headwear", "lip_gloss", "close_up", "close-up", "skirt", "Feet", " hips ", "(thighs:1.2)", "constructor", "toString", "upper_body"]
  const targets = ["red eyes", "eyes", "long hair", "leg lift", "ass", "big butt", "hat", "witch hat", "lip gloss", "close-up", "close up", "pleated skirt", "skirt lift",
    "feet", "foot", "barefoot", "hips", "thigh strap", "constructor", "toString", "upper body", "upper-body", "", "  ", "Long_Hair", "(red eyes:1.3)"]
  let checked = 0
  for (const b of blocked) for (const t of targets) {
    checked++
    assert(isRelatedTag(b, t) === oldIsRelatedTag(b, t), `R1: isRelatedTag("${b}", "${t}") as before`)
  }
  // And twice in a row (the second answer comes from what it kept).
  for (const b of blocked) for (const t of targets) assert(isRelatedTag(b, t) === oldIsRelatedTag(b, t), `R2: again for ("${b}", "${t}")`)
  assert(checked === blocked.length * targets.length, "R: every pair checked")
}

done()
