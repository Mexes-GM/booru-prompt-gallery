/**
 * Tests for lib/scene-model/ (the scene model's vocabulary and generation loop), with a
 * small made-up vocabulary and deterministic fake logits instead of the model.
 *
 * Covers:
 *   1. Vocabulary: blocks, implications, colour groups; a broken file is refused.
 *   2. Condition tokens: rating, people, body, characters and series (known, OTHER, NONE, at most 3).
 *   3. One tag per pass with alpha 0.25 / top-p 0.95 draws exactly what the reference
 *      browser loop draws (ported below) for the same seed and logits.
 *   4. The rules hold for the settings in use (two tags per pass after three):
 *      no repeated, implied or masked tag; one colour per garment; a specific tag
 *      replaces its generic; fixed tags stay; END and the length limit stop it;
 *      excluded tags never appear; implied tags come back at the end.
 *   5. Two tags per pass needs fewer model runs.
 *   6. The real vocabulary file, when it is present (it isn't in the repository).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/scene-model-sampler.verify.ts
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { prepareSceneVocab, modelTag, type RawSceneVocab, type SceneVocab } from "../lib/scene-model/vocab"
import { conditionTokens, generateScene, seededRandom, SCENE_SAMPLER_SETTINGS, type SceneLogits } from "../lib/scene-model/sampler"
import { makeAssert } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()

// ── A made-up vocabulary ──
const TAGS = [
  "smile", "shirt", "white_shirt", "black_shirt", "skirt", "red_skirt", "blue_skirt", "standing", "sitting", "outdoors",
  "indoors", "bedroom", "bed", "holding", "holding_cup", "cup", "kimono", "obi", "sash", "looking_at_viewer",
]
const V = TAGS.length
const id = (name: string) => TAGS.indexOf(name)
const RAW: RawSceneVocab = {
  version: 2,
  V,
  maxlen: 60,
  offsets: {
    end: V, summary: V + 1, rating: V + 2, detail: V + 6, people: V + 10, body: V + 13, char_none: V + 15, char_other: V + 16,
    char: V + 17, series_none: V + 20, series_other: V + 21, series: V + 22,
  },
  tags: TAGS,
  lnf: TAGS.map((_, i) => -0.5 - (i % 5) * 0.7),
  implies: {
    [id("white_shirt")]: [id("shirt")],
    [id("black_shirt")]: [id("shirt")],
    [id("red_skirt")]: [id("skirt")],
    [id("blue_skirt")]: [id("skirt")],
    [id("holding_cup")]: [id("holding"), id("cup")],
    [id("bedroom")]: [id("indoors")],
    [id("obi")]: [id("sash")],
  },
  color_groups: [[id("white_shirt"), id("black_shirt")], [id("red_skirt"), id("blue_skirt")]],
  rating: ["0", "1", "2", "3"],
  detail: ["0", "1", "2", "3"],
  people: ["1girl", "1boy", "solo"],
  body: ["animal_ears", "tail"],
  chars: ["hero_a", "hero_b", "hero_c"],
  series: ["series_a", "original"],
}
const vocab = prepareSceneVocab(RAW)

/** Deterministic fake logits: a hash of the input, with END rising as the scene grows. */
function fakeLogits(vocabulary: SceneVocab, seed = 7): SceneLogits {
  return (tokens) => {
    let h = seed >>> 0
    for (const t of tokens) h = Math.imul(h ^ (t + 0x9e3779b9), 0x85ebca6b) >>> 0
    const random = seededRandom(h)
    const out = new Float32Array(vocabulary.V + 1)
    for (let i = 0; i < vocabulary.V; i++) out[i] = random() * 6 - 1
    const length = tokens.length
    out[vocabulary.V] = length < 6 ? -4 : length * 0.45 - 2
    return out
  }
}

// ── 1. Vocabulary ──
{
  assert(vocab.V === V && vocab.tagId.get("white_shirt") === id("white_shirt"), "tags and ids")
  assert(vocab.implies[id("holding_cup")].join() === [id("holding"), id("cup")].join() && vocab.implies[id("smile")].length === 0, "implications per tag")
  assert(vocab.colorOf[id("black_shirt")] === 0 && vocab.colorOf[id("blue_skirt")] === 1 && vocab.colorOf[id("smile")] === -1, "colour groups")
  assert(vocab.charId.get("hero_b") === RAW.offsets.char + 1 && vocab.seriesId.get("original") === RAW.offsets.series + 1, "character and series tokens")
  let refused = 0
  for (const broken of [null, { ...RAW, tags: TAGS.slice(1) }, { ...RAW, lnf: [] }, { ...RAW, offsets: { ...RAW.offsets, end: 3 } }]) {
    try {
      prepareSceneVocab(broken)
    } catch {
      refused++
    }
  }
  assert(refused === 4, "a broken vocabulary file is refused")
  assert(modelTag("Yor Briar") === "yor_briar" && modelTag("makima \\(chainsaw man\\)") === "makima_(chainsaw_man)", "model spelling of a tag")
}

