/**
 * The brief's undo history (lib/pack/brief-history.ts).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-brief-history.verify.ts
 */
import assert from "node:assert/strict"
import { addNever, addTag, emptyBrief, setCharacterRole, setChanges, type PackBrief } from "../lib/pack/brief"
import {
  HISTORY_LIMIT, briefFromCharacters, commit, lastChange, seedNever, startHistory, undo,
} from "../lib/pack/brief-history"

let passed = 0
const check = (fn: () => void) => { fn(); passed++ }

const OVERRIDES: Record<string, string> = { bikini: "clothing:outfit", beach: "scenery:setting" }

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

check(() => {
  const h0 = startHistory(emptyBrief())
  const next = addTag(h0.present, "bikini", OVERRIDES)
  const h1 = commit(h0, next, "Added bikini")
  assert.equal(h1.present, next)
  assert.deepEqual(h1.past, [{ brief: h0.present, label: "Added bikini" }])
  assert.equal(lastChange(h1), "Added bikini")
  assert.equal(lastChange(h0), null)
})

check(() => {
  const h0 = startHistory(addTag(emptyBrief(), "bikini", OVERRIDES))
  // A copy with the same content (and a different key order) records nothing.
  const copy = setCharacterRole(addTag(emptyBrief(), "bikini", OVERRIDES), null, undefined)
  assert.notEqual(copy, h0.present)
  assert.equal(commit(h0, copy, "Added bikini"), h0)
  assert.equal(commit(h0, addTag(h0.present, "bikini", OVERRIDES), "Added bikini"), h0)
  // A real change does.
  assert.equal(commit(h0, setChanges(h0.present, "pose"), "Changed what varies").past.length, 1)
})

check(() => {
  const h0 = startHistory(emptyBrief())
  const h1 = commit(h0, addTag(h0.present, "bikini", OVERRIDES), "Added bikini")
  const { history, undone } = undo(h1)
  assert.equal(undone, "Added bikini")
  assert.equal(history.present, h0.present)
  assert.deepEqual(history.past, [])
})

check(() => {
  let h = startHistory(emptyBrief())
  const states: PackBrief[] = [h.present]
  for (const [tag, label] of [["bikini", "Added bikini"], ["beach", "Added beach"]] as const) {
    h = commit(h, addTag(h.present, tag, OVERRIDES), label)
    states.push(h.present)
  }
  h = commit(h, addNever(h.present, "smile"), "Never: smile")
  states.push(h.present)
  const labels: Array<string | null> = []
  for (let i = states.length - 2; i >= 0; i--) {
    const r = undo(h)
    labels.push(r.undone)
    h = r.history
    assert.equal(h.present, states[i])
  }
  assert.deepEqual(labels, ["Never: smile", "Added beach", "Added bikini"])
})

check(() => {
  const h = startHistory(emptyBrief())
  const r = undo(h)
  assert.equal(r.history, h)
  assert.equal(r.undone, null)
})

check(() => {
  let h = startHistory(emptyBrief())
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = commit(h, addTag(h.present, `tag ${i}`, OVERRIDES), `Added tag ${i}`)
  assert.equal(h.past.length, HISTORY_LIMIT)
  assert.equal(h.past[0].label, "Added tag 5")
  assert.equal(lastChange(h), `Added tag ${HISTORY_LIMIT + 4}`)
})

check(() => {
  const h0 = deepFreeze(startHistory(emptyBrief()))
  const next = deepFreeze(addTag(h0.present, "bikini", OVERRIDES))
  const snapshot = structuredClone(h0)
  const h1 = deepFreeze(commit(h0, next, "Added bikini"))
  assert.deepEqual(h0, snapshot)
  const h1Snapshot = structuredClone(h1)
  undo(h1)
  assert.deepEqual(h1, h1Snapshot)
})

// Pack starts: never defaults, and names that enter as characters.
check(() => {
  const seeded = seedNever(emptyBrief(), ["Smile", "looking_at_viewer", "smile"])
  assert.deepEqual(seeded.never, ["smile", "looking at viewer"])
  const prompt = addTag(emptyBrief(), "bikini", OVERRIDES)
  assert.deepEqual(seedNever(prompt, ["bikini", "smile"]).never, ["smile"])
  assert.deepEqual(emptyBrief().never, [])

  const cast = briefFromCharacters(["Tifa_Lockhart", "tifa lockhart", "", "aerith gainsborough", "cloud strife", "barret wallace"])
  assert.deepEqual(cast.who.map((c) => c.tag), ["tifa lockhart", "aerith gainsborough", "cloud strife"])
  assert.deepEqual(briefFromCharacters([]).who, [{ tag: null, addedLook: [], removedLook: [] }])
})

console.log(`${passed} passed, 0 failed`)
