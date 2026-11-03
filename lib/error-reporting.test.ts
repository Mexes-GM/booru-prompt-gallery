/**
 * Unit tests for error reporting before posthog-js has loaded
 * (lib/error-reporting.ts on top of lib/posthog-queue.ts).
 *
 * A caught error reported before the SDK loads must still be sent once it
 * does, with the time it happened, and with the same event id that
 * reportError() returned (the error boundary shows it to the user as a report
 * code). It must also carry super properties registered earlier.
 *
 * Uses Node's built-in `assert` (no test framework installed). Self-running:
 *   npx ts-node lib/error-reporting.test.ts
 */

import assert from "assert"
import type { PostHog } from "posthog-js"
import { reportError, setErrorContext } from "./error-reporting"
import { QUEUED_TIMESTAMP_PROP, QUEUED_UUID_PROP, applyQueuedMetadata, setPostHogClient } from "./posthog-queue"

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

// reportError only reports in the browser; a bare `window` is enough here.
;(globalThis as { window?: unknown }).window = {}

type SentEvent = { event: string; properties: Record<string, unknown>; timestamp?: Date; uuid: string }
const sent: SentEvent[] = []
const order: string[] = []
let superProps: Record<string, unknown> = {}

// Mimics the parts of posthog-js the queue relies on: captureException builds
// an $exception event, runs it through the same before_send step as
// instrumentation-client.ts, and returns it.
const fake = {
  register: (props: Record<string, unknown>) => {
    order.push(`register:${Object.keys(props).join(",")}`)
    superProps = { ...superProps, ...props }
  },
  captureException: (err: Error, props: Record<string, unknown>) => {
    order.push(`exception:${err.message}`)
    const event = applyQueuedMetadata({
      event: "$exception",
      properties: { ...superProps, ...props, $exception_message: err.message },
      timestamp: new Date(),
      uuid: "sdk-generated",
    })
    sent.push(event)
    return event
  },
} as unknown as PostHog

console.log("\nreportError before PostHog loads")

setErrorContext({ provider: "danbooru" })
const before = Date.now()
const eventId = reportError(new Error("early failure"), { tags: { context: "test" }, level: "warning" })
const after = Date.now()

test("returns an event id straight away", () => {
  assert.match(eventId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.strictEqual(sent.length, 0)
})

setPostHogClient(fake, () => fake.register({ nav_language: "en" }))

test("beforeReplay runs ahead of the queued calls", () => {
  assert.deepStrictEqual(order, ["register:nav_language", "register:provider", "exception:early failure"])
})

test("the queued exception is sent with that id and its original time", () => {
  assert.strictEqual(sent.length, 1)
  const [event] = sent
  assert.strictEqual(event.uuid, eventId)
  const ms = event.timestamp!.getTime()
  assert.ok(ms >= before && ms <= after, "timestamp is the time reportError was called")
})

test("keeps tags, level and earlier super properties, and drops the queue markers", () => {
  const { properties } = sent[0]
  assert.strictEqual(properties.context, "test")
  assert.strictEqual(properties.$exception_level, "warning")
  assert.strictEqual(properties.provider, "danbooru")
  assert.strictEqual(properties.nav_language, "en")
  assert.ok(!(QUEUED_TIMESTAMP_PROP in properties))
  assert.ok(!(QUEUED_UUID_PROP in properties))
})

console.log("\nreportError after PostHog loads")

test("returns the SDK's own event id", () => {
  assert.strictEqual(reportError(new Error("late failure")), "sdk-generated")
})

console.log("\napplyQueuedMetadata")

test("leaves events without markers untouched", () => {
  const timestamp = new Date(0)
  const event = applyQueuedMetadata({ event: "app_open", properties: { a: 1 }, timestamp, uuid: "u" })
  assert.deepStrictEqual(event, { event: "app_open", properties: { a: 1 }, timestamp, uuid: "u" })
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error("\nFailures:\n" + failures.map((f) => "  - " + f).join("\n"))
  process.exit(1)
}