// ── 2. Condition tokens ──
{
  const O = RAW.offsets
  const tokens = conditionTokens(vocab, { rating: "s", detail: "2", people: ["1girl", "solo", "6+girls"], body: ["animal ears"], characters: ["hero_b", "Unknown Person", "hero_b"], series: ["series_a"] })
  assert(
    tokens.join() === [O.rating + 1, O.detail + 2, O.people + 0, O.people + 2, O.body + 0, O.char + 1, O.char_other, O.series + 0].join(),
    "rating, detail, people, body, characters (unknown -> OTHER, no repeats), series; unknown people names left out"
  )
  assert(conditionTokens(vocab, { rating: "g", noCharacter: true, noSeries: true }).join() === [O.rating, O.char_none, O.series_none].join(), "no character / no series -> NONE")
  assert(conditionTokens(vocab, { rating: "e" }).join() === [O.rating + 3].join(), "nothing said -> no token")
  assert(conditionTokens(vocab, { rating: "g", characters: ["hero_a", "hero_b", "hero_c", "x"] }).length === 4, "at most three characters")
}

// ── 3. Same draws as the reference browser loop (one tag per pass) ──
/** The test page's generator (the one checked prompt by prompt against Python), as it was written. */
async function referenceGenerate(v: SceneVocab, logitsOf: SceneLogits, cond: number[], fixed: string[], seed: number, alpha: number, temp: number, topP: number, maxlen: number) {
  const r = seededRandom(seed)
  const names = v.names
  const imp = v.implies
  const E = new Float64Array(v.V + 1)
  const TMP = new Float64Array(v.V + 1)
  function sample(lg: ArrayLike<number>, mask: Uint8Array) {
    let mx = -Infinity
    for (let i = 0; i <= v.V; i++) { if (mask[i]) continue; const x = lg[i] - (i < v.V ? alpha * v.lnf[i] : 0); TMP[i] = x; if (x > mx) mx = x }
    let z = 0
    for (let i = 0; i <= v.V; i++) { if (mask[i]) { E[i] = 0; continue } const e = Math.exp((TMP[i] - mx) / temp); E[i] = e; z += e }
    let cand: number[] = []
    for (let i = 0; i <= v.V; i++) if (E[i] >= 1e-4) cand.push(i)
    let keepn = -1
    for (let pass = 0; pass < 2 && keepn < 0; pass++) {
      if (pass === 1) { cand = []; for (let i = 0; i <= v.V; i++) if (!mask[i]) cand.push(i) }
      cand.sort((a, b) => E[b] - E[a])
      let cs = 0, below = 0, reached = false
      for (const k of cand) { cs += E[k] / z; if (cs < topP) below++; else { reached = true; break } }
      if (reached || pass === 1) keepn = Math.min(cand.length, below + 1)
    }
    let zk = 0; for (let k = 0; k < keepn; k++) zk += E[cand[k]]
    let u = r() * zk
    for (let k = 0; k < keepn; k++) { u -= E[cand[k]]; if (u <= 0) return cand[k] }
    return cand[keepn - 1]
  }
  const ids = [...new Set(fixed.map(modelTag).filter((n) => v.tagId.has(n)).map((n) => v.tagId.get(n)!))]
  const implied = new Set<number>(); for (const i of ids) for (const j of imp[i]) implied.add(j)
  let cur = ids.filter((i) => !implied.has(i))
  const mask = new Uint8Array(v.V + 1)
  while (cur.length < maxlen) {
    const lg = await logitsOf([v.offsets.summary, ...cond, ...cur])
    mask.fill(0)
    for (const i of cur) { mask[i] = 1; for (const j of imp[i]) mask[j] = 1; if (v.colorOf[i] >= 0) for (const j of v.colorGroups[v.colorOf[i]]) mask[j] = 1 }
    const j = sample(lg, mask)
    if (j === v.V) break
    cur = cur.filter((i) => !imp[j].includes(i)); cur.push(j)
  }
  const out = cur.map((i) => names[i]), seen = new Set(out), extra = new Set<number>()
  for (const i of cur) for (const j of imp[i]) extra.add(j)
  for (const j of [...extra].sort((a, b) => a - b)) if (!seen.has(names[j])) out.push(names[j])
  return out
}

