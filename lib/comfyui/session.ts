/**
 * Job layer for "Send to ComfyUI". One session owns one WebSocket to the
 * user's ComfyUI, queues prompts through the HTTP client and turns the
 * socket's messages into immutable job snapshots that React can read with
 * `useSyncExternalStore`. Everything lives in memory.
 */
import { applyRoles } from "./roles"
import { createComfyClient, type ComfyClient } from "./client"
import { ComfyError, type ApiWorkflow, type HistoryEntry, type HistoryImage, type Roles } from "./types"

export type ComfyJobStatus = "queued" | "running" | "done" | "error" | "cancelled"

export interface ComfyJob {
  id: string
  status: ComfyJobStatus
  /** 0 = next in line, counted among pending jobs. */
  queuePosition?: number
  step?: number
  totalSteps?: number
  node?: string
  previewUrl?: string
  imageUrl?: string
  error?: { message: string; node?: string }
  createdAt: number
}

export interface SendInput {
  api: ApiWorkflow
  roles: Roles
  prompt: string
  seed?: number
  width?: number
  height?: number
  preview: boolean
}

export interface WebSocketLike {
  binaryType: string
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  close(): void
}
export type WebSocketCtor = new (url: string) => WebSocketLike

export interface SessionTiming {
  /** Delay before reconnect attempt number `attempt` (0-based). */
  backoffMs?: (attempt: number) => number
  /** Close the socket after this long with no unfinished jobs. */
  idleMs?: number
  /** Gap between `/queue` polls while jobs are queued. */
  queuePollMs?: number
  /** Minimum gap between two preview frames of one job. */
  previewMinGapMs?: number
}

export interface SessionOptions {
  baseUrl: string
  client?: ComfyClient
  WebSocketImpl?: WebSocketCtor
  now?: () => number
  clientId?: string
  timing?: SessionTiming
}

type Listener = () => void
type Msg = { type?: string; data?: Record<string, unknown> }

interface Rec {
  job: ComfyJob
  output: string | null
  images: Map<string, HistoryImage[]>
  lastImages: HistoryImage[] | null
  lastPreviewAt: number
  finalizing: boolean
}

const EVENT_PREVIEW = 1
const EVENT_PREVIEW_WITH_METADATA = 4

