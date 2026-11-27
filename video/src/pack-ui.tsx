import type { CSSProperties, ReactNode } from "react"
import { Ban, Plus, X } from "lucide-react"
import { textWidth } from "./comfy-ui"
import { C, FONT, MONO } from "./theme"

// Pieces of the Pack screen (components/prompt-gallery/pack/*), drawn in the
// site's own CSS pixels inside a panel that PackMode.tsx scales up by `MS`.
// Writing them at their real sizes keeps every gap, height and font size
// checkable against the Tailwind classes they copy.

/**
 * The panel is drawn 1.5× its real size: 880 video px are 587 CSS px, the
 * width of the pack screen on a small laptop, where it shows one column.
 */
export const MS = 1.5
/** Where the panel sits on the 960×720 canvas (video px), and its size in CSS px. */
export const PANEL = { x: 40, y: 108, w: 880 / MS, h: 588 / MS }
/** CSS px inside the panel → video px on the canvas. */
export const toVideo = (x: number, y: number) => ({ x: PANEL.x + x * MS, y: PANEL.y + y * MS })

/** Dark theme tokens the pack uses and theme.ts doesn't have, copied from app/globals.css (.dark). */
export const P = {
  faint: "oklch(0.68 0.02 250)",
  ring: "oklch(0.58 0.09 150)",
  primaryText: "oklch(0.72 0.11 150)",
  destructive: "oklch(0.68 0.16 35)",
  destructiveText: "oklch(0.79 0.1235 35)",
  successText: "oklch(0.79 0.15 164)",
  infoText: "oklch(0.79 0.1133 246)",
  pack: "oklch(0.71 0.1575 238)",
  packText: "oklch(0.79 0.1211 238)",
  appearance: "oklch(0.68 0.16 45)",
  appearanceText: "oklch(0.79 0.1296 45)",
  clothing: "oklch(0.71 0.1307 178)",
  clothingText: "oklch(0.79 0.1454 178)",
  pose: "oklch(0.71 0.1293 220)",
  poseText: "oklch(0.79 0.1439 220)",
  scenery: "oklch(0.71 0.16 123)",
  sceneryText: "oklch(0.79 0.15 123)",
} as const

const mix = (color: string, pct: number) => `color-mix(in oklab, ${color} ${pct}%, transparent)`
/** `bg-*-soft` and `border-*-border` (--mix-soft 16%, --mix-border 40% in dark). */
export const soft = (color: string) => mix(color, 16)
export const edge = (color: string) => mix(color, 40)
export const alpha = mix

// ---------------------------------------------------------------------------
// Layout: the site wraps chips with flex-wrap; here the same rule runs in
// code, so the pointer knows where each chip and field lands.
// ---------------------------------------------------------------------------

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** One item of a wrapping row. `grow`: a field that takes the rest of its line, at least this wide. */
export interface FlowItem {
  w: number
  h: number
  grow?: number
}

/** flex flex-wrap items-center gap-1.5: boxes relative to the row, and the row's height. */
export function flow(items: readonly FlowItem[], maxW: number, gap = 6): { boxes: Box[]; height: number } {
  const boxes: Box[] = []
  let line: number[] = []
  let x = 0
  let top = 0
  let lineH = 0
  const close = () => {
    for (const i of line) boxes[i].y = top + (lineH - boxes[i].h) / 2
    top += lineH + gap
    line = []
    x = 0
    lineH = 0
  }
  items.forEach((item, i) => {
    let width = item.w
    if (item.grow !== undefined) {
      if (line.length > 0 && maxW - x < item.grow) close()
      width = maxW - x
    } else if (line.length > 0 && x + item.w > maxW) close()
    boxes[i] = { x, y: 0, w: width, h: item.h }
    line.push(i)
    x += width + gap
    lineH = Math.max(lineH, item.h)
  })
  if (line.length > 0) close()
  return { boxes, height: Math.max(0, top - gap) }
}

