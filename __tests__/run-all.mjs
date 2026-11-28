// Runs every self-checking verification script (`__tests__/*.verify.ts` plus `lib/**/*.test.ts`) and
// exits non-zero if any of them fails. Each script asserts on its own and signals failure through its
// exit code, so no test framework is needed. Every file still runs in its own Node process (some keep
// handles open or call process.exit), but several run at once and the output is printed in file order.
//
//   npm test                       every file
//   npm test -- pack               only files whose path contains "pack"
//   npm test -- --changed          only files affected by uncommitted changes (working tree vs HEAD)
//   npm test -- --changed=main     ... by everything that differs from the merge base with main
//   --bail                         stop at the first failure
//   --timeout=<s>                  kill a file that runs longer than this (default 90) and report it as hung
//   --jobs=<n>                     files at once (default: one per CPU); --jobs=1 runs them one by one
//   --loader=ts-node               compile with ts-node instead of the esbuild hook (slower; to compare)
//   --list                         print the files that would run, and stop

import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs"
import { availableParallelism } from "node:os"
import { basename, dirname, join, relative, sep } from "node:path"
import { changedFiles, root } from "../tools/changed-files.mjs"

// A change to one of these can change any test: run them all.
const RUN_ALL = ["package.json", "package-lock.json", "tsconfig.json", join("__tests__", "tsconfig.json"), join("__tests__", "run-all.mjs"), join("__tests__", "register.js")]

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", `${sep}index.ts`, `${sep}index.tsx`, `${sep}index.js`]

// ── arguments ──
const flags = new Map()
const positional = []
for (const arg of process.argv.slice(2)) {
  const m = /^--([\w-]+)(?:=(.*))?$/.exec(arg)
  if (m) flags.set(m[1], m[2] ?? true)
  else positional.push(arg)
}
const known = new Set(["changed", "bail", "timeout", "jobs", "loader", "list"])
for (const name of flags.keys()) {
  if (!known.has(name)) {
    console.error(`Unknown option --${name}. Options: ${[...known].map((k) => `--${k}`).join(", ")}`)
    process.exit(2)
  }
}
const filter = positional[0] ?? ""
const bail = flags.has("bail")
const timeoutMs = Number(flags.get("timeout") ?? 90) * 1000
const jobs = Math.max(1, Number(flags.get("jobs") ?? availableParallelism()))
const loader = flags.get("loader") ?? "esbuild"
if (loader !== "esbuild" && loader !== "ts-node") {
  console.error(`Unknown loader "${loader}" (esbuild or ts-node)`)
  process.exit(2)
}

function collect(dir, suffix, recursive) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) return recursive ? collect(rel, suffix, true) : []
    return entry.name.endsWith(suffix) ? [rel] : []
  })
}

let files = [...collect("__tests__", ".verify.ts", false), ...collect("lib", ".test.ts", true)]
  .filter((f) => f.includes(filter))
  .sort()

// ── --changed: the files whose imports (followed through the project) reach a changed file ──
if (flags.has("changed")) {
  let changed
  try {
    changed = changedFiles(flags.get("changed"), { includeDeleted: true })
  } catch (error) {
    console.error(error.message)
    process.exit(2)
  }
  const before = files.length
  files = affectedTests(files, changed)
  const shown = changed.slice(0, 8).join(", ") + (changed.length > 8 ? `, ... (${changed.length})` : "")
  console.log(`changed: ${changed.length ? shown : "nothing"}`)
  console.log(`running ${files.length} of ${before} files\n`)
}

if (flags.has("list")) {
  for (const f of files) console.log(f)
  process.exit(0)
}

// ── run ──
const timesPath = join(root, "node_modules", ".cache", "verify-times.json")
const pastTimes = readJson(timesPath) ?? {}
const command =
  loader === "ts-node"
    ? (file) => [join(root, "node_modules/ts-node/dist/bin.js"), "--transpile-only", "--project", "__tests__/tsconfig.json", file]
    : (file) => ["-r", join(root, "__tests__/register.js"), file]

const results = new Array(files.length)
const running = new Map()
let next = 0
let printed = 0
let stopped = false

// Slowest files first (times of the last run), so a long file does not start last and hold the run.
const queue = files.map((_, i) => i).sort((a, b) => (pastTimes[files[b]] ?? Infinity) - (pastTimes[files[a]] ?? Infinity))

function start(index) {
  const file = files[index]
  const began = Date.now()
  // windowsHide: on Windows each child would otherwise open its own console window.
  const child = spawn(process.execPath, command(file), { cwd: root, windowsHide: true })
  const out = []
  const err = []
  child.stdout.on("data", (d) => out.push(d))
  child.stderr.on("data", (d) => err.push(d))
  const entry = { child, hung: false }
  entry.timer = setTimeout(() => {
    entry.hung = true
    kill(child)
  }, timeoutMs)
  running.set(index, entry)
  child.on("close", (code, signal) => {
    clearTimeout(entry.timer)
    running.delete(index)
    const status = entry.hung ? "hung" : entry.skipped ? "skipped" : code === 0 ? "ok" : "fail"
    results[index] = {
      file,
      status,
      code: code ?? signal,
      ms: Date.now() - began,
      stdout: Buffer.concat(out).toString("utf8"),
      stderr: Buffer.concat(err).toString("utf8"),
    }
    if (bail && (status === "fail" || status === "hung")) stopAll()
    flush()
    pump()
  })
}

