/**
 * Tests for Send to ComfyUI in Pack Mode: what one pack prompt sends
 * (lib/pack/pack-comfy-send.ts packSendRequest), Send all's queue (sendInOrder)
 * and the words its button says (components/prompt-gallery/pack/pack-text.ts).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-comfy-send.verify.ts
 */
import { packSendRequest, sendInOrder, type SendAllProgress } from "../lib/pack/pack-comfy-send"
import { packCopyText } from "../lib/pack/brief-pack"
import { sendAllAnnouncement, sendAllLabel, sendAllNote } from "../components/prompt-gallery/pack/pack-text"

let passed = 0
let failed = 0
function assert(condition: boolean, label: string) {
  if (condition) passed++
  else {
    failed++
    console.error(`  FAIL: ${label}`)
  }
}
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  assert(a === e, `${label} (got ${a}, want ${e})`)
}

async function main() {
  // ── packSendRequest ──────────────────────────────────────────────────────────
  const sized = { width: 1728, height: 1344 }
  eq(packSendRequest(sized, "1girl, solo"), { prompt: "1girl, solo", sourceWidth: 1728, sourceHeight: 1344 }, "a sized prompt sends its size")
  eq(packSendRequest({}, "1girl, solo"), { prompt: "1girl, solo" }, "a prompt without a size sends none")
  eq(packSendRequest({ width: 1024 }, "a"), { prompt: "a" }, "half a size is no size")
  // The text is the copy's body, never the Import List prefix the copy can add.
  const body = "A girl reading in a library."
  const copied = packCopyText([sized], [body], true).text
  assert(copied.startsWith("[1728x1344] "), "the copy with size has the prefix")
  eq(packSendRequest(sized, body).prompt, body, "the send has no size prefix")
  eq(packSendRequest(sized, body).prompt, packCopyText([sized], [body], false).text, "the send is the copy without size")

  // ── sendInOrder ──────────────────────────────────────────────────────────────
  {
    const order: string[] = []
    const progress: SendAllProgress[] = []
    let running = 0
    let overlapped = false
    const result = await sendInOrder(
      ["a", "b", "c"],
      async (item) => {
        running++
        if (running > 1) overlapped = true
        await new Promise((r) => setTimeout(r, 1))
        order.push(item)
        running--
        return true
      },
      (p) => progress.push(p),
    )
    eq(result, { sent: 3, total: 3 }, "all sent")
    eq(order, ["a", "b", "c"], "in order")
    assert(!overlapped, "one at a time")
    eq(progress, [{ done: 0, total: 3 }, { done: 1, total: 3 }, { done: 2, total: 3 }, { done: 3, total: 3 }], "progress after each")
  }
  {
    const tried: number[] = []
    const result = await sendInOrder([1, 2, 3, 4], async (n) => {
      tried.push(n)
      return n !== 2
    })
    eq(result, { sent: 1, total: 4 }, "stops at the first that doesn't go")
    eq(tried, [1, 2], "the rest aren't tried")
  }
  {
    const result = await sendInOrder([1, 2], async (n) => {
      if (n === 1) throw new Error("boom")
      return true
    })
    eq(result, { sent: 0, total: 2 }, "a send that throws counts as not sent")
  }
  {
    let stop = false
    const tried: number[] = []
    const result = await sendInOrder(
      [1, 2, 3],
      async (n) => {
        tried.push(n)
        if (n === 1) stop = true
        return true
      },
      undefined,
      () => stop,
    )
    eq(result, { sent: 1, total: 3 }, "stops when told to")
    eq(tried, [1], "nothing after the stop")
  }
  eq(await sendInOrder([], async () => true), { sent: 0, total: 0 }, "an empty list sends nothing")

  // ── Words ────────────────────────────────────────────────────────────────────
  eq(sendAllLabel({ kind: "idle" }), "Send all", "idle label")
  eq(sendAllLabel({ kind: "sending", done: 0, total: 10 }), "Sending 1 of 10", "first one going")
  eq(sendAllLabel({ kind: "sending", done: 10, total: 10 }), "Sending 10 of 10", "never past the total")
  eq(sendAllLabel({ kind: "ended", sent: 10, total: 10 }), "Sent 10", "all sent")
  eq(sendAllLabel({ kind: "ended", sent: 4, total: 10 }), "Sent 4 of 10", "stopped early")
  eq(sendAllNote({ kind: "ended", sent: 10, total: 10 }), null, "no note when all went")
  eq(sendAllNote({ kind: "ended", sent: 9, total: 10 }), "1 prompt wasn't sent.", "one left")
  eq(sendAllNote({ kind: "ended", sent: 4, total: 10 }), "6 prompts weren't sent.", "several left")
  eq(sendAllNote({ kind: "sending", done: 1, total: 10 }), null, "no note while sending")
  eq(sendAllAnnouncement({ kind: "idle" }), "", "nothing to say while idle")
  eq(sendAllAnnouncement({ kind: "ended", sent: 1, total: 1 }), "Sent 1 prompt to ComfyUI", "one sent")
  eq(sendAllAnnouncement({ kind: "ended", sent: 4, total: 10 }), "Sent 4 of 10 prompts to ComfyUI. 6 prompts weren't sent.", "stopped, said")

  console.log(`pack-comfy-send: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

void main()
