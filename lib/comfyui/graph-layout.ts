/**
 * Turns an API-format workflow (plus the editor format, when known) into
 * positioned boxes and links for the read-only workflow viewer. Pure: no
 * React, no DOM, so it can be tested on its own.
 *
 * - With the editor format, top-level nodes keep their ComfyUI positions.
 *   API ids like "57:27" belong to subgraph 57: they are drawn inside a box for
 *   that subgraph, at the positions the subgraph definition gives them.
 * - Without it (an "Export (API)" file), nodes are laid out left to right in
 *   layers that follow the links.
 * Our boxes are not the size ComfyUI draws, so overlapping top-level boxes are
 * pushed apart afterwards.
 */
import type { ApiWorkflow, InputValue, NodeRef } from "./types"

export const NODE_WIDTH = 240
export const NODE_HEADER = 34
export const NODE_ROW = 26
export const NODE_PADDING = 8
const GROUP_PADDING = 24
const GROUP_HEADER = 36
const GAP_X = 72
const GAP_Y = 28

export interface GraphInput {
  name: string
  /** A link from another node, or a value typed into the node. */
  kind: "link" | "literal"
  /** For literals: the value. */
  value?: InputValue
}

export interface GraphNode {
  id: string
  /** The title ComfyUI shows, or the node type. */
  title: string
  classType: string
  x: number
  y: number
  width: number
  height: number
  /** Id of the subgraph box this node sits in (positions are then relative to it). */
  parent?: string
  /** True for a subgraph box (it has no inputs of its own). */
  group?: boolean
  inputs: GraphInput[]
  /** Output indexes that other nodes use. */
  outputs: number[]
}

export interface GraphEdge {
  id: string
  source: string
  sourceOutput: number
  target: string
  targetInput: string
}

export interface WorkflowGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

interface UiNodeLike {
  id: number | string
  type?: string
  title?: string
  pos?: [number, number] | { 0: number; 1: number }
  size?: [number, number] | { 0: number; 1: number }
}
interface SubgraphLike {
  id: string
  name?: string
  nodes?: UiNodeLike[]
}

function isLink(value: unknown): value is NodeRef {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number"
}

function asPoint(value: unknown): [number, number] | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string | number, unknown>
  const x = Number(v[0])
  const y = Number(v[1])
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
}

/** Same order ComfyUI ids sort in: numeric per segment. */
export function compareNodeIds(a: string, b: string): number {
  const pa = a.split(":")
  const pb = b.split(":")
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1
    if (pb[i] === undefined) return 1
    const nx = Number(pa[i])
    const ny = Number(pb[i])
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx - ny
    } else if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

export function nodeHeight(inputCount: number): number {
  return NODE_HEADER + Math.max(inputCount, 1) * NODE_ROW + NODE_PADDING
}

function baseNode(api: ApiWorkflow, id: string): GraphNode {
  const node = api[id]
  const inputs: GraphInput[] = Object.entries(node.inputs ?? {}).map(([name, value]) =>
    isLink(value) ? { name, kind: "link" } : { name, kind: "literal", value },
  )
  return {
    id,
    title: (typeof node._meta?.title === "string" && node._meta.title) || node.class_type,
    classType: node.class_type,
    x: 0,
    y: 0,
    width: NODE_WIDTH,
    height: nodeHeight(inputs.length),
    inputs,
    outputs: [],
  }
}

/** Longest-path layers from the sources, then stacked columns. Positions start at (0, 0). */
function layered(nodes: GraphNode[], edges: GraphEdge[]): void {
  const ids = new Set(nodes.map((n) => n.id))
  const sources = new Map<string, string[]>()
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue
    const list = sources.get(e.target) ?? []
    list.push(e.source)
    sources.set(e.target, list)
  }
  const rank = new Map<string, number>()
  const visiting = new Set<string>()
  const rankOf = (id: string): number => {
    const known = rank.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0 // a cycle: should not happen in ComfyUI graphs
    visiting.add(id)
    const r = Math.max(-1, ...(sources.get(id) ?? []).map(rankOf)) + 1
    visiting.delete(id)
    rank.set(id, r)
    return r
  }
  const columns: GraphNode[][] = []
  for (const n of nodes) (columns[rankOf(n.id)] ??= []).push(n)

  const order = new Map<string, number>()
  let x = 0
  for (const column of columns) {
    if (!column) continue
    // Barycenter of the nodes feeding each node keeps links mostly straight.
    const weight = (n: GraphNode) => {
      const from = (sources.get(n.id) ?? []).map((s) => order.get(s)).filter((v): v is number => v !== undefined)
      return from.length ? from.reduce((a, b) => a + b, 0) / from.length : Number.MAX_SAFE_INTEGER
    }
    column.sort((a, b) => weight(a) - weight(b) || compareNodeIds(a.id, b.id))
    let y = 0
    column.forEach((n, i) => {
      order.set(n.id, i)
      n.x = x
      n.y = y
      y += n.height + GAP_Y
    })
    x += NODE_WIDTH + GAP_X
  }
}

