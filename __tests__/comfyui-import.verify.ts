/**
 * Tests for lib/comfyui/import.ts: PNG metadata (tEXt, iTXt plain and
 * compressed), API-format JSON, UI-format detection, bridge records and the
 * object_info check. PNGs are built here, chunk by chunk, with real CRC32s.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/comfyui-import.verify.ts
 */
import { deflateSync } from "node:zlib"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { checkNodesAgainstObjectInfo, importBridgeRecord, importWorkflowFile } from "../lib/comfyui/import"

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

const FIXTURES = join(__dirname, "fixtures", "comfyui")
const bridge = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"))
const zImage = bridge("bridge-image-z-image-turbo-f8c31de2.json")
const enc = new TextEncoder()

// ── PNG builder ──
const CRC_TABLE = (() => {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table.push(c >>> 0)
  }
  return table
})()
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let pos = 0
  for (const p of parts) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = enc.encode(type)
  const header = new Uint8Array(4)
  new DataView(header.buffer).setUint32(0, data.length)
  const crc = new Uint8Array(4)
  new DataView(crc.buffer).setUint32(0, crc32(concat(typeBytes, data)))
  return concat(header, typeBytes, data, crc)
}

const latin1Bytes = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff)
const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// 1x1 RGBA pixel
const IHDR = chunk("IHDR", Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]))
const IDAT = chunk("IDAT", deflateSync(Uint8Array.from([0, 255, 0, 0, 255])))
const IEND = chunk("IEND", new Uint8Array(0))

const text = (key: string, value: string) => chunk("tEXt", concat(latin1Bytes(key), Uint8Array.of(0), latin1Bytes(value)))
function itxt(key: string, value: string, compressed = false): Uint8Array {
  const body = compressed ? deflateSync(enc.encode(value)) : enc.encode(value)
  return chunk(
    "iTXt",
    concat(latin1Bytes(key), Uint8Array.of(0, compressed ? 1 : 0, 0), enc.encode("en"), Uint8Array.of(0), enc.encode("clave"), Uint8Array.of(0), body),
  )
}
const png = (...extra: Uint8Array[]) => concat(SIGNATURE, IHDR, ...extra, IDAT, IEND)

