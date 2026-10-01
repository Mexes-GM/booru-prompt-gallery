/**
 * Tests for lib/extension/generation-resolution.ts's computeGenerationResolution,
 * covering both capping modes:
 *   - "area" budget (default, strictCap: false/omitted) — total-pixel-area
 *     ceiling, a non-square result CAN exceed maxLongSide on one side.
 *   - "strict" cap (strictCap: true) — maxLongSide is a hard per-side ceiling,
 *     max(width, height) must never exceed it, regardless of aspect ratio.
 * ...and the `snapToBucket` option, which replaces the source's raw aspect
 * ratio with the closest entry from SUPPORTED_BUCKET_RESOLUTIONS (common
 * ratios: 1:1, 5:7/7:5, 3:4/4:3, 2:3/3:2, 9:16/16:9)
 * before applying the same capping logic.
 *
 * This file specifically covers the bug report: "auto resolution takes the
 * longest side and applies a higher resolution than maxLongSide allows,
 * ignoring the max long side option" — reproduced with a 16:9 source and
 * fixed by strictCap: true.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/generation-resolution.verify.ts
 */
import {
  clampMaxLongSide,
  computeGenerationResolution,
  MAX_MAX_LONG_SIDE,
  MIN_MAX_LONG_SIDE,
  SUPPORTED_BUCKET_RESOLUTIONS,
} from "../lib/extension/generation-resolution"

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

// ── 0) Graceful degradation on missing/invalid dimensions ──
{
  assert(computeGenerationResolution(undefined, 1000) === null, "missing width -> null")
  assert(computeGenerationResolution(1000, null) === null, "missing height -> null")
  assert(computeGenerationResolution(0, 1000) === null, "zero width -> null")
  assert(computeGenerationResolution(-5, 1000) === null, "negative width -> null")
}

// ── 1) "area" mode (default): a 16:9 source CAN exceed maxLongSide on the long side ──
{
  // 1920x1080 (16:9) at maxLongSide=1536 (area budget = 1536^2 = 2,359,296 px).
  const res = computeGenerationResolution(1920, 1080, { maxLongSide: 1536 })
  assert(res !== null, "area mode produces a result")
  if (res) {
    assert(res.width > 1536, `area mode: long side (${res.width}) legitimately exceeds maxLongSide (1536) for a 16:9 source`)
    assert(res.width * res.height <= 1536 * 1536, `area mode: total area (${res.width * res.height}) stays within the 1536^2 budget`)
    assert(res.width % 64 === 0 && res.height % 64 === 0, "both dimensions are multiples of 64")
  }
}

// ── 2) "strict" mode: the same 16:9 source must never exceed maxLongSide ──
{
  const res = computeGenerationResolution(1920, 1080, { maxLongSide: 1536, strictCap: true })
  assert(res !== null, "strict mode produces a result")
  if (res) {
    assert(Math.max(res.width, res.height) <= 1536, `strict mode: longest side (${Math.max(res.width, res.height)}) never exceeds maxLongSide (1536)`)
    assert(res.width % 64 === 0 && res.height % 64 === 0, "both dimensions are multiples of 64")
    // Aspect ratio should be approximately preserved (16:9 ~= 1.778).
    const ratio = res.width / res.height
    assert(Math.abs(ratio - 16 / 9) < 0.15, `strict mode: aspect ratio (${ratio.toFixed(3)}) approximates the source 16:9 (${(16/9).toFixed(3)})`)
  }
}

// ── 3) Strict mode upscales small sources to match the cap ──
{
  // Source already smaller than the cap on every side — strict mode scales
  // it UP so the longest side equals budgetSide (target, not ceiling).
  const res = computeGenerationResolution(800, 600, { maxLongSide: 1536, strictCap: true })
  assert(res !== null, "strict mode produces a result for a small source")
  if (res) {
    const longest = Math.max(res.width, res.height)
    assert(longest === 1536, `strict mode upscales small source to the cap (got longest=${longest}, expected 1536, full=${res.width}x${res.height} from 800x600)`)
    assert(res.width % 64 === 0 && res.height % 64 === 0, `upscaled dimensions are multiples of 64 (got ${res.width}x${res.height})`)
    // Aspect ratio should be approximately preserved (800/600 = 4:3 ~= 1.333).
    const ratio = res.width / res.height
    assert(Math.abs(ratio - 4 / 3) < 0.1, `strict mode upscale preserves aspect ratio (${ratio.toFixed(3)} ≈ ${(4/3).toFixed(3)})`)
  }
}

// ── 4) Strict mode on a square source: both modes should agree closely ──
{
  const area = computeGenerationResolution(1500, 1500, { maxLongSide: 1536 })
  const strict = computeGenerationResolution(1500, 1500, { maxLongSide: 1536, strictCap: true })
  assert(area !== null && strict !== null, "both modes produce a result for a square source")
  if (area && strict) {
    assert(Math.max(strict.width, strict.height) <= 1536, "strict mode respects the cap on a square source")
    assert(area.width === area.height, "area mode keeps a square source square")
    assert(strict.width === strict.height, "strict mode keeps a square source square")
  }
}

