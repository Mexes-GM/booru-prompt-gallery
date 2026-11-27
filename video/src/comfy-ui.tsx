import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { continueRender, delayRender, Easing, interpolate, random, staticFile, Img } from "remotion"
import { Check, Copy, ExternalLink, Loader2, Play, Search, Send, X } from "lucide-react"
import { C, FONT, fontsReady, u } from "./theme"

// Pieces for the Send to ComfyUI video and the setup guide's loops: an
// abstract ComfyUI window (no logo, shapes and a few real labels, like the
// guide's old illustrations), the guide's "From your ComfyUI" list, and
// a card's job surface from components/prompt-gallery/comfyui-card-job.tsx
// with the curves from comfyui-motion.tsx.

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/** lib/motion.ts and comfyui-motion.tsx, as Remotion curves. */
export const EASE = {
  out: Easing.bezier(0.23, 1, 0.32, 1),
  inOut: Easing.bezier(0.77, 0, 0.175, 1),
  rise: Easing.bezier(0.32, 0.72, 0, 1),
  exit: Easing.bezier(0.4, 0, 1, 1),
  /** Framer's spring with a little bounce (chip, pill): overshoots ~3%. */
  springy: Easing.bezier(0.3, 1.25, 0.5, 1),
}

/** Clamped interpolation with a curve: 0 → 1 between `from` and `to` (or `out`). */
export function ease(frame: number, from: number, to: number, curve = EASE.out, out: [number, number] = [0, 1]) {
  return interpolate(frame, [from, to], out, { easing: curve, extrapolateLeft: "clamp", extrapolateRight: "clamp" })
}

/** 0 → 1 → 0, with its own curves in and out. */
export function window01(frame: number, start: number, end: number, fadeIn = 8, fadeOut = 8) {
  return Math.min(ease(frame, start, start + fadeIn), 1 - ease(frame, end - fadeOut, end, EASE.exit))
}

/** Seconds → frames at 30 fps. */
export const sec = (s: number) => Math.round(s * 30)

// ---------------------------------------------------------------------------
// Text measuring (chip widths follow their label, as on the site)
// ---------------------------------------------------------------------------

let ctx: CanvasRenderingContext2D | null = null
export function textWidth(text: string, size: number, weight = 500, family = FONT) {
  ctx ??= document.createElement("canvas").getContext("2d")
  if (!ctx) return text.length * size * 0.55
  ctx.font = `${weight} ${size}px ${family}`
  return ctx.measureText(text).width
}

/** Holds the frame until the fonts are in, so measured widths are right. */
export function useFontsMeasured() {
  const [handle] = useState(() => delayRender("Waiting for fonts to measure text"))
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void fontsReady.then(() => {
      setReady(true)
      continueRender(handle)
    })
  }, [handle])
  return ready
}

// ---------------------------------------------------------------------------
// The generated image: a painted flower field, drawn here so the video uses
// no one's artwork as ComfyUI's output.
// ---------------------------------------------------------------------------

const PALETTES = [
  {
    sky: ["#cfdcea", "#eef0ec", "#f6efe2"],
    sun: "#fffaf0",
    far: "#aebfbe",
    mid: ["#9fb58f", "#7f9b6f"],
    near: ["#5f7d52", "#3a5236"],
    flowers: ["#fff8e2", "#f5d86e", "#f4b6c4", "#ffffff"],
  },
  {
    sky: ["#e9a98a", "#f6cfa6", "#fbe6c8"],
    sun: "#fff4d8",
    far: "#c79e86",
    mid: ["#b7a46a", "#94874f"],
    near: ["#6b6a36", "#3e3f22"],
    flowers: ["#fff1cf", "#f7c35a", "#f39b8b", "#fffaf0"],
  },
] as const

function Figure({ x, base, hair, dress, scale = 1, flip = false }: { x: number; base: number; hair: string; dress: string; scale?: number; flip?: boolean }) {
  // Seen from behind, in a breeze from the left: long hair and the skirt
  // sweep right. Drawn small and soft, like figures in a landscape painting.
  const skin = "#f1d3c0"
  return (
    <g transform={`translate(${x} ${base}) scale(${flip ? -scale : scale} ${scale})`}>
      <ellipse cx={4} cy={1} rx={22} ry={3.5} fill="rgb(0 0 0 / 0.12)" />
      <path d="M-6 -2 L-4.5 -34 L-1 -34 L-2 -2 Z" fill={skin} />
      <path d="M2 -2 L1.5 -34 L5 -34 L5.5 -2 Z" fill="#e6c3ae" />
      {/* Skirt: narrow waist, full hem lifted on the right. */}
      <path d="M-8 -78 C-10 -62 -20 -44 -24 -30 C-12 -27 4 -26 30 -33 C24 -46 14 -62 8 -78 Z" fill={dress} />
      <path d="M-24 -30 C-12 -27 4 -26 30 -33 C20 -29 6 -28 -6 -28 C-14 -28 -20 -29 -24 -30 Z" fill="rgb(0 0 0 / 0.14)" />
      <path d="M-2 -76 C-4 -60 -6 -46 -6 -30" stroke="rgb(255 255 255 / 0.18)" strokeWidth={2} fill="none" />
      {/* Bodice and bare shoulders, arms at the sides. */}
      <path d="M-10 -98 C-11 -90 -9 -84 -8 -78 L8 -78 C9 -84 11 -90 10 -98 Z" fill={dress} />
      <path d="M-12 -100 C-13 -103 -6 -105 0 -105 C6 -105 13 -103 12 -100 L10 -97 L-10 -97 Z" fill={skin} />
      <path d="M-12 -100 C-15 -92 -15 -80 -13 -68" stroke={skin} strokeWidth={3.4} strokeLinecap="round" fill="none" />
      <path d="M12 -100 C15 -92 15 -80 14 -68" stroke="#e6c3ae" strokeWidth={3.4} strokeLinecap="round" fill="none" />
      {/* Head and long hair, swept right. */}
      <circle cx={0} cy={-114} r={9} fill={hair} />
      <path d="M-9 -116 C-11 -100 -9 -88 -4 -74 C2 -66 14 -64 24 -70 C14 -74 11 -86 10 -100 C10 -108 9 -114 7 -118 Z" fill={hair} />
      <path d="M-3 -120 C-2 -104 1 -90 8 -76" stroke="rgb(255 255 255 / 0.16)" strokeWidth={1.6} fill="none" />
    </g>
  )
}

