import type { CSSProperties, ReactNode } from "react"
import { Img, staticFile } from "remotion"
import { Check, ChevronDown, Copy, MoreHorizontal } from "lucide-react"
import { CARD, CARD_HEIGHT } from "./layout"
import { C, FONT, u } from "./theme"

// Recreations of the site's controls, drawn at 1.6× (see `u`). Sizes follow
// the real components: card (components/prompt-gallery/masonry-item.tsx),
// menus (components/ui/dropdown-menu.tsx), select and switch.

export function PromptCard({
  well,
  copied = 0,
  showMore = 0,
  overlay,
}: {
  well: ReactNode
  /** 0 → 1: the Copy button turns into "Copied!". */
  copied?: number
  /** Opacity of the hover controls on the image. */
  showMore?: number
  /** Extra layers on top of the image (name chips). */
  overlay?: ReactNode
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: CARD.x,
        top: CARD.y,
        width: CARD.width,
        height: CARD_HEIGHT,
        borderRadius: u(12),
        background: C.card,
        overflow: "hidden",
      }}
    >
      <div style={{ position: "relative", height: CARD.imageHeight, overflow: "hidden" }}>
        <Img
          src={staticFile("danbooru-5513008.jpg")}
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 6%" }}
        />
        {overlay}
        <div
          style={{
            position: "absolute",
            right: 14,
            top: 14,
            width: 40,
            height: 40,
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "color-mix(in oklab, " + C.background + " 80%, transparent)",
            color: C.mutedForeground,
            boxShadow: "0 1px 2px rgb(0 0 0 / 0.25)",
            opacity: showMore,
          }}
        >
          <MoreHorizontal size={22} />
        </div>
      </div>
      <div style={{ padding: CARD.pad, display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            position: "relative",
            height: CARD.wellHeight,
            borderRadius: u(10),
            background: "color-mix(in oklab, " + C.muted + " 50%, transparent)",
            overflow: "hidden",
          }}
        >
          {well}
        </div>
        <CopyButton copied={copied} />
      </div>
    </div>
  )
}

function CopyButton({ copied }: { copied: number }) {
  const fill = copied > 0.5 ? C.primary : C.secondary
  const ink = copied > 0.5 ? C.primaryForeground : C.foreground
  return (
    <div style={{ display: "flex", height: CARD.buttonHeight, borderRadius: u(8), overflow: "hidden", fontFamily: FONT }}>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          background: fill,
          color: ink,
          fontSize: 21,
          fontWeight: 500,
        }}
      >
        {copied > 0.5 ? <Check size={22} /> : <Copy size={22} />}
        {copied > 0.5 ? "Copied!" : "Copy"}
      </div>
      <div
        style={{
          width: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: fill,
          color: ink,
          borderLeft: "1px solid color-mix(in oklab, " + C.foreground + " 10%, transparent)",
        }}
      >
        <ChevronDown size={22} />
      </div>
    </div>
  )
}

/** Plain prompt text inside the card's well. */
export function WellText({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: "12px 15px",
        fontFamily: FONT,
        fontSize: 19,
        lineHeight: 1.55,
        color: C.foreground,
        overflowWrap: "anywhere",
        // The well clips long prompts; fade the cut line instead of slicing it.
        maskImage: "linear-gradient(to bottom, black calc(100% - 40px), transparent calc(100% - 6px))",
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        borderRadius: u(10),
        background: C.popover,
        border: `1px solid ${C.border}`,
        boxShadow: "0 8px 24px -6px rgb(0 0 0 / 0.35), 0 2px 6px rgb(0 0 0 / 0.2)",
        fontFamily: FONT,
        color: C.foreground,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div style={{ padding: "10px 14px 8px", fontSize: 19, fontWeight: 600 }}>{children}</div>
}

export function MenuSeparator() {
  return <div style={{ height: 1, margin: "6px -6px", background: C.border }} />
}

export function MenuItem({
  icon,
  label,
  hint,
  highlight = 0,
}: {
  icon?: ReactNode
  label: ReactNode
  hint?: ReactNode
  /** 0 → 1: hover/focus fill. */
  highlight?: number
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        height: 46,
        padding: "0 14px",
        borderRadius: u(6),
        fontSize: 19,
      }}
    >
      <div style={{ position: "absolute", inset: 0, borderRadius: u(6), background: C.accent, opacity: highlight }} />
      <div style={{ position: "relative", width: 34, display: "flex", alignItems: "center" }}>{icon}</div>
      <div style={{ position: "relative", flex: 1 }}>{label}</div>
      {hint !== undefined && <div style={{ position: "relative", marginLeft: 12 }}>{hint}</div>}
    </div>
  )
}

