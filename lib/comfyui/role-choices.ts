/**
 * What the ComfyUI panel and viewer offer for each role: which inputs can take
 * it, how to name them, and small checks on saved roles. Pure helpers.
 */
import type { ApiWorkflow, InputRef, RoleCandidates, Roles } from "./types"

export type RoleKey = "prompt" | "seed" | "size" | "output"

export interface InputChoice {
  ref: InputRef
  suggested: boolean
}

export interface SizeChoice {
  width: InputRef
  height: InputRef
  suggested: boolean
}

export interface OutputChoice {
  nodeId: string
  suggested: boolean
}

const SEED_INPUT = /seed/i

function isLink(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number"
}

export function sameRef(a: InputRef | null | undefined, b: InputRef | null | undefined): boolean {
  return !!a && !!b && a.nodeId === b.nodeId && a.input === b.input
}

export function refKey(ref: InputRef): string {
  return `${ref.nodeId}\u0000${ref.input}`
}

/** "Positive prompt" or "CLIPTextEncode", as ComfyUI titles the node. */
export function nodeTitle(api: ApiWorkflow, nodeId: string): string {
  const node = api[nodeId]
  if (!node) return `Node ${nodeId}`
  const title = node._meta?.title
  return typeof title === "string" && title.trim() ? title.trim() : node.class_type
}

/** Text inputs that hold a typed value. Suggested ones come first. */
export function promptChoices(api: ApiWorkflow, candidates: RoleCandidates): InputChoice[] {
  const out: InputChoice[] = candidates.prompt
    .filter((ref) => typeof api[ref.nodeId]?.inputs[ref.input] === "string")
    .map((ref) => ({ ref, suggested: true }))
  for (const [nodeId, node] of Object.entries(api)) {
    for (const [input, value] of Object.entries(node.inputs ?? {})) {
      if (typeof value !== "string") continue
      const ref = { nodeId, input }
      if (!out.some((c) => sameRef(c.ref, ref))) out.push({ ref, suggested: false })
    }
  }
  return out
}

/** Number inputs named like a seed. Suggested ones come first. */
export function seedChoices(api: ApiWorkflow, candidates: RoleCandidates): InputChoice[] {
  const out: InputChoice[] = candidates.seed
    .filter((ref) => typeof api[ref.nodeId]?.inputs[ref.input] === "number")
    .map((ref) => ({ ref, suggested: true }))
  for (const [nodeId, node] of Object.entries(api)) {
    for (const [input, value] of Object.entries(node.inputs ?? {})) {
      if (typeof value !== "number" || !SEED_INPUT.test(input)) continue
      const ref = { nodeId, input }
      if (!out.some((c) => sameRef(c.ref, ref))) out.push({ ref, suggested: false })
    }
  }
  return out
}

/** Nodes with typed width and height. The one the detection picked is suggested. */
export function sizeChoices(api: ApiWorkflow, candidates: RoleCandidates, detected: Roles): SizeChoice[] {
  return candidates.size
    .filter((c) => typeof api[c.width.nodeId]?.inputs.width === "number" && typeof api[c.height.nodeId]?.inputs.height === "number")
    .map((c) => ({ ...c, suggested: sameRef(c.width, detected.width) }))
}

export function outputChoices(candidates: RoleCandidates, detected: Roles): OutputChoice[] {
  return candidates.output.map((nodeId) => ({ nodeId, suggested: nodeId === detected.output }))
}

/** True when every role still points at a typed value (or a node, for the output) in this workflow. */
export function rolesFit(api: ApiWorkflow, roles: Roles): boolean {
  const literal = (ref: InputRef | null) => {
    if (!ref) return true
    const node = api[ref.nodeId]
    return !!node && ref.input in node.inputs && !isLink(node.inputs[ref.input])
  }
  return (
    literal(roles.prompt) &&
    literal(roles.seed) &&
    literal(roles.width) &&
    literal(roles.height) &&
    (roles.output === null || roles.output in api)
  )
}

/**
 * A small size for the panel's test run: the workflow's own aspect ratio with
 * the long side at `longSide`, both sides a multiple of 8. Null without size roles.
 */
export function testSize(api: ApiWorkflow, roles: Roles, longSide = 512): { width: number; height: number } | null {
  if (!roles.width || !roles.height) return null
  const w = Number(api[roles.width.nodeId]?.inputs[roles.width.input])
  const h = Number(api[roles.height.nodeId]?.inputs[roles.height.input])
  if (!(w > 0) || !(h > 0)) return { width: longSide, height: longSide }
  const scale = longSide / Math.max(w, h)
  const snap = (v: number) => Math.max(64, Math.round((v * scale) / 8) * 8)
  return { width: snap(w), height: snap(h) }
}

/** Short text of a typed value, for lists and the graph. */
export function previewValue(value: unknown, max = 48): string {
  if (typeof value === "string") {
    const flat = value.replace(/\s+/g, " ").trim()
    if (!flat) return "(empty)"
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value === null || value === undefined) return "none"
  return "…"
}
