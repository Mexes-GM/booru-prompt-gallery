/**
 * Guesses which inputs of an API-format workflow play which role (prompt,
 * seed, size, output) and writes values into those inputs.
 *
 * Detection walks the links backwards from the sampler, so it works through
 * LoRA loaders, conditioning wrappers, switches and string helpers. The
 * negative prompt is never read or written.
 */
import type {
  ApiNode,
  ApiWorkflow,
  InputRef,
  NodeRef,
  ObjectInfo,
  RoleCandidates,
  Roles,
} from "./types"

export interface Detection {
  roles: Roles
  candidates: RoleCandidates
}

export interface RoleValues {
  prompt?: string
  seed?: number
  width?: number
  height?: number
}

function isLink(value: unknown): value is NodeRef {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number"
}

/** Orders ids numerically per segment, so "9" < "30:6" < "30:28" < "49". */
function compareIds(a: string, b: string): number {
  const pa = a.split(":")
  const pb = b.split(":")
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = Number(x)
    const ny = Number(y)
    if (Number.isFinite(nx) && Number.isFinite(ny) && nx !== ny) return nx - ny
    if (!(Number.isFinite(nx) && Number.isFinite(ny)) && x !== y) return x < y ? -1 : 1
  }
  return 0
}

function sortedIds(api: ApiWorkflow): string[] {
  return Object.keys(api).sort(compareIds)
}

function linkInputs(node: ApiNode): [string, NodeRef][] {
  return Object.entries(node.inputs).filter((entry): entry is [string, NodeRef] => isLink(entry[1]))
}

function pushUnique<T extends InputRef>(list: T[], ref: T) {
  if (!list.some((r) => r.nodeId === ref.nodeId && r.input === ref.input)) list.push(ref)
}

// --- Samplers -------------------------------------------------------------

/** KSampler, KSamplerAdvanced, SamplerCustom and SamplerCustomAdvanced all take a latent plus conditioning or a guider. */
function isSampler(node: ApiNode): boolean {
  const i = node.inputs
  if (!isLink(i.latent_image)) return false
  return isLink(i.positive) || isLink(i.guider) || "seed" in i || "noise_seed" in i || isLink(i.noise)
}

function isEmptyLatent(node: ApiNode): boolean {
  if (/Empty.*Latent/i.test(node.class_type)) return true
  const i = node.inputs
  const hasLatentLink = linkInputs(node).some(([name]) => /latent|samples/i.test(name))
  return !hasLatentLink && typeof i.width === "number" && typeof i.height === "number"
}

/**
 * Follows only latent-like links from a sampler's `latent_image`. Returns the
 * empty-latent node it starts from, or null when another sampler (hires fix)
 * or an image encode comes first.
 */
function emptyLatentBehind(api: ApiWorkflow, samplerId: string): string | null {
  const start = api[samplerId].inputs.latent_image
  if (!isLink(start)) return null
  const seen = new Set<string>()
  const queue = [start[0]]
  while (queue.length) {
    const id = queue.shift() as string
    if (seen.has(id) || !api[id]) continue
    seen.add(id)
    const node = api[id]
    if (isSampler(node)) continue
    if (isEmptyLatent(node)) return id
    for (const [name, link] of linkInputs(node)) {
      if (/latent|samples/i.test(name)) queue.push(link[0])
    }
  }
  return null
}

// --- Literals behind links --------------------------------------------------

function literalBehind(
  api: ApiWorkflow,
  value: unknown,
  names: string[],
  type: "number" | "string",
  depth = 0,
): InputRef | null {
  if (!isLink(value) || depth > 8) return null
  const source = api[value[0]]
  if (!source) return null
  for (const name of [...names, "value"]) {
    if (typeof source.inputs[name] === type) return { nodeId: value[0], input: name }
  }
  for (const name of names) {
    const next = source.inputs[name]
    if (isLink(next)) return literalBehind(api, next, names, type, depth + 1)
  }
  return null
}

function seedRef(api: ApiWorkflow, samplerId: string): InputRef | null {
  const sampler = api[samplerId]
  const direct = ["seed", "noise_seed"].find((n) => n in sampler.inputs)
  if (direct) {
    const v = sampler.inputs[direct]
    if (typeof v === "number") return { nodeId: samplerId, input: direct }
    return literalBehind(api, v, ["seed", "noise_seed"], "number")
  }
  // SamplerCustomAdvanced: the seed lives on a RandomNoise node.
  return literalBehind(api, sampler.inputs.noise, ["noise_seed", "seed"], "number")
}

// --- Text -----------------------------------------------------------------

const TEXT_KEYS = ["text", "prompt", "text_g", "positive_prompt", "prompt_text", "caption", "text_l"]
const NEGATIVE = /negative|neg_/i
const SYSTEM = /system|instruction/i
/** Literal inputs worth offering when we walk through string helper nodes. */
const STRING_INPUT = /^(text|prompt|value|string|string_\w+|text_\w+|caption|input|str|on_true|on_false)$/
/** Links that never carry text. */
const NON_TEXT_LINK = /^(clip|model|vae|image|images|latent|samples|conditioning|mask)/i

