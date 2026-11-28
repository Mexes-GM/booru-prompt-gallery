/**
 * Tests for the size Send to ComfyUI writes into the workflow
 * (lib/comfyui/send-size.ts chooseSendSize), for a card's post size and for Pack's exact size.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/comfy-send-size.verify.ts
 */
import { chooseSendSize, type SendSizePrefs } from "../lib/comfyui/send-size"
import { packSendRequest } from "../lib/pack/pack-comfy-send"
import { computeGenerationResolution } from "../lib/extension/generation-resolution"

let passed = 0
let failed = 0
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed++
  else {
    failed++
    console.error(`  FAIL: ${label} (got ${a}, want ${e})`)
  }
}

const loose: SendSizePrefs = { maxLongSide: 1536, strictCap: false, snapToBucket: false }
const strict: SendSizePrefs = { maxLongSide: 1536, strictCap: true, snapToBucket: false }
const roles = { width: { node: "1" }, height: { node: "1" } }

// Pack: the size the row shows goes through unchanged, whatever the prefs.
for (const [w, h] of [[832, 1216], [1024, 1024], [896, 1152]]) {
  const req = packSendRequest({ width: w, height: h }, "1girl")
  eq(chooseSendSize(req, true, roles, loose), { width: w, height: h }, `pack ${w}x${h}, loose`)
  eq(chooseSendSize(req, true, roles, strict), { width: w, height: h }, `pack ${w}x${h}, strict`)
}

// The option off, or a role missing: no size at all, exact or not.
const pack = packSendRequest({ width: 832, height: 1216 }, "a")
const card = { sourceWidth: 1000, sourceHeight: 1500 }
for (const [name, req] of [["pack", pack], ["card", card]] as const) {
  eq(chooseSendSize(req, false, roles, loose), {}, `${name}: option off`)
  eq(chooseSendSize(req, true, { width: roles.width }, loose), {}, `${name}: no height role`)
  eq(chooseSendSize(req, true, { height: roles.height }, loose), {}, `${name}: no width role`)
  eq(chooseSendSize(req, true, {}, loose), {}, `${name}: no roles`)
}

// A card: still the match-the-size computation, with the prefs.
eq(chooseSendSize(card, true, roles, loose), computeGenerationResolution(1000, 1500, loose) ?? {}, "card goes through computeGenerationResolution")
eq(chooseSendSize(card, true, roles, strict), computeGenerationResolution(1000, 1500, strict) ?? {}, "card, strict cap")
eq(chooseSendSize({ sourceWidth: 832, sourceHeight: 1216 }, true, roles, loose), { width: 1216, height: 1920 }, "a post of 832x1216 is still scaled up")
eq(chooseSendSize({}, true, roles, loose), {}, "no size at all sends none")

console.log(`comfy-send-size: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
