/** Shared types for the ComfyUI integration. */

/** A link to another node's output: [source node id, output index]. */
export type NodeRef = [string, number]

export type InputValue = string | number | boolean | null | NodeRef | unknown[] | Record<string, unknown>

export interface ApiNode {
  class_type: string
  inputs: Record<string, InputValue>
  _meta?: { title?: string; [key: string]: unknown }
}

/** ComfyUI "API format": node id -> node. Subgraph node ids look like "57:27". */
export type ApiWorkflow = Record<string, ApiNode>

/** The `/object_info` response, kept loose on purpose. */
export type ObjectInfo = Record<string, ObjectInfoEntry>
export interface ObjectInfoEntry {
  input?: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> }
  output_node?: boolean
  [key: string]: unknown
}

/** What the bridge node reports about itself. */
export interface BridgeInfo {
  version: string
  origins: string[]
  middleware: "ok" | "missing" | "already"
}
export interface BridgeWorkflowSummary {
  id: string
  name: string
  updated: number | string
}
export interface BridgeWorkflowRecord extends BridgeWorkflowSummary {
  ui: Record<string, unknown> | null
  api: Record<string, unknown>
}

export interface SystemStats {
  system?: { comfyui_version?: string; [key: string]: unknown }
  [key: string]: unknown
}

export interface QueueResponse {
  prompt_id: string
  number: number
  node_errors: Record<string, unknown>
}

export interface HistoryImage {
  filename: string
  subfolder: string
  type: string
}
export interface HistoryEntry {
  outputs?: Record<string, { images?: HistoryImage[]; [key: string]: unknown }>
  status?: { status_str?: string; completed?: boolean; [key: string]: unknown }
  [key: string]: unknown
}

/** Points at one literal input of one node. */
export interface InputRef {
  nodeId: string
  input: string
}

export interface Roles {
  prompt: InputRef | null
  seed: InputRef | null
  width: InputRef | null
  height: InputRef | null
  /** Id of the node whose images are shown as the result. */
  output: string | null
}

export interface RoleCandidates {
  prompt: InputRef[]
  seed: InputRef[]
  size: { width: InputRef; height: InputRef }[]
  output: string[]
}

export type Diagnosis =
  | { state: "unsupported-browser" }
  | { state: "invalid-url" }
  | { state: "local-network-denied" }
  | { state: "bridge-outdated"; version: string }
  | { state: "bridge-inactive"; version: string }
  | { state: "ok"; comfyVersion: string | null; bridgeVersion: string }
  /** The server is up but blocks our origin. */
  | { state: "bridge-missing"; localNetworkPrompt?: true }
  | { state: "unreachable"; localNetworkPrompt?: true }

export type ComfyErrorKind = "network" | "http" | "timeout" | "validation"

export class ComfyError extends Error {
  readonly kind: ComfyErrorKind
  readonly status?: number
  /** Per-node validation errors reported by the server, when present. */
  readonly nodeErrors?: Record<string, unknown>

  constructor(
    kind: ComfyErrorKind,
    message: string,
    extra: { status?: number; nodeErrors?: Record<string, unknown> } = {},
  ) {
    super(message)
    this.name = "ComfyError"
    this.kind = kind
    this.status = extra.status
    this.nodeErrors = extra.nodeErrors
  }
}

export type SavedComfyWorkflowSource = "png" | "api-json" | "bridge"

/** A workflow the user saved for "Send to ComfyUI", with the roles chosen for it. */
export interface SavedComfyWorkflow {
  id: string
  name: string
  source: SavedComfyWorkflowSource
  /** Id of the workflow inside the bridge node, when it was imported from there. */
  bridgeId?: string
  api: ApiWorkflow
  /** The editor (UI) format, when known. */
  ui: object | null
  roles: Roles
  savedAt: number
}

/** Behaviour switches for sending. */
export interface ComfyOptions {
  randomSeed: boolean
  matchPostResolution: boolean
  livePreview: boolean
}
