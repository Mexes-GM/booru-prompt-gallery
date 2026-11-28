// CommonJS require hook for the verification scripts: compiles .ts/.tsx with esbuild (one file at a
// time, the same per-module output shape as `ts-node --transpile-only`), caches the result on disk
// by content hash, and resolves the `@/` alias of __tests__/tsconfig.json. Loaded with
// `node -r ./__tests__/register.js <file>`; run-all.mjs does this for every file.
// CommonJS on purpose: `-r` keeps the entry file on Node's CommonJS loader, where this hook applies.
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const Module = require("node:module")

const root = path.join(__dirname, "..")
const tsconfig = JSON.parse(fs.readFileSync(path.join(__dirname, "tsconfig.json"), "utf8"))
// esbuild reads the TypeScript options that change emitted code (target, so class fields keep
// tsc's assign semantics; jsx; esModuleInterop) from here, as ts-node read them from the file.
const compilerOptions = {
  target: tsconfig.compilerOptions.target,
  jsx: tsconfig.compilerOptions.jsx,
  esModuleInterop: tsconfig.compilerOptions.esModuleInterop,
}
const cacheDir = path.join(root, "node_modules", ".cache", "verify-ts")
const salt = `${require("esbuild/package.json").version}:${JSON.stringify(compilerOptions)}:1`

function compile(source, filename) {
  const hash = crypto.createHash("sha1").update(salt).update(filename).update(source).digest("hex")
  const cached = path.join(cacheDir, `${hash}.js`)
  try {
    return fs.readFileSync(cached, "utf8")
  } catch {}
  // esbuild is loaded only on a cache miss: after the first run every file comes from the cache.
  const { code } = require("esbuild").transformSync(source, {
    loader: filename.endsWith(".tsx") ? "tsx" : "ts",
    format: "cjs",
    target: "node24",
    sourcefile: filename,
    sourcemap: "inline",
    tsconfigRaw: { compilerOptions },
  })
  try {
    fs.mkdirSync(cacheDir, { recursive: true })
    // Write to a temp name and rename, so parallel runs never read a half-written file.
    const tmp = `${cached}.${process.pid}.tmp`
    fs.writeFileSync(tmp, code)
    fs.renameSync(tmp, cached)
  } catch {}
  return code
}

for (const ext of [".ts", ".tsx"]) {
  Module._extensions[ext] = function (module, filename) {
    module._compile(compile(fs.readFileSync(filename, "utf8"), filename), filename)
  }
}

const resolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) request = path.join(root, request.slice(2))
  return resolveFilename.call(this, request, ...rest)
}

// Stack traces point at the .ts lines, as with ts-node.
process.setSourceMapsEnabled(true)
