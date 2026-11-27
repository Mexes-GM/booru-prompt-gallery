/**
 * Tests for lib/comfyui/roles.ts against real workflows produced by ComfyUI's
 * own graphToPrompt (bridge-*.json) and a few hand-written API graphs
 * (api-*.json). Every expected role below is explained next to it.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/comfyui-roles.verify.ts
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { applyRoles, detectRoles, randomSeed } from "../lib/comfyui/roles"
import type { ApiWorkflow, InputRef, ObjectInfo, Roles } from "../lib/comfyui/types"

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

const FIXTURES = join(__dirname, "fixtures", "comfyui")
const load = (name: string): ApiWorkflow => {
  const data = JSON.parse(readFileSync(join(FIXTURES, name), "utf8"))
  return data.api ?? data
}
const ref = (nodeId: string, input: string): InputRef => ({ nodeId, input })

/** Lists every (node, input) whose value differs between two graphs. */
function changedInputs(a: ApiWorkflow, b: ApiWorkflow): string[] {
  const out: string[] = []
  const ids = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const id of ids) {
    if (!a[id] || !b[id]) {
      out.push(`${id} (added or removed)`)
      continue
    }
    if (a[id].class_type !== b[id].class_type) out.push(`${id}.class_type`)
    const names = new Set([...Object.keys(a[id].inputs), ...Object.keys(b[id].inputs)])
    for (const n of names) {
      if (JSON.stringify(a[id].inputs[n]) !== JSON.stringify(b[id].inputs[n])) out.push(`${id}.${n}`)
    }
  }
  return out.sort()
}

const refKey = (r: InputRef | null) => (r ? `${r.nodeId}.${r.input}` : null)

// ── 1) Z-Image Turbo: the simple case ──
// KSampler 57:3 -> positive 57:27 (CLIPTextEncode, literal `text`); negative is a ConditioningZeroOut
// (57:33), never touched. Seed and size are literals on the sampler and EmptySD3LatentImage 57:13.
const zImage = load("bridge-image-z-image-turbo-f8c31de2.json")
{
  const { roles, candidates } = detectRoles(zImage)
  same(roles, { prompt: ref("57:27", "text"), seed: ref("57:3", "seed"), width: ref("57:13", "width"), height: ref("57:13", "height"), output: "9" }, "z-image roles")
  same(candidates.output, ["9"], "z-image output candidates")
  assert(candidates.size.length === 1, "z-image has one size pair")
  assert(!candidates.prompt.some((r) => r.nodeId === "57:33"), "z-image: the negative node is never a candidate")
}

// ── 2) Krea 2 Turbo: text flows through switches and string helpers ──
// positive 30:6 CLIPTextEncode.text <- 30:28 switch (switch <- PrimitiveBoolean 30:23 = false -> on_false)
// <- 30:20 PreviewAny <- 30:21 switch (30:24 = true -> on_true) <- 30:16 TextGenerate <- 30:17 StringConcatenate
// <- 30:18 (title "System Prompt") and 30:19 (title "User Prompt"). The user prompt is the one to edit.
// Size comes from ResolutionSelector (aspect ratio + megapixels, no width/height literals): no size role.
const krea = load("bridge-image-krea2-turbo-t2i-7b32be7a.json")
{
  const { roles, candidates } = detectRoles(krea)
  same(roles, { prompt: ref("30:19", "value"), seed: ref("30:3", "seed"), width: null, height: null, output: "29" }, "krea roles")
  assert(refKey(candidates.prompt[0]) === "30:19.value", "krea: chosen prompt is the first candidate")
  assert(candidates.prompt.some((r) => refKey(r) === "30:18.value"), "krea: system prompt is listed as a candidate")
  assert(candidates.prompt.some((r) => refKey(r) === "30:27.string_b"), "krea: the other switch branch is listed as a candidate")
  assert(candidates.size.length === 0, "krea has no literal width/height pair")
  // With object_info, PreviewAny (30:20) is an output node too, but the image output must still win.
  const info: ObjectInfo = { SaveImage: { output_node: true }, PreviewAny: { output_node: true }, KSampler: {} }
  assert(detectRoles(krea, info).roles.output === "29", "krea: PreviewAny does not hijack the output")
}

// ── 3) Qwen Image 2.1: literal sitting on a switch ──
// positive 459:452 TextEncodeQwenImage21: `prompt` <- 459:472 PreviewAny <- 459:474 switch (literal false)
// -> on_false is a literal string: that is the editable prompt. The TextGenerate (459:471) branch is inactive.
// negative_prompt on 459:452 is a literal that must be left alone.
const qwen = load("bridge-image-qwen-image-2-1-t2i-1fbfd730.json")
{
  const { roles, candidates } = detectRoles(qwen)
  same(roles, { prompt: ref("459:474", "on_false"), seed: ref("459:458", "seed"), width: null, height: null, output: "461" }, "qwen roles")
  assert(candidates.prompt.some((r) => refKey(r) === "459:471.prompt"), "qwen: TextGenerate prompt is a candidate")
  assert(!candidates.prompt.some((r) => r.input === "negative_prompt"), "qwen: negative_prompt is never a candidate")
}

