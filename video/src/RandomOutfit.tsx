import type { ReactNode } from "react"
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion"
import {
  Check,
  ChevronRight,
  Flame,
  Flower2,
  Heart,
  Leaf,
  Minus,
  Package,
  PartyPopper,
  PenLine,
  Plus,
  RefreshCw,
  Shirt,
  Snowflake,
  Sun,
  Waves,
  type LucideIcon,
} from "lucide-react"
import { CHAPTERS, DURATION } from "./outfit-chapters"
import { OUTFIT_COUNTS, OUTFIT_FLUX2, OUTFIT_POST, OUTFIT_SENTENCES, OUTFIT_TAGS, PACK_POOL, cardTags } from "./outfit-data"
import { C, FONT, MONO, tween, u, visible } from "./theme"
import { ClickRing, MenuItem, Panel, Pointer, PromptCard, SelectTrigger, SettingRow, WellText } from "./ui"

// The Random outfit video: same card, panel, pointer and pacing as
// FeatureIntro.tsx (PromptFormats), with the Outfit options and Pack Mode's
// Clothing row drawn from prompt-generation-options-panel.tsx and
// pack-category-list.tsx.

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Customize prompt panel. Its content scrolls inside it, like the real sheet. */
const PANEL = { x: 440, y: 112, width: 480, height: 578, pad: 26 }
const INNER = { x: PANEL.x + PANEL.pad, width: PANEL.width - 2 * PANEL.pad }
// Unscrolled canvas y of each block.
const OUTPUT_LABEL_TOP = PANEL.y + PANEL.pad + 44 + 16
const FORMAT_ROW_TOP = OUTPUT_LABEL_TOP + 24
const OUTFIT_ROW_TOP = FORMAT_ROW_TOP + 90
const TRAY_TOP = OUTFIT_ROW_TOP + 90 + 4
/** How far the content scrolls once the tray is open: the Outfit row stays in view. */
const SCROLL = 198

const SELECT_X = PANEL.x + PANEL.width - PANEL.pad - 118
const FORMAT_SELECT_Y = FORMAT_ROW_TOP + 45
const OUTFIT_SELECT_Y = OUTFIT_ROW_TOP + 45
const LIST = { right: PANEL.x + PANEL.width - PANEL.pad, width: 260 }
const listItemY = (selectY: number, i: number) => selectY + 34 + 6 + 23 + i * 46

// The tray (rounded-lg bg-muted/40 p-3), at 1.6×. Offsets from TRAY_TOP.
const TRAY = { pad: u(12), labelHeight: 26, gap: u(8), section: u(12), tileHeight: 80, tileGap: u(4), detailHeight: 105, noteHeight: 64 }
const TRAY_INNER_WIDTH = INNER.width - 2 * TRAY.pad
const STYLE_TILE_WIDTH = (TRAY_INNER_WIDTH - 3 * TRAY.tileGap) / 4
const DETAIL_TILE_WIDTH = (TRAY_INNER_WIDTH - TRAY.tileGap) / 2
const GRID_TOP = TRAY.pad + TRAY.labelHeight + TRAY.gap
const DETAIL_TOP = GRID_TOP + 2 * TRAY.tileHeight + TRAY.tileGap + TRAY.section + TRAY.labelHeight + TRAY.gap
const NOTE_TOP = DETAIL_TOP + TRAY.detailHeight + TRAY.section
const TRAY_HEIGHT = NOTE_TOP + TRAY.noteHeight + TRAY.pad

const styleTileCenter = (i: number) => ({
  x: INNER.x + TRAY.pad + (i % 4) * (STYLE_TILE_WIDTH + TRAY.tileGap) + STYLE_TILE_WIDTH / 2,
  y: TRAY_TOP + GRID_TOP + Math.floor(i / 4) * (TRAY.tileHeight + TRAY.tileGap) + TRAY.tileHeight / 2 - SCROLL,
})
const detailTileCenter = (i: number) => ({
  x: INNER.x + TRAY.pad + i * (DETAIL_TILE_WIDTH + TRAY.tileGap) + DETAIL_TILE_WIDTH / 2,
  y: TRAY_TOP + DETAIL_TOP + TRAY.detailHeight / 2 - SCROLL,
})