/**
 * `develop` 0 → 1: a live preview turning into the final image (soft, grainy
 * and pale at first). `variant` picks the light: 0 morning, 1 golden hour.
 */
export function MeadowArt({
  variant,
  develop = 1,
  seed = 0,
  style,
  slice = "xMidYMid",
}: {
  variant: 0 | 1
  develop?: number
  seed?: number
  style?: CSSProperties
  slice?: string
}) {
  const p = PALETTES[variant]
  const id = `m${variant}`
  const flowers = Array.from({ length: 70 }, (_, i) => {
    const y = 190 + random(`${id}-y-${i}`) * 62
    const depth = (y - 190) / 62
    return {
      x: random(`${id}-x-${i}`) * 372 - 6,
      y,
      r: 0.9 + depth * 2.4 + random(`${id}-r-${i}`) * 0.8,
      color: p.flowers[Math.floor(random(`${id}-c-${i}`) * p.flowers.length)],
    }
  })
  const rough = 1 - develop
  return (
    <svg
      viewBox="0 0 360 250"
      preserveAspectRatio={`${slice} slice`}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        filter: rough > 0 ? `blur(${(rough * 7).toFixed(2)}px) saturate(${(1 - rough * 0.55).toFixed(2)}) contrast(${(1 - rough * 0.18).toFixed(2)})` : undefined,
        ...style,
      }}
    >
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.sky[0]} />
          <stop offset="0.55" stopColor={p.sky[1]} />
          <stop offset="1" stopColor={p.sky[2]} />
        </linearGradient>
        <radialGradient id={`${id}-sun`} cx={variant === 0 ? 0.72 : 0.3} cy={variant === 0 ? 0.16 : 0.5} r="0.55">
          <stop offset="0" stopColor={p.sun} stopOpacity="0.95" />
          <stop offset="1" stopColor={p.sun} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-mid`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.mid[0]} />
          <stop offset="1" stopColor={p.mid[1]} />
        </linearGradient>
        <linearGradient id={`${id}-near`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.near[0]} />
          <stop offset="1" stopColor={p.near[1]} />
        </linearGradient>
        <filter id={`${id}-figure`}>
          <feGaussianBlur stdDeviation="0.45" />
        </filter>
        <filter id={`${id}-soft`}>
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <filter id={`${id}-grain-${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={seed} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>
      <rect width="360" height="250" fill={`url(#${id}-sky)`} />
      <rect width="360" height="250" fill={`url(#${id}-sun)`} />
      <path d="M0 150 C60 128 110 140 170 132 C230 124 290 138 360 126 L360 250 L0 250 Z" fill={p.far} filter={`url(#${id}-soft)`} opacity="0.85" />
      <path d="M0 176 C70 160 130 172 200 164 C260 158 310 166 360 158 L360 250 L0 250 Z" fill={`url(#${id}-mid)`} />
      <g filter={`url(#${id}-figure)`}>
        <Figure x={158} base={200} hair={variant === 0 ? "#2b2730" : "#3a2a26"} dress={variant === 0 ? "#6f86ad" : "#7d6a9c"} scale={0.78} />
        <Figure x={196} base={203} hair={variant === 0 ? "#7b4b33" : "#8a5a3a"} dress={variant === 0 ? "#d98a97" : "#e0a07c"} scale={0.74} />
      </g>
      <path d="M0 206 C80 194 150 210 230 200 C290 194 330 200 360 196 L360 250 L0 250 Z" fill={`url(#${id}-near)`} />
      {flowers.map((f, i) => (
        <circle key={i} cx={f.x} cy={f.y} r={f.r} fill={f.color} opacity={0.9} />
      ))}
      {rough > 0 && <rect width="360" height="250" filter={`url(#${id}-grain-${seed})`} opacity={rough * 0.55} style={{ mixBlendMode: "overlay" }} />}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Pointer helpers
// ---------------------------------------------------------------------------

export type Key = [frame: number, x: number, y: number]
const MOVE = Easing.inOut(Easing.cubic)

export function pointerOn(path: Key[], frame: number) {
  const next = path.findIndex(([f]) => f > frame)
  if (next === -1) return { x: path.at(-1)![1], y: path.at(-1)![2] }
  if (next === 0) return { x: path[0][1], y: path[0][2] }
  const [f0, x0, y0] = path[next - 1]
  const [f1, x1, y1] = path[next]
  const t = MOVE((frame - f0) / (f1 - f0))
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t }
}

