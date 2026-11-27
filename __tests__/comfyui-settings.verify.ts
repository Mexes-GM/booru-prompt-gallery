/**
 * Tests for the persisted "Send to ComfyUI" settings (lib/storage.ts, hooks/use-comfyui-settings.ts).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/comfyui-settings.verify.ts
 */
import type { Roles, SavedComfyWorkflow } from "../lib/comfyui/types"

// Minimal browser: a Map-backed localStorage that can be told to throw on write.
const data = new Map<string, string>()
let quotaFull = false
const fakeLocalStorage = {
  getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
  setItem: (k: string, v: string) => {
    if (quotaFull) throw new DOMException("full", "QuotaExceededError")
    data.set(k, String(v))
  },
  removeItem: (k: string) => void data.delete(k),
}
const g = globalThis as unknown as Record<string, unknown>
g.window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} }
g.localStorage = fakeLocalStorage

/* eslint-disable @typescript-eslint/no-require-imports */
const storage = require("../lib/storage") as typeof import("../lib/storage")
const hook = require("../hooks/use-comfyui-settings") as typeof import("../hooks/use-comfyui-settings")
const { STORAGE_KEYS } = storage

let passed = 0
let failed = 0
function assert(condition: boolean, label: string) {
  if (condition) passed++
  else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

const noRoles: Roles = { prompt: null, seed: null, width: null, height: null, output: null }
const roles: Roles = { prompt: { nodeId: "6", input: "text" }, seed: null, width: null, height: null, output: "9" }
function wf(id: string, extra: Partial<SavedComfyWorkflow> = {}): SavedComfyWorkflow {
  return {
    id,
    name: `wf ${id}`,
    source: "api-json",
    api: { "6": { class_type: "CLIPTextEncode", inputs: { text: "x" } } },
    ui: null,
    roles: noRoles,
    savedAt: 1,
    ...extra,
  }
}
function reset() {
  data.clear()
  quotaFull = false
}

const origWarn = console.warn
console.warn = () => {}

// Defaults
reset()
assert(storage.getComfyEnabled() === false, "enabled defaults to false")
assert(storage.getComfyUrl() === "http://127.0.0.1:8188", "url default")
assert(storage.getComfyWorkflows().length === 0, "no workflows by default")
assert(storage.getComfyActiveWorkflowId() === null, "no active workflow by default")
assert(
  JSON.stringify(storage.getComfyOptions()) === JSON.stringify({ randomSeed: true, matchPostResolution: true, livePreview: true }),
  "option defaults",
)
const s0 = hook.getComfyUISettings()
assert(s0.activeWorkflow === null && s0.enabled === false, "settings snapshot defaults")
assert(hook.getComfyUISettings() === s0, "snapshot is stable while nothing changes")

// Enabled / options
assert(storage.setComfyEnabled(true) && storage.getComfyEnabled() === true, "enabled persists")
assert(hook.getComfyUISettings() !== s0, "snapshot changes after a write")
storage.setComfyOptions({ randomSeed: false })
const o = storage.getComfyOptions()
assert(o.randomSeed === false && o.livePreview === true && o.matchPostResolution === true, "options merge with defaults")
assert(storage.getComfyOptions() === o, "options snapshot is stable")
data.set(STORAGE_KEYS.COMFYUI_OPTIONS, JSON.stringify({ livePreview: "yes", randomSeed: false }))
assert(storage.getComfyOptions().livePreview === true && storage.getComfyOptions().randomSeed === false, "non-boolean option ignored")

// URL
assert(storage.setComfyUrl("localhost:9000") === true && storage.getComfyUrl() === "http://localhost:9000", "url stored normalized")
assert(storage.setComfyUrl("http://192.168.1.5:8188") === false, "LAN url rejected")
assert(storage.setComfyUrl("https://example.com") === false, "remote url rejected")
assert(storage.getComfyUrl() === "http://localhost:9000", "rejected url stores nothing")
data.set(STORAGE_KEYS.COMFYUI_URL, JSON.stringify("http://evil.example"))
assert(storage.getComfyUrl() === "http://127.0.0.1:8188", "invalid stored url falls back to default")

// Corrupt storage
reset()
data.set(STORAGE_KEYS.COMFYUI_WORKFLOWS, "{not json")
data.set(STORAGE_KEYS.COMFYUI_OPTIONS, "[[")
data.set(STORAGE_KEYS.COMFYUI_ENABLED, "oops")
assert(storage.getComfyWorkflows().length === 0, "corrupt workflows JSON ignored")
assert(storage.getComfyOptions().randomSeed === true, "corrupt options ignored")
assert(storage.getComfyEnabled() === false, "corrupt enabled ignored")
data.set(
  STORAGE_KEYS.COMFYUI_WORKFLOWS,
  JSON.stringify([wf("ok"), { id: "bad" }, null, 7, wf("bad2", { source: "zip" as never }), wf("bad3", { api: { 1: 5 } as never })]),
)
assert(storage.getComfyWorkflows().length === 1 && storage.getComfyWorkflows()[0].id === "ok", "invalid entries dropped, valid kept")
data.set(STORAGE_KEYS.COMFYUI_WORKFLOWS, JSON.stringify({ not: "an array" }))
assert(storage.getComfyWorkflows().length === 0, "non-array workflows ignored")

// Save, cap, replace
reset()
for (let i = 0; i < 25; i++) assert(storage.saveComfyWorkflow(wf(`w${i}`, { savedAt: i })), `save w${i}`)
const list = storage.getComfyWorkflows()
assert(list.length === 20, "capped at 20")
assert(list[0].id === "w5" && list[19].id === "w24", "oldest dropped")
storage.saveComfyWorkflow(wf("w10", { name: "renamed" }))
assert(storage.getComfyWorkflows().length === 20 && storage.getComfyWorkflows().filter((w) => w.id === "w10").length === 1, "same id upserts")
assert(storage.getComfyWorkflows()[19].name === "renamed", "upserted entry moves last")

reset()
storage.saveComfyWorkflow(wf("a", { source: "bridge", bridgeId: "B1" }))
storage.saveComfyWorkflow(wf("b"))
storage.setComfyActiveWorkflow("a")
storage.saveComfyWorkflow(wf("c", { source: "bridge", bridgeId: "B1", name: "newer" }))
assert(storage.getComfyWorkflows().map((w) => w.id).join() === "b,c", "bridgeId match replaces the old entry")
assert(storage.getComfyActiveWorkflowId() === "c", "active follows the replacement")

// Active workflow
assert(storage.setComfyActiveWorkflow("nope") === false, "unknown active id rejected")
assert(storage.setComfyActiveWorkflow("b") && storage.getComfyActiveWorkflowId() === "b", "active set")
assert(hook.getComfyUISettings().activeWorkflow?.id === "b", "snapshot exposes the active object")
data.set(STORAGE_KEYS.COMFYUI_ACTIVE_WORKFLOW, JSON.stringify("ghost"))
assert(storage.getComfyActiveWorkflowId() === null, "dangling active id reads as null")

// Remove
storage.setComfyActiveWorkflow("b")
storage.removeComfyWorkflow("b")
assert(storage.getComfyWorkflows().map((w) => w.id).join() === "c", "removed")
assert(storage.getComfyActiveWorkflowId() === null && data.get(STORAGE_KEYS.COMFYUI_ACTIVE_WORKFLOW) === "null", "remove clears active")
storage.setComfyActiveWorkflow("c")
storage.removeComfyWorkflow("zzz")
assert(storage.getComfyActiveWorkflowId() === "c", "removing another id keeps active")

// Roles
assert(storage.updateComfyWorkflowRoles("c", roles) === true, "roles updated")
assert(storage.getComfyWorkflows()[0].roles.output === "9" && storage.getComfyWorkflows()[0].roles.prompt?.nodeId === "6", "roles persisted")
assert(storage.updateComfyWorkflowRoles("zzz", roles) === false, "roles update on unknown id fails")

// A passed test is kept with the workflow until its roles change
assert(storage.markComfyWorkflowTested("c", 42) === true, "test recorded")
assert(storage.getComfyWorkflows()[0].testedAt === 42, "test date stored")
assert(storage.updateComfyWorkflowRoles("c", { ...roles }) === true, "same roles saved")
assert(storage.getComfyWorkflows()[0].testedAt === 42, "same roles keep the test")
assert(storage.updateComfyWorkflowRoles("c", { ...roles, seed: { nodeId: "6", input: "seed" } }) === true, "new roles saved")
assert(storage.getComfyWorkflows()[0].testedAt === undefined, "new roles clear the test")
assert(storage.markComfyWorkflowTested("zzz") === false, "test on unknown id fails")
assert(storage.updateComfyWorkflowRoles("c", roles) === true, "roles restored")
data.set(STORAGE_KEYS.COMFYUI_WORKFLOWS, JSON.stringify([{ ...wf("bad"), testedAt: "yesterday" }]))
assert(storage.getComfyWorkflows().length === 0, "a non-numeric test date is rejected")
data.set(STORAGE_KEYS.COMFYUI_WORKFLOWS, JSON.stringify([wf("c", { roles })]))

// Quota
const before = data.get(STORAGE_KEYS.COMFYUI_WORKFLOWS)
quotaFull = true
assert(storage.saveComfyWorkflow(wf("big")) === false, "save returns false on quota")
assert(storage.updateComfyWorkflowRoles("c", noRoles) === false, "roles update returns false on quota")
assert(storage.removeComfyWorkflow("c") === false, "remove returns false on quota")
assert(storage.setComfyUrl("localhost:1234") === false, "url write returns false on quota")
quotaFull = false
assert(data.get(STORAGE_KEYS.COMFYUI_WORKFLOWS) === before, "failed writes leave the saved list untouched")

console.warn = origWarn
console.log(`comfyui-settings: ${passed} passed, ${failed} failed`)
// A BroadcastChannel may be open; do not wait for it.
process.exit(failed === 0 ? 0 : 1)
