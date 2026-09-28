// Pure helper: derive a usable generation width/height from a source image's
// aspect ratio. Used by the extension's "Match image resolution" feature
// (see docs/extension-configurable-targets-plan.md and the design doc for
// this feature) to scale a booru post's real dimensions down/up to a
// resolution most checkpoints (Illustrious/Anima/SDXL) can generate cleanly,
// while preserving aspect ratio.
//
// Two capping modes are supported (see `strictCap`):
//
//   - "area" budget (default, strictCap=false): the scaling budget is a
//     TOTAL PIXEL AREA, not a fixed long-side cap. Anima (and similarly-
//     trained checkpoints) documents its working range as "512^2 to 1536^2
//     pixels" — i.e. a total-area ceiling of 1536*1536 = 2,359,296 px, not a
//     hard "longest side <= 1536" rule. Anchoring to the long side alone
//     wastes capacity on non-square aspect ratios: a 16:9 source gets capped
//     at 1536x864 (~1.33M px) when the model can actually take it up to
//     ~2048x1152 (~2.36M px) at the same total-area budget. A non-square
//     result can legitimately have one side longer than `maxLongSide`, as
//     long as the other side is proportionally shorter and the total area
//     stays within budget.
//
//   - "strict" cap (strictCap=true): the classic behavior — `maxLongSide` is
//     a hard ceiling on whichever side (width or height) is longest. Useful
//     for checkpoints/UIs that reject (or silently clamp/crop) any single
//     dimension above a fixed limit, regardless of total area.

export interface GenerationResolution {
  width: number
  height: number
}

export interface ComputeGenerationResolutionOptions {
  /** Longest side of the output, in px. Default 1536 (Illustrious/Anima ceiling). */
  maxLongSide?: number
  /** Both dimensions are snapped to this multiple. Default 64. */
  multiple?: number
  /** When true, `maxLongSide` is a hard per-side cap (classic behavior)
   *  instead of the side of an equivalent total-area budget. Default false. */
  strictCap?: boolean
  /** When true, ignore the source's raw aspect ratio and instead pick the
   *  closest entry from `SUPPORTED_BUCKET_RESOLUTIONS` (see below). Default false. */
  snapToBucket?: boolean
}

/**
 * Curated "bucket" resolutions the model was actually trained/tested on
 * (Illustrious/Anima-class SDXL checkpoints), covering the common aspect
 * ratios — 1:1, 2:3 / 3:2 (portrait/landscape "poster"), 3:4 / 4:3, and
 * 9:16 / 16:9 (phone/widescreen) — within Anima's documented working range
 * of roughly 512^2 to 1536^2 total pixels. Using one of these instead of an
 * arbitrary aspect ratio derived from a booru post's raw dimensions avoids
 * feeding the model a ratio it wasn't trained on (which tends to produce
 * warped anatomy/composition), at the cost of a slight crop/pad vs. the
 * source image's exact proportions.
 *
 * `1536x1536` is included but documented upstream as "iffy" (Anima's ceiling
 * is a total-area budget of 1536^2 px; a full 1536x1536 square sits exactly
 * at that ceiling and edges into unreliable territory for some workflows) —
 * kept as an option rather than omitted since it's still within the stated
 * working range.
 */
export const SUPPORTED_BUCKET_RESOLUTIONS: readonly GenerationResolution[] = [
  // 1:1
  { width: 1024, height: 1024 },
  { width: 1536, height: 1536 }, // iffy — see doc comment above
  // 2:3 / 3:2 (portrait / landscape "poster")
  { width: 832, height: 1216 },
  { width: 1216, height: 832 },
  // 3:4 / 4:3
  { width: 1152, height: 1536 },
  { width: 1536, height: 1152 },
  // 9:16 / 16:9
  { width: 768, height: 1344 },
  { width: 1344, height: 768 },
]

/**
 * Picks the entry from `SUPPORTED_BUCKET_RESOLUTIONS` whose aspect ratio is
 * closest to the source's, then rescales that bucket (preserving ITS aspect
 * ratio, not the source's) to respect the caller's cap — same two capping
 * semantics as the free-form path (`strictCap`: hard per-side ceiling vs.
 * total-area budget) — and snaps to `multiple`.
 *
 * Comparing aspect ratios in log-space (`Math.log(w/h)`) rather than raw
 * ratio makes "distance" symmetric between portrait and landscape (e.g. 2:3
 * and 3:2 are equally "one step" from 1:1), so a source's orientation always
 * matches the winning bucket's orientation — a landscape source can never
 * snap to a portrait bucket, and vice versa, since flipping orientation
 * would always be a larger log-distance than the closest same-orientation
 * bucket (verified by construction: the bucket list is orientation-paired).
 */
function pickClosestBucketResolution(srcWidth: number, srcHeight: number): GenerationResolution {
  const srcLogRatio = Math.log(srcWidth / srcHeight)
  let best = SUPPORTED_BUCKET_RESOLUTIONS[0]
  let bestDistance = Infinity
  for (const bucket of SUPPORTED_BUCKET_RESOLUTIONS) {
    const bucketLogRatio = Math.log(bucket.width / bucket.height)
    const distance = Math.abs(bucketLogRatio - srcLogRatio)
    if (distance < bestDistance) {
      bestDistance = distance
      best = bucket
    }
  }
  return best
}

