/**
 * Unit tests for describeSearchError (lib/booru/search-error-reason.ts), the
 * classifier behind the `reason` property of `error_shown` / booru_search.
 *
 * Uses Node's built-in `assert` (no test framework installed). Self-running:
 *   npx ts-node lib/booru/search-error-reason.test.ts
 */

import assert from "node:assert/strict"
import { describeSearchError } from "./search-error-reason"

let passed = 0
let failed = 0
const failures: string[] = []

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
  } catch (err) {
    failed++
    failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Mirrors the error lib/api-client.ts throws for a non-OK response.
function httpError(status: number, info: unknown) {
  return Object.assign(new Error("Failed to fetch data"), { status, info })
}

test("Worker circuit breaker (429 + saturated) → circuit_open", () => {
  const d = describeSearchError(httpError(429, { error: "Danbooru is saturated. Please wait before retrying." }))
  assert.equal(d.reason, "circuit_open")
  assert.equal(d.status, 429)
})

test("plain 429 → rate_limited", () => {
  assert.equal(describeSearchError(httpError(429, { error: "slow down" })).reason, "rate_limited")
})

test("other statuses → http_<status>, statusCode accepted too", () => {
  assert.equal(describeSearchError(httpError(502, { error: "The provider is unavailable right now." })).reason, "http_502")
  assert.equal(describeSearchError({ statusCode: 403, message: "x" }).reason, "http_403")
})

test("fetch() TypeError (CORS / offline) → network", () => {
  assert.equal(describeSearchError(new TypeError("Failed to fetch")).reason, "network")
  assert.equal(describeSearchError(new TypeError("Load failed")).reason, "network")
  assert.equal(describeSearchError(new Error("NetworkError when attempting to fetch resource.")).reason, "network")
})

test("AbortError / TimeoutError / 'timed out' → timeout", () => {
  assert.equal(describeSearchError(new DOMException("The operation was aborted.", "AbortError")).reason, "timeout")
  assert.equal(describeSearchError(new DOMException("signal timed out", "TimeoutError")).reason, "timeout")
  assert.equal(describeSearchError(new Error("Request timed out")).reason, "timeout")
})

test("JSON parse failure → invalid_response", () => {
  assert.equal(describeSearchError(new SyntaxError("Unexpected token '<'")).reason, "invalid_response")
})

test("unrecognised values → unknown, never throws", () => {
  assert.equal(describeSearchError(undefined).reason, "unknown")
  assert.equal(describeSearchError(null).reason, "unknown")
  assert.equal(describeSearchError(new Error("weird")).reason, "unknown")
})

test("message combines client + server text and is trimmed to 200 chars", () => {
  const d = describeSearchError(httpError(502, { error: "upstream down" }))
  assert.equal(d.message, "Failed to fetch data | upstream down")
  const long = describeSearchError(new Error("x".repeat(500)))
  assert.equal(long.message?.length, 200)
  assert.equal(describeSearchError({}).message, undefined)
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error("\nFailures:\n" + failures.map((f) => "  - " + f).join("\n"))
  process.exit(1)
}
