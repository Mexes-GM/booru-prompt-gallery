/**
 * Unit tests for the PostHog call queue (lib/posthog-queue.ts).
 *
 * posthog-js loads after the first paint, so every call made before that waits
 * in this queue. These lock in what must not change when it is replayed:
 * nothing is dropped, the order is kept (super properties registered early
 * still apply to later events), and captures keep the time they happened.
 *
 * Uses Node's built-in `assert` (no test framework installed). Self-running:
 *   npx ts-node lib/posthog-queue.test.ts
 */

import assert from "assert"
import type { PostHog } from "posthog-js"
import { capture, getPostHog, setPostHogClient, uuidv7, withPostHog } from "./posthog-queue"

// ---------------------------------------------------------------------------
// Minimal self-contained runner
// ---------------------------------------------------------------------------

let passed = 0
let failed = 0
const failures: string[] = []

function test(name: string, fn: () => void): void {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    const msg = e instanceof Error ? e.message : String(e)
    failures.push(`${name}: ${msg}`)
    console.error(`  ✗ ${name}\n      ${msg}`)
  }
}

// The queue is browser-only; a bare `window` is enough for it.
;(globalThis as { window?: unknown }).window = {}

type Call = { method: string; args: unknown[] }
const calls: Call[] = []
const fake = {
  capture: (...args: unknown[]) => calls.push({ method: "capture", args }),
  register: (...args: unknown[]) => calls.push({ method: "register", args }),
  identify: (...args: unknown[]) => calls.push({ method: "identify", args }),
} as unknown as PostHog

// ---------------------------------------------------------------------------
// Before PostHog loads
// ---------------------------------------------------------------------------

console.log("\nqueue before PostHog loads")

const before = Date.now()
capture("app_open", { surface: "home" })
withPostHog((ph) => ph.register({ provider: "danbooru" }))
capture("provider_changed", { provider: "danbooru" })
withPostHog((ph) => ph.identify("user-1"))
withPostHog(() => {
  throw new Error("a failing call must not stop the replay")
})
capture("search_executed")
const after = Date.now()

test("nothing reaches PostHog until it is handed over", () => {
  assert.strictEqual(getPostHog(), null)
  assert.strictEqual(calls.length, 0)
})

setPostHogClient(fake)

test("replays every queued call, in order, past a failing one", () => {
  assert.deepStrictEqual(
    calls.map((c) => `${c.method}:${c.method === "capture" ? c.args[0] : ""}`),
    ["capture:app_open", "register:", "capture:provider_changed", "identify:", "capture:search_executed"],
  )
})

test("queued captures keep their properties and original time", () => {
  const appOpen = calls[0]
  assert.deepStrictEqual(appOpen.args[1], { surface: "home" })
  const { timestamp } = appOpen.args[2] as { timestamp: Date }
  assert.ok(timestamp instanceof Date)
  assert.ok(timestamp.getTime() >= before && timestamp.getTime() <= after)
  assert.strictEqual(calls[4].args[1], undefined)
})

// ---------------------------------------------------------------------------
// After PostHog loads
// ---------------------------------------------------------------------------

console.log("\ncalls after PostHog loads")

test("go straight through without a timestamp override", () => {
  calls.length = 0
  capture("prompt_copied", { provider: "e621" })
  assert.deepStrictEqual(calls, [{ method: "capture", args: ["prompt_copied", { provider: "e621" }] }])
})

test("a throwing call is swallowed", () => {
  assert.doesNotThrow(() =>
    withPostHog(() => {
      throw new Error("boom")
    }),
  )
})

// ---------------------------------------------------------------------------
// uuidv7
// ---------------------------------------------------------------------------

console.log("\nuuidv7")

test("is a version 7, RFC 4122 variant uuid", () => {
  assert.match(uuidv7(), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test("encodes the given time in its first 48 bits", () => {
  const ms = 1_790_000_000_123
  const hex = uuidv7(ms).replace(/-/g, "").slice(0, 12)
  assert.strictEqual(parseInt(hex, 16), ms)
})

test("is unique per call", () => {
  const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(0)))
  assert.strictEqual(ids.size, 1000)
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error("\nFailures:\n" + failures.map((f) => "  - " + f).join("\n"))
  process.exit(1)
}
