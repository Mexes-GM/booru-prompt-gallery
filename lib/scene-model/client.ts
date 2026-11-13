/**
 * The page's side of the scene model: one worker per page, created the first
 * time something asks for the model (nothing is downloaded before that).
 *
 * The files live under NEXT_PUBLIC_SCENE_MODEL_URL (default /scene-model):
 * see SCENE_MODEL_FILES. When they aren't there the model reports itself
 * unavailable and every request resolves empty.
 */
import type { GeneratedScene, GenerateSceneInput } from './sampler'
import type { SceneModelLoadStep, SceneModelRequest, SceneModelResponse } from './protocol'

export const SCENE_MODEL_BASE_URL = (process.env.NEXT_PUBLIC_SCENE_MODEL_URL || '/scene-model').replace(/\/+$/, '')

export type SceneModelState =
  | { status: 'idle' }
  | { status: 'loading'; step: SceneModelLoadStep; loaded: number; total: number | null }
  | { status: 'ready'; loadMs: number; bytes: number }
  | { status: 'unavailable' }
  | { status: 'failed'; reason: string }

export interface SceneBatch {
  scenes: GeneratedScene[]
  /** Milliseconds per scene. */
  ms: number[]
}

type Listener = (state: SceneModelState) => void

let worker: Worker | null = null
let state: SceneModelState = { status: 'idle' }
const listeners = new Set<Listener>()
let nextId = 1
/** The generate request still wanted (only the latest one is). */
let lastGenerate = 0
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>()

function setState(next: SceneModelState) {
  state = next
  listeners.forEach((listener) => listener(state))
}

function onMessage(event: MessageEvent<SceneModelResponse>) {
  const message = event.data
  switch (message.type) {
    case 'progress':
      setState({ status: 'loading', step: message.step, loaded: message.loaded, total: message.total })
      break
    case 'ready':
      setState({ status: 'ready', loadMs: message.loadMs, bytes: message.bytes })
      break
    case 'unavailable':
      console.info('Scene model unavailable:', message.reason)
      setState({ status: 'unavailable' })
      break
    case 'failed':
      console.warn('Scene model failed to load:', message.reason)
      setState({ status: 'failed', reason: message.reason })
      break
    case 'scenes':
      pending.get(message.id)?.resolve({ scenes: message.scenes, ms: message.ms })
      pending.delete(message.id)
      break
    case 'logits':
      pending.get(message.id)?.resolve(message.logits)
      pending.delete(message.id)
      break
    case 'error':
      pending.get(message.id)?.reject(new Error(message.reason))
      pending.delete(message.id)
      break
  }
}

const send = (message: SceneModelRequest) => worker?.postMessage(message)

/** Starts loading the model (once per page; again after a failure). */
export function loadSceneModel(): void {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    setState({ status: 'unavailable' })
    return
  }
  if (state.status === 'loading' || state.status === 'ready' || state.status === 'unavailable') return
  if (!worker) {
    worker = new Worker(new URL('./scene-model.worker.ts', import.meta.url), { name: 'scene-model' })
    worker.onmessage = onMessage
    worker.onerror = (event) => {
      console.warn('Scene model worker error:', event.message)
      setState({ status: 'failed', reason: event.message || 'worker error' })
    }
  }
  setState({ status: 'loading', step: 'vocabulary', loaded: 0, total: null })
  send({ type: 'load', baseUrl: new URL(SCENE_MODEL_BASE_URL, window.location.href).href })
}

export const sceneModelState = (): SceneModelState => state

export function subscribeSceneModel(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function request<T>(message: SceneModelRequest & { id: number }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.set(message.id, { resolve: resolve as (value: unknown) => void, reject })
    send(message)
  })
}

/**
 * Generates `scenes` in the worker. A newer call supersedes this one: the
 * older promise then never resolves its scenes (it rejects as cancelled).
 */
export function generateScenes(scenes: GenerateSceneInput[]): Promise<SceneBatch> {
  if (state.status !== 'ready') return Promise.reject(new Error('scene model not ready'))
  const id = nextId++
  // Only the latest batch is wanted: the older one is dropped.
  const older = pending.get(lastGenerate)
  if (older) {
    older.reject(new Error('cancelled'))
    pending.delete(lastGenerate)
  }
  lastGenerate = id
  return request<SceneBatch>({ type: 'generate', id, scenes })
}

/** The model's raw logits for `tokens` (V + 1 values): to check the model against reference outputs. */
export function sceneModelLogits(tokens: number[]): Promise<Float32Array> {
  if (state.status !== 'ready') return Promise.reject(new Error('scene model not ready'))
  const id = nextId++
  return request<Float32Array>({ type: 'logits', id, tokens })
}

// Development only: lets the model be checked from the console against reference outputs.
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__sceneModel = {
    load: loadSceneModel,
    state: sceneModelState,
    logits: sceneModelLogits,
    generate: generateScenes,
  }
}