/** Press (0 → 1 → 0) and click ring progress for a list of click frames. */
export function clicksAt(clicks: number[], frame: number) {
  const press = Math.max(0, ...clicks.map((c) => Math.min(ease(frame, c, c + 3), 1 - ease(frame, c + 4, c + 7))))
  const ring = clicks.map((c) => (frame - c) / 16).find((p) => p > 0 && p < 1) ?? 0
  return { press, ring }
}

// ---------------------------------------------------------------------------
// ComfyUI window (neutral greys, so it reads as another app than the site)
// ---------------------------------------------------------------------------

export const CF = {
  canvas: "#1a1a1d",
  dot: "#2e2e34",
  chrome: "#222226",
  bar: "#26262a",
  border: "#36363d",
  dialog: "#252529",
  field: "#1c1c20",
  text: "#e7e7ea",
  muted: "#a3a3ab",
  shape: "#3b3b43",
  node: "#2a2a30",
  nodeHead: "#33333a",
}

export const WINDOW = { titleHeight: 46, barHeight: 62 }

function ShapeBar({ width, height = 9, color = CF.shape, style }: { width: number; height?: number; color?: string; style?: CSSProperties }) {
  return <span style={{ display: "block", width, height, borderRadius: 999, background: color, flexShrink: 0, ...style }} />
}

/** The window frame: title bar, top bar (with `barRight` on its right) and the graph canvas. */
export function ComfyWindow({
  x,
  y,
  width,
  height,
  barRight,
  children,
  style,
}: {
  x: number
  y: number
  width: number
  height: number
  barRight?: ReactNode
  children?: ReactNode
  style?: CSSProperties
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        borderRadius: 18,
        overflow: "hidden",
        border: `1px solid ${CF.border}`,
        background: CF.canvas,
        boxShadow: "0 18px 40px -16px rgb(0 0 0 / 0.55)",
        fontFamily: FONT,
        color: CF.text,
        ...style,
      }}
    >
      <div style={{ height: WINDOW.titleHeight, display: "flex", alignItems: "center", gap: 9, padding: "0 18px", background: CF.chrome, borderBottom: `1px solid ${CF.border}` }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 12, height: 12, borderRadius: 999, background: "#3d3d44" }} />
        ))}
        <span style={{ marginLeft: 10, fontSize: 18, fontWeight: 500, color: CF.muted }}>ComfyUI</span>
      </div>
      <div style={{ height: WINDOW.barHeight, display: "flex", alignItems: "center", gap: 14, padding: "0 16px 0 20px", background: CF.bar, borderBottom: `1px solid ${CF.border}` }}>
        <ShapeBar width={44} />
        <ShapeBar width={56} />
        <ShapeBar width={40} />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>{barRight}</div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: WINDOW.titleHeight + WINDOW.barHeight + 2,
          bottom: 0,
          backgroundImage: `radial-gradient(circle, ${CF.dot} 1.6px, transparent 1.8px)`,
          backgroundSize: "28px 28px",
          backgroundPosition: "14px 14px",
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** The Run button. */
export function RunButton() {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 40,
        padding: "0 16px",
        borderRadius: 9,
        border: `1px solid ${CF.border}`,
        background: CF.field,
        fontSize: 18,
        fontWeight: 500,
        color: CF.text,
      }}
    >
      <Play size={15} fill="currentColor" />
      Run
    </span>
  )
}

/** The add-on's button in ComfyUI's top bar. `press` squeezes it; `done` 0 → 1 shows a check. */
export function PublishButton({ press = 0, done = 0, glow = 1 }: { press?: number; done?: number; glow?: number }) {
  return (
    <span
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 40,
        padding: "0 16px",
        borderRadius: 9,
        background: C.primary,
        color: C.primaryForeground,
        fontSize: 18,
        fontWeight: 600,
        whiteSpace: "nowrap",
        boxShadow: `0 0 0 ${5 * glow}px color-mix(in oklab, ${C.primary} 22%, transparent)`,
        transform: `scale(${1 - press * 0.03})`,
      }}
    >
      <span style={{ display: "grid", width: done > 0 ? 18 * done : 0, overflow: "hidden", opacity: done, transform: `scale(${0.5 + 0.5 * done})` }}>
        <Check size={18} strokeWidth={2.6} />
      </span>
      Use in Booru Prompt Gallery
    </span>
  )
}