/** Pack Builder's Clothing row spans the frame in the last chapter. */
const PACK = { x: 40, y: 124, width: 880 }
// The pool mode radios, before "Per prompt" appears in front of them.
const POOL_CONTROLS_X = PACK.x + 1 + u(16) + u(56) + u(12)
const POOL_CONTROLS_Y = PACK.y + 1 + 86 + 1 + u(4)
const LIBRARY_RADIO = { x: POOL_CONTROLS_X + 4 + 118 + 126 + 80, y: POOL_CONTROLS_Y + 26 }

const STYLES: { label: string; Icon: LucideIcon }[] = [
  { label: "Spring", Icon: Flower2 },
  { label: "Summer", Icon: Sun },
  { label: "Autumn", Icon: Leaf },
  { label: "Winter", Icon: Snowflake },
  { label: "Party", Icon: PartyPopper },
  { label: "Swimwear", Icon: Waves },
  { label: "Lingerie", Icon: Heart },
  { label: "Sexy", Icon: Flame },
]
const PARTY = 4
const DETAILS = [
  { label: "Main pieces", hint: "Top, bottom and shoes" },
  { label: "Full outfit", hint: "Plus legwear, bag and jewelry" },
]
const OUTFIT_MODES = ["Keep original", "Random outfit"]
const FORMAT_OPTIONS = [
  { label: "Tags", hint: "Booru tags separated by commas" },
  { label: "Anima", hint: "Tags followed by a short description of the pose and framing" },
  { label: "FLUX.2 · Krea 2", hint: "Plain sentences for FLUX.2 and Krea 2" },
  { label: "MOSS-Image", hint: "A longer description for MOSS-Image" },
]

// The tags around the clothing, identical in every version of the card.
const [HEAD, TAIL] = cardTags("\u0000").split("\u0000")
const tagsOf = (clothing: string) => clothing.split(", ")
const ADDED_FULL = tagsOf(OUTFIT_TAGS.secondFull).filter((t) => !tagsOf(OUTFIT_TAGS.second).includes(t))

// ---------------------------------------------------------------------------
// Timeline (frames)
// ---------------------------------------------------------------------------

const T = {
  outfitSelectClick: 56,
  randomClick: 94,
  partyClick: 268,
  fullClick: 356,
  formatSelectClick: 496,
  fluxClick: 534,
  libraryClick: 742,
}
const CLICKS = Object.values(T)

const PARTY_TILE = styleTileCenter(PARTY)
const FULL_TILE = detailTileCenter(1)

/** Where the pointer waits: the gutter between the card and the panel. */
const IDLE = { x: 420, y: 600 }

type Key = [frame: number, x: number, y: number]
const POINTER_PATH: Key[] = [
  [0, IDLE.x, IDLE.y],
  [20, IDLE.x, IDLE.y],
  [50, SELECT_X + 2, OUTFIT_SELECT_Y + 2],
  [62, SELECT_X + 2, OUTFIT_SELECT_Y + 2],
  [88, SELECT_X - 10, listItemY(OUTFIT_SELECT_Y, 1) + 2],
  [110, SELECT_X - 10, listItemY(OUTFIT_SELECT_Y, 1) + 2],
  [146, IDLE.x, IDLE.y],
  [236, IDLE.x, IDLE.y],
  [262, PARTY_TILE.x + 4, PARTY_TILE.y + 6],
  [290, PARTY_TILE.x + 4, PARTY_TILE.y + 6],
  [350, FULL_TILE.x + 4, FULL_TILE.y + 6],
  [380, FULL_TILE.x + 4, FULL_TILE.y + 6],
  [416, IDLE.x, IDLE.y],
  [462, IDLE.x, IDLE.y],
  [490, SELECT_X + 2, FORMAT_SELECT_Y + 2],
  [502, SELECT_X + 2, FORMAT_SELECT_Y + 2],
  [528, SELECT_X - 10, listItemY(FORMAT_SELECT_Y, 2) + 2],
  [548, SELECT_X - 10, listItemY(FORMAT_SELECT_Y, 2) + 2],
  [580, IDLE.x, IDLE.y],
  [700, 640, 640],
  [736, LIBRARY_RADIO.x, LIBRARY_RADIO.y],
  [760, LIBRARY_RADIO.x, LIBRARY_RADIO.y],
  [800, 760, 660],
]

