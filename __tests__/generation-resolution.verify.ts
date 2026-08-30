/**
 * Tests for lib/extension/generation-resolution.ts's computeGenerationResolution,
 * covering both capping modes:
 *   - "area" budget (default, strictCap: false/omitted) — total-pixel-area
 *     ceiling, a non-square result CAN exceed maxLongSide on one side.
 *   - "strict" cap (strictCap: true) — maxLongSide is a hard per-side ceiling,
 *     max(width, height) must never exceed it, regardless of aspect ratio.
 *
 * This file specifically covers the bug report: "auto resolution takes the
 * longest side and applies a higher resolution than maxLongSide allows,
 * ignoring the max long side option" — reproduced with a 16:9 source and
 * fixed by strictCap: true.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/generation-resolution.verify.ts
 */
import { computeGenerationResolution } from "../lib/extension/generation-resolution"

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

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