/** Greedy word wrap, for text the pointer or the layout needs to know the lines of. */
export function wrapWords(text: string, maxW: number, size: number, weight = 400, family = FONT): string[] {
  const words = text.split(" ")
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && textWidth(next, size, weight, family) > maxW) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

/** A prompt's tags as the result row shows them: "tag," kept whole, lines break at the spaces. */
export function wrapTags(tags: readonly string[], maxW: number): { tag: string; line: number; x: number; w: number }[] {
  const space = textWidth(" ", 13, 500, MONO)
  const out: { tag: string; line: number; x: number; w: number }[] = []
  let line = 0
  let x = 0
  tags.forEach((tag, i) => {
    const w = textWidth(tag, 13, 500, MONO)
    const withComma = w + (i < tags.length - 1 ? textWidth(",", 13, 500, MONO) : 0)
    if (x > 0 && x + withComma > maxW) {
      line += 1
      x = 0
    }
    out.push({ tag, line, x, w })
    x += withComma + space
  })
  return out
}

// ---------------------------------------------------------------------------
// Chips (request-chip.tsx)
// ---------------------------------------------------------------------------

export type Tone = "plain" | "appearance" | "clothing" | "pose" | "scenery"

export interface ChipSpec {
  label: string
  tone?: Tone
  /** A character's name: bolder, in the pack's colour. */
  strong?: boolean
  /** Part of a character's usual look. */
  trait?: boolean
  never?: boolean
  /** Wearing and Where: Any or Exactly, a button at the chip's start. */
  mode?: "Any" | "Exactly"
}

const TONES: Record<Exclude<Tone, "plain">, { text: string; base: string }> = {
  appearance: { text: P.appearanceText, base: P.appearance },
  clothing: { text: P.clothingText, base: P.clothing },
  pose: { text: P.poseText, base: P.pose },
  scenery: { text: P.sceneryText, base: P.scenery },
}

/** Width of the Any / Exactly button (h-6 px-1.5 text-[11px]). */
export const modeWidth = (mode: string) => 12 + textWidth(mode, 11, 500)

/** h-7, border, pl-2 (pl-0.5 with a mode), gap-1, then the 24 px Remove button and pr-0.5. */
export function chipWidth(spec: ChipSpec): number {
  const label = textWidth(spec.label, 13, spec.strong ? 600 : 500)
  const start = spec.mode ? 2 + modeWidth(spec.mode) + 4 : 8
  const icon = spec.never ? 14 + 4 : 0
  return 2 + start + icon + label + 4 + 24 + 2
}

export function Chip({ spec, box, style }: { spec: ChipSpec; box: Box; style?: CSSProperties }) {
  const tone = spec.tone && spec.tone !== "plain" ? TONES[spec.tone] : null
  const surface = spec.strong
    ? { color: P.packText, background: soft(P.pack), borderColor: edge(P.pack) }
    : spec.never
      ? { color: P.destructiveText, background: soft(P.destructive), borderColor: edge(P.destructive) }
      : spec.trait
        ? { color: C.mutedForeground, background: alpha(C.background, 40), borderColor: C.border }
        : tone
          ? { color: tone.text, background: soft(tone.base), borderColor: edge(tone.base) }
          : { color: C.foreground, background: C.secondary, borderColor: "transparent" }
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: 28,
        display: "flex",
        alignItems: "center",
        gap: 4,
        paddingLeft: spec.mode ? 2 : 8,
        paddingRight: 2,
        borderRadius: 6,
        border: "1px solid",
        fontSize: 13,
        lineHeight: 1,
        whiteSpace: "nowrap",
        ...surface,
        ...style,
      }}
    >
      {spec.never && <Ban size={14} style={{ flexShrink: 0 }} />}
      {spec.mode && (
        <span
          style={{
            height: 24,
            padding: "0 6px",
            display: "flex",
            alignItems: "center",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 500,
            background: spec.mode === "Exactly" ? alpha("currentColor", 15) : "transparent",
          }}
        >
          {spec.mode}
        </span>
      )}
      <span style={{ fontWeight: spec.strong ? 600 : 500, flex: 1 }}>{spec.label}</span>
      <span style={{ width: 24, height: 24, display: "grid", placeItems: "center", flexShrink: 0 }}>
        <X size={14} />
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The field at the end of each row (tag-entry.tsx)
// ---------------------------------------------------------------------------

