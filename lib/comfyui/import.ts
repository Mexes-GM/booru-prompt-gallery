/**
 * Turns a dropped file or a bridge record into an API-format workflow.
 *
 * UI-format workflows are never converted here: the conversion is ComfyUI
 * frontend logic that changes between versions, so we report `ui-format` and
 * let the user export an API-format file or publish it from ComfyUI.
 *
 * PNG metadata: ComfyUI writes the `prompt` (API) and `workflow` (UI) JSON as
 * tEXt chunks (Latin-1) and, in some tools, as iTXt chunks (UTF-8). Compressed
 * iTXt chunks are inflated with `DecompressionStream` when the runtime has it
 * (browsers and Node 18+); otherwise that chunk is ignored. CRCs are not
 * verified: the data is parsed leniently and only used as JSON.
 */
import type { ApiWorkflow, BridgeWorkflowRecord, ObjectInfo } from "./types"

export type ImportError = "ui-format" | "no-workflow" | "invalid-json" | "unsupported-file"

export interface ImportedWorkflow {
  name: string
  api: ApiWorkflow
  ui: Record<string, unknown> | null
  source: "png" | "api-json" | "bridge"
}

export type ImportResult = { ok: true; workflow: ImportedWorkflow } | { ok: false; error: ImportError }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** API format: a non-empty object whose values all carry a string `class_type`. */
export function isApiFormat(value: unknown): value is ApiWorkflow {
  if (!isPlainObject(value)) return false
  const nodes = Object.values(value)
  return (
    nodes.length > 0 &&
    nodes.every((node) => isPlainObject(node) && typeof node.class_type === "string" && isPlainObject(node.inputs ?? {}))
  )
}

/** UI format: the saved-graph shape with a `nodes` array. */
export function isUiFormat(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && Array.isArray(value.nodes)
}

function baseName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/).pop() ?? fileName
  return leaf.replace(/\.[^.]*$/, "") || leaf
}

function latin1(bytes: Uint8Array): string {
  let out = ""
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

/** Reads tEXt/iTXt chunks into a keyword -> text map (first occurrence wins). */
async function readPngText(bytes: Uint8Array): Promise<Map<string, string> | null> {
  if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const utf8 = new TextDecoder("utf-8")
  const texts = new Map<string, string>()
  let pos = 8
  while (pos + 12 <= bytes.length) {
    const length = view.getUint32(pos)
    const type = latin1(bytes.subarray(pos + 4, pos + 8))
    const start = pos + 8
    const end = start + length
    if (end + 4 > bytes.length) break // truncated file
    const data = bytes.subarray(start, end)
    if (type === "tEXt") {
      const sep = data.indexOf(0)
      if (sep > 0) {
        const key = latin1(data.subarray(0, sep))
        if (!texts.has(key)) texts.set(key, latin1(data.subarray(sep + 1)))
      }
    } else if (type === "iTXt") {
      const sep = data.indexOf(0)
      if (sep > 0 && sep + 2 < data.length) {
        const key = latin1(data.subarray(0, sep))
        const compressed = data[sep + 1] === 1
        // Skip language tag and translated keyword, each NUL-terminated.
        const langEnd = data.indexOf(0, sep + 3)
        const transEnd = langEnd < 0 ? -1 : data.indexOf(0, langEnd + 1)
        if (transEnd >= 0 && !texts.has(key)) {
          let body: Uint8Array | null = data.subarray(transEnd + 1)
          if (compressed) body = await inflate(body)
          if (body) texts.set(key, utf8.decode(body))
        }
      }
    }
    if (type === "IEND") break
    pos = end + 4
  }
  return texts
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

async function importPng(name: string, bytes: Uint8Array): Promise<ImportResult> {
  const texts = await readPngText(bytes)
  if (!texts) return { ok: false, error: "unsupported-file" }
  const promptText = texts.get("prompt")
  const workflowText = texts.get("workflow")
  if (promptText === undefined) {
    return { ok: false, error: workflowText === undefined ? "no-workflow" : "ui-format" }
  }
  const prompt = parseJson(promptText)
  if (!prompt.ok || !isApiFormat(prompt.value)) return { ok: false, error: "invalid-json" }
  let ui: Record<string, unknown> | null = null
  if (workflowText !== undefined) {
    const parsed = parseJson(workflowText)
    if (parsed.ok && isUiFormat(parsed.value)) ui = parsed.value
  }
  return { ok: true, workflow: { name: baseName(name), api: prompt.value, ui, source: "png" } }
}

function importJson(name: string, bytes: Uint8Array): ImportResult {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "")
  } catch {
    return { ok: false, error: "invalid-json" }
  }
  const parsed = parseJson(text)
  if (!parsed.ok) return { ok: false, error: "invalid-json" }
  if (isApiFormat(parsed.value)) {
    return { ok: true, workflow: { name: baseName(name), api: parsed.value, ui: null, source: "api-json" } }
  }
  if (isUiFormat(parsed.value)) return { ok: false, error: "ui-format" }
  return { ok: false, error: "no-workflow" }
}

export async function importWorkflowFile(file: { name: string; bytes: Uint8Array }): Promise<ImportResult> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith(".png")) return importPng(file.name, file.bytes)
  if (lower.endsWith(".json")) return importJson(file.name, file.bytes)
  return { ok: false, error: "unsupported-file" }
}

export function importBridgeRecord(record: Pick<BridgeWorkflowRecord, "name" | "ui" | "api">): ImportResult {
  if (!isPlainObject(record) || !isApiFormat(record.api)) return { ok: false, error: "no-workflow" }
  return {
    ok: true,
    workflow: {
      name: typeof record.name === "string" && record.name ? record.name : "Workflow",
      api: record.api,
      ui: isUiFormat(record.ui) ? record.ui : null,
      source: "bridge",
    },
  }
}

/** Class types used by the workflow that the connected ComfyUI does not know. */
export function checkNodesAgainstObjectInfo(api: ApiWorkflow, objectInfo: ObjectInfo): string[] {
  const missing = new Set<string>()
  for (const node of Object.values(api)) {
    if (!(node.class_type in objectInfo)) missing.add(node.class_type)
  }
  return [...missing]
}
