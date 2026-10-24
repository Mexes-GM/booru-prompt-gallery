import type { ReactNode } from "react"
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion"
import { Check, ClipboardCheck, Download, ExternalLink, Mountain, Package, Palette, PenLine, Shirt, Smile, Sparkles, User } from "lucide-react"
import { CHAPTERS, DURATION } from "./chapters"
import { CHARACTER_SENTENCES, POST, PROMPTS, wordCount } from "./data"
import { C, FONT, MONO, tween, u, visible } from "./theme"
import { CARD, CHEVRON, MORE_BUTTON } from "./layout"
import {
  ClickRing,
  CountPill,
  Hint,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Panel,
  Pointer,
  PromptCard,
  ScrimChip,
  SelectTrigger,
  SettingRow,
  Switch,
  WellText,
} from "./ui"

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const PANEL = { x: 440, y: 140, width: 480, pad: 26 }
const ROW1_TOP = PANEL.y + PANEL.pad + 44 + 16 + 24
const SELECT = { x: PANEL.x + PANEL.width - PANEL.pad - 118, y: ROW1_TOP + 45 }
const LIST = { right: PANEL.x + PANEL.width - PANEL.pad, top: SELECT.y + 34, width: 260 }
const LIST_ITEM_Y = (i: number) => LIST.top + 6 + 23 + i * 46
const SWITCH = { x: PANEL.x + PANEL.width - PANEL.pad - 35, y: ROW1_TOP + 90 + 45 }

// Opens upward from the split button, aligned to its right edge (as on the site).
const COPY_MENU = { right: CARD.x + CARD.width - CARD.pad, width: 360, bottom: CHEVRON.y - CARD.buttonHeight / 2 - 8 }
const COPY_MENU_HEIGHT = 6 + 41 + 4 * 46 + 13 + 41 + 4 * 46 + 6
const COPY_MENU_TOP = COPY_MENU.bottom - COPY_MENU_HEIGHT
const COPY_AS_Y = (i: number) => COPY_MENU_TOP + 6 + 41 + 23 + i * 46

const ACTIONS_MENU = { width: u(208), top: MORE_BUTTON.y + 28 }
const ACTIONS_Y = (i: number) => ACTIONS_MENU.top + 6 + 23 + i * 46

/** In the last chapter the card slides to the middle of the frame. */
const CENTER_SHIFT = 260

const FORMAT_OPTIONS = [
  { label: "Tags", hint: "Booru tags separated by commas" },
  { label: "Anima", hint: "Tags followed by a short description of the pose and framing" },
  { label: "FLUX.2 · Krea 2", hint: "Plain sentences for FLUX.2 and Krea 2" },
  { label: "MOSS-Image", hint: "A longer description for MOSS-Image" },
]
const COPY_AS = [
  { label: "Tags", hint: "tags" },
  { label: "Anima", hint: "tags + text" },
  { label: "FLUX.2 · Krea 2", hint: "text" },
  { label: "MOSS-Image", hint: "long text" },
]

// ---------------------------------------------------------------------------
// Timeline (frames)
// ---------------------------------------------------------------------------

const T = {
  selectClick: 54,
  formatClick: 98,
  textSwap: 104,
  chevronClick: 266,
  animaClick: 312,
  switchClick: 656,
  moreClick: 816,
}
const CLICKS = [T.selectClick, T.formatClick, T.chevronClick, T.animaClick, T.switchClick, T.moreClick]

