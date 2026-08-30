// Pure helper: split a pasted block of prompts into individual prompts for the
// extension's "Import Prompt List" feature.
//
// Recognition rule (as specified for the import): each prompt is a
// comma-separated tag list whose LAST tag carries no trailing comma. Prompts
// are separated by line breaks. A line that still ends with a comma is a
// continuation of the previous prompt (multi-line wrap), so:
//
//   thick thighs, wide hips, ..., explicit
//   1girl, solo, ..., full body
//
// parses to two prompts. A wrapped prompt:
//
//   thick thighs, wide hips,
//   shiny skin, ..., explicit
//
// parses to a single prompt (the first line ends with a comma, so it is
// continued rather than terminated, and the tags stay comma-joined).
//
// ── Inline resolution ──
// A prompt may optionally declare the generation resolution it should be sent
// with, as a `[WIDTHxHEIGHT]` token at the very START of the prompt:
//
//   [1024x1536] 1girl, solo, full body
//   [1536x1024], scenery, no humans
//
// The token is stripped from the prompt text and returned as `width`/`height`
// so the caller can forward it to the extension (the sidepanel already accepts
// width/height on INJECT_PROMPT for the "Match image resolution" feature).
// Prompts without the token get no width/height and keep the previous
// behavior: the generator's current resolution is left untouched.

import { computeGenerationResolution } from "./generation-resolution"

/**
 * Hard per-side ceiling for an inline `[WIDTHxHEIGHT]` request, in px.
 * 1536 is the Illustrious/Anima working ceiling already used elsewhere in the
 * extension's resolution pipeline.
 */
export const MAX_INLINE_RESOLUTION_SIDE = 1536

export interface ParsedPromptListItem {
  /** Prompt text with the `[WIDTHxHEIGHT]` token (if any) removed. */
  prompt: string
  /** Present only when the prompt declared a valid inline resolution. */
  width?: number
  height?: number
}

export interface ParsePromptListOptions {
  /** Per-side cap applied to inline resolutions. Default MAX_INLINE_RESOLUTION_SIDE. */
  maxSide?: number
}

/**
 * Leading `[WIDTHxHEIGHT]` token, with tolerant spacing, an `x` / `X` / `×`
 * separator, and an optional comma right after the closing bracket (so both
 * `[1024x1536] 1girl` and `[1024x1536], 1girl` work).
 */
const RESOLUTION_PREFIX_RE = /^\[\s*(\d{1,5})\s*[x×]\s*(\d{1,5})\s*\]\s*,?\s*/i

/**
 * Splits a leading inline resolution off a prompt.
 *
 * - Values within the cap are honored VERBATIM (an explicit `[1000x1500]` is
 *   the user's call and is not snapped to a multiple of 64).
 * - A value above the cap is scaled DOWN preserving the requested aspect
 *   ratio, reusing computeGenerationResolution's strict per-side cap (which
 *   also snaps to a multiple of 64), e.g. `[3072x1536]` -> 1536x768.
 * - A token shaped like a resolution but carrying a zero side (`[0x1024]`) is
 *   left untouched in the prompt text rather than silently guessed at, so the
 *   malformed input stays visible to the user.
 */
function extractInlineResolution(prompt: string, maxSide: number): ParsedPromptListItem {
  const match = prompt.match(RESOLUTION_PREFIX_RE)
  if (!match) return { prompt }

  const requestedWidth = Number(match[1])
  const requestedHeight = Number(match[2])
  if (!requestedWidth || !requestedHeight) return { prompt }

  const rest = prompt.slice(match[0].length).trim()
  const fitsCap = requestedWidth <= maxSide && requestedHeight <= maxSide
  const resolution = fitsCap
    ? { width: requestedWidth, height: requestedHeight }
    : computeGenerationResolution(requestedWidth, requestedHeight, {
        maxLongSide: maxSide,
        strictCap: true,
      })

  return resolution ? { prompt: rest, ...resolution } : { prompt: rest }
}

/**
 * Parse a pasted block of text into a list of individual prompts.
 *
 * - Input is split on CRLF / LF / CR line breaks.
 * - A trimmed, non-empty line is appended to the prompt currently being built
 *   (a trailing comma on a continued line is preserved so tags remain
 *   comma-joined).
 * - If that line ends with a comma (optionally followed by trailing
 *   whitespace), the prompt is considered to continue on the next line.
 * - Otherwise the line terminates the prompt, which is pushed and reset.
 * - Blank lines also terminate any in-progress prompt.
 * - A leading `[WIDTHxHEIGHT]` token is stripped and returned as width/height,
 *   capped per side (see extractInlineResolution).
 *
 * Returns only prompts with non-empty text (leading/trailing whitespace
 * trimmed). A line holding nothing but a resolution token yields no prompt.
 */
export function parsePromptList(
  text: string,
  options?: ParsePromptListOptions
): ParsedPromptListItem[] {
  const maxSide =
    options?.maxSide && options.maxSide > 0 ? options.maxSide : MAX_INLINE_RESOLUTION_SIDE
  const lines = (text || "").split(/\r\n|\r|\n/)
  const prompts: ParsedPromptListItem[] = []
  let current = ""

  const pushCurrent = () => {
    const trimmed = current.trim()
    current = ""
    if (!trimmed) return
    const item = extractInlineResolution(trimmed, maxSide)
    if (item.prompt) prompts.push(item)
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      pushCurrent()
      continue
    }
    const continues = /,\s*$/.test(line)
    current = current ? `${current} ${line}` : line
    if (!continues) pushCurrent()
  }
  pushCurrent()

  return prompts
}