/**
 * Scales (srcWidth, srcHeight) to the largest size that (a) preserves the
 * source aspect ratio and (b) respects the configured cap — either a hard
 * per-side ceiling of `maxLongSide` (`strictCap: true`) or a total-pixel-area
 * budget of `maxLongSide * maxLongSide` (default, e.g. 1536*1536 =
 * 2,359,296 px for Anima) — then rounds both dimensions down to a multiple of
 * `multiple` (never below one multiple) so the result never overshoots the
 * budget after snapping.
 *
 * When `options.snapToBucket` is true, the SOURCE aspect ratio is ignored in
 * favor of the closest entry in `SUPPORTED_BUCKET_RESOLUTIONS` (see
 * `pickClosestBucketResolution`) — trading a slight crop/pad vs. the source
 * image's exact proportions for staying on an aspect ratio the model
 * actually knows well, instead of an arbitrary ratio derived from whatever
 * the booru post happened to be.
 *
 * Returns null when the source dimensions are missing/invalid — callers
 * should treat that as "nothing to adjust, send the prompt as-is" rather
 * than an error (graceful degradation).
 */
export function computeGenerationResolution(
  srcWidth: number | undefined | null,
  srcHeight: number | undefined | null,
  options?: ComputeGenerationResolutionOptions
): GenerationResolution | null {
  if (!srcWidth || !srcHeight || srcWidth <= 0 || srcHeight <= 0) return null

  const multiple = options?.multiple && options.multiple > 0 ? options.multiple : 64
  const rawMax = options?.maxLongSide && options.maxLongSide > 0 ? options.maxLongSide : 1536
  const strictCap = options?.strictCap ?? false
  // Normalize the cap itself to a valid multiple so it never overshoots after snapping.
  const budgetSide = Math.max(multiple, Math.floor(rawMax / multiple) * multiple)

  // `snapToBucket` swaps the source's raw aspect ratio for the closest
  // curated bucket, then continues through the SAME scaling/capping logic
  // below (using the bucket's ratio in place of srcWidth/srcHeight) so the
  // result still respects maxLongSide/strictCap/multiple exactly as before.
  if (options?.snapToBucket) {
    const bucket = pickClosestBucketResolution(srcWidth, srcHeight)
    srcWidth = bucket.width
    srcHeight = bucket.height
  }

  if (strictCap) {
    // Strict behavior: scale so the LONGEST source side maps exactly to
    // budgetSide — both up AND down. A small source (e.g. 764px with cap
    // 1536) is upscaled to fill the cap, and a large source is downscaled
    // to fit it. This guarantees max(width, height) === budgetSide (within
    // rounding to `multiple`) regardless of the source size or aspect ratio.
    const longestSrcSide = Math.max(srcWidth, srcHeight)
    const scale = budgetSide / longestSrcSide
    const targetWidth = srcWidth * scale
    const targetHeight = srcHeight * scale
    const snapDown = (value: number) => {
      const snapped = Math.floor(value / multiple) * multiple
      return Math.max(multiple, snapped)
    }
    const snapUp = (value: number) => Math.ceil(value / multiple) * multiple

    let width = snapDown(targetWidth)
    let height = snapDown(targetHeight)

    // Snapping down independently can leave one side under-rounded relative
    // to its OWN aspect-ratio-scaled target (never both, and never past the
    // next `multiple` step) — unlike "area" mode, we must NOT grow a side
    // past what the aspect ratio actually calls for, or a non-square source
    // would drift toward square as the cap is approached. Only round a side
    // UP to the next multiple when that's still <= budgetSide and the
    // rounding error is less than a full step — this recovers precision
    // lost to Math.floor without ever exceeding budgetSide.
    if (snapUp(targetWidth) <= budgetSide && snapUp(targetWidth) - targetWidth < multiple) {
      width = snapUp(targetWidth)
    }
    if (snapUp(targetHeight) <= budgetSide && snapUp(targetHeight) - targetHeight < multiple) {
      height = snapUp(targetHeight)
    }

    return { width, height }
  }

  const maxTotalPixels = budgetSide * budgetSide

  // Scale factor that makes srcWidth*scale * srcHeight*scale == maxTotalPixels,
  // i.e. scale = sqrt(maxTotalPixels / srcArea). This is the aspect-ratio-preserving
  // scale that maximizes area usage, unlike anchoring to the longest side alone.
  const srcArea = srcWidth * srcHeight
  const scale = Math.sqrt(maxTotalPixels / srcArea)

  // Round DOWN to the multiple (not nearest) so snapping can only shrink the
  // area, never push it back over budget.
  const snapDown = (value: number) => {
    const scaled = value * scale
    const snapped = Math.floor(scaled / multiple) * multiple
    return Math.max(multiple, snapped)
  }

  let width = snapDown(srcWidth)
  let height = snapDown(srcHeight)

  // Rounding both dimensions down independently can leave headroom under the
  // budget (e.g. one side rounds down more than the other). Grow whichever
  // side has slack, one `multiple` step at a time, while area stays in budget.
  // Bounded by budgetSide/multiple so a pathological aspect ratio can't loop
  // more than a few dozen times.
  const maxSteps = Math.ceil(budgetSide / multiple) + 1
  for (let i = 0; i < maxSteps; i++) {
    const canGrowWidth = (width + multiple) * height <= maxTotalPixels
    const canGrowHeight = width * (height + multiple) <= maxTotalPixels
    if (canGrowWidth && (!canGrowHeight || width <= height)) {
      width += multiple
    } else if (canGrowHeight) {
      height += multiple
    } else {
      break
    }
  }

  return { width, height }
}