// ── 5) Extreme aspect ratio: strict mode still caps the long side ──
{
  // A very wide banner-like source (e.g. 3000x500, 6:1).
  const res = computeGenerationResolution(3000, 500, { maxLongSide: 1536, strictCap: true })
  assert(res !== null, "strict mode produces a result for an extreme aspect ratio")
  if (res) {
    assert(Math.max(res.width, res.height) <= 1536, `strict mode caps the long side even for an extreme 6:1 source (got ${res.width}x${res.height})`)
  }
}

// ── 6) Custom `multiple` is respected in strict mode ──
{
  const res = computeGenerationResolution(1920, 1080, { maxLongSide: 1536, strictCap: true, multiple: 8 })
  assert(res !== null, "strict mode with a custom multiple produces a result")
  if (res) {
    assert(res.width % 8 === 0 && res.height % 8 === 0, "both dimensions are multiples of the custom `multiple` (8)")
    assert(Math.max(res.width, res.height) <= 1536, "the per-side cap still holds with a custom multiple")
  }
}

// ── 7) snapToBucket: a near-16:9 source snaps to the 16:9 bucket, not its raw ratio ──
{
  // 1920x1080 is exactly 16:9. The closest bucket is 1344x768 (also 16:9).
  const res = computeGenerationResolution(1920, 1080, { maxLongSide: 1536, snapToBucket: true })
  assert(res !== null, "snapToBucket produces a result")
  if (res) {
    const ratio = res.width / res.height
    assert(Math.abs(ratio - 16 / 9) < 0.01, `snapToBucket result (${res.width}x${res.height}, ratio ${ratio.toFixed(3)}) matches the 16:9 bucket exactly`)
    assert(res.width % 64 === 0 && res.height % 64 === 0, "both dimensions are multiples of 64")
  }
}

// ── 8) snapToBucket: an odd/unusual source ratio still snaps to the closest bucket ──
{
  // 1000x1470 (≈0.680) sits between 2:3 (0.667) and the 5:7 bucket (0.708) but is
  // closer to 2:3 in log space — verifies "closest", not "first match"
  // (5:7 comes before 2:3 in the list). Compare distances instead of an exact
  // final ratio since post-bucket capping/snapping can nudge it slightly.
  const res = computeGenerationResolution(1000, 1470, { maxLongSide: 1536, snapToBucket: true, strictCap: true })
  assert(res !== null, "snapToBucket produces a result for an odd source ratio")
  if (res) {
    const ratio = res.width / res.height
    const distTo2_3 = Math.abs(ratio - 2 / 3)
    const distTo5_7 = Math.abs(ratio - 5 / 7)
    assert(distTo2_3 < distTo5_7, `source ratio ${(1000 / 1470).toFixed(3)} snaps to 2:3 rather than 5:7; got ratio ${ratio.toFixed(3)} (${res.width}x${res.height})`)
  }
}

// ── 8b) snapToBucket: a 5:7 source keeps the 5:7 bucket at Anima v1.0 size ──
{
  const res = computeGenerationResolution(1000, 1400, { maxLongSide: 1536, snapToBucket: true, strictCap: true })
  assert(res !== null && res.width === 1088 && res.height === 1536, `5:7 source in strict mode returns the 1088x1536 bucket (got ${res ? `${res.width}x${res.height}` : "null"})`)
}

// ── 9) snapToBucket: orientation is preserved (landscape source never snaps to a portrait bucket) ──
{
  const landscape = computeGenerationResolution(1600, 900, { maxLongSide: 1536, snapToBucket: true, strictCap: true })
  const portrait = computeGenerationResolution(900, 1600, { maxLongSide: 1536, snapToBucket: true, strictCap: true })
  assert(landscape !== null && portrait !== null, "snapToBucket produces results for both orientations")
  if (landscape && portrait) {
    assert(landscape.width > landscape.height, `landscape source (1600x900) snaps to a landscape bucket (got ${landscape.width}x${landscape.height})`)
    assert(portrait.height > portrait.width, `portrait source (900x1600) snaps to a portrait bucket (got ${portrait.width}x${portrait.height})`)
  }
}

// ── 10) snapToBucket: a square-ish source snaps to the 1:1 bucket ──
{
  const res = computeGenerationResolution(1050, 950, { maxLongSide: 1536, snapToBucket: true, strictCap: true })
  assert(res !== null, "snapToBucket produces a result for a near-square source")
  if (res) {
    assert(res.width === res.height, `near-square source (1050x950) snaps to the 1:1 bucket (got ${res.width}x${res.height})`)
  }
}

// ── 11) Every bucket sits inside Anima's 512^2–1536^2 working range ──
{
  for (const { width, height } of SUPPORTED_BUCKET_RESOLUTIONS) {
    const area = width * height
    assert(area >= 512 * 512 && area <= 1536 * 1536, `bucket ${width}x${height} is within 512^2–1536^2 px`)
    assert(width % 64 === 0 && height % 64 === 0, `bucket ${width}x${height} uses multiples of 64`)
  }
}

// ── 12) clampMaxLongSide keeps the setting inside 512–1536 ──
{
  assert(clampMaxLongSide(4096) === MAX_MAX_LONG_SIDE, "values above 1536 clamp down")
  assert(clampMaxLongSide(64) === MIN_MAX_LONG_SIDE, "values below 512 clamp up")
  assert(clampMaxLongSide(1088) === 1088, "in-range values pass through")
  assert(clampMaxLongSide(Number.NaN) === MAX_MAX_LONG_SIDE, "NaN falls back to the default")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