async function main() {
  {
    const conditions = { rating: "g" as const, people: ["1girl", "solo"], characters: ["hero_a"] }
    const cond = conditionTokens(vocab, conditions)
    const settings = { alpha: 0.25, temperature: 0.9, topP: 0.95, perPass: 1, warmupPasses: 0, maxLength: 60 }
    let same = 0
    const runs = 60
    for (let seed = 0; seed < runs; seed++) {
      const fixed = seed % 3 === 0 ? ["white shirt", "shirt", "nonexistent_tag"] : []
      const logitsOf = fakeLogits(vocab, seed)
      const ours = await generateScene(vocab, logitsOf, { conditions, fixed, seed, settings })
      const ref = await referenceGenerate(vocab, logitsOf, cond, fixed, seed, 0.25, 0.9, 0.95, 60)
      if (ours.tags.join() === ref.join()) same++
    }
    assert(same === runs, `one tag per pass draws what the reference loop draws (${same}/${runs})`)
  }

  // ── 4. Rules with the settings in use ──
  {
    const conditions = { rating: "g" as const, people: ["1girl", "solo"] }
    let violations = 0
    let lengths = 0
    for (let seed = 0; seed < 200; seed++) {
      const fixed = seed % 2 === 0 ? ["red skirt"] : ["skirt", "bedroom"]
      const exclude = ["cup", "sitting"]
      const out = await generateScene(vocab, fakeLogits(vocab, seed), { conditions, fixed, exclude, seed })
      const drawn = [...out.fixed, ...out.generated]
      const set = new Set(drawn)
      const fail = (why: string) => {
        violations++
        if (violations <= 5) console.error(`  seed ${seed}: ${why} — ${out.tags.join(", ")}`)
      }
      if (set.size !== drawn.length) fail("a tag repeats")
      for (const name of drawn) for (const j of vocab.implies[id(name)]) if (set.has(TAGS[j])) fail(`${name} next to the ${TAGS[j]} it implies`)
      if (drawn.filter((t) => t.endsWith("_shirt")).length > 1 || drawn.filter((t) => t.endsWith("_skirt")).length > 1) fail("two colours of one garment")
      // Neither an excluded tag nor one that implies it ("holding cup" brings "cup").
      if (out.tags.includes("cup") || out.tags.includes("holding_cup") || drawn.includes("sitting")) fail("an excluded tag came in")
      if (seed % 2 === 0 && !(drawn.includes("red_skirt"))) fail("fixed tag lost")
      if (seed % 2 === 1 && !(drawn.includes("bedroom") && (drawn.includes("skirt") || drawn.some((t) => t.endsWith("_skirt"))))) fail("fixed tag lost or not specialised")
      if (drawn.length > SCENE_SAMPLER_SETTINGS.maxLength) fail("too long")
      // Implied tags come back after the drawn ones.
      const expected = new Set<string>(drawn)
      for (const name of drawn) for (const j of vocab.implies[id(name)]) expected.add(TAGS[j])
      if (out.tags.length !== expected.size || out.tags.slice(0, drawn.length).join() !== drawn.join()) fail("re-expansion")
      if (out.unknownFixed.length !== 0) fail("unknown fixed")
      lengths += drawn.length
    }
    assert(violations === 0, "no repeated, implied, excluded or second-colour tag; fixed tags stay; implied tags come back at the end")
    assert(lengths / 200 > 4, "scenes have several tags")

    const a = await generateScene(vocab, fakeLogits(vocab, 3), { conditions, seed: 11 })
    const b = await generateScene(vocab, fakeLogits(vocab, 3), { conditions, seed: 11 })
    assert(a.tags.join() === b.tags.join(), "same seed and logits, same scene")
    const short = await generateScene(vocab, fakeLogits(vocab, 3), { conditions, seed: 11, settings: { maxLength: 3 } })
    assert(short.fixed.length + short.generated.length <= 3, "the length limit holds with two tags per pass")
    const endFirst = await generateScene(vocab, () => { const out = new Float32Array(V + 1).fill(-20); out[V] = 20; return out }, { conditions, fixed: ["kimono"], seed: 1 })
    assert(endFirst.generated.length === 0 && endFirst.fixed.join() === "kimono" && endFirst.passes === 1, "END first: only the fixed tags")
    const unknown = await generateScene(vocab, fakeLogits(vocab), { conditions, fixed: ["Not A Tag"], seed: 2 })
    assert(unknown.unknownFixed.join() === "not_a_tag", "unknown fixed tags are reported and ignored")
  }

  // ── 5. Fewer model runs with two tags per pass ──
  {
    const conditions = { rating: "g" as const }
    let one = 0
    let two = 0
    const long = (): SceneLogits => { const base = fakeLogits(vocab, 5); return async (tokens) => { const out = Float32Array.from(await base(tokens)); out[V] = tokens.length < 14 ? -6 : 6; return out } }
    for (let seed = 0; seed < 50; seed++) {
      one += (await generateScene(vocab, long(), { conditions, seed, settings: { perPass: 1 } })).passes
      two += (await generateScene(vocab, long(), { conditions, seed })).passes
    }
    assert(two < one * 0.8, `two tags per pass after the warm-up: fewer runs (${two} vs ${one})`)
  }

  // ── 6. The real vocabulary, when present ──
  {
    const file = join(__dirname, "..", "public", "scene-model", "vocab_web_v2.json")
    if (existsSync(file)) {
      const real = prepareSceneVocab(JSON.parse(readFileSync(file, "utf8")))
      assert(real.V > 4000 && real.offsets.end === real.V && real.colorGroups.length > 0, "the served vocabulary loads")
      const t = conditionTokens(real, { rating: "g", people: ["1girl", "solo"], characters: ["yor_briar"], series: ["spy_x_family"] })
      assert(t.length === 5 && t[3] >= real.offsets.char && t[3] < real.offsets.series_none, "a known character gets its own token")
    } else {
      console.log("  (public/scene-model/vocab_web_v2.json not present: real-vocabulary check skipped)")
    }
  }

  done()
}

void main()
