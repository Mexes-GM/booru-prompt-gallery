// Lints only the changed files (with the same cache as `npm run lint`).
//
//   npm run lint:changed                  uncommitted work (working tree vs HEAD)
//   npm run lint:changed -- --base=main   everything since the merge base with main
//
// A change to the ESLint config or the dependencies lints the whole project instead.

import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { changedFiles, root } from "./changed-files.mjs"

export const ESLINT_CACHE = ["--cache", "--cache-location", "node_modules/.cache/eslint/", "--cache-strategy", "content"]
const LINTED = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const LINT_ALL = ["eslint.config.mjs", "package.json", "package-lock.json"]

export function lintArgs(base = true) {
  const changed = changedFiles(base)
  if (changed.some((f) => LINT_ALL.includes(f))) return { files: ["."], changed }
  return { files: changed.filter((f) => LINTED.test(f)), changed }
}

if (import.meta.main) {
  const baseArg = process.argv.slice(2).find((a) => a.startsWith("--base="))
  const { files } = lintArgs(baseArg ? baseArg.slice("--base=".length) : true)
  if (files.length === 0) {
    console.log("lint: no changed files to lint")
    process.exit(0)
  }
  console.log(files[0] === "." ? "lint: config or dependencies changed, linting everything" : `lint: ${files.length} changed file(s)`)
  const r = spawnSync(process.execPath, [join(root, "node_modules/eslint/bin/eslint.js"), ...ESLINT_CACHE, "--no-warn-ignored", ...files], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  })
  process.exit(r.status ?? 1)
}
