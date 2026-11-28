/**
 * Tests for the shared ComfyUI status (lib/comfyui/status.ts): results are
 * reused while fresh, checks in flight are shared, and a newer address wins.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/comfyui-status.verify.ts
 */
import type { Diagnosis } from "../lib/comfyui/types"

/* eslint-disable @typescript-eslint/no-require-imports */
const status = require("../lib/comfyui/status") as typeof import("../lib/comfyui/status")

let passed = 0
let failed = 0
function assert(condition: boolean, label: string) {
  if (condition) passed++
  else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

const OK: Diagnosis = { state: "ok", comfyVersion: "1.0", bridgeVersion: "0.1.0" }
const DOWN: Diagnosis = { state: "unreachable" }
const A = "http://127.0.0.1:8188"
const B = "http://127.0.0.1:8199"

async function main() {
  let clock = 1000
  let calls = 0
  let answer: Diagnosis = OK
  const pending: (() => void)[] = []
  status.resetComfyStatusForTests({
    now: () => clock,
    diagnose: () => {
      calls++
      const result = answer
      return new Promise((resolve) => pending.push(() => resolve(result)))
    },
  })
  const flush = async () => {
    while (pending.length) pending.shift()!()
    await new Promise((r) => setTimeout(r, 0))
  }

  let notified = 0
  const off = status.subscribeComfyStatus(() => notified++)

  // First check runs and marks the store as checking.
  const first = status.checkComfyStatus(A)
  assert(status.getComfyStatus().checking && status.getComfyStatus().url === A, "checking while the first check runs")
  // A second caller shares the check in flight.
  const second = status.checkComfyStatus(A)
  assert(calls === 1, "a check in flight is shared")
  await flush()
  assert((await first).state === "ok" && (await second).state === "ok", "both callers get the result")
  assert(status.getComfyStatus().diagnosis?.state === "ok" && !status.getComfyStatus().checking, "result stored")
  assert(notified >= 2, "listeners hear about the change")

  // Fresh results are reused; old ones are checked again.
  clock += 10_000
  await status.checkComfyStatus(A)
  assert(calls === 1, "a result younger than 30 s is reused")
  clock += status.STATUS_MAX_AGE_MS
  answer = DOWN
  const stale = status.checkComfyStatus(A)
  assert(calls === 2, "an older result is checked again")
  assert(status.getComfyStatus().diagnosis?.state === "ok", "the old result stays shown while checking")
  await flush()
  assert((await stale).state === "unreachable" && status.getComfyStatus().diagnosis?.state === "unreachable", "new result replaces it")

  // refresh ignores the age.
  answer = OK
  const refreshed = status.refreshComfyStatus(A)
  assert(calls === 3, "refresh always checks")
  await flush()
  assert((await refreshed).state === "ok", "refresh result")

  // A newer address wins over a slower answer for the old one.
  answer = DOWN
  const oldCheck = status.refreshComfyStatus(A)
  answer = OK
  const newCheck = status.checkComfyStatus(B)
  assert(status.getComfyStatus().url === B && status.getComfyStatus().diagnosis === null, "switching address clears the old result")
  await flush()
  await oldCheck
  await newCheck
  assert(status.getComfyStatus().url === B && status.getComfyStatus().diagnosis?.state === "ok", "the old address's answer is dropped")

  // A result found elsewhere (a failed Send) is stored as is and skips the next check.
  status.reportComfyStatus(B, DOWN)
  assert(status.getComfyStatus().diagnosis?.state === "unreachable", "reported result stored")
  const before = calls
  await status.checkComfyStatus(B)
  assert(calls === before, "a reported result counts as fresh")

  // A check that throws counts as unreachable.
  status.resetComfyStatusForTests({ now: () => clock, diagnose: () => Promise.reject(new Error("boom")) })
  const thrown = await status.checkComfyStatus(A)
  assert(thrown.state === "unreachable", "a failing check reads as unreachable")

  // Copy
  assert(status.shortStatusLine(null).tone === "checking", "no result reads as checking")
  assert(status.shortStatusLine(OK).text === "Connected", "ok line")
  assert(status.shortStatusLine(DOWN).tone === "problem", "problem line")

  off()
  console.log(`comfyui-status: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
