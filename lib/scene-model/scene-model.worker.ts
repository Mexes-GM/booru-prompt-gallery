/**
 * The scene model's worker: loads onnxruntime-web (WebAssembly, one thread) and
 * the model from the model's base URL as plain static files, then generates
 * scenes on request so the page never waits on the model.
 *
 * Runs as a classic worker: onnxruntime-web's UMD build is loaded with
 * importScripts and defines `ort`. One thread needs neither SharedArrayBuffer
 * nor cross-origin isolation.
 */
import { isBlockedTheme } from '../pack/scene/blocked'
import { generateScene, type GeneratedScene } from './sampler'
import { prepareSceneVocab, type SceneVocab } from './vocab'
import { SCENE_MODEL_FILES, type SceneModelLoadStep, type SceneModelRequest, type SceneModelResponse } from './protocol'

/** The part of onnxruntime-web this worker uses. */
interface OrtTensor { data: ArrayLike<number> }
interface OrtSession { run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>> }
interface Ort {
  env: { wasm: { numThreads: number; proxy: boolean; wasmPaths: string } }
  Tensor: new (type: 'int64', data: BigInt64Array, dims: number[]) => unknown
  InferenceSession: { create(model: Uint8Array, options: Record<string, unknown>): Promise<OrtSession> }
}
interface WorkerScope {
  ort?: Ort
  location: { href: string }
  importScripts(...urls: string[]): void
  postMessage(message: SceneModelResponse, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<SceneModelRequest>) => void) | null
}

const scope = self as unknown as WorkerScope

let loading: Promise<boolean> | null = null
let session: OrtSession | null = null
let vocab: SceneVocab | null = null
/** Tag ids no scene may have (the pack's block list). */
let blocked: number[] = []
/** The generate request that is current; an older one stops at its next scene. */
let currentRequest = 0
/** Model runs go one at a time. */
let queue: Promise<unknown> = Promise.resolve()

const post = (message: SceneModelResponse, transfer?: Transferable[]) => scope.postMessage(message, transfer)

class MissingFile extends Error {}

/** A file of the model, reading it in chunks so the page can show progress. */
async function download(url: string, step: SceneModelLoadStep): Promise<Uint8Array> {
  const res = await fetch(url)
  if (res.status === 404) throw new MissingFile(`${url}: HTTP 404`)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const encoded = res.headers.get('content-encoding')
  const length = Number(res.headers.get('content-length'))
  const total = !encoded && length > 0 ? length : null
  if (!res.body) return new Uint8Array(await res.arrayBuffer())
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  let lastReport = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    if (loaded - lastReport > 256 * 1024) {
      lastReport = loaded
      post({ type: 'progress', step, loaded, total })
    }
  }
  const out = new Uint8Array(loaded)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  post({ type: 'progress', step, loaded, total: total ?? loaded })
  return out
}

/** Bytes the browser fetched from the model's folder (what went over the network). */
function bytesFetched(base: string): number {
  try {
    return performance
      .getEntriesByType('resource')
      .filter((entry) => entry.name.startsWith(base))
      .reduce((sum, entry) => sum + ((entry as PerformanceResourceTiming).transferSize || 0), 0)
  } catch {
    return 0
  }
}

async function load(baseUrl: string): Promise<boolean> {
  const started = performance.now()
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, scope.location.href).href
  try {
    const vocabBytes = await download(base + SCENE_MODEL_FILES.vocab, 'vocabulary')
    vocab = prepareSceneVocab(JSON.parse(new TextDecoder().decode(vocabBytes)))
    blocked = vocab.names.flatMap((name, i) => (isBlockedTheme(name) ? [i] : []))

    post({ type: 'progress', step: 'runtime', loaded: 0, total: null })
    try {
      scope.importScripts(base + SCENE_MODEL_FILES.runtime)
    } catch (err) {
      throw new MissingFile(`${SCENE_MODEL_FILES.runtime}: ${String(err)}`)
    }
    const ort = scope.ort
    if (!ort) throw new Error('onnxruntime-web did not load')
    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false
    ort.env.wasm.wasmPaths = base + SCENE_MODEL_FILES.runtimeDir

    const model = await download(base + SCENE_MODEL_FILES.model, 'model')
    session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
    post({ type: 'ready', loadMs: Math.round(performance.now() - started), bytes: bytesFetched(base) })
    return true
  } catch (err) {
    session = null
    if (err instanceof MissingFile) post({ type: 'unavailable', reason: err.message })
    else post({ type: 'failed', reason: err instanceof Error ? err.message : String(err) })
    loading = null
    return false
  }
}

function logits(tokens: number[]): Promise<Float32Array> {
  const run = queue.then(async () => {
    const ort = scope.ort!
    const input = new ort.Tensor('int64', BigInt64Array.from(tokens.map((t) => BigInt(t))), [1, tokens.length])
    const out = await session!.run({ toks: input })
    return Float32Array.from(out.logits.data)
  })
  queue = run.catch(() => undefined)
  return run
}

async function generate(id: number, request: Extract<SceneModelRequest, { type: 'generate' }>): Promise<void> {
  const scenes: GeneratedScene[] = []
  const ms: number[] = []
  for (const input of request.scenes) {
    if (currentRequest !== id) return
    const started = performance.now()
    scenes.push(await generateScene(vocab!, logits, { ...input, exclude: [...(input.exclude ?? []), ...blocked] }))
    ms.push(Math.round((performance.now() - started) * 10) / 10)
  }
  if (currentRequest === id) post({ type: 'scenes', id, scenes, ms })
}

scope.onmessage = (event) => {
  const message = event.data
  switch (message.type) {
    case 'load':
      loading ??= load(message.baseUrl)
      break
    case 'cancel':
      if (currentRequest === message.id) currentRequest = 0
      break
    case 'generate':
      currentRequest = message.id
      void (loading ?? Promise.resolve(false)).then((ok) => {
        if (!ok || !session) {
          post({ type: 'error', id: message.id, reason: 'model not loaded' })
          return
        }
        return generate(message.id, message)
      }).catch((err) => post({ type: 'error', id: message.id, reason: String(err) }))
      break
    case 'logits':
      void (loading ?? Promise.resolve(false)).then(async (ok) => {
        if (!ok || !session) throw new Error('model not loaded')
        const out = await logits(message.tokens)
        post({ type: 'logits', id: message.id, logits: out }, [out.buffer])
      }).catch((err) => post({ type: 'error', id: message.id, reason: String(err) }))
      break
  }
}
