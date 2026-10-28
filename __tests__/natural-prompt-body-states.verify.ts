/**
 * "floating hair" is the hair floating, not something the person does to it:
 * "with her hair floating", never "She is floating hair". Verbs that act on
 * something ("holding staff", "biting lip") keep the person as the subject.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/natural-prompt-body-states.verify.ts
 */
import { readFileSync } from "fs"
import { formatPrompt, naturalPromptInput } from "../lib/prompt/natural-format"
import { posePhrase, PRONOUNS } from "../lib/prompt/natural/english"

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

const phrases = JSON.parse(readFileSync("public/natural-prompt-phrases.json", "utf8"))

assert(posePhrase("floating hair", PRONOUNS.her)?.text === "her hair floating", "floating hair -> her hair floating")
assert(posePhrase("floating hair", PRONOUNS.her)?.kind === "with", "floating hair is a 'with' phrase")
assert(posePhrase("flowing tail", PRONOUNS.his)?.text === "his tail flowing", "flowing tail -> his tail flowing")
assert(posePhrase("holding staff", PRONOUNS.her)?.text === "holding a staff", "holding staff unchanged")

const input = naturalPromptInput({ prompt: "1girl, solo, frieren, floating hair, grey hair, long hair, holding staff", characters: "frieren", rating: "g", provider: "danbooru" }, {})
const text = formatPrompt("flux2", input, {}, { phrases, fullDetail: true }).text
assert(!/is floating hair/.test(text), "no 'is floating hair' in the prose")
assert(/her hair floating/.test(text), "prose says her hair is floating")

console.log(`\nResults: ${passed} passed, ${failed} failed\n`)

if (failed > 0) {
  process.exit(1)
}