/** Pushes overlapping boxes to the right, keeping their vertical position. */
function separate(boxes: GraphNode[]): void {
  const placed: GraphNode[] = []
  for (const box of [...boxes].sort((a, b) => a.x - b.x || a.y - b.y)) {
    let moved = true
    while (moved) {
      moved = false
      for (const other of placed) {
        const overlaps =
          box.x < other.x + other.width + GAP_Y &&
          box.x + box.width + GAP_Y > other.x &&
          box.y < other.y + other.height + GAP_Y &&
          box.y + box.height + GAP_Y > other.y
        if (overlaps) {
          box.x = other.x + other.width + GAP_Y
          moved = true
        }
      }
    }
    placed.push(box)
  }
}

function edgesOf(api: ApiWorkflow): GraphEdge[] {
  const edges: GraphEdge[] = []
  for (const [target, node] of Object.entries(api)) {
    for (const [input, value] of Object.entries(node.inputs ?? {})) {
      if (isLink(value) && api[value[0]]) {
        edges.push({ id: `${value[0]}:${value[1]}->${target}.${input}`, source: value[0], sourceOutput: value[1], target, targetInput: input })
      }
    }
  }
  return edges
}

export function buildWorkflowGraph(api: ApiWorkflow, ui?: object | null): WorkflowGraph {
  const ids = Object.keys(api).sort(compareNodeIds)
  const edges = edgesOf(api)
  const nodes = new Map(ids.map((id) => [id, baseNode(api, id)]))
  for (const e of edges) {
    const source = nodes.get(e.source)
    if (source && !source.outputs.includes(e.sourceOutput)) source.outputs.push(e.sourceOutput)
  }
  for (const n of nodes.values()) n.outputs.sort((a, b) => a - b)

  const uiNodes = Array.isArray((ui as { nodes?: unknown })?.nodes) ? ((ui as { nodes: UiNodeLike[] }).nodes) : null
  if (!uiNodes) {
    const list = [...nodes.values()]
    layered(list, edges)
    return { nodes: list, edges }
  }

  const uiById = new Map(uiNodes.map((n) => [String(n.id), n]))
  const subgraphs = new Map<string, SubgraphLike>()
  const defs = (ui as { definitions?: { subgraphs?: SubgraphLike[] } }).definitions?.subgraphs
  if (Array.isArray(defs)) for (const def of defs) if (def && typeof def.id === "string") subgraphs.set(def.id, def)

  const topLevel: GraphNode[] = []
  const unplaced: GraphNode[] = []
  const children = new Map<string, GraphNode[]>()
  for (const id of ids) {
    const node = nodes.get(id) as GraphNode
    const colon = id.indexOf(":")
    if (colon > 0) {
      const parent = id.slice(0, colon)
      const list = children.get(parent) ?? []
      list.push(node)
      children.set(parent, list)
      continue
    }
    const pos = asPoint(uiById.get(id)?.pos)
    if (pos) {
      node.x = pos[0]
      node.y = pos[1]
      topLevel.push(node)
    } else unplaced.push(node)
  }

  const groups: GraphNode[] = []
  for (const [parentId, kids] of children) {
    const uiNode = uiById.get(parentId)
    const def = uiNode?.type ? subgraphs.get(uiNode.type) : undefined
    const defById = new Map((def?.nodes ?? []).map((n) => [String(n.id), n]))
    // Direct children use the definition's positions; deeper levels (or a
    // missing definition) fall back to the layered layout.
    const positions = kids.map((k) => {
      const rest = k.id.slice(parentId.length + 1)
      return rest.includes(":") ? null : asPoint(defById.get(rest)?.pos)
    })
    if (positions.every((p) => p !== null)) {
      kids.forEach((k, i) => {
        const p = positions[i] as [number, number]
        k.x = p[0]
        k.y = p[1]
      })
      separate(kids)
    } else {
      layered(kids, edges)
    }
    const minX = Math.min(...kids.map((k) => k.x))
    const minY = Math.min(...kids.map((k) => k.y))
    let right = 0
    let bottom = 0
    for (const k of kids) {
      k.x = k.x - minX + GROUP_PADDING
      k.y = k.y - minY + GROUP_HEADER + GROUP_PADDING / 2
      k.parent = parentId
      right = Math.max(right, k.x + k.width)
      bottom = Math.max(bottom, k.y + k.height)
    }
    const pos = asPoint(uiNode?.pos)
    const group: GraphNode = {
      id: parentId,
      title: (typeof uiNode?.title === "string" && uiNode.title) || def?.name || `Subgraph ${parentId}`,
      classType: "subgraph",
      x: pos?.[0] ?? 0,
      y: pos?.[1] ?? 0,
      width: right + GROUP_PADDING,
      height: bottom + GROUP_PADDING,
      group: true,
      inputs: [],
      outputs: [],
    }
    groups.push(group)
    if (pos) topLevel.push(group)
    else unplaced.push(group)
  }

  separate(topLevel)
  if (unplaced.length) {
    // Anything ComfyUI did not place goes in a column right of the rest.
    const x = topLevel.length ? Math.max(...topLevel.map((n) => n.x + n.width)) + GAP_X : 0
    let y = topLevel.length ? Math.min(...topLevel.map((n) => n.y)) : 0
    for (const n of unplaced) {
      n.x = x
      n.y = y
      y += n.height + GAP_Y
    }
  }

  // Parents must come before their children for the viewer.
  const ordered = [...groups, ...ids.map((id) => nodes.get(id) as GraphNode)]
  return { nodes: ordered, edges }
}
