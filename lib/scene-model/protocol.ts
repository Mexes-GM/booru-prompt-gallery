/**
 * Messages between the page and the scene model's worker (scene-model.worker.ts).
 */
import type { GeneratedScene, GenerateSceneInput } from './sampler'

/**
 * The model's base URL from NEXT_PUBLIC_SCENE_MODEL_URL, or null when it isn't set:
 * the files aren't part of the app, so without it there is no scene model at all.
 */
export function sceneModelBaseUrl(raw: string | undefined): string | null {
  const url = raw?.trim() ?? ''
  if (!url) return null
  return url.replace(/\/+$/, '') || '/'
}

/** "Invented scenes" is on only where there is a model: a saved setting alone doesn't turn it on. */
export function inventedScenesOn(setting: boolean | undefined, baseUrl: string | null): boolean {
  return baseUrl !== null && setting === true
}

/** Files the worker reads from the model's base URL. */
export const SCENE_MODEL_FILES = {
  model: 'scene_model_v2_int8_rowemb.onnx',
  vocab: 'vocab_web_v2.json',
  /** onnxruntime-web, loaded as a classic script; it fetches its .mjs and .wasm from the same folder. */
  runtime: 'ort/ort.wasm.min.js',
  runtimeDir: 'ort/',
} as const

export type SceneModelRequest =
  | { type: 'load'; baseUrl: string }
  | { type: 'generate'; id: number; scenes: GenerateSceneInput[] }
  | { type: 'cancel'; id: number }
  /** The raw logits of one input (to check the model against reference outputs). */
  | { type: 'logits'; id: number; tokens: number[] }

export type SceneModelLoadStep = 'runtime' | 'vocabulary' | 'model'

export type SceneModelResponse =
  | { type: 'progress'; step: SceneModelLoadStep; loaded: number; total: number | null }
  | { type: 'ready'; loadMs: number; bytes: number }
  /** The files aren't there (404): the feature is unavailable, nothing else is wrong. */
  | { type: 'unavailable'; reason: string }
  | { type: 'failed'; reason: string }
  | { type: 'scenes'; id: number; scenes: GeneratedScene[]; ms: number[] }
  | { type: 'logits'; id: number; logits: Float32Array }
  | { type: 'error'; id: number; reason: string }
