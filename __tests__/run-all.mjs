// Runs every self-checking verification script (`__tests__/*.verify.ts` plus
// `lib/**/*.test.ts`) with ts-node and exits non-zero if any of them fails.
// Each script asserts on its own and signals failure through its exit code, so
// no test framework is needed. Usage: `npm test` (optionally a name filter:
// `npm test -- pack` runs only files whose path contains "pack").

import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { join, relative } from "node:path"

const root = join(import.meta.dirname, "..")
const filter = process.argv[2] ?? ""

function collect(dir, suffix, recursive) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) return recursive ? collect(rel, suffix, true) : []
    return entry.name.endsWith(suffix) ? [rel] : []
  })
}

const files = [
  ...collect("__tests__", ".verify.ts", false),
  ...collect("lib", ".test.ts", true),
]
  .filter((f) => f.includes(filter))
  .sort()

const failed = []
for (const file of files) {
  const start = Date.now()
  const result = spawnSync(
    process.execPath,
    [join(root, "node_modules/ts-node/dist/bin.js"), "--transpile-only", "--project", "__tests__/tsconfig.json", file],
    { cwd: root, encoding: "utf8" },
  )
  const ms = Date.now() - start
  if (result.status === 0) {
    console.log(`  ok    ${relative(root, join(root, file))} (${ms}ms)`)
  } else {
    failed.push(file)
    console.log(`  FAIL  ${file} (${ms}ms)`)
    process.stdout.write(result.stdout.split("\n").slice(-25).join("\n"))
    process.stdout.write(result.stderr.split("\n").slice(-25).join("\n"))
  }
}

console.log(`\n${files.length - failed.length}/${files.length} passed`)
if (failed.length > 0) {
  console.log(`Failed:\n${failed.map((f) => `  - ${f}`).join("\n")}`)
  process.exit(1)
}
