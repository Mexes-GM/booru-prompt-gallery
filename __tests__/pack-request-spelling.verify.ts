/**
 * Tests for what the user asks for meeting the scenes whatever its spelling
 * (lib/pack/scene/spelling.ts requestSpelling; scene-pack's view of the args; brief-pack conditionSupply).
 *
 * Covers:
 *   S. The spelling of a request: the scenes' rule ("stockings" is "thighhighs", "doggy style"
 *      "doggystyle"); "vagina", which the taxonomy files as lasting anatomy and "pussy" as a state,
 *      stays as typed.
 *   W. Wearing "stockings" as typed: imposed, met by the scenes' "thighhighs", written once and as
 *      the user wrote it. As a condition: the scenes that wear thighhighs serve it, in their spelling.
 *   D. Doing "doggy style" picks the scenes with "doggystyle" (sceneCandidates).
 *   N. Never "stockings" keeps "thighhighs" out of every prompt.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-request-spelling.verify.ts
 */
import fs from "fs"
import path from "path"
import { requestSpelling } from "../lib/pack/scene/spelling"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { DEFAULT_SCENE_SETTINGS, generateScenePack, poseNeedsScene, sceneCandidates, type ScenePackArgs } from "../lib/pack/scene-pack"
import { conditionSupply } from "../lib/pack/brief-pack"
import { makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8")) as PermanenceData, overrides)

// ── S. The spelling of a request ─────────────────────────────────────────────
assert(requestSpelling("stockings", overrides, permanence) === "thighhighs", "S1: stockings -> thighhighs")
assert(requestSpelling("doggy_style", overrides, permanence) === "doggystyle", "S1: doggy style -> doggystyle (any input form)")
assert(requestSpelling("vagina", overrides, permanence) === "vagina", "S2: vagina stays (lasting anatomy against a state)")
assert(requestSpelling("vagina", overrides) === "vagina", "S2: and without the permanence lookup")
assert(requestSpelling("thighhighs", overrides, permanence) === "thighhighs", "S3: Danbooru's spelling stays")
assert(poseNeedsScene("doggy style", overrides) === poseNeedsScene("doggystyle", overrides), "S4: a pose is judged in the scenes' spelling")

// ── The pool: one girl, scenes in Danbooru's spelling ────────────────────────
const SCENE = "1girl solo indoors bedroom blush smile looking_at_viewer"
const posts = [
  makePost(1, `${SCENE} sitting thighhighs skirt shirt`),
  makePost(2, `${SCENE} standing white_thighhighs dress`),
  makePost(3, `${SCENE} lying thighhighs bikini`),
  makePost(4, `${SCENE} kneeling skirt shirt`),
  makePost(5, `${SCENE} doggystyle all_fours skirt shirt`, { rating: "explicit" }),
  makePost(6, `${SCENE} doggystyle all_fours thighhighs dress`, { rating: "explicit" }),
]
const pool = buildScenePool(posts, { overrides, permanence, subject: "girl" })
const args = (requests: Partial<NonNullable<ScenePackArgs["requests"]>> = {}, over: Partial<ScenePackArgs> = {}): ScenePackArgs => ({
  identity: ["alice (test)", "long hair"],
  alwaysAdd: [],
  subject: "girl",
  settings: DEFAULT_SCENE_SETTINGS,
  count: 6,
  seed: 1,
  overrides,
  permanence,
  clean: (tags: string[]) => tags.join(", "),
  requests: { select: [], wearing: [], where: [], also: [], literal: [], ...requests },
  ...over,
})
const tagsOf = (prompt: string) => prompt.split(", ")

// ── W. Wearing ───────────────────────────────────────────────────────────────
{
  const { prompts } = generateScenePack(pool, args({ wearing: ["stockings"] }))
  assert(prompts.length > 0, "W1: prompts")
  for (const p of prompts) {
    const tags = tagsOf(p.prompt)
    assert(tags.includes("stockings"), `W1: the prompt says what the user wrote: ${p.prompt}`)
    assert(!tags.includes("thighhighs"), `W1: once, not next to the scenes' spelling: ${p.prompt}`)
  }
  const exact = generateScenePack(pool, args({ wearing: ["thighhighs"] })).prompts
  assert(exact.length === prompts.length && exact.every((p, i) => p.prompt === prompts[i].prompt.replace("stockings", "thighhighs")), "W2: the same pack as asking in the scenes' spelling, but for the word")
}
{
  const cond = generateScenePack(pool, args({ wearing: ["stockings"], conditions: ["stockings"] })).prompts
  assert(cond.length > 0 && cond.every((p) => tagsOf(p.prompt).some((t) => /thighhighs$/.test(t))), `W3: a condition is met by the scenes' thighhighs, in their spelling: ${cond.map((p) => p.prompt).join(" | ")}`)
  const supply = conditionSupply({ role: "wearing", tags: ["stockings"], scenes: pool.allScenes ?? pool.scenes, overrides, permanence })
  const asTyped = conditionSupply({ role: "wearing", tags: ["thighhighs"], scenes: pool.allScenes ?? pool.scenes, overrides, permanence })
  assert(supply.variants > 0 && supply.variants === asTyped.variants, `W4: the fit line counts the same supply (${supply.variants} / ${asTyped.variants})`)
  assert(supply.tags[0] === "stockings", "W4: and names the user's tag")
}

// ── D. Doing ─────────────────────────────────────────────────────────────────
{
  const candidates = sceneCandidates(pool, args({ select: ["doggy style"] }))
  const withPose = candidates.filter((c) => c.hasPose).map((c) => c.postId).sort()
  assert(withPose.join() === "5,6", `D1: "doggy style" finds the scenes with "doggystyle" (${withPose.join()})`)
}

// ── N. Never ─────────────────────────────────────────────────────────────────
{
  const { prompts } = generateScenePack(pool, args({}, { never: ["stockings"] }))
  assert(prompts.length > 0 && prompts.every((p) => !tagsOf(p.prompt).some((t) => /thighhighs$/.test(t))), `N1: Never "stockings" keeps every thighhighs out: ${prompts.map((p) => p.prompt).join(" | ")}`)
}

done()
