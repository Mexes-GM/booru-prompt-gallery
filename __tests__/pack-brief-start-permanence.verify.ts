/**
 * A pack's first brief and the permanence data, whichever comes first. The brief a start makes
 * (a pasted prompt, a card) can be made before the data loads: then "navel" and "closed eyes" read
 * as traits of the character (Who). Once the data is there they are how she looks in this picture
 * (Also), and settleStart moves them, unless the user has moved them since. With the data there
 * first, the start places them right away.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-brief-start-permanence.verify.ts
 */
import fs from "fs"
import path from "path"
import assert from "node:assert/strict"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { parseTagRelations, setTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import {
  addNever, addTag, briefFromCard, briefFromPrompt, removeTag, setRoutePermanence, settleStart, type PackBrief,
} from "../lib/pack/brief"

const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const PERMANENCE: PermanenceData = JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8"))
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(PERMANENCE, overrides)
setTagRelations(parseTagRelations(JSON.parse(fs.readFileSync(path.join(root, "public/tag-relations.json"), "utf8")) as TagRelationsFile))

let passed = 0
const check = (name: string, fn: () => void) => {
  try { fn(); passed++ } catch (err) { console.error(`FAIL: ${name}`); throw err }
}

const PROMPT = "1girl, tifa lockhart, navel, closed eyes, beach"
const MOMENT = ["navel", "closed eyes"]

const look = (brief: PackBrief) => brief.who.flatMap((c) => c.addedLook)
const also = (brief: PackBrief) => brief.requests.filter((r) => r.role === "also").map((r) => r.tag)
/** Where the prompt's own tags are: the character, her look, Also, Where. */
function rows(brief: PackBrief) {
  return {
    who: brief.who.map((c) => c.tag),
    look: look(brief),
    also: also(brief),
    where: brief.requests.filter((r) => r.role === "where").map((r) => r.tag),
  }
}

// ── The data arrives after the start ─────────────────────────────────────────
// Nothing has set the permanence yet: the start reads the slots' defaults.
const early = briefFromPrompt(PROMPT, overrides).brief
const settled = briefFromPrompt(PROMPT, overrides, permanence).brief

check("before the data, the start reads navel and closed eyes as traits (the case settleStart fixes)", () => {
  for (const tag of MOMENT) assert.ok(look(early).includes(tag), `${tag} in Who before the data`)
})

check("with the data passed in, the same start puts them in Also", () => {
  assert.deepEqual(rows(settled), { who: ["tifa lockhart"], look: [], also: MOMENT, where: ["beach"] })
})

check("once the data arrives, the untouched start moves them to Also and keeps the rest", () => {
  const next = settleStart(early, settled, early)
  assert.deepEqual(rows(next), { who: ["tifa lockhart"], look: [], also: MOMENT, where: ["beach"] })
  // Placing it again changes nothing.
  assert.equal(settleStart(early, settled, next), next)
})

check("a tag the user removed or put in Never before the data arrived stays as they left it", () => {
  const removed = removeTag(early, "navel")
  const nevered = addNever(removed, "closed eyes")
  const next = settleStart(early, settled, nevered)
  assert.ok(!look(next).includes("navel") && !also(next).includes("navel"))
  assert.ok(next.never.includes("closed eyes") && !also(next).includes("closed eyes") && !look(next).includes("closed eyes"))
})

check("the user's own edits stay; only the start's untouched tags move", () => {
  const edited = addTag(removeTag(early, "closed eyes"), "bikini", overrides)
  const next = settleStart(early, settled, edited)
  assert.deepEqual(also(next), ["navel"])
  assert.ok(!look(next).includes("closed eyes") && !also(next).includes("closed eyes"))
  assert.ok(next.requests.some((r) => r.tag === "bikini" && r.role === "wearing"))
})

check("a card start drops what is no longer its look (the card keeps only characters and look)", () => {
  const tags = ["1girl", "tifa lockhart", "navel", "closed eyes", "black hair", "beach"]
  const card = briefFromCard(tags, overrides).brief
  const cardSettled = briefFromCard(tags, overrides, permanence).brief
  const next = settleStart(card, cardSettled, card)
  for (const tag of MOMENT) assert.ok(!look(next).includes(tag) && !also(next).includes(tag), `${tag} off the card's look`)
  assert.ok(look(next).includes("black hair"))
})

// ── The data arrives first ───────────────────────────────────────────────────
setRoutePermanence(permanence)

check("with the data there first, the start puts them in Also and there is nothing to settle", () => {
  const brief = briefFromPrompt(PROMPT, overrides).brief
  assert.deepEqual(rows(brief), { who: ["tifa lockhart"], look: [], also: MOMENT, where: ["beach"] })
  assert.equal(settleStart(brief, briefFromPrompt(PROMPT, overrides, permanence).brief, brief), brief)
})

check("the early start settles the same once the app has set the data too", () => {
  const next = settleStart(early, briefFromPrompt(PROMPT, overrides, permanence).brief, early)
  assert.deepEqual(rows(next), { who: ["tifa lockhart"], look: [], also: MOMENT, where: ["beach"] })
})

console.log(`pack-brief-start-permanence: ${passed} checks passed`)
