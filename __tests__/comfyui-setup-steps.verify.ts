/**
 * Tests for the setup steps shared by the ComfyUI setup guide and the settings
 * panel (lib/comfyui/setup-steps.ts): which devices can connect, where the
 * guide reopens, when Next is available and what the install step says.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/comfyui-setup-steps.verify.ts
 */
import type { Diagnosis, Roles, SavedComfyWorkflow } from "../lib/comfyui/types"

/* eslint-disable @typescript-eslint/no-require-imports */
const steps = require("../lib/comfyui/setup-steps") as typeof import("../lib/comfyui/setup-steps")

let passed = 0
let failed = 0
function assert(condition: boolean, label: string) {
  if (condition) passed++
  else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

const UA = {
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36",
}

// --- Device ---
assert(steps.deviceSupport(UA.chrome) === "ok", "desktop Chrome works")
assert(steps.deviceSupport(UA.edge) === "ok", "desktop Edge works")
assert(steps.deviceSupport(UA.firefox) === "ok", "desktop Firefox works")
assert(steps.deviceSupport(UA.safari) === "webkit", "desktop Safari is blocked by WebKit")
assert(steps.deviceSupport(UA.safari, 5) === "mobile", "iPadOS (Mac agent with touch) is a tablet")
assert(steps.deviceSupport(UA.iphoneChrome) === "mobile", "Chrome on iPhone is a phone")
assert(steps.deviceSupport(UA.android) === "mobile", "Android Chrome is a phone")
assert(steps.isWebKitOnly(UA.iphoneChrome), "every iOS browser is WebKit")
assert(!steps.isWebKitOnly(UA.chrome), "Chrome is not WebKit-only")

// --- Progress ---
const noRoles: Roles = { prompt: null, seed: null, width: null, height: null, output: null }
const fullRoles: Roles = { ...noRoles, prompt: { nodeId: "6", input: "text" }, output: "9" }
function wf(roles: Roles, testedAt?: number): SavedComfyWorkflow {
  return { id: "w", name: "W", source: "bridge", api: {}, ui: null, roles, savedAt: 1, ...(testedAt ? { testedAt } : {}) }
}
const OK: Diagnosis = { state: "ok", comfyVersion: "0.3", bridgeVersion: "0.1.0" }
const DOWN: Diagnosis = { state: "unreachable" }
const MISSING: Diagnosis = { state: "bridge-missing" }

const resume = (diagnosis: Diagnosis | null, workflow: SavedComfyWorkflow | null, savedCount = workflow ? 1 : 0, device: "ok" | "mobile" | "webkit" = "ok") =>
  steps.resumeStep({ device, diagnosis, workflow, savedCount })

assert(resume(OK, null, 0, "mobile") === "start", "a phone always starts at the beginning")
assert(resume(DOWN, null) === "start", "a first visit starts at the beginning")
assert(resume(MISSING, null) === "start", "a first visit starts at the beginning even with ComfyUI running")
assert(resume(DOWN, wf(fullRoles)) === "install", "with a saved workflow, a lost connection reopens on install")
assert(resume(OK, null) === "publish", "connected without a workflow reopens on publish")
assert(resume(OK, null, 2) === "publish", "saved workflows but none in use reopen on publish")
assert(resume(OK, wf(noRoles)) === "prompt", "no prompt input reopens on the prompt step")
assert(resume(OK, wf({ ...fullRoles, output: null })) === "prompt", "no output node reopens on the prompt step")
assert(resume(OK, wf(fullRoles)) === "test", "an untested workflow reopens on the test")
assert(resume(OK, wf(fullRoles, 5)) === "done", "a tested workflow reopens on done")

// --- Needs setup ---
assert(steps.needsSetup({ workflows: [], setupDone: true }), "no workflows means setup, even after a past test")
assert(steps.needsSetup({ workflows: [wf(fullRoles)], setupDone: false }), "an untested workflow still needs setup")
assert(!steps.needsSetup({ workflows: [wf(fullRoles, 5)], setupDone: false }), "a tested workflow finishes setup")
assert(!steps.needsSetup({ workflows: [wf(fullRoles)], setupDone: true }), "a past test keeps setup finished after roles change")

// --- Next ---
const p = (d: Diagnosis | null, w: SavedComfyWorkflow | null) => steps.setupProgress(d, w)
assert(steps.canContinue("start", "ok", p(null, null)), "start continues on a desktop")
assert(!steps.canContinue("start", "mobile", p(null, null)), "start stops on a phone")
assert(!steps.canContinue("install", "ok", p(MISSING, null)), "install waits for the node")
assert(steps.canContinue("install", "ok", p(OK, null)), "install continues once connected")
assert(!steps.canContinue("publish", "ok", p(OK, null)), "publish waits for a workflow")
assert(steps.canContinue("publish", "ok", p(OK, wf(noRoles))), "publish continues with a workflow")
assert(!steps.canContinue("prompt", "ok", p(OK, wf(noRoles))), "prompt waits for a prompt input")
assert(steps.canContinue("prompt", "ok", p(OK, wf(fullRoles))), "prompt continues with prompt and output")
assert(!steps.canContinue("test", "ok", p(OK, wf(fullRoles))), "test waits for a pass")
assert(steps.canContinue("test", "ok", p(OK, wf(fullRoles, 5))), "test continues after a pass")

// --- Install copy ---
assert(steps.installState(null).tone === "checking" && steps.installState(null).poll, "no result yet: checking, and polling")
assert(steps.installState(OK).tone === "ok" && !steps.installState(OK).poll, "connected: found, polling stops")
assert(/0\.3/.test(steps.installState(OK).text ?? ""), "found names the ComfyUI version")
assert(steps.installState(MISSING).poll && /isn't installed/.test(steps.installState(MISSING).title), "node missing keeps polling")
assert(/Allow/.test(steps.installState({ state: "unreachable", localNetworkPrompt: true }).text ?? ""), "the local network prompt says to choose Allow")
assert(/0\.0\.1/.test(steps.installState({ state: "bridge-outdated", version: "0.0.1" }).text ?? ""), "outdated names the version")
assert(!steps.installState({ state: "invalid-url" }).poll, "a bad address doesn't poll")
assert(!steps.installState({ state: "unsupported-browser" }).poll, "an unsupported browser doesn't poll")
for (const d of [OK, DOWN, MISSING, { state: "local-network-denied" }, { state: "bridge-inactive", version: "1" }] as Diagnosis[]) {
  const s = steps.installState(d)
  assert(s.title.length > 0 && !/[.]$/.test(s.title), `${d.state}: a title without a final period`)
}

// --- Prompt certainty ---
assert(steps.promptCertainty(wf(noRoles), 3) === "missing", "no prompt input is missing")
assert(steps.promptCertainty(wf(fullRoles), 1) === "sure", "the only candidate is sure")
assert(steps.promptCertainty(wf(fullRoles), 2) === "check", "other text inputs ask to check")

// --- Steps ---
assert(steps.NUMBERED_STEPS.length === 5 && !steps.NUMBERED_STEPS.includes("done"), "five numbered steps, done isn't one")

console.log(`comfyui-setup-steps: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