/** A few nodes and wires: just enough to say "a workflow". */
export function GraphHint({ width, top = 36, opacity = 1 }: { width: number; top?: number; opacity?: number }) {
  const nodeW = 176
  const gap = (width - 3 * nodeW) / 4
  const xs = [gap, 2 * gap + nodeW, 3 * gap + 2 * nodeW]
  const heads = ["#7b6aa8", "#b39a4a", "#4f8a78"]
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
        {[0, 1].map((i) => {
          const x0 = xs[i] + nodeW
          const y0 = top + 58 + i * 26
          const x1 = xs[i + 1]
          const y1 = top + 58
          const mid = (x0 + x1) / 2
          return <path key={i} d={`M${x0} ${y0} C${mid} ${y0} ${mid} ${y1} ${x1} ${y1}`} stroke={heads[i]} strokeOpacity={0.75} strokeWidth={3} fill="none" />
        })}
      </svg>
      {xs.map((x, i) => (
        <div key={i} style={{ position: "absolute", left: x, top, width: nodeW, borderRadius: 10, background: CF.node, border: `1px solid ${CF.border}`, overflow: "hidden" }}>
          <div style={{ height: 30, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", background: CF.nodeHead }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: heads[i] }} />
            <ShapeBar width={[78, 64, 70][i]} height={8} color="#4a4a52" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 12px 16px" }}>
            {[0, 1, 2].map((r) => (
              <div key={r} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: r === 0 ? heads[i] : "#4a4a52" }} />
                <ShapeBar width={[96, 70, 84][(r + i) % 3]} height={7} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Custom Nodes Manager
// ---------------------------------------------------------------------------

export const ADDON_NAME = "Booru Prompt Gallery"
export const MANAGER = { width: 700, rowHeight: 84, searchHeight: 56, headHeight: 60, pad: 22 }
const INSTALL_WIDTH = 160

/**
 * The Manager's search and node list. `typed` is how many characters of the
 * add-on's name are in the field; `filter` 0 → 1 collapses the other nodes;
 * `install` is "idle", "installing" or "done" with `swap` 0 → 1 between them.
 */
export function ManagerDialog({
  x,
  y,
  typed,
  caret,
  filter,
  focus,
  installPress = 0,
  installing,
  installed,
  frame,
  otherRows = 3,
  style,
}: {
  x: number
  y: number
  /** Nodes listed before the search narrows it down. */
  otherRows?: number
  typed: number
  caret: number
  filter: number
  focus: number
  installPress?: number
  /** 0 → 1: the button turns into "Installing". */
  installing: number
  /** 0 → 1: then into "Installed". */
  installed: number
  frame: number
  style?: CSSProperties
}) {
  const text = ADDON_NAME.slice(0, typed)
  const others = [
    { name: 118, desc: 210 },
    { name: 150, desc: 172 },
    { name: 96, desc: 236 },
  ].slice(0, otherRows)
  const label = (on: number, children: ReactNode) => (
    <span
      style={{
        gridArea: "1 / 1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        opacity: on,
        filter: `blur(${(1 - on) * 3}px)`,
      }}
    >
      {children}
    </span>
  )
  const idle = 1 - installing
  const busy = Math.min(installing, 1 - installed)
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: MANAGER.width,
        padding: MANAGER.pad,
        paddingTop: 0,
        borderRadius: 16,
        background: CF.dialog,
        border: `1px solid ${CF.border}`,
        boxShadow: "0 24px 48px -20px rgb(0 0 0 / 0.7)",
        fontFamily: FONT,
        color: CF.text,
        ...style,
      }}
    >
      <div style={{ height: MANAGER.headHeight, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 21, fontWeight: 600 }}>Custom Nodes Manager</span>
        <X size={20} color={CF.muted} />
      </div>
      <div
        style={{
          height: MANAGER.searchHeight,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 16px",
          borderRadius: 11,
          background: CF.field,
          border: `1px solid ${focus > 0.5 ? "#5b5b66" : CF.border}`,
          boxShadow: `0 0 0 ${3 * focus}px rgb(255 255 255 / 0.06)`,
          fontSize: 20,
        }}
      >
        <Search size={20} color={CF.muted} />
        <span style={{ whiteSpace: "pre" }}>{text}</span>
        <span style={{ width: 2, height: 24, marginLeft: -10, background: CF.text, opacity: caret }} />
        {typed === 0 && <span style={{ marginLeft: -8, color: "#6b6b74" }}>Search</span>}
      </div>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column" }}>
        {/* The match: hidden in the full list, the only row once the name is typed. */}
        <div
          style={{
            height: MANAGER.rowHeight * filter,
            opacity: filter,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: MANAGER.rowHeight - 10,
              marginTop: 5,
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "0 14px",
              borderRadius: 12,
              border: `1px solid color-mix(in oklab, ${C.primary} ${30 * filter}%, transparent)`,
              background: CF.field,
              transform: `translateY(${(1 - filter) * 8}px)`,
            }}
          >
            <span style={{ width: 44, height: 44, borderRadius: 10, background: `color-mix(in oklab, ${C.primary} 18%, transparent)`, display: "grid", placeItems: "center", color: C.primaryText }}>
              <Send size={22} />
            </span>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 20, fontWeight: 600 }}>{ADDON_NAME}</span>
              <ShapeBar width={260} height={8} />
            </div>
            <span
              style={{
                display: "grid",
                width: INSTALL_WIDTH,
                height: 44,
                borderRadius: 10,
                fontSize: 18,
                fontWeight: 600,
                background: `color-mix(in oklab, ${C.primary} ${idle * 100}%, transparent)`,
                border: `1px solid ${idle > 0.5 ? "transparent" : CF.border}`,
                color: idle > 0.5 ? C.primaryForeground : installed > 0.5 ? C.successText : CF.muted,
                boxShadow: `0 0 0 ${5 * idle}px color-mix(in oklab, ${C.primary} 20%, transparent)`,
                transform: `scale(${1 - installPress * 0.03})`,
              }}
            >
              {label(idle, "Install")}
              {label(busy, (
                <>
                  <Loader2 size={18} style={{ transform: `rotate(${frame * 14}deg)` }} />
                  Installing
                </>
              ))}
              {label(installed, (
                <>
                  <span style={{ display: "grid", transform: `scale(${0.4 + 0.6 * ease(installed, 0, 1, EASE.springy)})` }}>
                    <Check size={19} strokeWidth={2.6} />
                  </span>
                  Installed
                </>
              ))}
            </span>
          </div>
        </div>
        {others.map((o, i) => {
          // Rows leave from the bottom up, a step apart.
          const gone = ease(filter, i * 0.08, 0.7 + i * 0.1, Easing.linear)
          return (
            <div key={i} style={{ height: MANAGER.rowHeight * (1 - gone), opacity: 1 - gone, overflow: "hidden" }}>
              <div style={{ height: MANAGER.rowHeight, display: "flex", alignItems: "center", gap: 16, padding: "0 15px", borderBottom: i < others.length - 1 ? `1px solid ${CF.border}` : "none" }}>
                <span style={{ width: 44, height: 44, borderRadius: 10, background: "#303037" }} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
                  <ShapeBar width={o.name} height={10} color="#4a4a52" />
                  <ShapeBar width={o.desc} height={8} />
                </div>
                <span style={{ width: INSTALL_WIDTH, height: 44, borderRadius: 10, background: "#303037" }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The setup guide's "From your ComfyUI" list (site theme)
// ---------------------------------------------------------------------------

export const WORKFLOW_NAME = "Anime portrait"
export const OLD_WORKFLOW = "Basic text to image"
// Sizes are the site's px at 1.6× (min-h-12 rows, px-4 py-3 box).
export const LIST = { headHeight: 50, rowHeight: u(48), padX: u(16), padY: u(12) }

/**
 * `arrive` 0 → 1: the new workflow's row opens at the top. `flash` 1 → 0: its
 * highlight fades. `inUse` 0 → 1: its Use button turns into "In use".
 */
export function PublishedList({
  x,
  y,
  width,
  arrive,
  flash,
  rowContent,
  inUse,
  usePress = 0,
  frame,
  style,
}: {
  x: number
  y: number
  width: number
  arrive: number
  flash: number
  /** Opacity of the new row's text and button (the flying name lands first). */
  rowContent: number
  inUse: number
  usePress?: number
  frame: number
  style?: CSSProperties
}) {
  const pulse = 0.55 + 0.45 * Math.cos((frame / 30) * Math.PI)
  const button = (primary: boolean, press = 0): CSSProperties => ({
    height: u(32),
    padding: `0 ${u(12)}px`,
    display: "flex",
    alignItems: "center",
    borderRadius: u(6),
    fontSize: u(12),
    fontWeight: 500,
    border: primary ? "1px solid transparent" : `1px solid ${C.border}`,
    background: primary ? C.primary : C.background,
    color: primary ? C.primaryForeground : C.foreground,
    transform: `scale(${1 - press * 0.03})`,
  })
  const row = (children: ReactNode, last: boolean, bg?: string): CSSProperties => ({
    height: LIST.rowHeight,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    margin: `0 -${LIST.padX}px`,
    padding: `0 ${LIST.padX}px`,
    borderBottom: last ? "none" : `1px solid color-mix(in oklab, ${C.border} 50%, transparent)`,
    background: bg,
  })
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        boxSizing: "border-box",
        padding: `${LIST.padY}px ${LIST.padX}px ${LIST.padY - 6}px`,
        borderRadius: u(12),
        border: `1px solid color-mix(in oklab, ${C.border} 70%, transparent)`,
        background: C.background,
        fontFamily: FONT,
        color: C.foreground,
        ...style,
      }}
    >
      <div style={{ height: LIST.headHeight, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: u(14), fontWeight: 500 }}>From your ComfyUI</span>
        <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: u(12), color: C.mutedForeground }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: C.primary, opacity: pulse }} />
          Watching for new ones
        </span>
      </div>
      <div style={{ height: arrive * LIST.rowHeight, overflow: "hidden" }}>
        <div style={row(null, false, `color-mix(in oklab, ${C.primary} ${14 * flash}%, transparent)`)}>
          <span style={{ display: "flex", alignItems: "center", gap: 12, opacity: rowContent }}>
            <span style={{ fontSize: u(14) }}>{WORKFLOW_NAME}</span>
            <span style={{ padding: `${u(2)}px ${u(6)}px`, borderRadius: 999, background: `color-mix(in oklab, ${C.primary} 12%, transparent)`, color: C.primaryText, fontSize: u(11), fontWeight: 500 }}>
              New
            </span>
          </span>
          <span style={{ display: "grid", justifyItems: "end", opacity: rowContent }}>
            <span style={{ gridArea: "1 / 1", ...button(true, usePress), opacity: 1 - inUse, filter: `blur(${inUse * 3}px)` }}>Use</span>
            <span
              style={{
                gridArea: "1 / 1",
                display: "flex",
                alignItems: "center",
                gap: 6,
                alignSelf: "center",
                fontSize: u(12),
                fontWeight: 500,
                color: C.successText,
                opacity: inUse,
                filter: `blur(${(1 - inUse) * 3}px)`,
              }}
            >
              <Check size={u(14)} style={{ transform: `scale(${0.4 + 0.6 * ease(inUse, 0, 1, EASE.springy)})` }} />
              In use
            </span>
          </span>
        </div>
      </div>
      <div style={row(null, true)}>
        <span style={{ fontSize: u(14) }}>{OLD_WORKFLOW}</span>
        <span style={button(false)}>Use</span>
      </div>
    </div>
  )
}

/** Where the new row's name sits, relative to the list's top-left corner. */
export const NEW_ROW_NAME = { dx: LIST.padX, dy: LIST.padY + LIST.headHeight + LIST.rowHeight / 2 }
/** Where the new row's Use button sits (center), relative to the list's top-right corner. */
export const NEW_ROW_USE = { dx: -LIST.padX - 34, dy: LIST.padY + LIST.headHeight + LIST.rowHeight / 2 }

/** The workflow's name on its way from ComfyUI to the list. */
export function NamePill({ x, y, scale = 1, opacity = 1 }: { x: number; y: number; scale?: number; opacity?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `translate(-12px, -50%) scale(${scale})`,
        transformOrigin: "12px 50%",
        opacity,
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 46,
        padding: "0 16px 0 12px",
        borderRadius: 12,
        background: C.card,
        border: `1px solid color-mix(in oklab, ${C.primary} 45%, transparent)`,
        boxShadow: "0 12px 28px -10px rgb(0 0 0 / 0.6)",
        fontFamily: FONT,
        fontSize: u(14),
        color: C.foreground,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center", background: `color-mix(in oklab, ${C.primary} 18%, transparent)`, color: C.primaryText }}>
        <Send size={13} />
      </span>
      {WORKFLOW_NAME}
    </div>
  )
}

/** A point on a quadratic curve, for paths that arc instead of sliding straight. */
export function arc(t: number, a: { x: number; y: number }, c: { x: number; y: number }, b: { x: number; y: number }) {
  const s = 1 - t
  return { x: s * s * a.x + 2 * s * t * c.x + t * t * b.x, y: s * s * a.y + 2 * s * t * c.y + t * t * b.y }
}

// ---------------------------------------------------------------------------
// The card: Copy → Send, and the job drawn over the post image
// ---------------------------------------------------------------------------

/**
 * The split button's label. `send` 0 → 1 turns Copy into Send; each frame in
 * `sends` flies the plane off to the top right and brings a new one back in
 * from the bottom left (SendGlyph).
 */
export function SendLabel({ frame, send, sends }: { frame: number; send: number; sends: number[] }) {
  const last = [...sends].reverse().find((s) => frame >= s)
  let leaving: CSSProperties | null = null
  let glyph: CSSProperties = {}
  if (last !== undefined) {
    const out = ease(frame, last, last + 7, EASE.exit)
    const back = ease(frame, last + 8, last + 19, EASE.out)
    if (out < 1) leaving = { opacity: 1 - out, transform: `translate(${16 * out}px, ${-16 * out}px) scale(${1 - 0.3 * out})` }
    glyph = { opacity: back, transform: `translate(${-11 * (1 - back)}px, ${11 * (1 - back)}px) scale(${0.6 + 0.4 * back})` }
  }
  const stack: CSSProperties = { gridArea: "1 / 1", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }
  return (
    <span style={{ display: "grid" }}>
      <span style={{ ...stack, opacity: 1 - send, filter: `blur(${send * 4}px)` }}>
        <Copy size={22} />
        Copy
      </span>
      <span style={{ ...stack, gap: 8, opacity: send, filter: `blur(${(1 - send) * 4}px)` }}>
        <span style={{ position: "relative", width: 22, height: 22 }}>
          {leaving && (
            <span style={{ position: "absolute", inset: 0, display: "grid", ...leaving }}>
              <Send size={22} />
            </span>
          )}
          <span style={{ position: "absolute", inset: 0, display: "grid", ...glyph }}>
            <Send size={22} />
          </span>
        </span>
        Send
      </span>
    </span>
  )
}

export const STEPS = 20

export interface Job {
  /** Send clicked. */
  send: number
  /** ComfyUI answered: the job waits in the queue. */
  queued: number
  /** It started: steps count up. */
  running: number
  /** Frames per step. */
  stepFrames: number
  /** The image the job makes. */
  variant: 0 | 1
}

export const jobDone = (job: Job) => job.running + STEPS * job.stepFrames

/** The step ComfyUI reports at `frame` (0 before the first one). */
const stepAt = (job: Job, frame: number) => Math.max(0, Math.min(STEPS, Math.floor((frame - job.running) / job.stepFrames) + 1))

// h-7 pl-2.5 pr-2.5 (pr-0.5 with the cancel button) gap-1.5 text-xs, at 1.6×.
const CHIP = { height: u(28), padLeft: u(10), padRight: u(10), padRightCancel: u(2), gap: u(6), font: u(12), icon: u(14), button: u(24) }

function chipLabel(job: Job, frame: number) {
  if (frame < job.queued) return { kind: "sending", text: "Sending" }
  if (frame < job.running) return { kind: "queued", text: "Next in queue" }
  return { kind: "running", text: `Step ${stepAt(job, frame)} of ${STEPS}` }
}

function chipWidth(job: Job, frame: number) {
  const { kind, text } = chipLabel(job, frame)
  const running = kind === "running"
  return CHIP.padLeft + (running ? CHIP.icon + CHIP.gap : 0) + textWidth(text, CHIP.font) + (kind === "sending" ? CHIP.padRight : CHIP.gap + CHIP.button + CHIP.padRightCancel)
}

/** The queue chip: label swaps in place, width follows it. */
function JobChip({ job, frame }: { job: Job; frame: number }) {
  const done = jobDone(job)
  const enter = ease(frame, job.send + 3, job.send + 18, EASE.springy)
  const leave = ease(frame, done, done + 6, EASE.exit)
  if (frame < job.send + 3 || leave >= 1) return null

  // Width eases from the previous label's to the current one's.
  const changes = [job.queued, job.running, ...Array.from({ length: STEPS - 1 }, (_, i) => job.running + (i + 1) * job.stepFrames)]
  const lastChange = [...changes].reverse().find((c) => frame >= c)
  const width =
    lastChange === undefined
      ? chipWidth(job, frame)
      : interpolate(ease(frame, lastChange, lastChange + 10), [0, 1], [chipWidth(job, lastChange - 1), chipWidth(job, frame)])

  const { kind } = chipLabel(job, frame)
  // Kinds blur through each other; numbers inside a kind change in place.
  const kinds: { kind: string; at: number; until: number }[] = [
    { kind: "sending", at: job.send, until: job.queued },
    { kind: "queued", at: job.queued, until: job.running },
    { kind: "running", at: job.running, until: 1e9 },
  ]
  const spinner = ease(frame, job.running, job.running + 9, EASE.out)
  const cancel = ease(frame, job.queued, job.queued + 9, EASE.out)

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: u(36),
        height: CHIP.height,
        width,
        marginLeft: -width / 2,
        borderRadius: u(14),
        background: `color-mix(in oklab, ${C.overlay} 75%, transparent)`,
        backdropFilter: "blur(4px)",
        boxShadow: "0 1px 2px rgb(0 0 0 / 0.3)",
        color: C.overlayForeground,
        fontFamily: FONT,
        fontSize: CHIP.font,
        fontWeight: 500,
        fontVariantNumeric: "tabular-nums",
        overflow: "hidden",
        opacity: Math.min(enter * 1.4, 1) * (1 - leave),
        transform: `translateY(${(1 - enter) * u(26) + leave * u(6)}px) scale(${1 - leave * 0.04})`,
        filter: `blur(${(1 - Math.min(enter * 1.4, 1)) * 4}px)`,
      }}
    >
      {spinner > 0 && (
        <span
          style={{
            position: "absolute",
            left: CHIP.padLeft,
            top: (CHIP.height - CHIP.icon) / 2,
            display: "grid",
            opacity: spinner,
            transform: `scale(${0.25 + 0.75 * spinner}) rotate(${frame * 12}deg)`,
          }}
        >
          <Loader2 size={CHIP.icon} />
        </span>
      )}
      {kinds.map((k) => {
        // The old label is gone before the new one is legible: two strings never stack.
        const on = Math.min(ease(frame, k.at + 2, k.at + 8), 1 - ease(frame, k.until, k.until + 3, EASE.exit))
        if (on <= 0) return null
        const text = k.kind === kind ? chipLabel(job, frame).text : chipLabel(job, k.until - 1).text
        return (
          <span
            key={k.kind}
            style={{
              position: "absolute",
              left: CHIP.padLeft + (k.kind === "running" ? CHIP.icon + CHIP.gap : 0),
              top: 0,
              lineHeight: `${CHIP.height}px`,
              whiteSpace: "nowrap",
              opacity: on,
              filter: `blur(${(1 - on) * 3}px)`,
            }}
          >
            {text}
          </span>
        )
      })}
      {cancel > 0 && (
        <span
          style={{
            position: "absolute",
            right: CHIP.padRightCancel,
            top: (CHIP.height - CHIP.button) / 2,
            width: CHIP.button,
            height: CHIP.button,
            display: "grid",
            placeItems: "center",
            opacity: cancel * 0.85,
            transform: `scale(${0.25 + 0.75 * cancel})`,
          }}
        >
          <X size={CHIP.icon} />
        </span>
      )}
    </div>
  )
}