function findTextInput(node: ApiNode, info?: ObjectInfo): string | null {
  const keys = Object.keys(node.inputs)
  for (const key of TEXT_KEYS) if (keys.includes(key)) return key
  const loose = keys.find((k) => /^(text|prompt)(_|$)/i.test(k) && !NEGATIVE.test(k))
  if (loose) return loose
  const spec = info?.[node.class_type]?.input
  if (spec) {
    const all = { ...spec.optional, ...spec.required }
    const multiline = keys.find((k) => {
      const def = all[k]
      const opts = def?.[1] as { multiline?: boolean } | undefined
      return def?.[0] === "STRING" && opts?.multiline === true && !NEGATIVE.test(k)
    })
    if (multiline) return multiline
  }
  return null
}

interface Hit {
  ref: InputRef
  active: boolean
  system: boolean
}

class TextTracer {
  readonly hits: Hit[] = []
  private visited = new Set<string>()

  constructor(
    private api: ApiWorkflow,
    private info?: ObjectInfo,
  ) {}

  private hit(nodeId: string, input: string, active: boolean) {
    const node = this.api[nodeId]
    const title = String(node._meta?.title ?? "")
    this.hits.push({ ref: { nodeId, input }, active, system: SYSTEM.test(title) || SYSTEM.test(input) })
  }

  /** Walk back from a conditioning link until a node with a text input. */
  conditioning(link: NodeRef) {
    const seen = new Set<string>()
    let id: string | undefined = link[0]
    while (id && this.api[id] && !seen.has(id)) {
      seen.add(id)
      const node: ApiNode = this.api[id]
      const key = findTextInput(node, this.info)
      if (key) return this.textInput(id, key, true)
      const next: [string, NodeRef] | undefined = linkInputs(node).find(([name]) => /conditioning|positive|cond/i.test(name) && !NEGATIVE.test(name))
      id = next?.[1][0]
    }
  }

  private textInput(nodeId: string, key: string, active: boolean) {
    const value = this.api[nodeId].inputs[key]
    if (typeof value === "string") this.hit(nodeId, key, active)
    else if (isLink(value)) this.strings(value[0], active)
  }

  private switchValue(value: unknown): boolean {
    if (typeof value === "boolean") return value
    // A PrimitiveBoolean-style node. Unresolvable switches count as off.
    if (isLink(value)) return this.api[value[0]]?.inputs.value === true
    return false
  }

  private slot(nodeId: string, name: string, active: boolean) {
    const v = this.api[nodeId].inputs[name]
    if (typeof v === "string") this.hit(nodeId, name, active)
    else if (isLink(v)) this.strings(v[0], active)
  }

  /** Walk through string helper nodes (primitives, concatenation, switches, previews, text generators). */
  strings(nodeId: string, active: boolean) {
    const node = this.api[nodeId]
    if (!node || this.visited.has(nodeId)) return
    this.visited.add(nodeId)
    if (/Switch/i.test(node.class_type) && ("on_true" in node.inputs || "on_false" in node.inputs)) {
      const chosen = this.switchValue(node.inputs.switch) ? "on_true" : "on_false"
      this.slot(nodeId, chosen, active)
      this.slot(nodeId, chosen === "on_true" ? "on_false" : "on_true", false)
      return
    }
    for (const [name, value] of Object.entries(node.inputs)) {
      if (isLink(value)) {
        if (!NON_TEXT_LINK.test(name)) this.strings(value[0], active)
      } else if (typeof value === "string" && STRING_INPUT.test(name) && !NEGATIVE.test(name)) {
        this.hit(nodeId, name, active)
      }
    }
  }

  result(): { primary: InputRef | null; candidates: InputRef[] } {
    const primary =
      this.hits.find((h) => h.active && !h.system) ?? this.hits.find((h) => h.active) ?? null
    const ordered = [...this.hits].sort((a, b) => Number(b.active) - Number(a.active) || Number(a.system) - Number(b.system))
    const candidates: InputRef[] = []
    for (const h of ordered) pushUnique(candidates, h.ref)
    return { primary: primary?.ref ?? null, candidates }
  }
}

// --- Outputs --------------------------------------------------------------

const IMAGE_OUTPUT = /^(SaveImage|PreviewImage|SaveAnimated|SaveVideo|SaveWEBM)/

function outputNodes(api: ApiWorkflow, info?: ObjectInfo): string[] {
  const ids = sortedIds(api)
  const isOutput = (id: string) => info?.[api[id].class_type]?.output_node === true
  const imageLike = ids.filter((id) => {
    const node = api[id]
    return IMAGE_OUTPUT.test(node.class_type) || (isOutput(id) && ("images" in node.inputs || "image" in node.inputs || "video" in node.inputs))
  })
  if (imageLike.length) return imageLike
  return ids.filter(isOutput)
}

