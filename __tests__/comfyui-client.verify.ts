/**
 * Tests for lib/comfyui/client.ts: URL normalization, semver comparison, the
 * request wrapper (timeouts, error kinds, bodies) and every state `diagnose`
 * can return, including the order the checks run in. No real network is used.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/comfyui-client.verify.ts
 */
import { compareSemver, createComfyClient, diagnose, normalizeComfyUrl } from "../lib/comfyui/client"
import { ComfyError } from "../lib/comfyui/types"

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

function same(actual: unknown, expected: unknown, label: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} (got ${JSON.stringify(actual)})`)
}

// ── Fake fetch ──
type Call = { url: string; init?: RequestInit }
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | { type: string }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

/** Builds a fetch that records calls and routes by path; unknown paths fail like a blocked request. */
function fakeFetch(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]
    const handler = routes[path]
    if (!handler) throw new TypeError("Failed to fetch")
    return (await handler(url, init)) as Response
  }
  return { fn, calls }
}

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
const EDGE = `${CHROME} Edg/130.0.0.0`
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0"
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"
const URL_OK = "http://127.0.0.1:8188"
const perm = (state: string) => ({ query: async () => ({ state }) })

const okRoutes: Record<string, Handler> = {
  "/booru_bridge/info": () => json({ version: "1.2.0", origins: [], middleware: "ok" }),
  "/system_stats": () => json({ system: { comfyui_version: "0.44.0" } }),
}

async function main() {
  // ── 1) URL normalization ──
  {
    same(normalizeComfyUrl("http://127.0.0.1:8188"), "http://127.0.0.1:8188", "plain 127.0.0.1")
    same(normalizeComfyUrl("http://localhost:8188/"), "http://localhost:8188", "trailing slash is dropped")
    same(normalizeComfyUrl("  http://[::1]:9000  "), "http://[::1]:9000", "IPv6 loopback, trimmed")
    same(normalizeComfyUrl("127.0.0.1:8190"), "http://127.0.0.1:8190", "scheme is optional")
    same(normalizeComfyUrl("HTTP://LOCALHOST:3000"), "http://localhost:3000", "case-insensitive, lowercased")
    // A missing port means ComfyUI's default, 8188 (not http's 80).
    same(normalizeComfyUrl("localhost"), "http://localhost:8188", "missing port defaults to 8188")
    same(normalizeComfyUrl("http://127.0.0.1"), "http://127.0.0.1:8188", "missing port with scheme defaults to 8188")
    for (const bad of [
      "https://localhost:8188",
      "http://192.168.1.5:8188",
      "http://10.0.0.2:8188",
      "http://localhost:8188/foo",
      "http://localhost:8188?x=1",
      "http://localhost:8188#x",
      "http://user@localhost:8188",
      "http://localhost:0",
      "http://localhost:65536",
      "http://localhost.evil.com:8188",
      "http://evil.com",
      "http://0.0.0.0:8188",
      "",
      "not a url",
    ]) {
      assert(normalizeComfyUrl(bad) === null, `rejects ${JSON.stringify(bad)}`)
    }
    assert(normalizeComfyUrl("http://localhost:65535") === "http://localhost:65535", "highest valid port")
  }

  // ── 2) Semver ──
  {
    assert(compareSemver("1.0.0", "1.0.0") === 0, "equal versions")
    assert(compareSemver("1.0.1", "1.0.0") > 0, "patch greater")
    assert(compareSemver("0.9.9", "1.0.0") < 0, "major smaller")
    assert(compareSemver("1.10.0", "1.9.0") > 0, "numeric, not lexical")
    assert(compareSemver("v2.0.0", "1.99.99") > 0, "leading v is ignored")
    assert(compareSemver("1.2", "1.2.0") === 0, "missing patch counts as 0")
    assert(compareSemver("garbage", "0.0.0") === 0, "invalid counts as 0.0.0")
  }

  // ── 3) Client requests ──
  {
    const { fn, calls } = fakeFetch({
      "/system_stats": () => json({ system: { comfyui_version: "0.44.0" } }),
      "/object_info": () => json({ KSampler: {} }),
      "/prompt": (_u, init) => json({ prompt_id: "p1", number: 3, node_errors: {}, echo: JSON.parse(String(init?.body)) }),
      "/interrupt": () => new Response(null, { status: 200 }),
      "/queue": (_u, init) =>
        init?.method === "POST" ? new Response(null, { status: 200 }) : json({ queue_running: [[1, "p1"]], queue_pending: [[2, "p2"]] }),
      "/booru_bridge/workflows": () => json({ workflows: [{ id: "a", name: "A", updated: 1 }] }),
      "/booru_bridge/workflows/a%20b": () => json({ id: "a b", name: "A", updated: 1, ui: null, api: {} }),
    })
    const client = createComfyClient("http://127.0.0.1:8188///", { fetch: fn })
    assert(client.baseUrl === "http://127.0.0.1:8188", "trailing slashes are stripped from the base URL")
    assert((await client.systemStats()).system?.comfyui_version === "0.44.0", "systemStats")
    assert(calls[0].url === "http://127.0.0.1:8188/system_stats", "no double slash in request URL")
    assert("KSampler" in (await client.objectInfo()), "objectInfo")

    const queued = (await client.queuePrompt({ "1": { class_type: "X", inputs: {} } }, "cid", { preview: true })) as unknown as {
      prompt_id: string
      echo: { client_id: string; extra_data: unknown; prompt: unknown }
    }
    assert(queued.prompt_id === "p1", "queuePrompt returns the server answer")
    same(queued.echo.extra_data, { preview_method: "auto" }, "preview asks for preview_method auto")
    assert(queued.echo.client_id === "cid", "client_id is sent")
    const post = calls.find((c) => c.url.endsWith("/prompt"))
    assert(post?.init?.method === "POST", "queuePrompt uses POST")
    await client.queuePrompt({}, "cid")
    const second = calls.filter((c) => c.url.endsWith("/prompt"))[1]
    same(JSON.parse(String(second.init?.body)).extra_data, {}, "no preview option sends empty extra_data")

    await client.interrupt()
    assert(Boolean(calls.at(-1)?.url.endsWith("/interrupt")) && calls.at(-1)?.init?.method === "POST", "interrupt POSTs /interrupt")
    await client.deleteFromQueue(["p1", "p2"])
    same(JSON.parse(String(calls.at(-1)?.init?.body)), { delete: ["p1", "p2"] }, "deleteFromQueue body")

    same(await client.listBridgeWorkflows(), [{ id: "a", name: "A", updated: 1 }], "listBridgeWorkflows unwraps the list")
    assert((await client.getBridgeWorkflow("a b")).id === "a b", "getBridgeWorkflow encodes the id")

    const url = client.viewUrl({ filename: "a b.png", subfolder: "x/y", type: "temp" })
    assert(url === "http://127.0.0.1:8188/view?filename=a+b.png&subfolder=x%2Fy&type=temp", "viewUrl encodes parameters")
    assert(client.viewUrl({ filename: "a.png" }) === "http://127.0.0.1:8188/view?filename=a.png&subfolder=&type=output", "viewUrl defaults")
  }

  // ── 4) Error kinds ──
  {
    const { fn } = fakeFetch({
      "/prompt": () =>
        json({ error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" }, node_errors: { "3": { errors: [] } } }, 400),
      "/object_info": () => new Response("boom", { status: 500 }),
    })
    const client = createComfyClient(URL_OK, { fetch: fn })
    try {
      await client.queuePrompt({}, "c")
      assert(false, "validation error should throw")
    } catch (e) {
      assert(e instanceof ComfyError && e.kind === "validation", "400 with body is a validation error")
      assert(e instanceof ComfyError && e.status === 400 && "3" in (e.nodeErrors ?? {}), "validation keeps status and node_errors")
      assert(e instanceof ComfyError && e.message === "Prompt outputs failed validation", "validation message comes from the server")
    }
    try {
      await client.objectInfo()
      assert(false, "500 should throw")
    } catch (e) {
      assert(e instanceof ComfyError && e.kind === "http" && e.status === 500, "500 is an http error")
    }
    try {
      await client.systemStats() // route missing -> fetch rejects
      assert(false, "network failure should throw")
    } catch (e) {
      assert(e instanceof ComfyError && e.kind === "network", "rejected fetch is a network error")
    }
  }

  // ── 5) Timeouts ──
  {
    const hang = async (_url: string, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
      })
    const client = createComfyClient(URL_OK, { fetch: hang, timeoutMs: 25 })
    const started = Date.now()
    try {
      await client.systemStats()
      assert(false, "hanging request should time out")
    } catch (e) {
      assert(e instanceof ComfyError && e.kind === "timeout", "abort from the timer is a timeout error")
    }
    assert(Date.now() - started < 1000, "timeout fires near the configured delay")
  }

  // ── 6) history retries ──
  {
    let calls = 0
    const { fn } = fakeFetch({
      "/history/p1": () => {
        calls++
        return json(calls < 3 ? {} : { p1: { outputs: { "9": { images: [] } } } })
      },
      "/history/never": () => json({}),
    })
    const client = createComfyClient(URL_OK, { fetch: fn })
    const entry = await client.history("p1", { retries: 5, delayMs: 1 })
    assert(entry !== null && calls === 3, "history retries until the entry shows up")
    assert((await client.history("never", { retries: 2, delayMs: 1 })) === null, "history gives up with null")
    assert((await client.history("never")) === null, "history without retries returns null once")
  }

  // ── 7) diagnose ──
  const diag = (routes: Record<string, Handler>, opts: Partial<Parameters<typeof diagnose>[1]> = {}, url = URL_OK) => {
    const f = fakeFetch(routes)
    return diagnose(url, { fetch: f.fn, userAgent: CHROME, permissions: perm("granted"), minBridgeVersion: "1.0.0", timeoutMs: 50, ...opts }).then(
      (d) => ({ d, calls: f.calls }),
    )
  }
  {
    let r = await diag(okRoutes)
    same(r.d, { state: "ok", comfyVersion: "0.44.0", bridgeVersion: "1.2.0" }, "ok state")

    r = await diag({ ...okRoutes, "/booru_bridge/info": () => json({ version: "1.0.0", origins: [], middleware: "already" }) })
    assert(r.d.state === "ok", "middleware 'already' counts as ok")

    r = await diag({ ...okRoutes, "/system_stats": () => json({}, 500) })
    same(r.d, { state: "ok", comfyVersion: null, bridgeVersion: "1.2.0" }, "ok even when system_stats fails")

    r = await diag(okRoutes, { userAgent: EDGE })
    assert(r.d.state === "ok", "Edge is supported")
    r = await diag(okRoutes, { userAgent: FIREFOX })
    assert(r.d.state === "ok", "Firefox is supported")

    // Order: Safari beats everything and never touches the network.
    r = await diag(okRoutes, { userAgent: SAFARI, permissions: perm("denied") })
    same(r.d, { state: "unsupported-browser" }, "Safari is unsupported")
    assert(r.calls.length === 0, "Safari check makes no request")
    // Every iOS browser is WebKit, so Chrome and Firefox on iOS are unsupported too.
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15",
    ]) {
      r = await diag(okRoutes, { userAgent: ua })
      same(r.d, { state: "unsupported-browser" }, `iOS browser is unsupported: ${ua.slice(13, 25)}`)
    }

    // A denied permission explains a failed bridge request, without the no-cors probe
    // (with the permission denied, the probe fails the same way).
    r = await diag({}, { permissions: perm("denied") })
    same(r.d, { state: "local-network-denied" }, "denied permission")
    assert(r.calls.length === 1 && r.calls[0].url.endsWith("/booru_bridge/info"), "denied permission: one bridge request, no probe")
    // But a page served from loopback reaches ComfyUI even while Chromium reports "denied".
    r = await diag(okRoutes, { permissions: perm("denied") })
    same(r.d, { state: "ok", comfyVersion: "0.44.0", bridgeVersion: "1.2.0" }, "denied permission but the request works: ok")
    r = await diag({ "/booru_bridge/info": () => new Response("nope", { status: 404 }) }, { permissions: perm("denied") })
    same(r.d, { state: "bridge-missing" }, "denied permission but an HTTP answer: bridge missing")

    r = await diag(okRoutes, { permissions: { query: async () => { throw new TypeError("unsupported") } } })
    assert(r.d.state === "ok", "unsupported Permissions API does not block the check")
    r = await diag(okRoutes, { permissions: undefined })
    assert(r.d.state === "ok" || r.d.state === "unreachable", "missing permissions object does not throw")

    r = await diag({ ...okRoutes, "/booru_bridge/info": () => json({ version: "0.9.5", origins: [], middleware: "ok" }) })
    same(r.d, { state: "bridge-outdated", version: "0.9.5" }, "outdated bridge")
    // Order: outdated is reported before inactive.
    r = await diag({ ...okRoutes, "/booru_bridge/info": () => json({ version: "0.1.0", origins: [], middleware: "missing" }) })
    assert(r.d.state === "bridge-outdated", "outdated is checked before inactive")

    r = await diag({ ...okRoutes, "/booru_bridge/info": () => json({ version: "1.0.0", origins: [], middleware: "missing" }) })
    same(r.d, { state: "bridge-inactive", version: "1.0.0" }, "inactive bridge")

    // Blocked origin: normal fetch fails, the no-cors probe resolves opaque.
    const blocked: Record<string, Handler> = {
      "/system_stats": (_u, init) => {
        if (init?.mode === "no-cors") return { type: "opaque" }
        throw new TypeError("Failed to fetch")
      },
    }
    r = await diag(blocked)
    same(r.d, { state: "bridge-missing" }, "bridge missing: opaque probe")
    assert(r.calls.some((c) => c.init?.mode === "no-cors"), "the probe uses mode no-cors")
    r = await diag(blocked, { permissions: perm("prompt") })
    same(r.d, { state: "bridge-missing", localNetworkPrompt: true }, "bridge missing with pending permission")

    // Server up with CORS but no bridge: a 404 is enough, no probe needed.
    r = await diag({ "/booru_bridge/info": () => new Response("nope", { status: 404 }) })
    same(r.d, { state: "bridge-missing" }, "404 on the bridge endpoint means bridge missing")
    assert(!r.calls.some((c) => c.init?.mode === "no-cors"), "404 does not need the probe")

    // Nothing answers.
    r = await diag({})
    same(r.d, { state: "unreachable" }, "unreachable")
    r = await diag({}, { permissions: perm("prompt") })
    same(r.d, { state: "unreachable", localNetworkPrompt: true }, "unreachable with pending permission")

    // Timeouts count as unreachable.
    const hang: Handler = () => new Promise<Response>(() => undefined)
    const t0 = Date.now()
    r = await diag({ "/booru_bridge/info": hang, "/system_stats": hang }, { fetch: async (_u, init) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("a", "AbortError")))), timeoutMs: 20 })
    same(r.d, { state: "unreachable" }, "timeouts are unreachable")
    assert(Date.now() - t0 < 1000, "diagnose with timeouts finishes promptly")

    r = await diag(okRoutes, {}, "http://192.168.1.4:8188")
    same(r.d, { state: "invalid-url" }, "non-loopback URL is rejected before any request")
    assert(r.calls.length === 0, "invalid URL makes no request")
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