export function CountPill({ n }: { n: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        minWidth: 34,
        padding: "2px 9px",
        borderRadius: 999,
        background: C.muted,
        color: C.mutedForeground,
        fontSize: 16,
        textAlign: "center",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {n}
    </span>
  )
}

export function Hint({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 17, color: C.mutedForeground }}>{children}</span>
}

export function SettingRow({ label, hint, control, last }: { label: ReactNode; hint: ReactNode; control: ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 18,
        minHeight: 90,
        borderBottom: last ? "none" : `1px solid color-mix(in oklab, ${C.border} 50%, transparent)`,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 21 }}>{label}</span>
        <span style={{ fontSize: 17, color: C.mutedForeground }}>{hint}</span>
      </div>
      {control}
    </div>
  )
}

export function SelectTrigger({ value, open }: { value: string; open: number }) {
  return (
    <div
      style={{
        width: 236,
        height: 52,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 14px 0 16px",
        borderRadius: u(8),
        background: C.background,
        border: `1px solid ${C.border}`,
        boxShadow: open > 0 ? `0 0 0 ${2 * open}px color-mix(in oklab, ${C.primary} 60%, transparent)` : "none",
        fontSize: 19,
      }}
    >
      <span>{value}</span>
      <ChevronDown size={20} color={C.mutedForeground} />
    </div>
  )
}

export function Switch({ on }: { on: number }) {
  const w = 70
  const h = 40
  const knob = 32
  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: h,
        flexShrink: 0,
        borderRadius: 999,
        background: on > 0.5 ? C.primary : C.muted,
        transition: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: (h - knob) / 2,
          left: 4 + on * (w - knob - 8),
          width: knob,
          height: knob,
          borderRadius: 999,
          background: C.foreground,
          boxShadow: "0 1px 3px rgb(0 0 0 / 0.3)",
        }}
      />
    </div>
  )
}

/** Night Scrim chip, the only thing the site puts on artwork. */
export function ScrimChip({ children, dot, style }: { children: ReactNode; dot: string; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 11px",
        borderRadius: u(8),
        background: `color-mix(in oklab, ${C.overlay} 72%, transparent)`,
        color: "white",
        fontFamily: FONT,
        fontSize: 17,
        fontWeight: 500,
        whiteSpace: "nowrap",
        boxShadow: "0 1px 2px rgb(0 0 0 / 0.3)",
        ...style,
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: 999, background: dot }} />
      {children}
    </div>
  )
}

/** Mouse pointer; `press` (0 → 1) squeezes it on click. */
export function Pointer({ x, y, press = 0, opacity = 1 }: { x: number; y: number; press?: number; opacity?: number }) {
  return (
    <svg
      width={34}
      height={34}
      viewBox="0 0 24 24"
      style={{
        position: "absolute",
        left: x - 6,
        top: y - 4,
        opacity,
        transform: `scale(${1 - press * 0.14})`,
        transformOrigin: "6px 4px",
        filter: "drop-shadow(0 2px 3px rgb(0 0 0 / 0.45))",
      }}
    >
      <path d="M5 3l14 8.2-6.3 1.4 3.6 6.6-2.6 1.4-3.6-6.6L5 18.6z" fill="white" stroke="black" strokeWidth={1.3} strokeLinejoin="round" />
    </svg>
  )
}

/** Expanding ring where a click lands. */
export function ClickRing({ x, y, progress }: { x: number; y: number; progress: number }) {
  if (progress <= 0 || progress >= 1) return null
  const r = 10 + progress * 26
  return (
    <div
      style={{
        position: "absolute",
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: 999,
        border: `3px solid ${C.foreground}`,
        opacity: (1 - progress) * 0.6,
      }}
    />
  )
}