function isTerminal(status: ComfyJobStatus): boolean {
  return status === "done" || status === "error" || status === "cancelled"
}

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function mimeOf(bytes: Uint8Array): string {
  if (bytes.length > 3 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png"
  if (bytes.length > 3 && bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp"
  return "image/jpeg"
}

function imagesOf(value: unknown): HistoryImage[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const list = value.filter(
    (v): v is HistoryImage => !!v && typeof v === "object" && typeof (v as HistoryImage).filename === "string",
  )
  return list.length ? list : null
}

function pickFromEntry(entry: HistoryEntry, output: string | null): HistoryImage[] | null {
  const outputs = entry.outputs ?? {}
  if (output) {
    const own = imagesOf(outputs[output]?.images)
    if (own) return own
  }
  const ids = Object.keys(outputs)
  for (let i = ids.length - 1; i >= 0; i--) {
    const found = imagesOf(outputs[ids[i]]?.images)
    if (found) return found
  }
  return null
}

/**
 * One readable line from ComfyUI's per-node validation error, or null.
 * A value that is not in the list is nearly always a model file this ComfyUI
 * does not have, so that case names the input and the value.
 */
export function describeNodeError(entry: unknown): string | null {
  const first = (entry as { errors?: unknown[] } | undefined)?.errors?.[0] as
    | { type?: string; message?: string; details?: string; extra_info?: { input_name?: string; received_value?: unknown } }
    | undefined
  if (!first) return null
  const input = first.extra_info?.input_name
  const value = first.extra_info?.received_value
  if (first.type === "value_not_in_list" && input && typeof value === "string") {
    return `${input} “${value}” isn't in this ComfyUI`
  }
  const text = [first.message, first.details].filter(Boolean).join(": ")
  if (!text) return null
  return text.length > 200 ? `${text.slice(0, 199)}…` : text
}

export function createComfySession(options: SessionOptions) {
  const client = options.client ?? createComfyClient(options.baseUrl)
  const WS: WebSocketCtor | undefined =
    options.WebSocketImpl ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket
  const now = options.now ?? (() => Date.now())
  const clientId = options.clientId ?? randomId()
  const backoffMs = options.timing?.backoffMs ?? ((attempt: number) => Math.min(1000 * 2 ** attempt, 15000))
  const idleMs = options.timing?.idleMs ?? 60_000
  const queuePollMs = options.timing?.queuePollMs ?? 2000
  const previewMinGapMs = options.timing?.previewMinGapMs ?? 125

  const base = (client.baseUrl || options.baseUrl).replace(/\/+$/, "")
  const wsUrl = `${base.replace(/^http/i, "ws")}/ws?clientId=${encodeURIComponent(clientId)}`

  const recs = new Map<string, Rec>()
  const listeners = new Set<Listener>()
  let jobsSnapshot: ComfyJob[] = []
  let localCounter = 0
  let disposed = false

  // Socket state
  let socket: WebSocketLike | null = null
  let isOpen = false
  let everOpened = false
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let openWaiters: Array<() => void> = []

  // Queue polling
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let polling = false

  // Text messages for prompts whose POST has not answered yet.
  let sending = 0
  const orphans = new Map<string, Msg[]>()

  function unref(timer: unknown) {
    ;(timer as { unref?: () => void })?.unref?.()
  }

  // --- Store ---------------------------------------------------------------

  function emit() {
    jobsSnapshot = Array.from(recs.values(), (r) => r.job)
    for (const l of Array.from(listeners)) l()
  }

  function patch(rec: Rec, changes: Partial<ComfyJob>) {
    rec.job = { ...rec.job, ...changes }
  }

  function revokePreview(rec: Rec) {
    if (rec.job.previewUrl) {
      URL.revokeObjectURL(rec.job.previewUrl)
      patch(rec, { previewUrl: undefined })
    }
  }

  function settle(rec: Rec, changes: Partial<ComfyJob>) {
    revokePreview(rec)
    patch(rec, { ...changes, queuePosition: undefined })
    emit()
    checkIdle()
  }

  function unfinished(): Rec[] {
    return Array.from(recs.values()).filter((r) => !isTerminal(r.job.status))
  }

  // --- Socket --------------------------------------------------------------

  function clearIdle() {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
  }

  function checkIdle() {
    if (disposed || !socket || unfinished().length > 0) return
    if (idleTimer) return
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (unfinished().length === 0) closeSocket()
    }, idleMs)
    unref(idleTimer)
  }

  function closeSocket() {
    const s = socket
    socket = null
    isOpen = false
    if (s) {
      s.onopen = s.onmessage = s.onclose = s.onerror = null
      try {
        s.close()
      } catch {
        /* already closed */
      }
    }
  }

  function scheduleReconnect() {
    if (disposed || reconnectTimer || socket || unfinished().length === 0) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (disposed || unfinished().length === 0) return
      reconnectAttempt++
      ensureSocket()
    }, backoffMs(reconnectAttempt))
    unref(reconnectTimer)
  }

  function ensureSocket() {
    if (disposed || socket || !WS) return
    let s: WebSocketLike
    try {
      s = new WS(wsUrl)
    } catch {
      scheduleReconnect()
      return
    }
    socket = s
    s.binaryType = "arraybuffer"
    s.onopen = () => {
      if (socket !== s) return
      isOpen = true
      const reconnected = everOpened
      everOpened = true
      reconnectAttempt = 0
      const waiters = openWaiters
      openWaiters = []
      waiters.forEach((w) => w())
      if (reconnected) void reconcile()
      checkIdle()
    }
    s.onmessage = (event) => {
      if (socket === s) handleMessage(event.data)
    }
    s.onclose = () => {
      if (socket !== s) return
      socket = null
      isOpen = false
      const waiters = openWaiters
      openWaiters = []
      waiters.forEach((w) => w())
      scheduleReconnect()
    }
    s.onerror = () => {
      /* onclose follows */
    }
  }

  function waitOpen(timeoutMs: number): Promise<void> {
    if (isOpen || !socket) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(done, timeoutMs)
      unref(timer)
      function done() {
        clearTimeout(timer)
        resolve()
      }
      openWaiters.push(done)
    })
  }

  /** After a reconnect: catch completions that happened while the socket was down. */
  async function reconcile() {
    for (const rec of unfinished()) {
      try {
        const entry = await client.history(rec.job.id)
        if (!entry || isTerminal(rec.job.status)) continue
        applyHistory(rec, entry)
      } catch {
        /* still unreachable: the next reconnect tries again */
      }
    }
  }

  function applyHistory(rec: Rec, entry: HistoryEntry) {
    if (entry.status?.status_str === "error") {
      settle(rec, { status: "error", error: { message: "The generation failed in ComfyUI." } })
      return
    }
    const images = pickFromEntry(entry, rec.output)
    if (images) finishWith(rec, images)
    else if (entry.status?.completed) void finalize(rec)
  }

  // --- Messages ------------------------------------------------------------

  function handleMessage(data: unknown) {
    if (typeof data === "string") {
      let msg: Msg
      try {
        msg = JSON.parse(data) as Msg
      } catch {
        return
      }
      handleText(msg)
      return
    }
    let bytes: Uint8Array | null = null
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data)
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    if (bytes) handleBinary(bytes)
  }

  function handleText(msg: Msg) {
    const d = msg.data
    if (!d || typeof msg.type !== "string") return
    const id = typeof d.prompt_id === "string" ? d.prompt_id : null
    if (!id) return
    const rec = recs.get(id)
    if (!rec) {
      if (sending > 0) {
        const list = orphans.get(id) ?? []
        if (list.length < 40) list.push(msg)
        orphans.set(id, list)
        if (orphans.size > 8) orphans.delete(orphans.keys().next().value as string)
      }
      return
    }
    applyText(rec, msg.type, d)
  }

  function ensureRunning(rec: Rec): boolean {
    if (isTerminal(rec.job.status)) return false
    if (rec.job.status === "queued") patch(rec, { status: "running", queuePosition: undefined })
    return true
  }

  function applyText(rec: Rec, type: string, d: Record<string, unknown>) {
    if (isTerminal(rec.job.status)) return
    switch (type) {
      case "execution_start":
        ensureRunning(rec)
        emit()
        break
      case "executing": {
        ensureRunning(rec)
        const node = typeof d.node === "string" ? d.node : undefined
        if (node) patch(rec, { node })
        emit()
        break
      }
      case "progress": {
        ensureRunning(rec)
        const value = Number(d.value)
        const max = Number(d.max)
        patch(rec, {
          step: Number.isFinite(value) ? value : undefined,
          totalSteps: Number.isFinite(max) ? max : undefined,
          node: typeof d.node === "string" ? d.node : rec.job.node,
        })
        emit()
        break
      }
      case "executed": {
        ensureRunning(rec)
        const node = String(d.node ?? "")
        const images = imagesOf((d.output as { images?: unknown } | undefined)?.images)
        if (images) {
          rec.images.set(node, images)
          rec.lastImages = images
        }
        emit()
        break
      }
      case "execution_success":
        void finalize(rec)
        break
      case "execution_error":
        settle(rec, {
          status: "error",
          error: {
            message: typeof d.exception_message === "string" && d.exception_message ? d.exception_message : "The generation failed in ComfyUI.",
            node: d.node_id !== undefined ? String(d.node_id) : undefined,
          },
        })
        break
      case "execution_interrupted":
        settle(rec, { status: "cancelled" })
        break
      default:
        break
    }
  }

  function handlePreview(rec: Rec | undefined, bytes: Uint8Array) {
    if (!rec || isTerminal(rec.job.status) || bytes.length === 0) return
    const t = now()
    if (rec.lastPreviewAt && t - rec.lastPreviewAt < previewMinGapMs) return
    rec.lastPreviewAt = t
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mimeOf(bytes) }))
    if (rec.job.previewUrl) URL.revokeObjectURL(rec.job.previewUrl)
    patch(rec, { previewUrl: url })
    emit()
  }

  function handleBinary(bytes: Uint8Array) {
    if (bytes.length < 8) return
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const event = view.getUint32(0)
    if (event === EVENT_PREVIEW) {
      let current: Rec | undefined
      for (const rec of recs.values()) if (rec.job.status === "running") current = rec
      handlePreview(current, bytes.subarray(8))
    } else if (event === EVENT_PREVIEW_WITH_METADATA) {
      const n = view.getUint32(4)
      if (8 + n > bytes.length) return
      let promptId: unknown
      try {
        promptId = (JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + n))) as { prompt_id?: unknown }).prompt_id
      } catch {
        return
      }
      if (typeof promptId === "string") handlePreview(recs.get(promptId), bytes.subarray(8 + n))
    }
  }

  // --- Completion ----------------------------------------------------------

  function finishWith(rec: Rec, images: HistoryImage[]) {
    if (isTerminal(rec.job.status)) return
    settle(rec, { status: "done", imageUrl: client.viewUrl(images[0]), error: undefined })
  }

  async function finalize(rec: Rec) {
    if (isTerminal(rec.job.status) || rec.finalizing) return
    rec.finalizing = true
    try {
      let images: HistoryImage[] | null | undefined = (rec.output ? rec.images.get(rec.output) : undefined) ?? rec.lastImages
      if (!images) {
        try {
          const entry = await client.history(rec.job.id, { retries: 6, delayMs: 500 })
          if (entry) {
            if (entry.status?.status_str === "error") {
              if (!isTerminal(rec.job.status)) settle(rec, { status: "error", error: { message: "The generation failed in ComfyUI." } })
              return
            }
            images = pickFromEntry(entry, rec.output)
          }
        } catch {
          /* reported below as a missing image */
        }
      }
      if (isTerminal(rec.job.status)) return
      if (images?.length) finishWith(rec, images)
      else settle(rec, { status: "error", error: { message: "The workflow finished without producing an image." } })
    } finally {
      rec.finalizing = false
    }
  }

  // --- Queue position ------------------------------------------------------

  function queuedRecs(): Rec[] {
    return Array.from(recs.values()).filter((r) => r.job.status === "queued")
  }

  async function pollQueue() {
    pollTimer = null
    if (disposed || polling || queuedRecs().length === 0) return
    polling = true
    try {
      const q = await client.queue()
      const pending = [...(q.queue_pending ?? [])].sort((a, b) => Number(a[0]) - Number(b[0]))
      let changed = false
      for (const rec of queuedRecs()) {
        const index = pending.findIndex((p) => p[1] === rec.job.id)
        if (index >= 0 && rec.job.queuePosition !== index) {
          patch(rec, { queuePosition: index })
          changed = true
        }
      }
      if (changed) emit()
    } catch {
      /* try again next round */
    } finally {
      polling = false
    }
    scheduleQueuePoll()
  }

  function scheduleQueuePoll() {
    if (disposed || pollTimer || polling || queuedRecs().length === 0) return
    pollTimer = setTimeout(() => void pollQueue(), queuePollMs)
    unref(pollTimer)
  }

  // --- Public API ----------------------------------------------------------

  function newRec(id: string, output: string | null): Rec {
    const rec: Rec = {
      job: { id, status: "queued", createdAt: now() },
      output,
      images: new Map(),
      lastImages: null,
      lastPreviewAt: 0,
      finalizing: false,
    }
    recs.set(id, rec)
    return rec
  }

  async function send(input: SendInput): Promise<string> {
    if (disposed) throw new ComfyError("network", "The ComfyUI session is closed")
    clearIdle()
    ensureSocket()
    await waitOpen(2000)

    const values: { prompt: string; seed?: number; width?: number; height?: number } = { prompt: input.prompt }
    if (input.seed !== undefined) values.seed = input.seed
    if (input.width !== undefined) values.width = input.width
    if (input.height !== undefined) values.height = input.height
    const workflow = applyRoles(input.api, input.roles, values)

    sending++
    let id: string
    try {
      const res = await client.queuePrompt(workflow, clientId, { preview: input.preview })
      id = res.prompt_id
    } catch (error) {
      if (error instanceof ComfyError && error.kind === "validation") {
        const localId = `local-${++localCounter}-${now()}`
        const rec = newRec(localId, input.roles.output)
        const node = error.nodeErrors ? Object.keys(error.nodeErrors)[0] : undefined
        const message = (node && describeNodeError(error.nodeErrors?.[node])) || error.message
        patch(rec, { status: "error", error: { message, node } })
        emit()
        checkIdle()
        return localId
      }
      checkIdle()
      throw error
    } finally {
      sending--
    }

    const rec = newRec(id, input.roles.output)
    emit()
    const early = orphans.get(id)
    orphans.delete(id)
    early?.forEach((m) => handleText(m))
    if (!isOpen) scheduleReconnect()
    if (queuedRecs().length > 0 && !polling) {
      if (pollTimer) clearTimeout(pollTimer)
      pollTimer = null
      void pollQueue()
    }
    return id
  }

  async function cancel(jobId: string): Promise<void> {
    const rec = recs.get(jobId)
    if (!rec || isTerminal(rec.job.status)) return
    if (rec.job.id.startsWith("local-")) return
    if (rec.job.status === "running") {
      await client.interrupt(jobId)
    } else {
      await client.deleteFromQueue([jobId])
      // It may have left the queue and started since we last heard; a targeted
      // interrupt stops it then, and does nothing to any other prompt.
      await client.interrupt(jobId)
    }
    if (!isTerminal(rec.job.status)) settle(rec, { status: "cancelled" })
  }

  function forget(jobId: string) {
    const rec = recs.get(jobId)
    if (!rec) return
    revokePreview(rec)
    recs.delete(jobId)
    emit()
    checkIdle()
  }

  function dispose() {
    disposed = true
    clearIdle()
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (pollTimer) clearTimeout(pollTimer)
    reconnectTimer = pollTimer = null
    closeSocket()
    for (const rec of recs.values()) revokePreview(rec)
    recs.clear()
    emit()
  }

  return {
    clientId,
    send,
    cancel,
    forget,
    dispose,
    subscribe(listener: Listener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getJob: (id: string): ComfyJob | null => recs.get(id)?.job ?? null,
    getJobs: (): ComfyJob[] => jobsSnapshot,
  }
}