// ── 4) Nano Banana (API node, no sampler) ──
// No sampler or latent. Output is SaveImageAdvanced 3, fed by GeminiNanoBanana2V2 1: its literal `prompt`
// is the prompt (`system_prompt` is skipped) and its literal `seed` is the seed. No size inputs.
const banana = load("bridge-api-nano-banana-2-1-t2i-8bd7ab1e.json")
{
  const { roles } = detectRoles(banana)
  same(roles, { prompt: ref("1", "prompt"), seed: ref("1", "seed"), width: null, height: null, output: "3" }, "nano banana roles")
}

// ── 5) SDXL with two chained LoRA loaders ──
// KSampler 3 <- positive 6 (CLIPTextEncode "1girl..."), negative 7 untouched. EmptyLatentImage 5 holds 832x1216.
const sdxl = load("api-sdxl-lora-txt2img.json")
{
  const { roles } = detectRoles(sdxl)
  same(roles, { prompt: ref("6", "text"), seed: ref("3", "seed"), width: ref("5", "width"), height: ref("5", "height"), output: "9" }, "sdxl roles")
}

// ── 6) Hires fix: second sampler has a LOWER id ──
// Sampler 2 (denoise 0.5) takes its latent from LatentUpscaleBy <- sampler 3 <- EmptyLatentImage 5.
// The primary sampler is 3 (the one fed by the empty latent), so the seed role is 3.seed, not 2.seed.
// 2.seed stays available as a candidate.
const hires = load("api-sdxl-hires-fix.json")
{
  const { roles, candidates } = detectRoles(hires)
  same(roles, { prompt: ref("6", "text"), seed: ref("3", "seed"), width: ref("5", "width"), height: ref("5", "height"), output: "9" }, "hires roles")
  assert(candidates.seed.some((r) => refKey(r) === "2.seed"), "hires: the second sampler's seed is a candidate")
  assert(refKey(candidates.seed[0]) === "3.seed", "hires: the chosen seed is the first candidate")
}

// ── 7) KSamplerAdvanced with everything linked ──
// positive 5 FluxGuidance (no text) -> conditioning 4 CLIPTextEncode, text <- 20 PrimitiveStringMultiline.value.
// noise_seed <- 21 PrimitiveInt.value; EmptySD3LatentImage width/height <- 22/23 PrimitiveInt.value.
const advanced = load("api-ksampler-advanced-linked.json")
{
  const { roles } = detectRoles(advanced)
  same(roles, { prompt: ref("20", "value"), seed: ref("21", "value"), width: ref("22", "value"), height: ref("23", "value"), output: "10" }, "advanced linked roles")
  // Same graph with literal values: the roles move onto the sampler and the latent node.
  const literal = structuredClone(advanced)
  literal["8"].inputs.noise_seed = 7
  literal["7"].inputs.width = 640
  literal["7"].inputs.height = 960
  literal["4"].inputs.text = "a dog"
  const r = detectRoles(literal).roles
  same(r, { prompt: ref("4", "text"), seed: ref("8", "noise_seed"), width: ref("7", "width"), height: ref("7", "height"), output: "10" }, "advanced literal roles (noise_seed)")
}

// ── 8) SamplerCustomAdvanced: guider and noise nodes ──
{
  const wf: ApiWorkflow = {
    "1": { class_type: "CLIPTextEncode", inputs: { text: "hello", clip: ["9", 0] } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "bad", clip: ["9", 0] } },
    "3": { class_type: "CFGGuider", inputs: { model: ["8", 0], positive: ["1", 0], negative: ["2", 0], cfg: 4 } },
    "4": { class_type: "RandomNoise", inputs: { noise_seed: 11 } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 768, batch_size: 1 } },
    "6": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["4", 0], guider: ["3", 0], sampler: ["7", 0], sigmas: ["10", 0], latent_image: ["5", 0] } },
    "7": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "8": { class_type: "UNETLoader", inputs: { unet_name: "m", weight_dtype: "default" } },
    "9": { class_type: "CLIPLoader", inputs: { clip_name: "c", type: "t" } },
    "10": { class_type: "BasicScheduler", inputs: { model: ["8", 0], scheduler: "simple", steps: 20, denoise: 1 } },
    "11": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "x" } },
  }
  same(detectRoles(wf).roles, { prompt: ref("1", "text"), seed: ref("4", "noise_seed"), width: ref("5", "width"), height: ref("5", "height"), output: "11" }, "custom advanced roles")
}

// ── 9) Output choice and empty graphs ──
{
  const wf: ApiWorkflow = {
    "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    "10": { class_type: "PreviewImage", inputs: { images: ["1", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    "1": { class_type: "Something", inputs: {} },
  }
  const { roles, candidates } = detectRoles(wf)
  assert(roles.output === "10", "output: last by numeric id order (10 after 9)")
  same(candidates.output, ["2", "9", "10"], "output candidates are in numeric id order")
  same(detectRoles({}).roles, { prompt: null, seed: null, width: null, height: null, output: null }, "empty graph gives no roles")
}

