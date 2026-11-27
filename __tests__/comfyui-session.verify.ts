/**
 * Tests for lib/comfyui/session.ts with a fake WebSocket and a fake client:
 * job lifecycle, previews (blob URL bookkeeping and throttling), errors,
 * reconnecting, cancelling and attribution of events between jobs.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/comfyui-session.verify.ts
 */
import { createComfySession, type ComfySession, type WebSocketLike, describeNodeError } from "../lib/comfyui/session"
import { ComfyError, type ApiWorkflow, type HistoryEntry, type Roles } from "../lib/comfyui/types"

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) passed++
  else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}
function same(actual: unknown, expected: unknown, label: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} (got ${JSON.stringify(actual)})`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(cond: () => boolean, label: string, ms = 1000) {
  const t0 = Date.now()
  while (!cond() && Date.now() - t0 < ms) await sleep(2)
  assert(cond(), label)
}

// ── Blob URL accounting ──
let created = 0
let revoked = 0
const live = new Set<string>()
URL.createObjectURL = (() => {
  const url = `blob:fake/${++created}`
  live.add(url)
  return url
}) as typeof URL.createObjectURL
URL.revokeObjectURL = ((url: string) => {
  revoked++
  live.delete(url)
}) as typeof URL.revokeObjectURL

// ── Fake WebSocket ──
class FakeWS implements WebSocketLike {
  static instances: FakeWS[] = []
  static autoOpen = true
  binaryType = "blob"
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  closed = false
  constructor(public url: string) {
    FakeWS.instances.push(this)
    if (FakeWS.autoOpen) queueMicrotask(() => this.onopen?.({}))
  }
  close() {
    this.closed = true
  }
  text(type: string, data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ type, data }) })
  }
  binary(buf: ArrayBuffer) {
    this.onmessage?.({ data: buf })
  }
  serverClose() {
    this.onclose?.({})
  }
}
const lastWs = () => FakeWS.instances[FakeWS.instances.length - 1]

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
}
function previewEvent1(imageType = 1): ArrayBuffer {
  return new Uint8Array([...u32(1), ...u32(imageType), 0xff, 0xd8, 1, 2, 3]).buffer
}
function previewEvent4(promptId: string): ArrayBuffer {
  const meta = new TextEncoder().encode(JSON.stringify({ prompt_id: promptId, node_id: "3", image_type: "image/png" }))
  return new Uint8Array([...u32(4), ...u32(meta.length), ...meta, 0x89, 0x50, 0x4e, 0x47, 9]).buffer
}

// ── Fake client ──
interface FakeClientOptions {
  validationError?: boolean
  history?: (id: string) => HistoryEntry | null
  pending?: string[]
}
function fakeClient(opts: FakeClientOptions = {}) {
  let n = 0
  const calls: { name: string; args: unknown[] }[] = []
  const client = {
    baseUrl: "http://127.0.0.1:8188",
    async queuePrompt(prompt: unknown, clientId: string, o: { preview?: boolean } = {}) {
      calls.push({ name: "queuePrompt", args: [prompt, clientId, o] })
      if (opts.validationError) throw new ComfyError("validation", "Value not in list: ckpt_name", { status: 400, nodeErrors: { "4": {} } })
      n++
      return { prompt_id: `p${n}`, number: n, node_errors: {} }
    },
    async history(id: string, o?: unknown) {
      calls.push({ name: "history", args: [id, o] })
      return opts.history ? opts.history(id) : null
    },
    async queue() {
      calls.push({ name: "queue", args: [] })
      return { queue_running: [], queue_pending: (opts.pending ?? []).map((id, i) => [i + 10, id]).reverse() }
    },
    viewUrl: (f: { filename: string }) => `http://127.0.0.1:8188/view?filename=${f.filename}`,
    async interrupt(promptId?: string) {
      calls.push({ name: "interrupt", args: [promptId] })
    },
    async deleteFromQueue(ids: string[]) {
      calls.push({ name: "deleteFromQueue", args: [ids] })
    },
  }
  return { client: client as unknown as Parameters<typeof createComfySession>[0]["client"], calls }
}

