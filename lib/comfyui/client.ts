/**
 * Small ComfyUI HTTP client. It runs in the browser and talks straight to the
 * user's ComfyUI; the site's server never sees these requests.
 */
import {
  ComfyError,
  type BridgeInfo,
  type BridgeWorkflowRecord,
  type BridgeWorkflowSummary,
  type Diagnosis,
  type HistoryEntry,
  type ObjectInfo,
  type QueueResponse,
  type SystemStats,
} from "./types"
import { normalizeComfyUrl } from "./url"

// The address check lives in ./url so settings code can use it without this client.
export { DEFAULT_COMFY_PORT, normalizeComfyUrl } from "./url"

export const DEFAULT_TIMEOUT_MS = 8000

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ComfyClientOptions {
  fetch?: FetchLike
  timeoutMs?: number
}

/** Compares `x.y.z` versions (a leading "v" and any suffix are ignored). Invalid input counts as 0.0.0. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.trim())
    return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : [0, 0, 0]
  }
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

export function createComfyClient(baseUrl: string, options: ComfyClientOptions = {}) {
  const base = baseUrl.trim().replace(/\/+$/, "")
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init))

  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    try {
      return await doFetch(base + path, { ...init, signal: controller.signal })
    } catch (error) {
      if (timedOut) throw new ComfyError("timeout", `ComfyUI did not answer within ${timeoutMs} ms`)
      throw new ComfyError("network", error instanceof Error ? error.message : "Network error")
    } finally {
      clearTimeout(timer)
    }
  }

  async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await send(path, init)
    if (!res.ok) throw new ComfyError("http", `HTTP ${res.status} for ${path}`, { status: res.status })
    try {
      return (await res.json()) as T
    } catch {
      throw new ComfyError("http", `Invalid JSON from ${path}`, { status: res.status })
    }
  }

  function postJson(path: string, body: unknown): Promise<Response> {
    return send(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  return {
    baseUrl: base,

    systemStats: () => readJson<SystemStats>("/system_stats"),
    objectInfo: () => readJson<ObjectInfo>("/object_info"),

    async queuePrompt(
      prompt: unknown,
      clientId: string,
      opts: { preview?: boolean } = {},
    ): Promise<QueueResponse> {
      const body = {
        prompt,
        client_id: clientId,
        extra_data: opts.preview ? { preview_method: "auto" } : {},
      }
      const res = await postJson("/prompt", body)
      if (res.ok) return (await res.json()) as QueueResponse
      let payload: { error?: unknown; node_errors?: Record<string, unknown> } | null = null
      try {
        payload = await res.json()
      } catch {
        payload = null
      }
      if (res.status === 400 && payload && (payload.error || payload.node_errors)) {
        const err = payload.error
        const message =
          typeof err === "string"
            ? err
            : err && typeof err === "object" && "message" in err
              ? String((err as { message: unknown }).message)
              : "ComfyUI rejected the workflow"
        throw new ComfyError("validation", message, { status: 400, nodeErrors: payload.node_errors })
      }
      throw new ComfyError("http", `HTTP ${res.status} for /prompt`, { status: res.status })
    },

    /**
     * Returns the history entry, or null when it is still empty after the
     * retries (ComfyUI needs about a second to write it after completion).
     */
    async history(
      promptId: string,
      opts: { retries?: number; delayMs?: number } = {},
    ): Promise<HistoryEntry | null> {
      const retries = opts.retries ?? 0
      const delayMs = opts.delayMs ?? 500
      for (let attempt = 0; attempt <= retries; attempt++) {
        const data = await readJson<Record<string, HistoryEntry>>(`/history/${encodeURIComponent(promptId)}`)
        const entry = data?.[promptId]
        if (entry) return entry
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
      return null
    },

    viewUrl(file: { filename: string; subfolder?: string; type?: string }): string {
      const params = new URLSearchParams({
        filename: file.filename,
        subfolder: file.subfolder ?? "",
        type: file.type ?? "output",
      })
      return `${base}/view?${params.toString()}`
    },

    /** Running and pending jobs. Entries are `[number, prompt_id, ...]`. */
    queue: () => readJson<{ queue_running?: unknown[][]; queue_pending?: unknown[][] }>("/queue"),

    /**
     * With a prompt id, ComfyUI stops only that prompt and only if it is the
     * one running; without one it stops whatever runs, which may be a job the
     * user queued from ComfyUI itself.
     */
    async interrupt(promptId?: string): Promise<void> {
      const res = promptId ? await postJson("/interrupt", { prompt_id: promptId }) : await send("/interrupt", { method: "POST" })
      if (!res.ok) throw new ComfyError("http", `HTTP ${res.status} for /interrupt`, { status: res.status })
    },

    async deleteFromQueue(ids: string[]): Promise<void> {
      const res = await postJson("/queue", { delete: ids })
      if (!res.ok) throw new ComfyError("http", `HTTP ${res.status} for /queue`, { status: res.status })
    },

    bridgeInfo: () => readJson<BridgeInfo>("/booru_bridge/info"),
    async listBridgeWorkflows(): Promise<BridgeWorkflowSummary[]> {
      const data = await readJson<{ workflows?: BridgeWorkflowSummary[] }>("/booru_bridge/workflows")
      return data.workflows ?? []
    },
    getBridgeWorkflow: (id: string) =>
      readJson<BridgeWorkflowRecord>(`/booru_bridge/workflows/${encodeURIComponent(id)}`),

    /**
     * True when the server answers a no-cors request (an opaque response), even
     * if it blocks our origin for normal requests.
     */
    async probeReachable(): Promise<boolean> {
      try {
        await send("/system_stats", { mode: "no-cors" })
        return true
      } catch {
        return false
      }
    },
  }
}