async function main() {
  const api = zImage.api
  const ui = zImage.ui
  // ComfyUI writes ASCII-escaped JSON into tEXt chunks (Latin-1), so do the same here.
  const asciiJson = (v: unknown) =>
    [...JSON.stringify(v)].map((c) => (c.charCodeAt(0) > 127 ? String.fromCharCode(92) + "u" + c.charCodeAt(0).toString(16).padStart(4, "0") : c)).join("")
  const apiText = asciiJson(api)
  const uiText = asciiJson(ui)

  // ── 1) PNG with tEXt ──
  {
    const r = await importWorkflowFile({ name: "ComfyUI_00001_.png", bytes: png(text("prompt", apiText), text("workflow", uiText)) })
    assert(r.ok && r.workflow.source === "png", "tEXt PNG imports")
    assert(r.ok && JSON.stringify(r.workflow.api) === JSON.stringify(api), "tEXt PNG keeps the API graph")
    assert(r.ok && r.workflow.ui !== null && Array.isArray((r.workflow.ui as { nodes: unknown[] }).nodes), "tEXt PNG keeps the UI graph")
    assert(r.ok && r.workflow.name === "ComfyUI_00001_", "PNG name drops the extension")
  }

  // ── 2) PNG with iTXt (plain, then compressed, with non-ASCII text) ──
  {
    const accented = JSON.parse(apiText)
    accented["57:27"].inputs.text = "niña con sombrero, ñandú ✨"
    const accentedText = JSON.stringify(accented) // non-ASCII stays as real UTF-8
    const plain = await importWorkflowFile({ name: "a.png", bytes: png(itxt("prompt", accentedText), itxt("workflow", uiText)) })
    assert(plain.ok && plain.workflow.api["57:27"].inputs.text === "niña con sombrero, ñandú ✨", "iTXt decodes as UTF-8")
    assert(plain.ok && plain.workflow.ui !== null, "iTXt keeps the UI graph")
    const packed = await importWorkflowFile({ name: "b.png", bytes: png(itxt("prompt", accentedText, true), itxt("workflow", uiText, true)) })
    assert(packed.ok && packed.workflow.api["57:27"].inputs.text === "niña con sombrero, ñandú ✨", "compressed iTXt is inflated")
    // Metadata chunks may sit after the image data too.
    const after = await importWorkflowFile({ name: "c.png", bytes: concat(SIGNATURE, IHDR, IDAT, text("prompt", apiText), IEND) })
    assert(after.ok, "text chunk after IDAT is found")
  }

  // ── 3) PNG that lacks the workflow ──
  {
    const bare = await importWorkflowFile({ name: "plain.png", bytes: png() })
    assert(!bare.ok && bare.error === "no-workflow", "PNG without metadata -> no-workflow")
    const other = await importWorkflowFile({ name: "meta.png", bytes: png(text("Software", "paint")) })
    assert(!other.ok && other.error === "no-workflow", "PNG with unrelated text -> no-workflow")
    const onlyUi = await importWorkflowFile({ name: "ui.png", bytes: png(text("workflow", uiText)) })
    assert(!onlyUi.ok && onlyUi.error === "ui-format", "PNG with only the UI graph -> ui-format")
    const badPrompt = await importWorkflowFile({ name: "bad.png", bytes: png(text("prompt", "{not json")) })
    assert(!badPrompt.ok && badPrompt.error === "invalid-json", "PNG with broken prompt JSON -> invalid-json")
    const truncated = await importWorkflowFile({ name: "t.png", bytes: png(text("prompt", apiText)).subarray(0, 60) })
    assert(!truncated.ok, "truncated PNG does not throw and does not import")
    const notPng = await importWorkflowFile({ name: "fake.png", bytes: enc.encode("this is not a png at all") })
    assert(!notPng.ok && notPng.error === "unsupported-file", "bad signature -> unsupported-file")
  }

  // ── 4) JSON ──
  {
    const good = await importWorkflowFile({ name: "my flow.json", bytes: enc.encode(apiText) })
    assert(good.ok && good.workflow.source === "api-json" && good.workflow.ui === null, "API JSON imports without a UI graph")
    assert(good.ok && good.workflow.name === "my flow", "JSON name drops the extension")
    const withBom = await importWorkflowFile({ name: "bom.JSON", bytes: concat(Uint8Array.of(0xef, 0xbb, 0xbf), enc.encode(apiText)) })
    assert(withBom.ok, "BOM and upper-case extension are fine")

    const uiFile = await importWorkflowFile({ name: "ui.json", bytes: enc.encode(uiText) })
    assert(!uiFile.ok && uiFile.error === "ui-format", "UI JSON -> ui-format")

    const garbage = await importWorkflowFile({ name: "g.json", bytes: enc.encode("<<<garbage>>>") })
    assert(!garbage.ok && garbage.error === "invalid-json", "garbage -> invalid-json")
    const binary = await importWorkflowFile({ name: "g2.json", bytes: Uint8Array.of(0xff, 0xfe, 0x00, 0x80) })
    assert(!binary.ok && binary.error === "invalid-json", "invalid UTF-8 -> invalid-json")

    for (const odd of ["{}", "[]", "42", "null", '{"a": 1}', '{"1": {"inputs": {}}}']) {
      const r = await importWorkflowFile({ name: "o.json", bytes: enc.encode(odd) })
      assert(!r.ok && r.error === "no-workflow", `valid JSON that is no workflow (${odd}) -> no-workflow`)
    }

    const txt = await importWorkflowFile({ name: "notes.txt", bytes: enc.encode(apiText) })
    assert(!txt.ok && txt.error === "unsupported-file", "unknown extension -> unsupported-file")
    const none = await importWorkflowFile({ name: "noext", bytes: enc.encode(apiText) })
    assert(!none.ok && none.error === "unsupported-file", "no extension -> unsupported-file")
  }

  // ── 5) Bridge records, one per fixture ──
  {
    for (const file of [
      "bridge-image-z-image-turbo-f8c31de2.json",
      "bridge-image-krea2-turbo-t2i-7b32be7a.json",
      "bridge-image-qwen-image-2-1-t2i-1fbfd730.json",
      "bridge-api-nano-banana-2-1-t2i-8bd7ab1e.json",
    ]) {
      const record = bridge(file)
      const r = importBridgeRecord(record)
      assert(r.ok && r.workflow.source === "bridge" && r.workflow.name === record.name, `${file}: bridge record imports with its name`)
      assert(r.ok && r.workflow.ui !== null, `${file}: bridge record keeps the UI graph`)
    }
    const noUi = importBridgeRecord({ name: "x", ui: null, api: api })
    assert(noUi.ok && noUi.workflow.ui === null, "bridge record without ui imports")
    const bad = importBridgeRecord({ name: "x", ui: null, api: { "1": { nope: true } } })
    assert(!bad.ok && bad.error === "no-workflow", "bridge record with a non-API graph -> no-workflow")
  }

  // ── 6) object_info check ──
  {
    const info = { KSampler: {}, CLIPTextEncode: {}, SaveImage: {} }
    const missing = checkNodesAgainstObjectInfo(api, info)
    assert(missing.includes("UNETLoader") && !missing.includes("KSampler"), "missing node types are listed")
    assert(new Set(missing).size === missing.length, "each missing type is listed once")
    assert(checkNodesAgainstObjectInfo({ "1": { class_type: "KSampler", inputs: {} } }, info).length === 0, "nothing missing -> empty list")
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
