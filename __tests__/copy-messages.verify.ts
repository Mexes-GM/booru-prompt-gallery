/**
 * The copy messages live in one place (lib/clipboard.ts), so a copy reads the same
 * wherever it happens, and no component spells its own.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/copy-messages.verify.ts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { COPIED_TITLE, COPY_FAILED_TEXT, COPY_FAILED_TITLE } from "../lib/clipboard"

let passed = 0
const check = (fn: () => void) => { fn(); passed++ }
const root = join(__dirname, "..")
const read = (file: string) => readFileSync(join(root, file), "utf8")

check(() => {
  assert.equal(COPIED_TITLE, "Copied")
  assert.equal(COPY_FAILED_TITLE, "Couldn't copy")
  assert.equal(COPY_FAILED_TEXT, "Your browser blocked the clipboard. Select the text and copy it yourself.")
})

check(() => {
  const files = [
    "components/prompt-gallery/ai-convert-sticky-footer.tsx",
    "components/prompt-gallery/prompt-compare-view.tsx",
    "components/prompt-gallery/reverse-prompt-parser-modal.tsx",
    "components/prompt-gallery/prompt-gallery.tsx",
    "components/prompt-gallery/interactive-prompt.tsx",
    "components/prompt-gallery/comfyui-setup-wizard.tsx",
  ]
  for (const file of files) {
    const source = read(file)
    assert.ok(!/clipboard access/i.test(source), `${file} words its own clipboard failure`)
    assert.ok(!/title: ['"]Copied!['"]/.test(source), `${file} has its own "Copied!" toast`)
    assert.ok(!/copy it by hand/.test(source), `${file} has the old failure advice`)
  }
})

console.log(`copy-messages: ${passed} checks passed`)