export type ComfyClient = ReturnType<typeof createComfyClient>

export interface DiagnoseOptions {
  fetch?: FetchLike
  timeoutMs?: number
  permissions?: { query(descriptor: { name: string }): Promise<{ state: string }> }
  userAgent?: string
  /** Host of the page running the check (defaults to location.hostname). */
  pageHost?: string
  minBridgeVersion: string
}

/**
 * WebKit blocks http://localhost from an https page. That covers desktop Safari
 * and every iOS browser (Chrome and Firefox on iOS are WebKit too), so iOS user
 * agents are unsupported whatever their brand.
 */
function isSafari(userAgent: string): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|Edg|Firefox/i.test(userAgent)
}

/**
 * Works out why the connection does or does not work, in this order:
 * unsupported browser, the bridge endpoint (a failure there with a denied
 * local-network permission means "denied"), then a no-cors probe to tell
 * "bridge missing" from "ComfyUI down".
 */
export async function diagnose(baseUrl: string, options: DiagnoseOptions): Promise<Diagnosis> {
  const userAgent = options.userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "")
  if (isSafari(userAgent)) return { state: "unsupported-browser" }

  const url = normalizeComfyUrl(baseUrl)
  if (!url) return { state: "invalid-url" }

  // A page served from loopback (local development) is in the same address
  // space as ComfyUI: the local-network permission does not apply to it, even
  // though Chromium reports it as "denied" there.
  const pageHost = options.pageHost ?? (typeof location !== "undefined" ? location.hostname : "")
  const loopbackPage = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i.test(pageHost)

  let permission: string | null = null
  if (!loopbackPage) {
    try {
      const perms = (options.permissions ?? (typeof navigator !== "undefined" ? navigator.permissions : undefined)) as DiagnoseOptions["permissions"]
      if (perms) permission = (await perms.query({ name: "local-network-access" })).state
    } catch {
      permission = null // not supported in this browser: carry on
    }
  }
  const promptFlag = permission === "prompt" ? ({ localNetworkPrompt: true } as const) : {}

  const client = createComfyClient(url, { fetch: options.fetch, timeoutMs: options.timeoutMs })
  try {
    // A "denied" permission is not the last word: pages served from loopback
    // themselves (local development) reach ComfyUI without it, and Chromium
    // still reports "denied" there. So try the bridge once; only when that
    // fails does the denied permission explain why.
    let info: BridgeInfo
    try {
      info = await client.bridgeInfo()
    } catch (error) {
      const answered = error instanceof ComfyError && error.kind === "http"
      if (permission === "denied" && !answered) return { state: "local-network-denied" }
      throw error
    }
    if (compareSemver(info.version, options.minBridgeVersion) < 0) {
      return { state: "bridge-outdated", version: info.version }
    }
    if (info.middleware !== "ok" && info.middleware !== "already") {
      return { state: "bridge-inactive", version: info.version }
    }
    let comfyVersion: string | null = null
    try {
      comfyVersion = (await client.systemStats()).system?.comfyui_version ?? null
    } catch {
      comfyVersion = null
    }
    return { state: "ok", comfyVersion, bridgeVersion: info.version }
  } catch (error) {
    // An HTTP answer (e.g. 404) means the server is up but has no bridge.
    if (error instanceof ComfyError && error.kind === "http") return { state: "bridge-missing", ...promptFlag }
    return (await client.probeReachable())
      ? { state: "bridge-missing", ...promptFlag }
      : { state: "unreachable", ...promptFlag }
  }
}
