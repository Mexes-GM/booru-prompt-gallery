/**
 * Unit tests for compareTagLists (lib/reverse-prompt-parser.ts), the logic
 * behind Compare in the Import Cleaner.
 *
 * Uses Node's built-in `assert` (no test framework installed). Self-running:
 *   npx ts-node lib/reverse-prompt-compare.test.ts
 */

import assert from "assert"
import { compareTagLists, parseRawPrompt } from "./reverse-prompt-parser"

let passed = 0
let failed = 0
const failures: string[] = []

function test(name: string, fn: () => void): void {
  try {
    fn()
    passed++
    console.log(`  ok    ${name}`)
  } catch (error) {
    failed++
    failures.push(name)
    console.log(`  FAIL  ${name}`)
    console.log(error)
  }
}

const OPTIONS = { removeWeights: true, removeLoras: true }
const tagsOf = (prompt: string) => parseRawPrompt(prompt, undefined, OPTIONS).cleanedTags

test("splits into only A, both and only B, keeping source order", () => {
  const result = compareTagLists(["1girl", "long hair", "smile", "outdoors"], ["outdoors", "1girl", "red eyes"])
  assert.deepStrictEqual(result.onlyA, ["long hair", "smile"])
  assert.deepStrictEqual(result.both, ["1girl", "outdoors"])
  assert.deepStrictEqual(result.onlyB, ["red eyes"])
})

test("matches across underscores, case, weights and brackets after parsing", () => {
  const result = compareTagLists(tagsOf("Long_Hair, (blue eyes:1.2), [smile]"), tagsOf("long hair, blue eyes, smile"))
  assert.deepStrictEqual(result.onlyA, [])
  assert.deepStrictEqual(result.both, ["long hair", "blue eyes", "smile"])
  assert.deepStrictEqual(result.onlyB, [])
})

test("ignores LoRA tags and keeps quality tags", () => {
  const result = compareTagLists(tagsOf("masterpiece, <lora:style:0.8>, 1girl"), tagsOf("masterpiece, 1boy"))
  assert.deepStrictEqual(result.both, ["masterpiece"])
  assert.deepStrictEqual(result.onlyA, ["1girl"])
  assert.deepStrictEqual(result.onlyB, ["1boy"])
})

test("lists each tag once even when a prompt repeats it", () => {
  const result = compareTagLists(["smile", "Smile", "1girl", "smile"], ["1girl", "1girl"])
  assert.deepStrictEqual(result.onlyA, ["smile"])
  assert.deepStrictEqual(result.both, ["1girl"])
  assert.deepStrictEqual(result.onlyB, [])
})

test("empty input gives empty lists", () => {
  assert.deepStrictEqual(compareTagLists([], []), { onlyA: [], both: [], onlyB: [] })
  assert.deepStrictEqual(compareTagLists([], ["a tag"]), { onlyA: [], both: [], onlyB: ["a tag"] })
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log(`Failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`)
  process.exit(1)
}