export type ComfySession = ReturnType<typeof createComfySession>

// --- Module-level default session --------------------------------------------

let active: { baseUrl: string; session: ComfySession; unsubscribe: () => void } | null = null
const storeListeners = new Set<Listener>()
const NO_JOBS: ComfyJob[] = []

function notifyStore() {
  for (const l of Array.from(storeListeners)) l()
}

/** The shared session for this base URL. A different URL replaces (and closes) the old one. */
export function getComfySession(baseUrl: string): ComfySession {
  const url = baseUrl.trim().replace(/\/+$/, "")
  if (active && active.baseUrl === url) return active.session
  if (active) {
    active.unsubscribe()
    active.session.dispose()
  }
  const session = createComfySession({ baseUrl: url })
  active = { baseUrl: url, session, unsubscribe: session.subscribe(notifyStore) }
  notifyStore()
  return session
}

/** Subscribes to changes of the active session (including its replacement). */
export function subscribeComfyJobs(listener: Listener): () => void {
  storeListeners.add(listener)
  return () => {
    storeListeners.delete(listener)
  }
}

export function getComfyJobSnapshot(id: string): ComfyJob | null {
  return active?.session.getJob(id) ?? null
}

export function getComfyJobsSnapshot(): ComfyJob[] {
  return active?.session.getJobs() ?? NO_JOBS
}