/** Image box size on the card (layout.ts CARD). */
const BOX = { width: 360, height: 250 }

/**
 * Everything ComfyCardJob draws over the post, for one job. `swap` 0 → 1
 * shows the post again (the corner thumbnail); `leave` 0 → 1 fades the whole
 * result away (a new send replaces it).
 */
export function CardJob({ job, frame, swap = 0, leave = 0, postImage }: { job: Job; frame: number; swap?: number; leave?: number; postImage: string }) {
  if (frame < job.send) return null
  const done = jobDone(job)
  const step = stepAt(job, frame)
  const firstPreview = job.running + job.stepFrames // the preview arrives with step 2
  const previewOn = frame >= firstPreview

  const veilRise = ease(frame, job.send, job.send + sec(0.5), EASE.rise)
  const veilFade = ease(frame, firstPreview, firstPreview + sec(0.45), EASE.out)
  const glintT = (frame - job.send) / sec(0.56)
  const glintY = interpolate(ease(glintT, 0, 1, EASE.rise), [0, 1], [100, -6])
  const glintO = interpolate(glintT, [0, 0.12, 0.62, 1], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })

  const develop = ease(frame, firstPreview, firstPreview + sec(0.7), EASE.out)
  // The preview updates once per step, like ComfyUI's: stepped, not smooth.
  const previewDevelop = Math.min(1, Math.max(0, (step - 1) / (STEPS - 1))) * 0.82

  const resolve = ease(frame, done + 1, done + 1 + sec(0.6), EASE.out)
  const controls = ease(frame, done + 6, done + 6 + sec(0.32), EASE.out)

  const barIn = ease(frame, job.running, job.running + sec(0.25), EASE.out)
  const barOut = ease(frame, done + 3 + 3, done + 6 + sec(0.3), EASE.out)
  // Each step eases the fill to its new length (300 ms), from the last one's.
  const stepStart = job.running + (step - 1) * job.stepFrames
  const fill = frame >= done ? 1 : step <= 0 ? 0 : interpolate(ease(frame, stepStart, stepStart + 9), [0, 1], [(step - 1) / STEPS, step / STEPS])

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity: 1 - leave }}>
      {previewOn && frame < done + sec(0.8) && (
        <div style={{ position: "absolute", inset: 0, opacity: develop, transform: `scale(${1 + 0.04 * (1 - develop)})`, filter: `blur(${12 * (1 - develop)}px)` }}>
          <MeadowArt variant={job.variant} develop={previewDevelop} seed={step} />
        </div>
      )}
      {frame > done && (
        <div style={{ position: "absolute", inset: 0, opacity: resolve * (1 - swap), transform: `scale(${1 + 0.02 * (1 - resolve)})`, filter: `blur(${6 * (1 - resolve)}px)` }}>
          <MeadowArt variant={job.variant} />
        </div>
      )}
      {veilFade < 1 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(to bottom, color-mix(in oklab, ${C.overlay} 15%, transparent), color-mix(in oklab, ${C.overlay} 25%, transparent), color-mix(in oklab, ${C.overlay} 45%, transparent))`,
            transform: `translateY(${(1 - veilRise) * 100}%)`,
            opacity: 1 - veilFade,
          }}
        />
      )}
      {glintT > 0 && glintT < 1 && (
        <div style={{ position: "absolute", inset: 0, transform: `translateY(${glintY}%)`, opacity: glintO }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 1.5, background: "rgb(255 255 255 / 0.7)" }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: u(40), background: `linear-gradient(to bottom, color-mix(in oklab, ${C.primary} 35%, transparent), transparent)` }} />
        </div>
      )}
      {barIn > 0 && barOut < 1 && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: u(4),
            background: `color-mix(in oklab, ${C.overlay} 40%, transparent)`,
            transform: `scaleY(${barIn})`,
            transformOrigin: "bottom",
            opacity: 1 - barOut,
          }}
        >
          <div style={{ height: "100%", background: C.primary, transform: `scaleX(${fill})`, transformOrigin: "left" }} />
        </div>
      )}
      <JobChip job={job} frame={frame} />
      {controls > 0 && (
        <div
          style={{
            position: "absolute",
            left: u(8),
            top: u(8),
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: u(2),
            padding: u(4),
            borderRadius: u(8),
            background: `color-mix(in oklab, ${C.overlay} 75%, transparent)`,
            boxShadow: "0 1px 2px rgb(0 0 0 / 0.3)",
            color: C.overlayForeground,
            opacity: controls,
            transform: `translateY(${(1 - controls) * -4}px) scale(${0.9 + 0.1 * controls})`,
            transformOrigin: "0 0",
          }}
        >
          <div style={{ position: "relative", width: u(32), height: u(40), borderRadius: u(6), overflow: "hidden", boxShadow: "0 0 0 1px rgb(255 255 255 / 0.4)" }}>
            <Img src={staticFile(postImage)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 0%", opacity: 1 - swap }} />
            <div style={{ position: "absolute", inset: 0, opacity: swap }}>
              <MeadowArt variant={job.variant} />
            </div>
          </div>
          {[ExternalLink, X].map((Icon, i) => (
            <span key={i} style={{ width: u(24), height: u(24), display: "grid", placeItems: "center", opacity: 0.85 }}>
              <Icon size={u(14)} />
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export const CARD_IMAGE_BOX = BOX
