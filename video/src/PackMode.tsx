import type { ReactNode } from "react"
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion"
import {
  Ban,
  Check,
  ChevronDown,
  Copy,
  Dices,
  ExternalLink,
  Lock,
  LockOpen,
  Minus,
  Mountain,
  Package,
  Palette,
  PersonStanding,
  Plus,
  Shirt,
  UserRound,
  Users,
  X,
} from "lucide-react"
import { EASE, clicksAt, ease, pointerOn, textWidth, useFontsMeasured, type Key } from "./comfy-ui"
import { CHAPTERS, DURATION } from "./pack-chapters"
import {
  Chip,
  Field,
  MS,
  P,
  PANEL,
  Popover,
  Segmented,
  SlotLabel,
  alpha,
  chipWidth,
  edge,
  flow,
  modeWidth,
  segmentWidths,
  segmentedWidth,
  soft,
  toVideo,
  wrapTags,
  wrapWords,
  type Box,
  type ChipSpec,
} from "./pack-ui"
import { C, FONT, MONO } from "./theme"
import { ClickRing, Pointer } from "./ui"

// The Pack Mode video (10.9.0): the pack screen as a full-screen panel over
// the paused gallery. Who, the rows that ask for clothes, a pose and a place,
// Generate, fixes from the results, Copy all with size.
// Same header, pointer and pacing as the earlier videos; every string comes
// from components/prompt-gallery/pack/pack-text.ts or the components that
// draw it.

// ---------------------------------------------------------------------------
// Timeline (frames)
// ---------------------------------------------------------------------------

const T = {
  enter: 8,
  whoClick: 34,
  typeA: 40,
  pickA: 66,
  typeB: 88,
  pickB: 110,
  turns: 166,
  hover: 202,
  scroll1: 236,
  wearClick: 266,
  typeWear: 271,
  enterWear: 294,
  exact: 322,
  doClick: 346,
  typeDo: 350,
  enterDo: 363,
  whereClick: 378,
  typeWhere: 382,
  enterWhere: 397,
  alsoClick: 412,
  typeAlso: 416,
  enterAlso: 433,
  generate: 454,
  results: 480,
  scroll3: 478,
  tag: 542,
  never: 568,
  reroll: 616,
  lock: 664,
  flux: 742,
  chevron: 800,
  size: 828,
  menuClose: 848,
  copy: 870,
}
/** Frames per typed character: Who, then the other rows. */
const CHAR = 1.5
const CHAR_FAST = 1.2

const typed = (word: string, f: number, from: number, speed: number) =>
  f < from ? "" : word.slice(0, Math.min(word.length, Math.floor((f - from) / speed) + 1))

/** A size that jumps at `events` eases there instead, from what it was just before. */
function settle(f: number, events: readonly number[], measure: (frame: number) => number, frames = 10) {
  const last = [...events].reverse().find((e) => e <= f)
  if (last === undefined) return measure(f)
  const before = measure(last - 1)
  return before + (measure(f) - before) * ease(f, last, last + frames)
}

// ---------------------------------------------------------------------------
// Panel layout (CSS px; see pack-ui.tsx)
// ---------------------------------------------------------------------------

const W = PANEL.w
const H = PANEL.h
const HEADER_H = 57
const FOOTER_H = 65
/** The Undo notice above Generate: mb-3 and min-h-10. */
const NOTICE_H = 52
const PAD = 24
const CW = W - 2 * PAD
const RIGHT = PAD + CW
/** Rows: a 5.75rem label column, gap-x-3, then what the row holds. */
const COL_X = PAD + 92 + 12
const COL_W = CW - 104
const NOTE_H = 8 + 19.5

// ---------------------------------------------------------------------------
// Content (rating general, generic tags)
// ---------------------------------------------------------------------------

const CAST = [
  { tag: "frieren", name: "Frieren", look: ["white hair", "twintails", "green eyes", "pointy ears"] },
  { tag: "fern (sousou no frieren)", name: "Fern", look: ["purple hair", "long hair", "purple eyes"] },
]
const PROMPT_COUNT = 10

const RESULTS = [
  {
    character: "Frieren",
    post: 7134502,
    size: "832×1216",
    tags: ["1girl", "solo", "frieren", "white hair", "twintails", "green eyes", "pointy ears", "school uniform", "sitting", "desk", "classroom", "chalkboard", "book", "(smile:1.2)", "looking at viewer"],
    reroll: ["1girl", "solo", "frieren", "white hair", "twintails", "green eyes", "pointy ears", "school uniform", "sitting", "chair", "classroom", "window", "(smile:1.2)", "upper body"],
    natural:
      "Frieren, a girl with white hair in twintails, green eyes and pointy ears, sits by a classroom window in a school uniform, smiling, shown from the waist up.",
  },
  {
    character: "Fern",
    post: 6890217,
    size: "896×1152",
    tags: ["1girl", "solo", "fern (sousou no frieren)", "purple hair", "long hair", "purple eyes", "school uniform", "sitting", "chair", "classroom", "window", "(smile:1.2)", "from side"],
    natural:
      "Fern, a girl with long purple hair and purple eyes, sits on a chair in a classroom in a school uniform, smiling, seen from the side by the window.",
  },
  {
    character: "Frieren",
    post: 7551093,
    size: "1216×832",
    tags: ["1girl", "solo", "frieren", "white hair", "twintails", "green eyes", "pointy ears", "school uniform", "sitting", "on desk", "classroom", "book", "(smile:1.2)", "sunlight"],
    natural:
      "Frieren, a girl with white hair in twintails, green eyes and pointy ears, sits on a desk in a sunlit classroom, wearing a school uniform and smiling.",
  },
  {
    character: "Fern",
    post: 6612840,
    size: "832×1216",
    tags: ["1girl", "solo", "fern (sousou no frieren)", "purple hair", "long hair", "purple eyes", "school uniform", "sitting", "classroom", "window", "(smile:1.2)", "upper body"],
    natural: "Fern, a girl with long purple hair and purple eyes, sits in a classroom in a school uniform by the window, smiling, from the waist up.",
  },
]
const FORMATS = ["Tags", "Anima", "FLUX.2 · Krea 2", "MOSS-Image"]