// ── 9b) Output after a hires fix ──
{
  const hires = load("api-sdxl-hires-fix.json")
  // A preview of the first pass, added with a higher id than the final SaveImage (9).
  const withPreview: ApiWorkflow = {
    ...hires,
    "20": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "21": { class_type: "PreviewImage", inputs: { images: ["20", 0] } },
  }
  const { roles, candidates } = detectRoles(withPreview)
  same(candidates.output, ["9", "21"], "hires + preview: both outputs are candidates")
  assert(roles.output === "9", "hires + preview: the output after the second pass wins over the later first-pass preview")

  // An output that the primary sampler does not feed (a preview of a loaded image) is skipped.
  const unrelated: ApiWorkflow = {
    ...hires,
    "30": { class_type: "LoadImage", inputs: { image: "ref.png" } },
    "31": { class_type: "PreviewImage", inputs: { images: ["30", 0] } },
  }
  assert(detectRoles(unrelated).roles.output === "9", "an output not fed by the sampler is not chosen")
}

// ── 10) applyRoles ──
{
  const cases: [string, ApiWorkflow][] = [
    ["z-image", zImage],
    ["krea", krea],
    ["qwen", qwen],
    ["banana", banana],
    ["sdxl", sdxl],
    ["hires", hires],
    ["advanced", advanced],
  ]
  for (const [name, wf] of cases) {
    const { roles } = detectRoles(wf)
    const before = JSON.stringify(wf)
    const out = applyRoles(wf, roles, { prompt: "NEW PROMPT", seed: 4242, width: 640, height: 960 })
    assert(JSON.stringify(wf) === before, `${name}: applyRoles does not mutate its input`)
    assert(out !== wf, `${name}: applyRoles returns a copy`)
    const allowed = new Set([roles.prompt, roles.seed, roles.width, roles.height].filter(Boolean).map((r) => refKey(r)))
    const changed = changedInputs(wf, out)
    assert(changed.every((c) => allowed.has(c)), `${name}: only role inputs changed (${changed.join(", ")})`)
    if (roles.prompt) assert(out[roles.prompt.nodeId].inputs[roles.prompt.input] === "NEW PROMPT", `${name}: prompt written`)
    if (roles.seed) assert(out[roles.seed.nodeId].inputs[roles.seed.input] === 4242, `${name}: seed written`)
    if (roles.width && roles.height) {
      assert(out[roles.width.nodeId].inputs[roles.width.input] === 640 && out[roles.height.nodeId].inputs[roles.height.input] === 960, `${name}: size written`)
    }
  }

  // The negative prompt survives byte for byte.
  {
    const { roles } = detectRoles(sdxl)
    const out = applyRoles(sdxl, roles, { prompt: "x" })
    same(out["7"], sdxl["7"], "sdxl: negative node unchanged")
    const q = applyRoles(qwen, detectRoles(qwen).roles, { prompt: "x" })
    assert(q["459:452"].inputs.negative_prompt === "", "qwen: negative_prompt unchanged")
  }

  // Only the requested values are written.
  {
    const { roles } = detectRoles(sdxl)
    const out = applyRoles(sdxl, roles, { seed: 5 })
    same(changedInputs(sdxl, out), ["3.seed"], "only the seed changes when only a seed is given")
    same(changedInputs(sdxl, applyRoles(sdxl, roles, {})), [], "no values -> no changes")
    const none = applyRoles(sdxl, { prompt: null, seed: null, width: null, height: null, output: null }, { prompt: "x", seed: 1 })
    same(changedInputs(sdxl, none), [], "null roles are skipped")
  }

  // Roles that point at links, missing nodes or missing inputs throw.
  const bad = (roles: Partial<Roles>, values: Parameters<typeof applyRoles>[2]) => {
    try {
      applyRoles(sdxl, { prompt: null, seed: null, width: null, height: null, output: null, ...roles }, values)
      return false
    } catch {
      return true
    }
  }
  assert(bad({ prompt: ref("3", "model") }, { prompt: "x" }), "throws when the role points at a linked input")
  assert(bad({ seed: ref("99", "seed") }, { seed: 1 }), "throws when the node is missing")
  assert(bad({ seed: ref("3", "nope") }, { seed: 1 }), "throws when the input is missing")
  assert(!bad({ prompt: ref("3", "model") }, {}), "no value for a linked role is not an error")

  // randomSeed
  let ok = true
  for (let i = 0; i < 2000; i++) {
    const s = randomSeed()
    if (!Number.isSafeInteger(s) || s < 0 || s >= 2 ** 53) ok = false
  }
  assert(ok, "randomSeed returns integers in [0, 2^53)")
  assert(new Set(Array.from({ length: 50 }, randomSeed)).size > 45, "randomSeed varies")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