function kill(child) {
  // The whole tree of this one child, by PID (a script could start processes of its own).
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
  else child.kill("SIGKILL")
}

function stopAll() {
  if (stopped) return
  stopped = true
  for (const entry of running.values()) {
    entry.skipped = true
    kill(entry.child)
  }
}

function pump() {
  while (!stopped && running.size < jobs && next < queue.length) start(queue[next++])
  if (running.size === 0 && (stopped || next >= queue.length)) finish()
}

const tail = (text) => text.split("\n").slice(-25).join("\n")

function flush() {
  while (printed < files.length && results[printed]) {
    const r = results[printed++]
    if (r.status === "ok") console.log(`  ok    ${relative(root, join(root, r.file))} (${r.ms}ms)`)
    else if (r.status === "skipped") console.log(`  skip  ${r.file} (stopped by --bail)`)
    else {
      console.log(r.status === "hung" ? `  HUNG  ${r.file} (killed after ${timeoutMs / 1000}s; last output below)` : `  FAIL  ${r.file} (${r.ms}ms)`)
      process.stdout.write(tail(r.stdout))
      process.stdout.write(tail(r.stderr))
      if (!r.stdout.endsWith("\n") && !r.stderr.endsWith("\n")) process.stdout.write("\n")
    }
  }
}

let finished = false
function finish() {
  if (finished) return
  finished = true
  // Files never started because of --bail.
  for (let i = 0; i < files.length; i++) results[i] ??= { file: files[i], status: "skipped" }
  flush()

  const done = results.filter((r) => r.status === "ok" || r.status === "fail")
  const times = { ...pastTimes }
  for (const r of done) times[r.file] = r.ms
  writeJson(timesPath, times)

  const failed = results.filter((r) => r.status === "fail" || r.status === "hung")
  const skipped = results.filter((r) => r.status === "skipped")
  const passed = results.filter((r) => r.status === "ok").length
  console.log(`\n${passed}/${files.length} passed`)
  if (skipped.length) console.log(`${skipped.length} not run (--bail)`)
  if (failed.length > 0) {
    console.log(`Failed:\n${failed.map((r) => `  - ${r.file}${r.status === "hung" ? " (hung)" : ""}`).join("\n")}`)
    process.exit(1)
  }
  if (skipped.length) process.exit(1)
}

// Ctrl+C or a parent that stops this run: take the children down with it.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    for (const entry of running.values()) kill(entry.child)
    process.exit(130)
  })
}

if (files.length === 0) {
  console.log("0/0 passed")
} else {
  pump()
}

// ── helpers ──

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function writeJson(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(value, null, 1))
    renameSync(tmp, path)
  } catch {}
}

function resolveImport(fromFile, spec) {
  let base
  if (spec.startsWith("@/")) base = spec.slice(2)
  else if (spec.startsWith(".")) base = join(dirname(fromFile), spec)
  else return null
  for (const ext of EXTENSIONS) {
    const candidate = base + ext
    if (statSync(join(root, candidate), { throwIfNoEntry: false })?.isFile()) return candidate
  }
  return null
}

function affectedTests(tests, changed) {
  if (changed.some((f) => RUN_ALL.includes(f))) return tests
  const changedSet = new Set(changed)
  // Files a script reads at run time (fixtures, public/*.json, a hook read as text) are not imports:
  // a script whose project files mention the changed file's name counts as affected too.
  const changedNames = [...new Set(changed.map((f) => basename(f)))]
  const sources = new Map()
  const source = (file) => {
    if (!sources.has(file)) {
      let text = ""
      try {
        text = readFileSync(join(root, file), "utf8")
      } catch {}
      sources.set(file, text)
    }
    return sources.get(file)
  }
  const importsOf = new Map()
  const imports = (file) => {
    if (!importsOf.has(file)) {
      const found = new Set()
      if (!file.endsWith(".json")) {
        for (const m of source(file).matchAll(IMPORT_RE)) {
          const resolved = resolveImport(file, m[1])
          if (resolved) found.add(resolved)
        }
      }
      importsOf.set(file, found)
    }
    return importsOf.get(file)
  }
  return tests.filter((test) => {
    const seen = new Set([test])
    const stack = [test]
    while (stack.length) {
      const file = stack.pop()
      if (changedSet.has(file)) return true
      const text = file.endsWith(".json") ? "" : source(file)
      if (changedNames.some((name) => text.includes(name))) return true
      for (const dep of imports(file)) {
        if (!seen.has(dep)) {
          seen.add(dep)
          stack.push(dep)
        }
      }
    }
    return false
  })
}
