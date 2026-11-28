/**
 * The builder reads requests in the scenes' spelling, as the engine does (lib/pack/scene/spelling.ts):
 * the People line's "needs company" (poseNeedsCompany), the fit line's forecast of conditions
 * (conditionSupply with the permanence lookup) and the poses' compositions (poseCompositions with it).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-brief-spelling.verify.ts
 */
import fs from "fs"
import path from "path"
import { conditionSupply, poseNeedsCompany } from "../lib/pack/brief-pack"
import { buildScenePool } from "../lib/pack/scene/scene-pool"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { poseCompositions, poseNeedsScene, tagKindsFromPosts } from "../lib/pack/scene-pack"
import { parseTagRelations, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import type { SceneRequests } from "../lib/pack/brief"
import { makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8")) as PermanenceData, overrides)
setTagRelations(parseTagRelations(JSON.parse(fs.readFileSync(path.join(root, "public/tag-relations.json"), "utf8")) as TagRelationsFile))

// The People line asks about a Rule34 spelling as the engine does: as Danbooru's.
assert(poseNeedsCompany("arm lock", overrides, permanence) === poseNeedsScene("locked arms", overrides), "arm lock is asked as locked arms")
assert(poseNeedsCompany("arm lock", overrides, permanence), "locked arms needs company (an interaction)")
assert(poseNeedsCompany("female on top", overrides, permanence) === poseNeedsScene("girl on top", overrides), "female on top is asked as girl on top")
assert(poseNeedsCompany("sitting", overrides, permanence) === poseNeedsScene("sitting", overrides), "a plain posture is unchanged")

// Scenes extracted from Rule34 posts carry Danbooru's spellings ("thighhighs", "arms up").
const posts = [
  makePost(1, "1girls solo female arms_above_head stockings garter_belt blush smile looking_at_viewer indoors bedroom bed pillow", { rating: "explicit" }),
  makePost(2, "1girls solo female arms_above_head stockings choker blush open_mouth outdoors forest tree grass", { rating: "explicit" }),
  makePost(3, "1girls solo female stockings skirt sweater sitting chair smile looking_at_viewer indoors kitchen window", { rating: "explicit" }),
]
const kinds = tagKindsFromPosts(posts)
const pool = buildScenePool(posts, { overrides, permanence, subject: "girl", tagKind: (t) => kinds.get(t), provider: "rule34" })
const scenes = pool.allScenes ?? pool.scenes

// The fit line's forecast: a condition typed as Rule34 writes it finds the scenes that have it.
{
  const supply = conditionSupply({ role: "wearing", tags: ["stockings"], scenes, overrides, permanence })
  assert(supply.variants >= 1, `stockings is met by the scenes' thighhighs: ${JSON.stringify(supply)}`)
}

// The poses' compositions: a pose typed as Rule34 writes it counts the scenes that have it.
{
  const requests: SceneRequests = { select: ["arms above head"], wearing: [], where: [], also: [], literal: [] }
  const withPermanence = poseCompositions(pool, { requests, overrides, permanence } as Parameters<typeof poseCompositions>[1])
  const counted = withPermanence.reduce((n, c) => n + c.scenes, 0)
  assert(counted === 2, `both scenes with the pose are counted (${JSON.stringify(withPermanence)})`)
}

done()
