/**
 * Tests for lib/comfyui/graph-layout.ts with the real bridge records
 * (editor + API format) and a hand-written API graph.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/comfyui-graph-layout.verify.ts
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildWorkflowGraph, type GraphNode } from "../lib/comfyui/graph-layout"
import type { ApiWorkflow } from "../lib/comfyui/types"

let passed = 0
let failed = 0
function assert(condition: boolean, label: string) {
  if (condition) passed++
  else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

const FIXTURES = join(__dirname, "fixtures", "comfyui")
const record = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as { ui: object; api: ApiWorkflow }

function overlap(a: GraphNode, b: GraphNode): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function checkNoOverlap(nodes: GraphNode[], label: string) {
  const byParent = new Map<string, GraphNode[]>()
  for (const n of nodes) {
    const key = n.parent ?? ""
    byParent.set(key, [...(byParent.get(key) ?? []), n])
  }
  let ok = true
  for (const list of byParent.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (overlap(list[i], list[j])) ok = false
  }
  assert(ok, `${label}: boxes at the same level do not overlap`)
}

// ── Subgraphs: z-image (API ids "57:x" inside subgraph 57) ──
{
  const { ui, api } = record("bridge-image-z-image-turbo-f8c31de2.json")
  const graph = buildWorkflowGraph(api, ui)
  const group = graph.nodes.find((n) => n.id === "57")
  assert(!!group?.group, "z-image: subgraph 57 becomes a box")
  const kids = graph.nodes.filter((n) => n.parent === "57")
  assert(kids.length === Object.keys(api).filter((id) => id.startsWith("57:")).length, "z-image: every 57:x node sits in the box")
  assert(kids.every((k) => k.x >= 0 && k.y >= 0 && k.x + k.width <= (group?.width ?? 0) && k.y + k.height <= (group?.height ?? 0)), "z-image: children fit inside the box")
  assert(graph.nodes.indexOf(group as GraphNode) < graph.nodes.indexOf(kids[0]), "z-image: the box comes before its children")
  assert(!graph.nodes.some((n) => n.classType === "MarkdownNote"), "z-image: editor-only notes are not drawn")
  const save = graph.nodes.find((n) => n.id === "9")
  assert(!!save && save.parent === undefined && save.inputs.some((i) => i.name === "images" && i.kind === "link"), "z-image: SaveImage is top level with a linked input")
  assert(graph.edges.some((e) => e.target === "9" && e.targetInput === "images"), "z-image: the link into SaveImage is an edge")
  checkNoOverlap(graph.nodes, "z-image")
}

// ── Every bridge fixture lays out without overlaps and keeps all API nodes ──
for (const name of [
  "bridge-image-krea2-turbo-t2i-7b32be7a.json",
  "bridge-image-qwen-image-2-1-t2i-1fbfd730.json",
  "bridge-api-nano-banana-2-1-t2i-8bd7ab1e.json",
]) {
  const { ui, api } = record(name)
  const graph = buildWorkflowGraph(api, ui)
  const drawn = new Set(graph.nodes.filter((n) => !n.group).map((n) => n.id))
  assert(Object.keys(api).every((id) => drawn.has(id)), `${name}: every API node is drawn`)
  checkNoOverlap(graph.nodes, name)
}

// ── API only: layered left to right ──
{
  const api = JSON.parse(readFileSync(join(FIXTURES, "api-sdxl-lora-txt2img.json"), "utf8")) as ApiWorkflow
  const graph = buildWorkflowGraph(api, null)
  const at = (id: string) => graph.nodes.find((n) => n.id === id) as GraphNode
  let leftToRight = true
  for (const e of graph.edges) if (at(e.source).x >= at(e.target).x) leftToRight = false
  assert(leftToRight, "api only: every link goes left to right")
  assert(graph.nodes.every((n) => n.parent === undefined && !n.group), "api only: no boxes")
  checkNoOverlap(graph.nodes, "api only")
  const outputs = graph.nodes.flatMap((n) => n.outputs.map((o) => `${n.id}:${o}`))
  assert(new Set(outputs).size === outputs.length && outputs.length > 0, "api only: used outputs are listed once")
}

// ── Edges to nodes that are missing are dropped ──
{
  const api: ApiWorkflow = { "1": { class_type: "SaveImage", inputs: { images: ["99", 0] } } }
  const graph = buildWorkflowGraph(api, null)
  assert(graph.edges.length === 0, "a link to a missing node draws no edge")
  assert(graph.nodes[0].inputs[0].kind === "link", "the input still shows as linked")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
