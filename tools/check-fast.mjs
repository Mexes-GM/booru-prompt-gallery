// The quick loop: tests affected by the changes, the incremental typecheck and lint of the changed
// files, all three at once. Prints each part when it ends, in a fixed order, and exits non-zero if
// any part failed.
//
//   npm run check:fast                   uncommitted work (working tree vs HEAD)
//   npm run check:fast -- --base=main    everything since the merge base with main
//   npm run check:fast -- --tsc          typecheck with tsc instead of tsgo (tsc is the reference)
//
// Before opening a PR, run the full set too: npm test, npm run typecheck, npm run lint.

import { spawn } from "node:child_process"
import { join } from "node:path"
import { root } from "./changed-files.mjs"
import { ESLINT_CACHE, lintArgs } from "./lint-changed.mjs"

const args = process.argv.slice(2)
const known = /^--(base=.+|tsc)$/
const unknown = args.filter((a) => !known.test(a))
if (unknown.length) {
  console.error(`Unknown option ${unknown.join(" ")}. Options: --base=<ref>, --tsc`)
  process.exit(2)
}
const baseArg = args.find((a) => a.startsWith("--base="))
const base = baseArg ? baseArg.slice("--base=".length) : true
const useTsc = args.includes("--tsc")

const bin = (path) => join(root, "node_modules", path)
const lint = lintArgs(base)
const parts = [
  {
    name: "tests",
    argv: [join(root, "__tests__/run-all.mjs"), base === true ? "--changed" : `--changed=${base}`],
  },
  useTsc
    ? { name: "typecheck (tsc)", argv: [bin("typescript/bin/tsc"), "--noEmit"] }
    : {
        name: "typecheck (tsgo)",
        argv: [bin("@typescript/native-preview/bin/tsgo"), "--noEmit", "--tsBuildInfoFile", "node_modules/.cache/tsgo.tsbuildinfo"],
      },
  lint.files.length
    ? { name: `lint (${lint.files[0] === "." ? "everything" : `${lint.files.length} files`})`, argv: [bin("eslint/bin/eslint.js"), ...ESLINT_CACHE, "--no-warn-ignored", ...lint.files] }
    : { name: "lint (no changed files)", skip: true },
]

const began = Date.now()
const results = await Promise.all(parts.map(run))
let failed = false
for (const r of results) {
  failed ||= !r.ok
  console.log(`── ${r.name}: ${r.ok ? "ok" : "FAILED"} (${(r.ms / 1000).toFixed(1)}s)`)
  // A passing test run lists every file; keep only its summary.
  const lines = r.output.split("\n")
  const text = (r.ok ? lines.filter((l) => !l.startsWith("  ok  ")) : lines).join("\n").trimEnd()
  if (text) console.log(text)
  console.log()
}
console.log(`check:fast ${failed ? "FAILED" : "ok"} in ${((Date.now() - began) / 1000).toFixed(1)}s: ${results.map((r) => `${r.name} ${r.ok ? "ok" : "FAILED"}`).join(", ")}`)
process.exit(failed ? 1 : 0)

function run(part) {
  if (part.skip) return Promise.resolve({ name: part.name, ok: true, ms: 0, output: "" })
  return new Promise((resolve) => {
    const start = Date.now()
    const child = spawn(process.execPath, part.argv, { cwd: root, windowsHide: true })
    const chunks = []
    child.stdout.on("data", (d) => chunks.push(d))
    child.stderr.on("data", (d) => chunks.push(d))
    child.on("close", (code) => resolve({ name: part.name, ok: code === 0, ms: Date.now() - start, output: Buffer.concat(chunks).toString("utf8") }))
  })
}