type Key = [frame: number, x: number, y: number]
const POINTER_PATH: Key[] = [
  [0, 700, 610],
  [20, 700, 610],
  [50, SELECT.x + 2, SELECT.y + 2],
  [66, SELECT.x + 2, SELECT.y + 2],
  [92, SELECT.x - 10, LIST_ITEM_Y(2) + 2],
  [130, SELECT.x - 10, LIST_ITEM_Y(2) + 2],
  [162, 600, 640],
  [232, 600, 640],
  [262, CHEVRON.x, CHEVRON.y],
  [280, CHEVRON.x, CHEVRON.y],
  [305, 200, COPY_AS_Y(1) + 2],
  [330, 200, COPY_AS_Y(1) + 2],
  [362, 600, 600],
  [612, 640, 610],
  [648, SWITCH.x + 2, SWITCH.y + 2],
  [690, SWITCH.x + 2, SWITCH.y + 2],
  [722, 720, 560],
  [786, 720, 560],
  [812, MORE_BUTTON.x + CENTER_SHIFT, MORE_BUTTON.y],
  [830, MORE_BUTTON.x + CENTER_SHIFT, MORE_BUTTON.y],
  [856, 200 + CENTER_SHIFT, ACTIONS_Y(1) + 2],
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

function SettingsPanel({
  frame,
  formatIndex,
  listOpen,
  keepRow,
  switchOn,
  hoverY,
  opacity,
}: {
  frame: number
  formatIndex: number
  listOpen: number
  keepRow: number
  switchOn: number
  hoverY: number
  opacity: number
}) {
  return (
    <div style={{ position: "absolute", inset: 0, opacity, transform: `translateY(${(1 - opacity) * 8}px)` }}>
      <Panel style={{ left: PANEL.x, top: PANEL.y, width: PANEL.width, padding: PANEL.pad, boxShadow: "none" }}>
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
          control={<SelectTrigger value={FORMAT_OPTIONS[formatIndex].label} open={listOpen} />}
          last={keepRow === 0}
        />
        <div style={{ height: keepRow * 90, opacity: keepRow, overflow: "hidden" }}>
          <SettingRow label="Keep every detail" hint="When off, prompts stay under 80 words" control={<Switch on={switchOn} />} last />
        </div>
      </Panel>
      {listOpen > 0 && (
        <Panel
          style={{
            left: LIST.right - LIST.width,
            top: LIST.top,
            width: LIST.width,
            padding: 6,
            opacity: listOpen,
            transform: `scale(${0.96 + 0.04 * listOpen})`,
            transformOrigin: "top right",
          }}
        >
          {FORMAT_OPTIONS.map((o, i) => (
            <MenuItem
              key={o.label}
              icon={i === formatIndex ? <Check size={20} /> : null}
              label={o.label}
              highlight={Math.abs(hoverY - LIST_ITEM_Y(i)) < 23 ? 1 : 0}
            />
          ))}
        </Panel>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export function FeatureIntro({ staticFrame, hidePointer }: { staticFrame?: number; hidePointer?: boolean }) {
  const currentFrame = useCurrentFrame()
  const frame = staticFrame ?? currentFrame
  const pointer = pointerAt(frame)
  const press = Math.max(...CLICKS.map((c) => visible(frame, c, c + 7, 3)))
  const ring = CLICKS.map((c) => (frame - c) / 16).find((p) => p > 0 && p < 1) ?? 0

  // Chapter 1: pick a format.
  const listOpen = visible(frame, T.selectClick + 2, T.formatClick + 6, 6)
  const formatIndex = frame < T.formatClick + 2 ? 0 : 2
  const keepRow1 = tween(frame, T.formatClick + 10, T.formatClick + 28)
  const panel1 = Math.min(tween(frame, 0, 14), 1 - tween(frame, 225, 240))

  // Chapter 2: copy as.
  const copyMenu = visible(frame, T.chevronClick + 2, T.animaClick + 6, 6)
  const copied = visible(frame, T.animaClick + 4, T.animaClick + 70, 2)
  const clipboard = Math.min(tween(frame, T.animaClick + 10, T.animaClick + 26), 1 - tween(frame, 402, 418))

  // Chapter 3: one description per character.
  const textPanel = Math.min(tween(frame, 424, 440), 1 - tween(frame, 584, 600))
  const markA = tween(frame, 452, 480)
  const markB = tween(frame, 492, 514)
  const chipA = visible(frame, 448, 596, 10)
  const chipB = visible(frame, 488, 596, 10)

  // Chapter 4: short or full.
  const panel4 = Math.min(tween(frame, 604, 620), 1 - tween(frame, 764, 780))
  const switchOn = tween(frame, T.switchClick + 2, T.switchClick + 12)
  const full = frame >= T.switchClick + 8
  const markFull = tween(frame, T.switchClick + 12, T.switchClick + 36)
  const shortWords = wordCount(PROMPTS.flux2)
  const fullWords = wordCount(PROMPTS.flux2Full)
  const words = Math.round(interpolate(frame, [T.switchClick + 8, T.switchClick + 28], [shortWords, fullWords], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }))

  // Chapter 5: the AI rewrite in the card menu.
  const shift = tween(frame, 780, 806) * CENTER_SHIFT
  const hover = tween(frame, 790, 800)
  const actions = tween(frame, T.moreClick + 2, T.moreClick + 10)

  // The card's prompt well.
  const tagsText = 1 - tween(frame, T.textSwap, T.textSwap + 10)
  const proseTop = Math.min(tween(frame, T.textSwap + 4, T.textSwap + 18), 1 - tween(frame, 600, 610))
  const proseEnd = Math.min(tween(frame, 606, 618), 1 - tween(frame, 780, 790))
  const proseFull = tween(frame, 786, 800)
  const addedSentence = PROMPTS.flux2Full.slice(PROMPTS.flux2.length).trim()

  const pointerOpacity = hidePointer ? 0 : Math.min(1 - tween(frame, 414, 424), 1) + tween(frame, 606, 616)
  const pointerY = pointer.y

  const [beforeA, afterA] = PROMPTS.flux2.split(CHARACTER_SENTENCES[0].sentence)
  const [between, afterB] = afterA.split(CHARACTER_SENTENCES[1].sentence)

  return (
    <AbsoluteFill style={{ background: C.background, fontFamily: FONT, color: C.foreground }}>
      <Header frame={frame} />

      <div style={{ position: "absolute", inset: 0, transform: `translateX(${shift}px)`, opacity: tween(frame, 0, 14) }}>
        <PromptCard
          copied={copied}
          showMore={hover}
          overlay={
            <>
              <ScrimChip dot={C.info} style={{ left: 64, top: 186, opacity: chipB, transform: `translateY(${(1 - chipB) * 6}px)` }}>
                Tifa Lockhart
              </ScrimChip>
              <ScrimChip dot={C.favorites} style={{ left: 160, top: 136, opacity: chipA, transform: `translateY(${(1 - chipA) * 6}px)` }}>
                Aerith Gainsborough
              </ScrimChip>
            </>
          }
          well={
            <>
              <WellText style={{ opacity: tagsText }}>{PROMPTS.tags}</WellText>
              <WellText style={{ opacity: proseTop }}>{PROMPTS.flux2}</WellText>
              <WellText
                style={{
                  opacity: proseEnd,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  maskImage: "linear-gradient(to bottom, transparent 0, black 56px)",
                }}
              >
                <span>
                  {PROMPTS.flux2}
                  {full && (
                    <>
                      {" "}
                      <Mark color={C.primary} progress={markFull}>
                        {addedSentence}
                      </Mark>
                    </>
                  )}
                </span>
              </WellText>
              <WellText style={{ opacity: proseFull }}>{PROMPTS.flux2Full}</WellText>
            </>
          }
        />

        {copyMenu > 0 && (
          <Panel
            style={{
              left: COPY_MENU.right - COPY_MENU.width,
              top: COPY_MENU_TOP,
              width: COPY_MENU.width,
              padding: 6,
              opacity: copyMenu,
              transform: `scale(${0.96 + 0.04 * copyMenu})`,
              transformOrigin: "bottom right",
            }}
          >
            <MenuLabel>Copy as</MenuLabel>
            {COPY_AS.map((o, i) => (
              <MenuItem
                key={o.label}
                icon={i === 2 ? <Check size={20} /> : null}
                label={o.label}
                hint={<Hint>{o.hint}</Hint>}
                highlight={Math.abs(pointerY - COPY_AS_Y(i)) < 23 && pointer.x < COPY_MENU.right ? 1 : 0}
              />
            ))}
            <MenuSeparator />
            <MenuLabel>Copy only</MenuLabel>
            <MenuItem icon={<Mountain size={20} />} label="Scenery" hint={<CountPill n={POST.categoryCounts.scenery} />} />
            <MenuItem icon={<User size={20} />} label="Pose" hint={<CountPill n={POST.categoryCounts.pose} />} />
            <MenuItem icon={<Shirt size={20} />} label="Clothing" hint={<CountPill n={POST.categoryCounts.clothing} />} />
            <MenuItem icon={<Smile size={20} />} label="Appearance" hint={<CountPill n={POST.categoryCounts.appearance} />} />
          </Panel>
        )}

        {actions > 0 && (
          <Panel
            style={{
              left: MORE_BUTTON.x + 20 - ACTIONS_MENU.width,
              top: ACTIONS_MENU.top,
              width: ACTIONS_MENU.width,
              padding: 6,
              opacity: actions,
              transform: `scale(${0.96 + 0.04 * actions})`,
              transformOrigin: "top right",
            }}
          >
            {[
              { icon: <Palette size={20} />, label: "Save artist" },
              { icon: <Sparkles size={20} color={C.primaryText} />, label: "Rewrite with AI" },
              { icon: <Package size={20} color={C.pack} />, label: "Make pack" },
              { icon: <Download size={20} />, label: "Download image" },
            ].map((item, i) => (
              <MenuItem
                key={item.label}
                icon={item.icon}
                label={item.label}
                highlight={Math.abs(pointerY - ACTIONS_Y(i)) < 23 && frame > T.moreClick + 20 ? 1 : 0}
              />
            ))}
            <MenuSeparator />
            <MenuItem icon={<ExternalLink size={20} />} label="View original post" />
          </Panel>
        )}
      </div>

      {panel1 > 0 && (
        <SettingsPanel
          frame={frame}
          formatIndex={formatIndex}
          listOpen={listOpen}
          keepRow={keepRow1}
          switchOn={0}
          hoverY={pointerY}
          opacity={panel1}
        />
      )}

      {clipboard > 0 && (
        <Panel
          style={{
            left: PANEL.x,
            top: PANEL.y,
            width: PANEL.width,
            padding: PANEL.pad,
            opacity: clipboard,
            transform: `translateY(${(1 - clipboard) * 10}px)`,
            border: `1px dashed ${C.border}`,
            background: "transparent",
            boxShadow: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 19, color: C.mutedForeground }}>
            <ClipboardCheck size={22} color={C.primaryText} />
            <span style={{ flex: 1 }}>Clipboard</span>
            <span style={{ padding: "3px 12px", borderRadius: 999, background: C.secondary, color: C.foreground, fontSize: 17 }}>Anima</span>
          </div>
          <div style={{ marginTop: 16, fontSize: 19, lineHeight: 1.55, overflowWrap: "anywhere" }}>{PROMPTS.anima}</div>
        </Panel>
      )}

      {textPanel > 0 && (
        <div
          style={{
            position: "absolute",
            left: PANEL.x,
            top: PANEL.y,
            width: PANEL.width,
            opacity: textPanel,
            transform: `translateY(${(1 - textPanel) * 10}px)`,
            fontSize: 22,
            lineHeight: 1.6,
            color: C.mutedForeground,
          }}
        >
          {beforeA}
          <span style={{ color: C.foreground }}>
            <Mark color={C.favorites} progress={markA}>
              {CHARACTER_SENTENCES[0].sentence}
            </Mark>
          </span>
          {between}
          <span style={{ color: C.foreground }}>
            <Mark color={C.info} progress={markB}>
              {CHARACTER_SENTENCES[1].sentence}
            </Mark>
          </span>
          {afterB}
        </div>
      )}

      {panel4 > 0 && (
        <>
          <SettingsPanel frame={frame} formatIndex={2} listOpen={0} keepRow={1} switchOn={switchOn} hoverY={-1} opacity={panel4} />
          <div
            style={{
              position: "absolute",
              left: PANEL.x + PANEL.pad,
              top: ROW1_TOP + 180 + PANEL.pad + 30,
              opacity: panel4,
              fontFamily: MONO,
              fontSize: 22,
              color: C.mutedForeground,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span style={{ color: C.foreground }}>{words}</span> words
          </div>
        </>
      )}

      <ClickRing x={pointer.x} y={pointer.y} progress={ring} />
      <Pointer x={pointer.x} y={pointer.y} press={press} opacity={Math.min(1, pointerOpacity)} />
    </AbsoluteFill>
  )
}