/** Nodes that feed `startId`, nearest first (including itself). */
function upstream(api: ApiWorkflow, startId: string): string[] {
  const order: string[] = []
  const seen = new Set<string>()
  const queue = [startId]
  while (queue.length) {
    const id = queue.shift() as string
    if (seen.has(id) || !api[id]) continue
    seen.add(id)
    order.push(id)
    for (const [, link] of linkInputs(api[id])) queue.push(link[0])
  }
  return order
}

// --- Public API -----------------------------------------------------------

export function detectRoles(api: ApiWorkflow, objectInfo?: ObjectInfo): Detection {
  const ids = sortedIds(api)
  const candidates: RoleCandidates = { prompt: [], seed: [], size: [], output: [] }
  const roles: Roles = { prompt: null, seed: null, width: null, height: null, output: null }

  // Output
  candidates.output = outputNodes(api, objectInfo)
  roles.output = candidates.output.at(-1) ?? null

  // Size candidates: every node with literal width and height.
  for (const id of ids) {
    const i = api[id].inputs
    if (typeof i.width === "number" && typeof i.height === "number") {
      candidates.size.push({ width: { nodeId: id, input: "width" }, height: { nodeId: id, input: "height" } })
    }
  }

  const samplers = ids.filter((id) => isSampler(api[id]))
  if (samplers.length) {
    // Primary sampler: the first one fed directly by an empty latent.
    const primary = samplers.find((id) => emptyLatentBehind(api, id) !== null) ?? samplers[0]
    const sampler = api[primary]

    // Prompt
    let positive = sampler.inputs.positive
    if (!isLink(positive) && isLink(sampler.inputs.guider)) {
      const guider = api[sampler.inputs.guider[0]]
      positive = guider?.inputs.positive ?? guider?.inputs.conditioning
    }
    if (isLink(positive)) {
      const tracer = new TextTracer(api, objectInfo)
      tracer.conditioning(positive)
      const found = tracer.result()
      roles.prompt = found.primary
      candidates.prompt = found.candidates
    }

    // Seed
    roles.seed = seedRef(api, primary)
    if (roles.seed) candidates.seed.push(roles.seed)
    for (const id of samplers) {
      const ref = seedRef(api, id)
      if (ref) pushUnique(candidates.seed, ref)
    }

    // Size
    const emptyId = emptyLatentBehind(api, primary) ?? ids.find((id) => isEmptyLatent(api[id]))
    if (emptyId) {
      const i = api[emptyId].inputs
      const width = typeof i.width === "number" ? { nodeId: emptyId, input: "width" } : literalBehind(api, i.width, ["width"], "number")
      const height = typeof i.height === "number" ? { nodeId: emptyId, input: "height" } : literalBehind(api, i.height, ["height"], "number")
      if (width && height) {
        roles.width = width
        roles.height = height
      }
    }
  } else if (roles.output) {
    // No sampler (API nodes): the first literal text input on a node feeding the output.
    const tracer: InputRef[] = []
    for (const id of upstream(api, roles.output)) {
      for (const [name, value] of Object.entries(api[id].inputs)) {
        if (typeof value === "string" && /prompt|text/i.test(name) && !SYSTEM.test(name) && !NEGATIVE.test(name)) {
          tracer.push({ nodeId: id, input: name })
        }
      }
    }
    candidates.prompt = tracer
    roles.prompt = tracer[0] ?? null
    if (roles.prompt) {
      const owner = api[roles.prompt.nodeId].inputs
      const seedName = ["seed", "noise_seed"].find((n) => typeof owner[n] === "number")
      if (seedName) {
        roles.seed = { nodeId: roles.prompt.nodeId, input: seedName }
        candidates.seed.push(roles.seed)
      }
    }
  }

  return { roles, candidates }
}

function setLiteral(api: ApiWorkflow, ref: InputRef | null, value: string | number | undefined, label: string) {
  if (value === undefined || ref === null) return
  const node = api[ref.nodeId]
  if (!node) throw new Error(`Role "${label}" points at missing node ${ref.nodeId}`)
  if (!(ref.input in node.inputs)) throw new Error(`Role "${label}" points at missing input ${ref.nodeId}.${ref.input}`)
  if (isLink(node.inputs[ref.input])) {
    throw new Error(`Role "${label}" points at a linked input (${ref.nodeId}.${ref.input}), which cannot be set`)
  }
  node.inputs[ref.input] = value
}

/** Returns a copy of the workflow with only the given roles' literal inputs replaced. */
export function applyRoles(api: ApiWorkflow, roles: Roles, values: RoleValues): ApiWorkflow {
  const copy = structuredClone(api)
  setLiteral(copy, roles.prompt, values.prompt, "prompt")
  setLiteral(copy, roles.seed, values.seed, "seed")
  setLiteral(copy, roles.width, values.width, "width")
  setLiteral(copy, roles.height, values.height, "height")
  return copy
}

/** Random integer in [0, 2^53). */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 53)
}
