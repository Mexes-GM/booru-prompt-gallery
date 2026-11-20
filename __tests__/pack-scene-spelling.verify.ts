/**
 * Tests for the Danbooru spelling of another booru's tags in the scenes
 * (lib/pack/scene/spelling.ts canonicalSpelling, extractScene).
 *
 * Covers:
 *   A. The alias table: a tag the taxonomy doesn't file under its own name takes its alias, and
 *      with it the alias's role; one it files takes the alias only when the slot and the
 *      permanence are the same; a longer tag takes its words' aliases only when the result is a
 *      tag the taxonomy knows and the tag itself is not one.
 *   S. The scene: Rule34's spellings come out as Danbooru's, two spellings of one tag make one,
 *      the people are still read from the site's own words, and a Danbooru post is as before.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-spelling.verify.ts
 */
import fs from "fs"
import path from "path"
import { canonicalSpelling } from "../lib/pack/scene/spelling"
import { extractScene, sceneTags } from "../lib/pack/scene/scene"
import { createPermanence, type Permanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { TAG_ALIASES } from "../lib/prompt/natural/tag-relations"
import { makeAssert, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8")) as PermanenceData, overrides)

// ── A. The alias table ───────────────────────────────────────────────────────
for (const [from, to] of [["vaginal penetration", "vaginal"], ["cum inside", "cum in pussy"], ["female on top", "girl on top"], ["stockings", "thighhighs"], ["voluptuous", "curvy"]]) {
  assert(TAG_ALIASES[from] === to, `A0: the table has ${from} -> ${to}`)
  assert(!overrides[from], `A0: the taxonomy doesn't file "${from}" under its own name`)
  assert(canonicalSpelling(from, overrides, permanence) === to, `A1: "${from}" takes its alias "${to}"`)
}
{
  const own: Record<string, string> = { cock: "appearance:anatomy", penis: "appearance:anatomy", "big ass": "appearance:anatomy", "huge ass": "appearance:anatomy" }
  const lasts = (tag: string): Permanence => (tag === "penis" ? "state" : "identity")
  assert(TAG_ALIASES.cock === "penis" && TAG_ALIASES["big ass"] === "huge ass", "A2: the table has both")
  assert(canonicalSpelling("big ass", own, lasts) === "huge ass", "A2: filed under its own name, same slot and permanence: the alias")
  assert(canonicalSpelling("cock", own, lasts) === "cock", "A3: filed under its own name, another permanence: kept as it is")
  assert(canonicalSpelling("cock", { ...own, penis: "pose:physiological" }, () => "identity") === "cock", "A3: another slot: kept as it is")
}
{
  const known: Record<string, string> = { "ass focus": "pose:camera", "butt crack": "appearance:anatomy", "ass crack": "appearance:anatomy" }
  assert(TAG_ALIASES.butt === "ass", "A4: the table has butt -> ass")
  assert(canonicalSpelling("butt focus", known, () => "state") === "ass focus", "A4: its words' aliases when the result is a known tag")
  assert(canonicalSpelling("butt pillow", known, () => "state") === "butt pillow", "A4: not when the result is unknown")
  assert(canonicalSpelling("butt crack", known, () => "state") === "butt crack", "A4: a tag the taxonomy knows keeps its own words")
  assert(canonicalSpelling("smile", overrides, permanence) === "smile" && canonicalSpelling("thighhighs", overrides, permanence) === "thighhighs", "A5: Danbooru's spellings stay")
}

// ── S. The scene ─────────────────────────────────────────────────────────────
{
  const post = makePost(1, "1girls 2boys female male straight vaginal_penetration vaginal cum_inside female_on_top stockings blush indoors bedroom smile", { rating: "explicit" })
  const ctx = { overrides, permanence, subject: "girl" as const, provider: "rule34" as const }
  const scene = extractScene(post, ctx)!
  const tags = [...sceneTags(scene), ...scene.pairing]
  for (const tag of ["vaginal penetration", "cum inside", "female on top", "stockings"]) assert(!tags.includes(tag), `S1: no "${tag}"`)
  for (const tag of ["cum in pussy", "girl on top", "thighhighs"]) assert(tags.includes(tag), `S1: "${tag}" instead (${tags.join(", ")})`)
  assert(tags.filter((tag) => tag === "vaginal").length === 1, "S2: two spellings of one tag make one")
  assert(scene.people?.girls === 1 && scene.people?.boys === 2, "S3: the people are read from the site's own words")
  assert(!tags.includes("straight") && !tags.includes("female"), "S3: which stay out of the scene")
}
{
  const post = makePost(2, "1girl 1boy hetero vaginal sex girl_on_top thighhighs blush indoors bedroom smile", { rating: "explicit" })
  const base = { overrides, permanence, subject: "girl" as const }
  const none = extractScene(post, base)!
  const danbooru = extractScene(post, { ...base, provider: "danbooru" })!
  assert(JSON.stringify(none) === JSON.stringify(danbooru), "S4: a Danbooru post gives the same scene with its site")
  assert(sceneTags(none).includes("girl on top") && sceneTags(none).includes("vaginal"), "S4: and keeps its tags")
}

done()