const MOVE = Easing.inOut(Easing.cubic)

function pointerAt(frame: number) {
  const next = POINTER_PATH.findIndex(([f]) => f > frame)
  if (next === -1) return { x: POINTER_PATH.at(-1)![1], y: POINTER_PATH.at(-1)![2] }
  if (next === 0) return { x: POINTER_PATH[0][1], y: POINTER_PATH[0][2] }
  const [f0, x0, y0] = POINTER_PATH[next - 1]
  const [f1, x1, y1] = POINTER_PATH[next]
  const t = MOVE((frame - f0) / (f1 - f0))
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t }
}

function chapterAt(frame: number) {
  let index = 0
  CHAPTERS.forEach((c, i) => {
    if (frame >= c.from) index = i
  })
  return index
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Header({ frame }: { frame: number }) {
  const index = chapterAt(frame)
  const start = CHAPTERS[index].from
  const end = CHAPTERS[index + 1]?.from ?? DURATION
  const fade = index === 0 ? 1 : tween(frame, start, start + 10)
  const out = index === CHAPTERS.length - 1 ? 0 : tween(frame, end - 8, end)
  return (
    <div style={{ position: "absolute", left: 40, top: 34, right: 40, fontFamily: FONT }}>
      <div style={{ display: "flex", gap: 8 }}>
        {CHAPTERS.map((c, i) => {
          const cEnd = CHAPTERS[i + 1]?.from ?? DURATION
          const fill = interpolate(frame, [c.from, cEnd], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
          return (
            <div key={c.id} style={{ width: 46, height: 6, borderRadius: 3, background: C.muted, overflow: "hidden" }}>
              <div style={{ width: `${fill * 100}%`, height: "100%", background: C.primary }} />
            </div>
          )
        })}
      </div>
      <div
        style={{
          marginTop: 16,
          fontSize: 34,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: C.foreground,
          opacity: fade * (1 - out),
          transform: `translateY(${(1 - fade) * 8}px)`,
        }}
      >
        {CHAPTERS[index].title}
      </div>
    </div>
  )
}

/** Inline marker that sweeps across a sentence, line by line. */
function Mark({ children, color, progress }: { children: ReactNode; color: string; progress: number }) {
  return (
    <span
      style={{
        backgroundImage: `linear-gradient(color-mix(in oklab, ${color} 34%, transparent), color-mix(in oklab, ${color} 34%, transparent))`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${progress * 100}% 100%`,
        borderRadius: 4,
      }}
    >
      {children}
    </span>
  )
}

/**
 * The card's tags with the clothing in the middle; `marked` tags get a
 * marker sweep, one after another from `markFrom`.
 */
function CardTags({ frame, clothing, marked, markFrom }: { frame: number; clothing: string; marked: readonly string[]; markFrom: number }) {
  let order = 0
  return (
    <>
      {HEAD}
      {tagsOf(clothing).map((tag, i) => {
        const sep = i === 0 ? "" : ", "
        if (!marked.includes(tag)) return sep + tag
        const start = markFrom + order++ * 4
        return (
          <span key={tag}>
            {sep}
            <Mark color={C.primary} progress={tween(frame, start, start + 14)}>
              {tag}
            </Mark>
          </span>
        )
      })}
      {TAIL}
    </>
  )
}

function StyleTile({ label, Icon, on }: { label: string; Icon: LucideIcon; on: number }) {
  return (
    <div
      style={{
        width: STYLE_TILE_WIDTH,
        height: TRAY.tileHeight,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: u(6),
        borderRadius: u(6),
        border: `1px solid ${on > 0.5 ? `color-mix(in oklab, ${C.primary} 60%, transparent)` : `color-mix(in oklab, ${C.border} 50%, transparent)`}`,
        background: `color-mix(in oklab, ${C.background} ${on * 100}%, transparent)`,
        color: on > 0.5 ? C.foreground : C.mutedForeground,
        boxShadow: on > 0.5 ? "0 1px 2px rgb(0 0 0 / 0.05)" : "none",
      }}
    >
      <Icon size={u(16)} color={on > 0.5 ? C.primaryText : C.mutedForeground} style={{ opacity: on > 0.5 ? 1 : 0.7 }} />
      <span style={{ maxWidth: "100%", fontSize: u(11), lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </span>
    </div>
  )
}

function DetailTile({ label, hint, on }: { label: string; hint: string; on: number }) {
  return (
    <div
      style={{
        width: DETAIL_TILE_WIDTH,
        height: TRAY.detailHeight,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: u(2),
        padding: `0 ${u(10)}px`,
        borderRadius: u(6),
        border: `1px solid ${on > 0.5 ? `color-mix(in oklab, ${C.primary} 60%, transparent)` : `color-mix(in oklab, ${C.border} 50%, transparent)`}`,
        background: `color-mix(in oklab, ${C.background} ${on * 100}%, transparent)`,
        color: on > 0.5 ? C.foreground : C.mutedForeground,
      }}
    >
      <span style={{ fontSize: u(12), fontWeight: 500, lineHeight: 1.25 }}>{label}</span>
      <span style={{ fontSize: u(11), lineHeight: 1.375, color: C.mutedForeground }}>{hint}</span>
    </div>
  )
}

function OutfitTray({ partyOn, fullOn, count }: { partyOn: number; fullOn: number; count: number }) {
  const label = { fontSize: u(12), fontWeight: 500, color: C.mutedForeground, lineHeight: `${TRAY.labelHeight}px` }
  return (
    <div style={{ position: "relative", height: TRAY_HEIGHT, borderRadius: u(8), background: `color-mix(in oklab, ${C.muted} 40%, transparent)` }}>
      <div style={{ position: "absolute", left: TRAY.pad, right: TRAY.pad, top: TRAY.pad, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={label}>Styles</span>
        <span style={{ fontSize: u(11), color: C.mutedForeground, fontVariantNumeric: "tabular-nums" }}>{count.toLocaleString("en")} outfits</span>
      </div>
      <div style={{ position: "absolute", left: TRAY.pad, top: GRID_TOP, display: "grid", gridTemplateColumns: `repeat(4, ${STYLE_TILE_WIDTH}px)`, gap: TRAY.tileGap }}>
        {STYLES.map((s, i) => (
          // Lingerie and Sexy are disabled, as on the site with NSFW off.
          <div key={s.label} style={{ opacity: i < 6 ? 1 : 0.4 }}>
            <StyleTile label={s.label} Icon={s.Icon} on={i === PARTY ? partyOn : i < 6 ? 1 : 0} />
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: TRAY.pad, top: DETAIL_TOP - TRAY.gap - TRAY.labelHeight, ...label }}>Detail</div>
      <div style={{ position: "absolute", left: TRAY.pad, top: DETAIL_TOP, display: "flex", gap: TRAY.tileGap }}>
        {DETAILS.map((d, i) => (
          <DetailTile key={d.label} label={d.label} hint={d.hint} on={i === 1 ? fullOn : 1 - fullOn} />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: TRAY.pad,
          right: TRAY.pad,
          top: NOTE_TOP,
          paddingTop: u(10),
          borderTop: `1px solid color-mix(in oklab, ${C.border} 40%, transparent)`,
          fontSize: u(11),
          lineHeight: 1.375,
          color: C.mutedForeground,
        }}
      >
        Only posts with one girl change. Beach and snow scenes get clothes that fit.
      </div>
    </div>
  )
}

function SelectList({ selectY, options, selected, hoverY, open }: { selectY: number; options: string[]; selected: number; hoverY: number; open: number }) {
  if (open <= 0) return null
  return (
    <Panel
      style={{
        left: LIST.right - LIST.width,
        top: selectY + 34,
        width: LIST.width,
        padding: 6,
        opacity: open,
        transform: `scale(${0.96 + 0.04 * open})`,
        transformOrigin: "top right",
      }}
    >
      {options.map((label, i) => (
        <MenuItem
          key={label}
          icon={i === selected ? <Check size={20} /> : null}
          label={label}
          highlight={Math.abs(hoverY - listItemY(selectY, i)) < 23 ? 1 : 0}
        />
      ))}
    </Panel>
  )
}

function SettingsPanel({
  frame,
  pointerY,
  opacity,
}: {
  frame: number
  pointerY: number
  opacity: number
}) {
  // Chapter 1: Keep original → Random outfit; the tray opens and the sheet scrolls to it.
  const outfitList = visible(frame, T.outfitSelectClick + 2, T.randomClick + 6, 6)
  const random = frame >= T.randomClick + 2
  const tray = tween(frame, T.randomClick + 6, T.randomClick + 30)
  const scroll = tween(frame, T.randomClick + 8, T.randomClick + 38) * SCROLL * (1 - tween(frame, 452, 482))

  // Chapter 2: Party off, then Full outfit.
  const partyOn = 1 - tween(frame, T.partyClick + 2, T.partyClick + 10)
  const count = Math.round(
    interpolate(frame, [T.partyClick + 4, T.partyClick + 24], [OUTFIT_COUNTS.defaults, OUTFIT_COUNTS.withoutParty], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  )
  const fullOn = tween(frame, T.fullClick + 2, T.fullClick + 10)

  // Chapter 3: the prompt format.
  const formatList = visible(frame, T.formatSelectClick + 2, T.fluxClick + 6, 6)
  const formatIndex = frame < T.fluxClick + 2 ? 0 : 2

  return (
    <div style={{ position: "absolute", inset: 0, opacity, transform: `translateY(${(1 - opacity) * 8}px)` }}>
      <Panel style={{ left: PANEL.x, top: PANEL.y, width: PANEL.width, height: PANEL.height, boxShadow: "none", overflow: "hidden" }}>
        <div style={{ padding: `${PANEL.pad - 1}px ${PANEL.pad - 1}px 0`, transform: `translateY(${-scroll}px)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, height: 44 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: u(8),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: `color-mix(in oklab, ${C.primary} 15%, transparent)`,
                color: C.primaryText,
              }}
            >
              <PenLine size={24} />
            </div>
            <span style={{ fontSize: 22, fontWeight: 600 }}>Customize prompt</span>
          </div>
          <div style={{ marginTop: 16, height: 24, fontSize: 17, fontWeight: 600, color: C.mutedForeground }}>Output</div>
          <SettingRow
            label="Prompt format"
            hint={FORMAT_OPTIONS[formatIndex].hint}
            control={<SelectTrigger value={FORMAT_OPTIONS[formatIndex].label} open={formatList} />}
          />
          <SettingRow
            label="Outfit"
            hint="Dress the character in a new outfit"
            control={<SelectTrigger value={OUTFIT_MODES[random ? 1 : 0]} open={outfitList} />}
            last
          />
          <div style={{ marginTop: 4, height: tray * TRAY_HEIGHT, opacity: tray, overflow: "hidden" }}>
            <OutfitTray partyOn={partyOn} fullOn={fullOn} count={count} />
          </div>
        </div>
      </Panel>
      <SelectList selectY={OUTFIT_SELECT_Y} options={OUTFIT_MODES} selected={random ? 1 : 0} hoverY={pointerY} open={outfitList} />
      <SelectList
        selectY={FORMAT_SELECT_Y}
        options={FORMAT_OPTIONS.map((o) => o.label)}
        selected={formatIndex}
        hoverY={pointerY}
        open={formatList}
      />
    </div>
  )
}

/** "− n +" stepper from pack-category-list.tsx. */
function Stepper({ value }: { value: number }) {
  const button = { width: u(32), height: u(32), display: "grid", placeItems: "center", color: C.mutedForeground }
  return (
    <div style={{ display: "inline-flex", alignItems: "center", borderRadius: u(6), border: `1px solid color-mix(in oklab, ${C.border} 60%, transparent)`, background: C.background }}>
      {/* At the minimum: the − is disabled. */}
      <div style={{ ...button, opacity: 0.3 }}>
        <Minus size={u(12)} />
      </div>
      <span style={{ minWidth: u(36), textAlign: "center", fontWeight: 600, color: C.foreground, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <div style={button}>
        <Plus size={u(12)} />
      </div>
    </div>
  )
}

/** Pool chip from pack-category-list.tsx (TagChip): monospace, one line, truncated. */
function PoolChip({ text, show }: { text: string; show: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: u(4),
        maxWidth: "100%",
        padding: `${u(2)}px ${u(6)}px`,
        borderRadius: u(6),
        border: `1px solid color-mix(in oklab, ${C.border} 50%, transparent)`,
        background: `color-mix(in oklab, ${C.muted} 40%, transparent)`,
        color: `color-mix(in oklab, ${C.foreground} 85%, transparent)`,
        fontFamily: MONO,
        fontSize: u(12),
        lineHeight: `${u(20)}px`,
        opacity: show,
        transform: `scale(${0.85 + 0.15 * show})`,
      }}
    >
      <span style={{ maxWidth: u(256), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
      {/* The remove button keeps its space; it only shows on hover. */}
      <span style={{ width: u(16), height: u(16), marginRight: -u(2) }} />
    </span>
  )
}

function PackClothingRow({ frame, opacity }: { frame: number; opacity: number }) {
  const library = frame >= T.libraryClick + 2
  const stepper = tween(frame, T.libraryClick + 4, T.libraryClick + 20)
  const resample = 1 - visible(frame, T.libraryClick + 2, T.libraryClick + 22, 5)
  const skeleton = 1 - tween(frame, T.libraryClick + 2, T.libraryClick + 10)
  const note = tween(frame, T.libraryClick + 8, T.libraryClick + 20)
  const pulse = 0.75 + 0.25 * Math.cos((frame / 30) * Math.PI)

  const radio = (active: boolean) => ({
    height: u(28),
    padding: `0 ${u(8)}px`,
    display: "inline-flex",
    alignItems: "center",
    gap: u(4),
    borderRadius: u(4),
    background: active ? C.muted : "transparent",
    color: active ? C.foreground : C.mutedForeground,
    fontWeight: active ? 600 : 400,
  })

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity,
        transform: `translateY(${(1 - opacity) * 10}px)`,
        // The pool runs on below the frame (60 outfits); fade it out at the edge.
        maskImage: "linear-gradient(to bottom, black 650px, transparent 712px)",
      }}
    >
      <section
        style={{
          position: "absolute",
          left: PACK.x,
          top: PACK.y,
          width: PACK.width,
          borderRadius: u(12),
          border: `1px solid color-mix(in oklab, ${C.border} 70%, transparent)`,
          background: `color-mix(in oklab, ${C.card} 70%, transparent)`,
          fontFamily: FONT,
          color: C.foreground,
        }}
      >
        {/* Header: chevron, icon, name and summary; then Keep / Vary / Off. */}
        <div style={{ display: "flex", alignItems: "center", gap: u(8), paddingRight: u(12), height: 86 }}>
          <div style={{ display: "flex", alignItems: "center", gap: u(10), flex: 1, minWidth: 0, padding: `0 ${u(16)}px` }}>
            <ChevronRight size={u(14)} color={C.mutedForeground} style={{ transform: "rotate(90deg)", flexShrink: 0 }} />
            <Shirt size={u(16)} color={C.mutedForeground} style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: u(14), fontWeight: 600, lineHeight: 1.25 }}>Clothing</div>
              <div style={{ position: "relative", height: u(16), fontSize: u(12), lineHeight: `${u(16)}px`, color: C.mutedForeground }}>
                <span style={{ position: "absolute", left: 0, opacity: library ? 0 : 1 }}>Collecting tags…</span>
                <span style={{ position: "absolute", left: 0, opacity: library ? 1 : 0, whiteSpace: "nowrap" }}>
                  {PACK_POOL.shown} outfits · 1 per prompt
                </span>
              </div>
            </div>
          </div>
          <div
            style={{
              display: "inline-flex",
              flexShrink: 0,
              padding: u(2),
              borderRadius: u(8),
              border: `1px solid color-mix(in oklab, ${C.border} 60%, transparent)`,
              background: `color-mix(in oklab, ${C.muted} 40%, transparent)`,
              fontSize: u(12),
              fontWeight: 500,
            }}
          >
            {["Keep", "Vary", "Off"].map((label) => (
              <div
                key={label}
                style={{
                  height: u(28),
                  padding: `0 ${u(10)}px`,
                  display: "flex",
                  alignItems: "center",
                  borderRadius: u(6),
                  background: label === "Vary" ? C.pack : "transparent",
                  color: label === "Vary" ? C.primaryForeground : C.mutedForeground,
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Body: the pool. */}
        <div style={{ padding: `${u(4)}px ${u(16)}px ${u(16)}px`, borderTop: `1px solid color-mix(in oklab, ${C.border} 40%, transparent)` }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: u(12) }}>
            <span style={{ width: u(56), flexShrink: 0, paddingTop: u(6), fontSize: u(12), fontWeight: 500, color: C.mutedForeground }}>Pool</span>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: u(8) }}>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: u(12), rowGap: u(8), fontSize: u(12), color: C.mutedForeground }}>
                {stepper > 0 && (
                  <div style={{ maxWidth: stepper * 300, overflow: "hidden", flexShrink: 0, opacity: stepper, marginRight: (stepper - 1) * u(12) }}>
                    <div style={{ display: "flex", alignItems: "center", gap: u(6), whiteSpace: "nowrap" }}>
                      <span>Per prompt</span>
                      <Stepper value={1} />
                    </div>
                  </div>
                )}
                <div style={{ display: "inline-flex", padding: u(2), borderRadius: u(6), border: `1px solid color-mix(in oklab, ${C.border} 60%, transparent)` }}>
                  <div style={radio(!library)}>Loose tags</div>
                  <div style={radio(false)}>
                    <Package size={u(12)} />
                    Full sets
                  </div>
                  <div style={radio(library)}>
                    <Shirt size={u(12)} />
                    Outfit library
                  </div>
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: u(4), height: u(28), padding: `0 ${u(6)}px`, opacity: resample }}>
                  <RefreshCw size={u(12)} />
                  Re-sample
                </div>
              </div>

              {note > 0 && (
                <p style={{ margin: 0, fontSize: u(12), lineHeight: 1.45, color: C.mutedForeground, opacity: note }}>
                  {PACK_POOL.shown} of {PACK_POOL.total.toLocaleString("en")} outfits, in the styles and detail chosen under Customize prompt › Outfit.
                </p>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: u(6), alignContent: "flex-start" }}>
                {library
                  ? PACK_POOL.chips.map((chip, i) => (
                      <PoolChip key={chip} text={chip} show={tween(frame, T.libraryClick + 10 + i * 3, T.libraryClick + 20 + i * 3)} />
                    ))
                  : [56, 72, 48, 88, 64, 52].map((w, i) => (
                      <span key={i} style={{ width: u(w), height: u(24), borderRadius: u(6), background: C.muted, opacity: skeleton * pulse }} />
                    ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** Lines the card's well scrolls by so the clothing tags sit in view. */
const WELL_SCROLL = 2 * 19 * 1.55

export function RandomOutfit({ staticFrame, hidePointer }: { staticFrame?: number; hidePointer?: boolean }) {
  const currentFrame = useCurrentFrame()
  const frame = staticFrame ?? currentFrame
  const pointer = pointerAt(frame)
  const press = Math.max(...CLICKS.map((c) => visible(frame, c, c + 7, 3)))
  const ring = CLICKS.map((c) => (frame - c) / 16).find((p) => p > 0 && p < 1) ?? 0

  // Settings panel: chapters 1–3, until the reading panel takes over.
  const settings = Math.min(tween(frame, 0, 14), 1 - tween(frame, 562, 576))
  // Reading panel: the FLUX.2 text with the outfit marked.
  const reading = Math.min(tween(frame, 572, 588), 1 - tween(frame, 674, 688))
  const markSentences = tween(frame, 598, 650)
  // Chapter 4: the card makes way for Pack Builder's Clothing row.
  const card = Math.min(tween(frame, 0, 14), 1 - tween(frame, 674, 688))
  const pack = tween(frame, 694, 712)

  // The card's well: one layer per version, crossfading on each change.
  const swap1 = T.randomClick + 10
  const swap2 = T.partyClick + 6
  const swap3 = T.fullClick + 6
  const swap4 = T.fluxClick + 6
  const layer = (from: number | null, to: number | null) =>
    Math.min(from === null ? 1 : tween(frame, from + 4, from + 16), to === null ? 1 : 1 - tween(frame, to, to + 10))
  const wellScroll = tween(frame, swap1, swap1 + 24) * WELL_SCROLL
  // The well scrolls (as on the site) so the clothing sits in view; fade both cut edges.
  const wellScrolled = { maskImage: "linear-gradient(to bottom, transparent 4px, black 34px, black calc(100% - 40px), transparent calc(100% - 6px))" }
  const scrolled = (children: ReactNode) => <div style={{ marginTop: -wellScroll }}>{children}</div>

  const [beforeOutfit, afterOutfit] = OUTFIT_FLUX2.split(OUTFIT_SENTENCES)

  const pointerOpacity = hidePointer
    ? 0
    : Math.min(1, 1 - tween(frame, 556, 568) + tween(frame, 704, 716)) * (1 - tween(frame, 820, 836))

  return (
    <AbsoluteFill style={{ background: C.background, fontFamily: FONT, color: C.foreground }}>
      <Header frame={frame} />

      <div style={{ position: "absolute", inset: 0, opacity: card, transform: `translateY(${(1 - card) * -8}px)` }}>
        <PromptCard
          image={OUTFIT_POST.image}
          objectPosition="50% 10%"
          well={
            <>
              <WellText style={{ opacity: layer(null, swap1) }}>{cardTags(OUTFIT_TAGS.original)}</WellText>
              <WellText style={{ opacity: layer(swap1, swap2), ...wellScrolled }}>
                {scrolled(<CardTags frame={frame} clothing={OUTFIT_TAGS.first} marked={tagsOf(OUTFIT_TAGS.first)} markFrom={swap1 + 14} />)}
              </WellText>
              <WellText style={{ opacity: layer(swap2, swap3), ...wellScrolled }}>
                {scrolled(<CardTags frame={frame} clothing={OUTFIT_TAGS.second} marked={tagsOf(OUTFIT_TAGS.second)} markFrom={swap2 + 12} />)}
              </WellText>
              <WellText style={{ opacity: layer(swap3, swap4), ...wellScrolled }}>
                {scrolled(<CardTags frame={frame} clothing={OUTFIT_TAGS.secondFull} marked={ADDED_FULL} markFrom={swap3 + 12} />)}
              </WellText>
              <WellText style={{ opacity: layer(swap4, null) }}>{OUTFIT_FLUX2}</WellText>
            </>
          }
        />
      </div>

      {settings > 0 && <SettingsPanel frame={frame} pointerY={pointer.y} opacity={settings} />}

      {reading > 0 && (
        <div
          style={{
            position: "absolute",
            left: PANEL.x,
            top: PANEL.y,
            width: PANEL.width,
            opacity: reading,
            transform: `translateY(${(1 - reading) * 10}px)`,
            fontSize: 19,
            lineHeight: 1.5,
            color: C.mutedForeground,
          }}
        >
          {beforeOutfit}
          <span style={{ color: C.foreground }}>
            <Mark color={C.primary} progress={markSentences}>
              {OUTFIT_SENTENCES}
            </Mark>
          </span>
          {afterOutfit}
        </div>
      )}

      {pack > 0 && <PackClothingRow frame={frame} opacity={pack} />}

      <ClickRing x={pointer.x} y={pointer.y} progress={ring} />
      <Pointer x={pointer.x} y={pointer.y} press={press} opacity={pointerOpacity} />
    </AbsoluteFill>
  )
}
