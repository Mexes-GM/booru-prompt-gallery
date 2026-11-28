// Files changed in this checkout, for the "changed only" modes of the test runner, lint and
// check:fast.
//
//   base === true (no value)  uncommitted work: staged, unstaged and untracked files vs HEAD
//   base === "<ref>"          everything since the merge base with <ref>, committed or not
//
// Paths are relative to the repository root, with the platform separator. Deleted files are left out.

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join, sep } from "node:path"

export const root = join(import.meta.dirname, "..")

function git(args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`)
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
}

export function changedFiles(base = true, { includeDeleted = false } = {}) {
  const against = base === true ? "HEAD" : git(["merge-base", base, "HEAD"])[0]
  const list = [...git(["diff", "--name-only", against]), ...git(["ls-files", "--others", "--exclude-standard"])]
  return [...new Set(list)]
    .map((f) => f.split("/").join(sep))
    .filter((f) => includeDeleted || existsSync(join(root, f)))
    .sort()
}