const API: ApiWorkflow = {
  "6": { class_type: "CLIPTextEncode", inputs: { text: "old" } },
  "3": { class_type: "KSampler", inputs: { seed: 1 } },
  "9": { class_type: "SaveImage", inputs: {} },
  "10": { class_type: "PreviewImage", inputs: {} },
}
const ROLES: Roles = {
  prompt: { nodeId: "6", input: "text" },
  seed: { nodeId: "3", input: "seed" },
  width: null,
  height: null,
  output: "9",
}

function make(opts: FakeClientOptions = {}, now: () => number = Date.now) {
  const { client, calls } = fakeClient(opts)
  const session = createComfySession({
    baseUrl: "http://127.0.0.1:8188",
    client,
    WebSocketImpl: FakeWS,
    now,
    clientId: "cid",
    timing: { backoffMs: () => 5, idleMs: 60_000, queuePollMs: 60_000 },
  })
  return { session, calls }
}
const send = (s: ComfySession, extra: Partial<Parameters<ComfySession["send"]>[0]> = {}) =>
  s.send({ api: API, roles: ROLES, prompt: "1girl", preview: true, ...extra })
const img = (filename: string) => ({ filename, subfolder: "", type: "output" })

async function main() {
  // 1) Happy path
  {
    let clock = 1000
    const { session, calls } = make({ pending: ["x", "p1"] }, () => clock)
    const id = await send(session, { seed: 42 })
    assert(id === "p1", "jobId is the prompt_id")
    const ws = lastWs()
    assert(ws.url === "ws://127.0.0.1:8188/ws?clientId=cid", "websocket url derived from the base url")
    assert(ws.binaryType === "arraybuffer", "binary frames are requested as ArrayBuffer")
    const post = calls.find((c) => c.name === "queuePrompt")
    const sent = post?.args[0] as ApiWorkflow
    assert(sent["6"].inputs.text === "1girl" && sent["3"].inputs.seed === 42, "roles are applied")
    assert(API["6"].inputs.text === "old", "the source workflow is not mutated")
    same(post?.args.slice(1), ["cid", { preview: true }], "client id and preview flag passed")
    assert(session.getJob(id)?.status === "queued", "starts queued")
    await waitFor(() => session.getJob(id)?.queuePosition === 1, "queue position from /queue (index among pending sorted by number)")

    const seen: string[] = []
    session.subscribe(() => seen.push(session.getJob(id)?.status ?? "gone"))
    ws.text("status", { status: { exec_info: { queue_remaining: 1 } } })
    ws.text("execution_start", { prompt_id: id })
    assert(session.getJob(id)?.status === "running", "execution_start => running")
    assert(session.getJob(id)?.queuePosition === undefined, "running jobs have no queue position")
    ws.text("progress", { value: 3, max: 8, prompt_id: id, node: "3" })
    same([session.getJob(id)?.step, session.getJob(id)?.totalSteps, session.getJob(id)?.node], [3, 8, "3"], "progress 3/8")
    ws.binary(previewEvent1())
    const p1 = session.getJob(id)?.previewUrl
    assert(!!p1, "event 1 preview attributed to the running job")
    clock += 500
    ws.binary(previewEvent4(id))
    const p2 = session.getJob(id)?.previewUrl
    assert(!!p2 && p2 !== p1 && !live.has(p1 as string), "event 4 preview replaces and revokes the previous url")
    ws.text("executed", { node: "10", prompt_id: id, output: { images: [img("temp.png")] } })
    ws.text("executed", { node: "9", prompt_id: id, output: { images: [img("final.png")] } })
    ws.text("executed", { node: "10", prompt_id: id, output: { images: [img("temp2.png")] } })
    ws.text("execution_success", { prompt_id: id })
    await waitFor(() => session.getJob(id)?.status === "done", "execution_success => done")
    assert(session.getJob(id)?.imageUrl?.endsWith("filename=final.png") === true, "imageUrl comes from the roles.output node")
    assert(session.getJob(id)?.previewUrl === undefined && live.size === 0, "previews revoked when done")
    assert(seen.includes("running") && seen.includes("done"), "subscribers were notified")
    session.dispose()
  }

  // 2) Validation error
  {
    const { session } = make({ validationError: true })
    const id = await send(session)
    const job = session.getJob(id)
    assert(job?.status === "error" && job.error?.message === "Value not in list: ckpt_name", "validation error shown on the job")
    assert(job?.error?.node === "4", "validation error names the first failing node")
    await session.cancel(id)
    assert(session.getJob(id)?.status === "error", "cancel on a local error job is a no-op")
    session.dispose()
  }

  // 2b) Validation errors read the per-node detail ComfyUI sends (real response shape)
  {
    const missingModel = {
      errors: [{
        type: "value_not_in_list",
        message: "Value not in list",
        details: "clip_name: 'a.safetensors' not in ['b.safetensors']",
        extra_info: { input_name: "clip_name", received_value: "a.safetensors" },
      }],
      class_type: "CLIPLoader",
    }
    assert(describeNodeError(missingModel) === "clip_name “a.safetensors” isn't in this ComfyUI", "missing model names the input and file")
    const other = { errors: [{ type: "required_input_missing", message: "Required input is missing", details: "images" }] }
    assert(describeNodeError(other) === "Required input is missing: images", "other errors join message and details")
    assert(describeNodeError({}) === null && describeNodeError(undefined) === null, "no detail gives null")
    const long = describeNodeError({ errors: [{ message: "x".repeat(400) }] })
    assert(long !== null && long.length === 200, "long details are cut")
  }

  // 3) execution_error
  {
    const { session } = make()
    const id = await send(session)
    const ws = lastWs()
    ws.text("execution_start", { prompt_id: id })
    ws.binary(previewEvent1())
    ws.text("execution_error", { prompt_id: id, node_id: "3", node_type: "KSampler", exception_message: "CUDA out of memory" })
    const job = session.getJob(id)
    same(job?.error, { message: "CUDA out of memory", node: "3" }, "execution_error carries message and node")
    assert(job?.status === "error" && live.size === 0, "error revokes the preview")
    ws.text("execution_success", { prompt_id: id })
    assert(session.getJob(id)?.status === "error", "terminal state is final")
    session.dispose()
  }

  // 4) Disconnect mid-run, reconnect, history has outputs
  {
    const { session, calls } = make({
      history: (id) => ({ status: { completed: true, status_str: "success" }, outputs: { "9": { images: [img(`${id}.png`)] } } }),
    })
    const id = await send(session)
    const first = lastWs()
    first.text("execution_start", { prompt_id: id })
    const before = FakeWS.instances.length
    first.serverClose()
    await waitFor(() => FakeWS.instances.length === before + 1, "reconnects after a drop")
    await waitFor(() => session.getJob(id)?.status === "done", "history on reconnect completes the job")
    assert(session.getJob(id)?.imageUrl?.endsWith(`${id}.png`) === true, "image from history")
    assert(calls.some((c) => c.name === "history" && c.args[0] === id), "history was consulted")
    session.dispose()
  }

  // 5) execution_success without executed
  {
    let tries = 0
    const { session, calls } = make({
      history: (id) => {
        tries++
        return { outputs: { "9": { images: [img(`${id}-h.png`)] } } }
      },
    })
    const id = await send(session)
    const ws = lastWs()
    ws.text("execution_start", { prompt_id: id })
    ws.text("execution_success", { prompt_id: id })
    await waitFor(() => session.getJob(id)?.status === "done", "history fallback completes the job")
    assert(tries === 1 && session.getJob(id)?.imageUrl?.endsWith(`${id}-h.png`) === true, "image fetched from history")
    const h = calls.find((c) => c.name === "history")
    assert(((h?.args[1] as { retries?: number })?.retries ?? 0) > 0, "history is asked with retries")
    session.dispose()

    const none = make({ history: () => null })
    const id2 = await send(none.session)
    lastWs().text("execution_success", { prompt_id: id2 })
    await waitFor(() => none.session.getJob(id2)?.status === "error", "no image anywhere => error")
    none.session.dispose()
  }

  // 6) Cancel
  {
    const { session, calls } = make()
    const a = await send(session)
    const b = await send(session)
    lastWs().text("execution_start", { prompt_id: a })
    await session.cancel(a)
    await session.cancel(b)
    same(calls.filter((c) => c.name === "interrupt").map((c) => c.args[0]), [a, b], "interrupts target their own prompt only")
    same(calls.filter((c) => c.name === "deleteFromQueue").map((c) => c.args[0]), [[b]], "queued job => deleteFromQueue")
    assert(session.getJob(a)?.status === "cancelled" && session.getJob(b)?.status === "cancelled", "both marked cancelled")
    session.dispose()
  }

  // 7) Preview throttling
  {
    let t = 1000
    const { session } = make({}, () => t)
    const id = await send(session)
    const ws = lastWs()
    ws.text("execution_start", { prompt_id: id })
    const before = created
    ws.binary(previewEvent1())
    t += 50
    ws.binary(previewEvent1())
    t += 50
    ws.binary(previewEvent1())
    same(created - before, 1, "frames within the minimum gap are dropped")
    t += 100
    ws.binary(previewEvent1())
    same(created - before, 2, "a frame after the gap goes through")
    session.dispose()
  }

  // 8) Blob accounting after forget / done
  {
    const { session } = make()
    const id = await send(session)
    const ws = lastWs()
    ws.text("execution_start", { prompt_id: id })
    ws.binary(previewEvent1())
    session.forget(id)
    assert(session.getJob(id) === null && session.getJobs().length === 0, "forget removes the job")
    assert(live.size === 0, "forget revokes the preview")
    session.dispose()
    assert(created === revoked, `every created blob url was revoked (${created} vs ${revoked})`)
  }

  // 9) Interleaved jobs
  {
    const { session } = make()
    const a = await send(session)
    const b = await send(session)
    const ws = lastWs()
    ws.text("execution_start", { prompt_id: a })
    ws.binary(previewEvent4(b)) // b is not running yet but event 4 names it
    const urlB = session.getJob(b)?.previewUrl
    assert(!!urlB && session.getJob(a)?.previewUrl === undefined, "event 4 is attributed by prompt_id, not to the running job")
    ws.binary(previewEvent4(a))
    assert(!!session.getJob(a)?.previewUrl && session.getJob(b)?.previewUrl === urlB, "each job keeps its own preview")
    ws.text("progress", { value: 1, max: 4, prompt_id: a, node: "3" })
    ws.text("executed", { node: "9", prompt_id: b, output: { images: [img("b.png")] } })
    ws.text("executed", { node: "9", prompt_id: a, output: { images: [img("a.png")] } })
    ws.text("execution_success", { prompt_id: a })
    await waitFor(() => session.getJob(a)?.status === "done", "a done")
    assert(session.getJob(a)?.imageUrl?.endsWith("a.png") === true, "a keeps its own image")
    assert(session.getJob(b)?.step === undefined && session.getJob(b)?.imageUrl === undefined, "b is untouched by a's events")
    ws.text("execution_start", { prompt_id: b })
    ws.text("execution_success", { prompt_id: b })
    await waitFor(() => session.getJob(b)?.status === "done", "b done")
    assert(session.getJob(b)?.imageUrl?.endsWith("b.png") === true, "b keeps its own image")
    session.dispose()
  }

  // Snapshot stability
  {
    const { session } = make()
    const id = await send(session)
    const other = await send(session)
    const snap = session.getJob(id)
    const list = session.getJobs()
    assert(session.getJobs() === list, "getJobs is stable without changes")
    lastWs().text("progress", { value: 1, max: 2, prompt_id: other })
    assert(session.getJob(id) === snap, "an unrelated job's change keeps this snapshot")
    assert(session.getJobs() !== list, "the list changes when any job does")
    session.dispose()
  }

  assert(created === revoked, `no blob URLs leaked overall (${created} vs ${revoked})`)
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