export function Field({
  box,
  placeholder,
  text = "",
  empty,
  focus = 0,
  caret = false,
  trailing,
}: {
  box: Box
  placeholder: string
  text?: string
  /** The row has nothing yet: a soft well that reads "Anything". */
  empty: boolean
  /** 0 → 1: focused (background and ring). */
  focus?: number
  caret?: boolean
  trailing?: ReactNode
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: 32,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 10px",
        borderRadius: 8,
        background: focus > 0.5 ? C.background : empty ? alpha(C.muted, 55) : "transparent",
        boxShadow: focus > 0 ? `0 0 0 ${2 * focus}px ${alpha(P.ring, 60)}` : "none",
        fontSize: 14,
      }}
    >
      {!empty && <Plus size={14} color={P.faint} style={{ flexShrink: 0 }} />}
      <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", display: "flex", alignItems: "center" }}>
        {text ? <span style={{ color: C.foreground }}>{text}</span> : !caret && <span style={{ color: C.mutedForeground }}>{placeholder}</span>}
        {caret && <span style={{ width: 1.5, height: 17, marginLeft: 1, background: C.foreground }} />}
      </span>
      {trailing}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row label, segmented choice, popover list
// ---------------------------------------------------------------------------

/** brief-slot.tsx SlotLabel: category icon and the row's name, h-8. */
export function SlotLabel({ icon, label, x, y }: { icon: ReactNode; label: string; x: number; y: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, height: 32, display: "flex", alignItems: "center", gap: 8 }}>
      {icon}
      <span style={{ fontSize: 13, fontWeight: 500, color: C.mutedForeground }}>{label}</span>
    </div>
  )
}

/** Each button of a small segmented ChoiceGroup (h-6 px-2 text-xs). */
export const segmentWidths = (labels: readonly string[]) => labels.map((l) => 16 + textWidth(l, 12, 500))
/** Border, p-0.5, the buttons and their gap-0.5. */
export const segmentedWidth = (labels: readonly string[]) =>
  2 + 4 + segmentWidths(labels).reduce((a, b) => a + b, 0) + 2 * (labels.length - 1)

export function Segmented({ labels, value, box, hover }: { labels: readonly string[]; value: number; box: Box; hover?: number }) {
  const widths = segmentWidths(labels)
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        height: 30,
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: 2,
        borderRadius: 8,
        border: `1px solid ${C.border}`,
        background: alpha(C.muted, 50),
      }}
    >
      {labels.map((l, i) => (
        <span
          key={l}
          style={{
            width: widths[i],
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            whiteSpace: "nowrap",
            color: i === value || i === hover ? C.foreground : C.mutedForeground,
            background: i === value ? C.background : "transparent",
            boxShadow: i === value ? "0 1px 2px rgb(0 0 0 / 0.25)" : "none",
          }}
        >
          {l}
        </span>
      ))}
    </div>
  )
}

/** A dropdown or listbox surface (bg-popover, border, rounded-lg, shadow-lg, p-1). */
export function Popover({ box, children, style }: { box: Omit<Box, "h"> & { h?: number }; children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        padding: 4,
        borderRadius: 8,
        border: `1px solid ${C.border}`,
        background: C.popover,
        boxShadow: "0 10px 24px -6px rgb(0 0 0 / 0.45), 0 2px 6px rgb(0 0 0 / 0.25)",
        fontFamily: FONT,
        color: C.foreground,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