// ---------------------------------------------------------------------------
// The rows of the pack (pack-brief-panel.tsx)
// ---------------------------------------------------------------------------

type ItemSpec =
  | { kind: "chip"; spec: ChipSpec; at: number }
  | { kind: "roles"; at: number }
  | { kind: "text"; text: string; at: number }

const ROLES = ["Girl", "Boy"]
const GUESSED = "Guessed from their pictures"
const CAST_MODES = ["Together", "One per prompt"]

function itemSize(item: ItemSpec) {
  if (item.kind === "chip") return { w: chipWidth(item.spec), h: 28 }
  if (item.kind === "roles") return { w: segmentedWidth(ROLES), h: 30 }
  return { w: textWidth(item.text, 12, 400), h: 16 }
}

function whoLayout(f: number) {
  const named = f >= T.pickB ? 2 : f >= T.pickA ? 1 : 0
  const several = named >= 2
  const top = several ? 40 : 0
  let y = top
  const lines = CAST.slice(0, named).map((c, i) => {
    const at = i === 0 ? T.pickA : T.pickB
    const items: ItemSpec[] = [
      { kind: "chip", spec: { label: c.name, strong: true }, at },
      ...(several ? ([{ kind: "roles", at: T.pickB }, { kind: "text", text: GUESSED, at: T.pickB }] as ItemSpec[]) : []),
      ...c.look.map((t, j): ItemSpec => ({ kind: "chip", spec: { label: t, trait: true }, at: at + 2 + j })),
    ]
    const { boxes, height } = flow(items.map(itemSize), COL_W)
    const line = { y, items, boxes }
    y += height + 6
    return line
  })
  const field: Box = { x: 0, y, w: COL_W, h: 32 }
  y += 32
  const afterY = y + 4
  y = afterY + 32
  const turns = f > T.turns
  const noteY = turns ? y + 8 : null
  if (turns) y += NOTE_H
  return { named, several, turns, lines, field, afterY, noteY, height: y + 12 }
}

type RowId = "wearing" | "doing" | "where" | "also" | "style" | "never"

const ROW_META: Record<RowId | "who", { label: string; icon: ReactNode }> = {
  who: { label: "Who", icon: <UserRound size={16} color={P.appearanceText} /> },
  wearing: { label: "Wearing", icon: <Shirt size={16} color={P.clothingText} /> },
  doing: { label: "Doing", icon: <PersonStanding size={16} color={P.poseText} /> },
  where: { label: "Where", icon: <Mountain size={16} color={P.sceneryText} /> },
  also: { label: "Also", icon: <Plus size={16} color={C.mutedForeground} /> },
  style: { label: "Style", icon: <Palette size={16} color={C.mutedForeground} /> },
  never: { label: "Never", icon: <Ban size={16} color={P.destructiveText} /> },
}
const ROW_IDS: RowId[] = ["wearing", "doing", "where", "also", "style", "never"]

/** What each row holds at frame `f`: its chips, what is being typed, focus, the note under it. */
function rowState(id: RowId, f: number) {
  const entry = (word: string, click: number, type: number, enter: number, blur: number) => ({
    typing: f >= type && f < enter ? typed(word, f, type, CHAR_FAST) : "",
    focus: ease(f, click + 1, click + 5) * (1 - ease(f, blur, blur + 4)),
    caret: f > click && f < blur,
  })
  switch (id) {
    case "wearing": {
      const has = f >= T.enterWear
      const exact = f > T.exact
      return {
        chips: has ? [{ spec: { label: "school uniform", tone: "clothing", mode: exact ? "Exactly" : "Any" } as ChipSpec, at: T.enterWear }] : [],
        ...entry("school uniform", T.wearClick, T.typeWear, T.enterWear, T.doClick),
        empty: "Usual outfit",
        more: "Add clothing",
        menu: !has,
        note: has ? (exact ? "Replaces the usual outfit" : "Each prompt gets its own kind of it, in place of the usual outfit") : null,
        events: [T.enterWear],
      }
    }
    case "doing":
      return {
        chips: f >= T.enterDo ? [{ spec: { label: "sitting", tone: "pose" } as ChipSpec, at: T.enterDo }] : [],
        ...entry("sitting", T.doClick, T.typeDo, T.enterDo, T.whereClick),
        empty: "Anything",
        more: "Add a pose or action",
        events: [T.enterDo],
      }
    case "where":
      return {
        chips: f >= T.enterWhere ? [{ spec: { label: "classroom", tone: "scenery", mode: "Any" } as ChipSpec, at: T.enterWhere }] : [],
        ...entry("classroom", T.whereClick, T.typeWhere, T.enterWhere, T.alsoClick),
        empty: "Anything",
        more: "Add a place",
        events: [T.enterWhere],
      }
    case "also":
      return {
        chips: f >= T.enterAlso ? [{ spec: { label: "(smile:1.2)" } as ChipSpec, at: T.enterAlso }] : [],
        ...entry("(smile:1.2)", T.alsoClick, T.typeAlso, T.enterAlso, T.generate),
        empty: "Add tags",
        more: "Add more",
        events: [T.enterAlso],
      }
    case "style":
      return { chips: [], typing: "", focus: 0, caret: false, empty: "Add style tags", more: "Add more", events: [] }
    case "never":
      return {
        chips: f > T.never ? [{ spec: { label: "book", never: true } as ChipSpec, at: T.never + 1 }] : [],
        typing: "",
        focus: 0,
        caret: false,
        empty: "Tags no prompt should have",
        more: "Add a tag",
        events: [T.never + 1],
      }
  }
}

function rowLayout(id: RowId, f: number) {
  const s = rowState(id, f)
  const items = [...s.chips.map((c) => ({ w: chipWidth(c.spec), h: 28 })), { w: 0, h: 32, grow: 120 }]
  const { boxes, height } = flow(items, COL_W)
  const note = "note" in s && s.note ? s.note : null
  const content = Math.max(32, height) + (note ? NOTE_H : 0)
  // A divider (divide-y) and py-3.
  return { s, boxes, note, contentH: content, height: 1 + 12 + content + 12 }
}

/** Where each row starts in the scrolling body (pt-4), its eased height, and where the brief ends. */
function briefLayout(f: number) {
  const whoH = settle(f, [T.pickA, T.pickB, T.turns + 1], (x) => whoLayout(x).height)
  let y = 16
  const tops: Record<RowId | "who", number> = { who: y } as Record<RowId | "who", number>
  y += whoH
  for (const id of ROW_IDS) {
    tops[id] = y
    y += settle(f, rowState(id, f).events, (x) => rowLayout(id, x).height)
  }
  return { tops, bottom: y }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** One result row's text, lines and height at frame `f`. */
function rowContent(i: number, f: number) {
  const r = RESULTS[i]
  const natural = f >= T.flux + 14
  const pending = f >= T.flux + 2 && f < T.flux + 14
  let tags = i === 0 && f >= T.reroll + 3 ? RESULTS[0].reroll ?? r.tags : r.tags
  if (f > T.never) tags = tags.filter((t) => t !== "book")
  const locked = i === 0 && f > T.lock
  const actionsW = textWidth(r.size, 11, 500, MONO) + 4 + 3 * 32 + 2 * 2
  const textW = CW - 26 - 24 - 10 - actionsW - 10
  const tokens = wrapTags(tags, textW)
  const lines = natural ? wrapWords(r.natural, textW, 13, 400) : []
  const lineCount = natural ? lines.length : (tokens.at(-1)?.line ?? 0) + 1
  const metaY = locked ? 20 : 0
  const textY = metaY + 18 + (pending ? 18 : 0)
  const contentH = textY + lineCount * 21.125
  return { r, natural, pending, tags, tokens, lines, locked, textW, actionsW, metaY, textY, height: 26 + Math.max(32, 2 + contentH) }
}

/** Where the results sit in the body, under the brief, with their eased heights. */
function lowerLayout(f: number) {
  const resultsTop = briefLayout(f).bottom + 16
  const events = [T.never + 1, T.reroll + 3, T.lock + 1, T.flux + 2, T.flux + 14]
  let y = resultsTop + 32 + 8
  const rows = RESULTS.map((_, i) => {
    const top = y
    y += settle(f, events, (x) => rowContent(i, x).height) + 6
    return top
  })
  return { resultsTop, rows }
}

// ---------------------------------------------------------------------------
// Scroll, footer, pointer targets
// ---------------------------------------------------------------------------

const SCROLL_TO = {
  /** Enough to bring Who's note under the cast choice into view. */
  whoNote: () => Math.max(0, briefLayout(T.turns + 12).tops.wearing - (H - HEADER_H - FOOTER_H) + 4),
  wearing: () => briefLayout(T.scroll1).tops.wearing - 4,
  results: () => lowerLayout(T.results).resultsTop - 8,
}

function scrollAt(f: number) {
  const a = SCROLL_TO.wearing()
  const c = SCROLL_TO.results()
  const a0 = SCROLL_TO.whoNote()
  if (f < T.scroll1) return a0 * ease(f, T.turns + 4, T.turns + 22, EASE.inOut)
  if (f < T.scroll3) return a0 + (a - a0) * ease(f, T.scroll1, T.scroll1 + 22, EASE.inOut)
  // The results arrive under the brief and the body glides down to them.
  return a + (c - a) * ease(f, T.scroll3, T.scroll3 + 30, EASE.inOut)
}

const noticeOn = (f: number) => f > T.never && f < T.never + 180
const footerAt = (f: number) => FOOTER_H + NOTICE_H * Math.min(ease(f, T.never + 1, T.never + 9), 1 - ease(f, T.never + 180, T.never + 188, EASE.exit))

/** Body coordinates (CSS px, scroll 0) → video px at frame `f`. */
const fromBody = (x: number, y: number, f: number) => toVideo(x, HEADER_H + y - scrollAt(f))

const generateLabel = (f: number) => (f >= T.generate && f < T.results ? "Generating…" : `Generate ${PROMPT_COUNT} prompts`)
const generateWidth = (f: number) => 40 + textWidth(generateLabel(f), 14, 600)

function copyLabel(f: number) {
  if (f > T.copy) return `Copied ${PROMPT_COUNT} with size`
  return f > T.size ? "Copy all with size" : "Copy all"
}
const copyWidth = (f: number) => 12 + 16 + 6 + textWidth(copyLabel(f), 14, 500) + 12

/** The token menu of row 1's "book" (result-row.tsx TokenMenu), placed under the tag. */
function tokenMenuBox(f: number) {
  const row = rowContent(0, T.tag)
  const tok = row.tokens.find((t) => t.tag === "book")!
  const top = lowerLayout(f).rows[0]
  return { x: PAD + 13 + 34 + tok.x, y: top + 13 + 2 + row.textY + (tok.line + 1) * 21.125 + 4, w: 224, h: 102, tok, row, top }
}

function sizeMenuBox(f: number) {
  return { x: RIGHT - 288, y: lowerLayout(f).resultsTop + 32 + 4, w: 288 }
}

function pointerPath(): Key[] {
  const who = (f: number) => {
    const b = briefLayout(f)
    return { top: b.tops.who, l: whoLayout(f) }
  }
  const whoField = (f: number) => {
    const { top, l } = who(f)
    return fromBody(COL_X + 70, top + l.field.y + 16, f)
  }
  const suggestion = (f: number) => {
    const { top, l } = who(f)
    return fromBody(COL_X + 80, top + l.field.y + 32 + 6 + 5 + 15, f)
  }
  const turns = (() => {
    const f = T.turns
    const w = segmentWidths(CAST_MODES)
    return fromBody(RIGHT - 3 - w[1] / 2, who(f).top + 16, f)
  })()
  const addSeveral = (() => {
    const f = T.hover
    const { top, l } = who(f)
    return fromBody(COL_X - 10 + 50, top + l.afterY + 16, f)
  })()
  const field = (id: RowId, f: number) => {
    const b = briefLayout(f)
    const l = rowLayout(id, f)
    const box = l.boxes.at(-1)!
    return fromBody(COL_X + box.x + 60, b.tops[id] + 13 + box.y + 16, f)
  }
  const exact = (() => {
    const f = T.exact
    const b = briefLayout(f)
    const box = rowLayout("wearing", f).boxes[0]
    return fromBody(COL_X + box.x + 2 + modeWidth("Any") / 2, b.tops.wearing + 13 + box.y + 14, f)
  })()
  const footerY = (f: number) => H - footerAt(f) + 1 + 12 + (footerAt(f) - FOOTER_H) + 20
  const generate = toVideo(RIGHT - generateWidth(T.generate - 1) / 2 + 20, footerY(T.generate))
  const tag = (() => {
    const m = tokenMenuBox(T.tag)
    return fromBody(m.x + m.tok.w / 2, m.y - 4 - 21.125 / 2, T.tag)
  })()
  const never = (() => {
    const m = tokenMenuBox(T.never)
    return fromBody(m.x + 90, m.y + 1 + 4 + 28 + 32 + 16, T.never)
  })()
  const action = (row: number, which: number, f: number) => fromBody(RIGHT - 1 - 12 - 16 - (2 - which) * 34, lowerLayout(f).rows[row] + 1 + 12 + 16, f)
  const reroll = action(0, 1, T.reroll)
  const lock = action(0, 2, T.lock)
  const flux = (() => {
    const w = segmentWidths(FORMATS)
    const x = PAD + 3 + w[0] + 2 + w[1] + 2 + w[2] / 2
    return fromBody(x, lowerLayout(T.flux).resultsTop + 16, T.flux)
  })()
  const chevron = fromBody(RIGHT - 14, lowerLayout(T.chevron).resultsTop + 16, T.chevron)
  const sizeItem = (() => {
    const m = sizeMenuBox(T.size)
    return fromBody(m.x + 120, m.y + 1 + 4 + 30, T.size)
  })()
  const copy = fromBody(RIGHT - 28 - copyWidth(T.copy - 1) / 2 + 20, lowerLayout(T.copy).resultsTop + 16, T.copy)

  const idle = { x: 820, y: 660 }
  const keys: Key[] = [
    [0, idle.x, idle.y],
    [14, idle.x, idle.y],
    [T.whoClick - 4, whoField(T.whoClick).x, whoField(T.whoClick).y],
    [T.whoClick + 8, whoField(T.whoClick).x + 4, whoField(T.whoClick).y + 4],
    [T.pickA - 4, suggestion(T.pickA - 1).x, suggestion(T.pickA - 1).y],
    [T.pickA + 8, suggestion(T.pickA - 1).x, suggestion(T.pickA - 1).y],
    [T.typeB - 6, whoField(T.typeB).x + 120, whoField(T.typeB).y + 50],
    [T.pickB - 4, suggestion(T.pickB - 1).x, suggestion(T.pickB - 1).y],
    [T.pickB + 10, suggestion(T.pickB - 1).x, suggestion(T.pickB - 1).y],
    [T.turns - 4, turns.x, turns.y],
    [T.turns + 14, turns.x, turns.y],
    [T.hover - 2, addSeveral.x, addSeveral.y],
    [T.hover + 26, addSeveral.x + 6, addSeveral.y],
    [T.scroll1 + 6, 700, 520],
    [T.wearClick - 4, field("wearing", T.wearClick).x, field("wearing", T.wearClick).y],
    [T.wearClick + 10, field("wearing", T.wearClick).x + 60, field("wearing", T.wearClick).y + 30],
    [T.exact - 4, exact.x, exact.y],
    [T.exact + 8, exact.x, exact.y],
    [T.doClick - 4, field("doing", T.doClick).x, field("doing", T.doClick).y],
    [T.doClick + 6, field("doing", T.doClick).x, field("doing", T.doClick).y],
    [T.whereClick - 4, field("where", T.whereClick).x, field("where", T.whereClick).y],
    [T.whereClick + 6, field("where", T.whereClick).x, field("where", T.whereClick).y],
    [T.alsoClick - 4, field("also", T.alsoClick).x, field("also", T.alsoClick).y],
    [T.alsoClick + 14, field("also", T.alsoClick).x + 40, field("also", T.alsoClick).y + 20],
    [T.generate - 4, generate.x, generate.y],
    [T.generate + 14, generate.x, generate.y],
    [T.scroll3 + 30, 720, 560],
    [T.tag - 4, tag.x, tag.y],
    [T.tag + 8, tag.x, tag.y],
    [T.never - 4, never.x, never.y],
    [T.never + 12, never.x, never.y],
    [T.reroll - 4, reroll.x, reroll.y],
    [T.reroll + 12, reroll.x, reroll.y],
    [T.lock - 4, lock.x, lock.y],
    [T.lock + 14, lock.x, lock.y],
    [T.lock + 40, 780, 560],
    [T.flux - 4, flux.x, flux.y],
    [T.flux + 12, flux.x, flux.y],
    [T.chevron - 4, chevron.x, chevron.y],
    [T.chevron + 8, chevron.x, chevron.y],
    [T.size - 4, sizeItem.x, sizeItem.y],
    [T.size + 12, sizeItem.x, sizeItem.y],
    [T.copy - 4, copy.x, copy.y],
    [T.copy + 14, copy.x, copy.y],
    [T.copy + 50, 800, 600],
  ]
  return keys
}

const CLICKS = [T.whoClick, T.pickA, T.pickB, T.turns, T.wearClick, T.exact, T.doClick, T.whereClick, T.alsoClick, T.generate, T.tag, T.never, T.reroll, T.lock, T.flux, T.chevron, T.size, T.copy]

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function chapterAt(frame: number) {
  let index = 0
  CHAPTERS.forEach((c, i) => {
    if (frame >= c.from) index = i
  })
  return index
}

function Header({ frame }: { frame: number }) {
  const index = chapterAt(frame)
  const start = CHAPTERS[index].from
  const end = CHAPTERS[index + 1]?.from ?? DURATION
  const fade = index === 0 ? 1 : ease(frame, start, start + 10)
  const out = index === CHAPTERS.length - 1 ? 0 : ease(frame, end - 8, end, EASE.exit)
  return (
    <div style={{ position: "absolute", left: 40, top: 30, right: 40, fontFamily: FONT }}>
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
          marginTop: 14,
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

/** The gallery under the pack: it pauses, dims and blurs as the panel opens. */
function Gallery({ frame }: { frame: number }) {
  const dim = ease(frame, T.enter - 2, T.enter + 16)
  const cols = 5
  const w = 164
  const gap = 16
  const x0 = (960 - (cols * w + (cols - 1) * gap)) / 2
  const heights = [[250, 300, 260], [310, 240, 280], [230, 290, 300], [290, 260, 240], [260, 300, 270]]
  return (
    <>
      <div style={{ position: "absolute", inset: 0, filter: `blur(${(dim * 9).toFixed(2)}px)` }}>
        {heights.map((col, c) => {
          let y = 100 + (c % 2) * 26
          return col.map((h, r) => {
            const top = y
            y += h + gap
            const image = (c + r) % 2 === 0 ? "danbooru-5513008.jpg" : "danbooru-12450891.jpg"
            return (
              <div key={`${c}-${r}`} style={{ position: "absolute", left: x0 + c * (w + gap), top, width: w, height: h, borderRadius: 16, background: C.card, overflow: "hidden" }}>
                <Img src={staticFile(image)} style={{ width: "100%", height: h * 0.62, objectFit: "cover", objectPosition: `50% ${(c * 23 + r * 41) % 60}%` }} />
                <div style={{ margin: "12px 12px 0", height: 10, borderRadius: 5, background: C.muted }} />
                <div style={{ margin: "8px 12px 0", width: "60%", height: 10, borderRadius: 5, background: C.muted }} />
              </div>
            )
          })
        })}
      </div>
      <div style={{ position: "absolute", inset: 0, background: `color-mix(in oklab, ${C.overlay} ${20 + 50 * dim}%, transparent)` }} />
    </>
  )
}

/** pack-brief-builder.tsx PackHeader. */
function PackHeader() {
  const ghost = { height: 32, padding: "0 10px", display: "flex", alignItems: "center", fontSize: 13, color: C.mutedForeground, borderRadius: 6 } as const
  const menu = { height: 28, padding: "0 10px", display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 500, color: C.foreground } as const
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: W, height: HEADER_H, borderBottom: `1px solid ${alpha(C.border, 60)}`, display: "flex", alignItems: "center", gap: 12, padding: "0 20px" }}>
      <span style={{ width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center", background: soft(P.pack), color: P.packText }}>
        <Package size={18} />
      </span>
      <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>Pack</span>
      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={ghost}>New pack</span>
        <span style={ghost}>Classic builder</span>
        <span style={{ height: 32, display: "flex", alignItems: "center", padding: 2, borderRadius: 8, background: alpha(C.muted, 70) }}>
          <span style={menu}>
            Danbooru <ChevronDown size={14} color={C.mutedForeground} />
          </span>
          <span style={{ width: 1, height: 16, background: C.border }} />
          <span style={menu}>
            Safe <ChevronDown size={14} color={C.mutedForeground} />
          </span>
        </span>
      </span>
      <span style={{ width: 36, height: 36, display: "grid", placeItems: "center", color: C.mutedForeground }}>
        <X size={18} />
      </span>
    </div>
  )
}

const appear = (f: number, at: number) => ({
  opacity: ease(f, at, at + 6),
  transform: `scale(${0.94 + 0.06 * ease(f, at, at + 9, EASE.springy)})`,
})

function QuietButton({ icon, label, x, y, hover }: { icon: ReactNode; label: string; x: number; y: number; hover: number }) {
  return (
    <span
      style={{
        position: "absolute",
        left: x,
        top: y,
        height: 32,
        padding: "0 10px",
        display: "flex",
        alignItems: "center",
        gap: 6,
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 500,
        color: hover > 0.5 ? C.foreground : C.mutedForeground,
        background: alpha(C.muted, 100 * hover),
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {label}
    </span>
  )
}

function WhoRow({ f, top }: { f: number; top: number }) {
  const l = whoLayout(f)
  const typing = f >= T.typeB && f < T.pickB ? typed("fern", f, T.typeB, CHAR) : f >= T.typeA && f < T.pickA ? typed("frieren", f, T.typeA, CHAR) : ""
  const focus = ease(f, T.whoClick + 1, T.whoClick + 5) * (1 - ease(f, T.turns, T.turns + 4))
  const filled = l.named > 0
  const shift = settle(f, [T.pickB], (x) => whoLayout(x).lines[0]?.y ?? 0)
  const fieldY = settle(f, [T.pickA, T.pickB], (x) => whoLayout(x).field.y)
  const afterY = settle(f, [T.pickA, T.pickB], (x) => whoLayout(x).afterY)
  const turns = ease(f, T.turns + 1, T.turns + 6)
  const hover = Math.min(ease(f, T.hover, T.hover + 4), 1 - ease(f, T.hover + 30, T.hover + 36))
  const addW = 20 + 14 + 6 + textWidth("Add several", 13, 500)
  const choiceW = segmentedWidth(CAST_MODES)
  return (
    <div style={{ position: "absolute", left: 0, top, width: W }}>
      <SlotLabel icon={ROW_META.who.icon} label="Who" x={PAD} y={0} />
      {l.several && (
        <div style={appear(f, T.pickB + 2)}>
          <Segmented labels={CAST_MODES} value={turns > 0.5 ? 1 : 0} box={{ x: RIGHT - choiceW, y: 1, w: choiceW, h: 30 }} />
        </div>
      )}
      {l.lines.map((line, i) =>
        line.items.map((item, j) => {
          const box = { ...line.boxes[j], x: COL_X + line.boxes[j].x, y: (i === 0 ? shift : line.y) + line.boxes[j].y }
          const style = appear(f, item.at)
          if (item.kind === "chip") return <Chip key={`${i}-${j}`} spec={item.spec} box={box} style={style} />
          if (item.kind === "roles")
            return (
              <div key={`${i}-${j}`} style={style}>
                <Segmented labels={ROLES} value={0} box={box} />
              </div>
            )
          return (
            <span key={`${i}-${j}`} style={{ position: "absolute", left: box.x, top: box.y, fontSize: 12, lineHeight: "16px", color: C.mutedForeground, whiteSpace: "nowrap", ...style }}>
              {item.text}
            </span>
          )
        }),
      )}
      <Field
        box={{ x: COL_X, y: fieldY, w: COL_W, h: 32 }}
        placeholder={filled ? "Add a character or look" : "Anything"}
        text={typing}
        empty={!filled}
        focus={focus}
        caret={focus > 0.5 && Math.floor(f / 15) % 2 === 0 ? true : focus > 0.5 && typing.length > 0}
      />
      <QuietButton icon={<Users size={14} color={P.packText} />} label="Add several" x={COL_X - 10} y={afterY} hover={hover} />
      {l.named === 0 && (
        <span style={{ opacity: 1 - ease(f, T.pickA, T.pickA + 4) }}>
          <QuietButton icon={<Dices size={14} color={P.packText} />} label="Random characters" x={COL_X - 10 + addW + 2} y={afterY} hover={0} />
        </span>
      )}
      {l.noteY !== null && (
        <p style={{ position: "absolute", left: COL_X, top: l.noteY, margin: 0, fontSize: 12, lineHeight: "19.5px", color: C.mutedForeground, ...appear(f, T.turns + 2) }}>
          Each prompt shows one of them, taking turns.
        </p>
      )}
    </div>
  )
}

function SuggestionList({ f, top }: { f: number; top: number }) {
  const l = whoLayout(f)
  const forA = f >= T.typeA + 3 * CHAR && f < T.pickA
  const forB = f >= T.typeB + 3 * CHAR && f < T.pickB
  if (!forA && !forB) return null
  const name = forA ? "frieren" : "fern (sousou no frieren)"
  const from = forA ? T.typeA + 3 * CHAR : T.typeB + 3 * CHAR
  const show = ease(f, from, from + 5)
  const y = top + l.field.y + 32 + 6
  const press = forA ? ease(f, T.pickA - 3, T.pickA) : ease(f, T.pickB - 3, T.pickB)
  return (
    <Popover box={{ x: COL_X, y, w: COL_W }} style={{ opacity: show, transform: `translateY(${(1 - show) * -4}px)` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "6px 8px", borderRadius: 6, fontSize: 13, background: press > 0 ? alpha(C.accent, 100) : alpha(C.accent, 70) }}>
        <span style={{ flex: 1 }}>{name}</span>
        <span style={{ fontSize: 12, color: C.mutedForeground }}>Character</span>
      </div>
    </Popover>
  )
}

function BriefRow({ id, f, top }: { id: RowId; f: number; top: number }) {
  const l = rowLayout(id, f)
  const s = l.s
  const fieldBox = l.boxes.at(-1)!
  const filled = s.chips.length > 0
  const caret = s.caret && (s.typing.length > 0 || Math.floor(f / 15) % 2 === 0)
  const menu = "menu" in s && s.menu
  return (
    <div style={{ position: "absolute", left: 0, top, width: W }}>
      <div style={{ position: "absolute", left: PAD, right: PAD, top: 0, height: 1, background: alpha(C.border, 50) }} />
      <SlotLabel icon={ROW_META[id].icon} label={ROW_META[id].label} x={PAD} y={13} />
      {s.chips.map((c, i) => (
        <Chip key={c.spec.label} spec={c.spec} box={{ ...l.boxes[i], x: COL_X + l.boxes[i].x, y: 13 + l.boxes[i].y }} style={appear(f, c.at)} />
      ))}
      <Field
        box={{ ...fieldBox, x: COL_X + fieldBox.x, y: 13 + fieldBox.y }}
        placeholder={filled ? s.more : s.empty}
        text={s.typing}
        empty={!filled}
        focus={s.focus}
        caret={caret}
        trailing={menu ? <ChevronDown size={14} color={C.mutedForeground} /> : undefined}
      />
      {l.note && (
        <p key={l.note} style={{ position: "absolute", left: COL_X, top: 13 + l.contentH - 19.5, margin: 0, fontSize: 12, lineHeight: "19.5px", color: C.mutedForeground, whiteSpace: "nowrap", opacity: ease(f, id === "wearing" && f > T.exact ? T.exact + 1 : T.enterWear, (id === "wearing" && f > T.exact ? T.exact + 1 : T.enterWear) + 8) }}>
          {l.note}
        </p>
      )}
    </div>
  )
}

function Toolbar({ f, top }: { f: number; top: number }) {
  const value = f > T.flux ? 2 : 0
  const fmtW = segmentedWidth(FORMATS)
  const copied = f > T.copy && f < T.copy + 60
  const bw = copyWidth(f)
  return (
    <div style={{ position: "absolute", left: 0, top, width: W, height: 32 }}>
      <Segmented labels={FORMATS} value={value} box={{ x: PAD, y: 1, w: fmtW, h: 30 }} />
      <span
        style={{
          position: "absolute",
          left: RIGHT - 28 - bw,
          top: 0,
          width: bw,
          height: 32,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 12px",
          borderRadius: "6px 0 0 6px",
          background: copied ? C.primary : C.secondary,
          color: copied ? C.primaryForeground : C.foreground,
          fontSize: 14,
          fontWeight: 500,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {copyLabel(f)}
      </span>
      <span style={{ position: "absolute", left: RIGHT - 28, top: 0, width: 28, height: 32, display: "grid", placeItems: "center", borderRadius: "0 6px 6px 0", borderLeft: `1px solid ${alpha(C.border, 60)}`, background: f > T.chevron && f < T.menuClose ? alpha(C.secondary, 100) : C.secondary, color: C.foreground }}>
        <ChevronDown size={14} />
      </span>
    </div>
  )
}

function ResultRowView({ i, f, top }: { i: number; f: number; top: number }) {
  const c = rowContent(i, f)
  const n = String(i + 1).padStart(2, "0")
  const swap = i === 0 ? Math.min(1, Math.abs(f - (T.reroll + 3)) / 4) : 1
  const lockFill = i === 0 ? ease(f, T.lock + 1, T.lock + 7) : 0
  const pendingInk = c.pending ? C.mutedForeground : C.foreground
  const copyW = textWidth(c.r.size, 11, 500, MONO)
  const height = settle(f, [T.never + 1, T.reroll + 3, T.lock + 1, T.flux + 2, T.flux + 14], (x) => rowContent(i, x).height)
  return (
    <div
      style={{
        position: "absolute",
        left: PAD,
        top,
        width: CW,
        height,
        borderRadius: 12,
        border: `1px solid ${lockFill > 0.5 ? edge(P.pack) : alpha(C.border, 60)}`,
        background: C.card,
        overflow: "hidden",
      }}
    >
      {lockFill > 0 && <div style={{ position: "absolute", inset: 0, background: `color-mix(in oklab, ${C.background} 100%, transparent)`, opacity: lockFill }} />}
      {lockFill > 0 && <div style={{ position: "absolute", inset: 0, background: soft(P.pack), opacity: lockFill }} />}
      <span style={{ position: "absolute", left: 12, top: 14, fontFamily: MONO, fontSize: 12, lineHeight: "20px", color: C.mutedForeground }}>{n}</span>
      <div style={{ position: "absolute", left: 12 + 34, top: 14, width: c.textW }}>
        {c.locked && (
          <p style={{ position: "absolute", top: 0, margin: 0, display: "flex", alignItems: "center", gap: 4, fontSize: 12, lineHeight: "16px", fontWeight: 500, color: P.packText, opacity: lockFill }}>
            <Lock size={12} /> Locked: stays when you generate again
          </p>
        )}
        <p style={{ position: "absolute", top: c.metaY, margin: 0, display: "flex", alignItems: "baseline", gap: 8, fontSize: 12, lineHeight: "16px", color: C.mutedForeground, whiteSpace: "nowrap" }}>
          <span style={{ fontWeight: 500 }}>{c.r.character}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: MONO }}>
            Post {c.r.post} <ExternalLink size={12} />
          </span>
        </p>
        {c.pending && <p style={{ position: "absolute", top: c.metaY + 18, margin: 0, fontSize: 12, lineHeight: "16px", color: C.mutedForeground }}>Updating…</p>}
        <div style={{ position: "absolute", top: c.textY, left: 0, width: c.textW, opacity: swap }}>
          {c.natural
            ? c.lines.map((line, k) => (
                <div key={k} style={{ height: 21.125, fontSize: 13, lineHeight: "21.125px", color: C.foreground, whiteSpace: "nowrap" }}>
                  {line}
                </div>
              ))
            : c.tokens.map((t, k) => (
                <span key={`${t.tag}-${k}`} style={{ position: "absolute", left: t.x, top: t.line * 21.125, fontFamily: MONO, fontSize: 13, lineHeight: "21.125px", whiteSpace: "nowrap", color: pendingInk }}>
                  <span style={{ borderRadius: 3, background: i === 0 && t.tag === "book" && f > T.tag && f <= T.never ? C.muted : "transparent" }}>{t.tag}</span>
                  {k < c.tokens.length - 1 && <span style={{ color: C.mutedForeground }}>,</span>}
                </span>
              ))}
        </div>
      </div>
      <div style={{ position: "absolute", right: 12, top: 12, display: "flex", alignItems: "center", gap: 2 }}>
        <span style={{ width: copyW, marginRight: 4, fontFamily: MONO, fontSize: 11, color: C.mutedForeground, whiteSpace: "nowrap" }}>{c.r.size}</span>
        <ActionIcon>
          <Copy size={16} />
        </ActionIcon>
        <ActionIcon active={i === 0 ? Math.min(ease(f, T.reroll - 2, T.reroll), 1 - ease(f, T.reroll + 10, T.reroll + 16)) : 0}>
          <Dices size={16} />
        </ActionIcon>
        <ActionIcon tint={lockFill > 0.5 ? P.packText : undefined}>{lockFill > 0.5 ? <Lock size={16} /> : <LockOpen size={16} />}</ActionIcon>
      </div>
    </div>
  )
}

function ActionIcon({ children, active = 0, tint }: { children: ReactNode; active?: number; tint?: string }) {
  return (
    <span style={{ width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 6, color: tint ?? (active > 0.5 ? C.foreground : C.mutedForeground), background: alpha(C.muted, 100 * active) }}>
      {children}
    </span>
  )
}

function TokenMenu({ f }: { f: number }) {
  const open = Math.min(ease(f, T.tag + 1, T.tag + 6), 1 - ease(f, T.never + 1, T.never + 5, EASE.exit))
  if (open <= 0) return null
  const m = tokenMenuBox(f)
  const y = HEADER_H + m.y - scrollAt(f)
  const pick = f > T.never - 6
  const item = (label: string, on: boolean) => (
    <div style={{ height: 32, padding: "0 8px", display: "flex", alignItems: "center", borderRadius: 4, fontSize: 14, background: on ? C.accent : "transparent" }}>{label}</div>
  )
  return (
    <Popover box={{ x: m.x, y, w: m.w }} style={{ opacity: open, transform: `scale(${0.96 + 0.04 * open})`, transformOrigin: "top left" }}>
      <div style={{ height: 28, padding: "0 8px", display: "flex", alignItems: "center", fontFamily: MONO, fontSize: 12, fontWeight: 500, color: C.mutedForeground }}>book</div>
      {item("Always in every prompt", !pick)}
      {item("Never in this pack", pick)}
    </Popover>
  )
}

function SizeMenu({ f }: { f: number }) {
  const open = Math.min(ease(f, T.chevron + 1, T.chevron + 6), 1 - ease(f, T.menuClose, T.menuClose + 5, EASE.exit))
  if (open <= 0) return null
  const m = sizeMenuBox(f)
  const checked = f > T.size
  const hover = f > T.size - 8
  return (
    <Popover box={{ x: m.x, y: HEADER_H + m.y - scrollAt(f), w: m.w }} style={{ opacity: open, transform: `scale(${0.96 + 0.04 * open})`, transformOrigin: "top right" }}>
      <div style={{ position: "relative", padding: "6px 8px 6px 32px", borderRadius: 4, background: hover ? C.accent : "transparent" }}>
        <span style={{ position: "absolute", left: 8, top: 9, width: 14, height: 14, display: "grid", placeItems: "center" }}>{checked && <Check size={16} />}</span>
        <div style={{ fontSize: 14, lineHeight: "20px" }}>Add size as [WIDTHxHEIGHT]</div>
        <div style={{ marginTop: 2, fontSize: 12, lineHeight: "16px", color: C.mutedForeground }}>For the extension&apos;s Import List. Taken from the post each prompt&apos;s scene came from.</div>
      </div>
    </Popover>
  )
}

function Footer({ f }: { f: number }) {
  const h = footerAt(f)
  const notice = Math.min(ease(f, T.never + 1, T.never + 9), 1 - ease(f, T.never + 180, T.never + 188, EASE.exit))
  const barY = 1 + 12 + (h - FOOTER_H)
  const label = generateLabel(f)
  const gw = generateWidth(f)
  const stepX = RIGHT - gw - 12 - 114
  const generating = f >= T.generate && f < T.results
  const press = Math.min(ease(f, T.generate, T.generate + 3), 1 - ease(f, T.generate + 4, T.generate + 8))
  return (
    <div style={{ position: "absolute", left: 0, top: H - h, width: W, height: h, borderTop: `1px solid ${alpha(C.border, 60)}`, background: C.background }}>
      {noticeOn(f) || notice > 0 ? (
        <div
          style={{
            position: "absolute",
            left: PAD,
            top: 12,
            width: CW,
            height: 40,
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "0 4px 0 12px",
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: C.popover,
            boxShadow: "0 4px 10px -2px rgb(0 0 0 / 0.3)",
            fontSize: 14,
            opacity: notice,
            transform: `translateY(${(1 - notice) * 8}px)`,
          }}
        >
          <span style={{ flex: 1 }}>Removed book from 2 prompts</span>
          <span style={{ height: 32, padding: "0 10px", display: "flex", alignItems: "center", fontWeight: 500, color: P.primaryText }}>Undo</span>
          <span style={{ width: 32, height: 32, display: "grid", placeItems: "center", color: C.mutedForeground }}>
            <X size={16} />
          </span>
        </div>
      ) : null}
      {f > T.lock && (
        <span style={{ position: "absolute", left: PAD, top: barY, width: stepX - 8 - textWidth("Prompts", 13, 500) - 12 - PAD, height: 40, display: "flex", alignItems: "center", fontSize: 13, lineHeight: "18px", textWrap: "pretty", color: C.mutedForeground, opacity: ease(f, T.lock + 1, T.lock + 8) }}>
          1 locked prompt stays as it is
        </span>
      )}
      <span style={{ position: "absolute", left: stepX - 8 - textWidth("Prompts", 13, 500), top: barY + 11, fontSize: 13, fontWeight: 500, color: C.mutedForeground }}>Prompts</span>
      <span style={{ position: "absolute", left: stepX, top: barY, width: 114, height: 40, display: "flex", alignItems: "center", borderRadius: 8, border: `1px solid ${alpha(C.border, 80)}`, background: C.background, opacity: generating ? 0.5 : 1 }}>
        <span style={{ width: 36, display: "grid", placeItems: "center", color: C.mutedForeground }}>
          <Minus size={14} />
        </span>
        <span style={{ flex: 1, textAlign: "center", fontFamily: MONO, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{PROMPT_COUNT}</span>
        <span style={{ width: 36, display: "grid", placeItems: "center", color: C.mutedForeground }}>
          <Plus size={14} />
        </span>
      </span>
      <span
        style={{
          position: "absolute",
          left: RIGHT - gw,
          top: barY,
          width: gw,
          height: 40,
          display: "grid",
          placeItems: "center",
          borderRadius: 8,
          background: C.primary,
          color: C.primaryForeground,
          fontSize: 14,
          fontWeight: 600,
          whiteSpace: "nowrap",
          boxShadow: "0 1px 2px rgb(0 0 0 / 0.3)",
          transform: `scale(${1 - press * 0.04})`,
        }}
      >
        {label}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export function PackMode({ staticFrame, hidePointer }: { staticFrame?: number; hidePointer?: boolean }) {
  const currentFrame = useCurrentFrame()
  const f = staticFrame ?? currentFrame
  useFontsMeasured()

  const pointer = pointerOn(pointerPath(), f)
  const { press, ring } = clicksAt(CLICKS, f)
  const pointerOpacity = hidePointer ? 0 : Math.min(ease(f, 12, 22), 1 - ease(f, T.copy + 40, T.copy + 54, EASE.exit))

  const enter = ease(f, T.enter, T.enter + 18, EASE.rise)
  const k = 0.98 + 0.02 * enter
  const scroll = scrollAt(f)
  const brief = briefLayout(f)
  const lower = lowerLayout(f)
  const bodyH = H - HEADER_H - footerAt(f)

  return (
    <AbsoluteFill style={{ background: C.background, fontFamily: FONT, color: C.foreground }}>
      <Gallery frame={f} />
      <Header frame={f} />

      <div
        style={{
          position: "absolute",
          left: PANEL.x,
          top: PANEL.y,
          width: W,
          height: H,
          transformOrigin: "0 0",
          transform: `translate(${(W * MS * (1 - k)) / 2}px, ${(1 - enter) * 18 + (H * MS * (1 - k)) / 2}px) scale(${MS * k})`,
          opacity: enter,
          borderRadius: 16,
          background: C.background,
          boxShadow: `0 25px 50px -12px rgb(0 0 0 / 0.5), 0 0 0 1px ${alpha(C.foreground, 10)}`,
          overflow: "hidden",
        }}
      >
        <PackHeader />
        <div style={{ position: "absolute", left: 0, top: HEADER_H, width: W, height: bodyH, overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, top: -scroll, width: W }}>
            <WhoRow f={f} top={brief.tops.who} />
            {ROW_IDS.map((id) => (
              <BriefRow key={id} id={id} f={f} top={brief.tops[id]} />
            ))}
            {f >= T.results && (
              <div style={{ opacity: ease(f, T.results, T.results + 8) }}>
                <Toolbar f={f} top={lower.resultsTop} />
                {RESULTS.map((_, i) => (
                  <div key={i} style={{ opacity: ease(f, T.results + i * 2, T.results + 8 + i * 2) }}>
                    <ResultRowView i={i} f={f} top={lower.rows[i]} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <Footer f={f} />
        <div style={{ position: "absolute", left: 0, top: HEADER_H - scroll, width: W }}>
          <SuggestionList f={f} top={brief.tops.who} />
        </div>
        <TokenMenu f={f} />
        <SizeMenu f={f} />
      </div>

      <ClickRing x={pointer.x} y={pointer.y} progress={ring} />
      <Pointer x={pointer.x} y={pointer.y} press={press} opacity={pointerOpacity} />
    </AbsoluteFill>
  )
}
