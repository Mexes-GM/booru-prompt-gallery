import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion"
import { Check, PenLine, Send } from "lucide-react"
import {
  CardJob,
  ComfyWindow,
  EASE,
  GraphHint,
  MANAGER,
  ManagerDialog,
  NamePill,
  NEW_ROW_NAME,
  NEW_ROW_USE,
  PublishButton,
  PublishedList,
  RunButton,
  SendLabel,
  WINDOW,
  WORKFLOW_NAME,
  arc,
  clicksAt,
  ease,
  jobDone,
  pointerOn,
  textWidth,
  useFontsMeasured,
  type Job,
  type Key,
} from "./comfy-ui"
import { POST, PROMPTS } from "./data"
import { CARD, CHEVRON } from "./layout"
import { CHAPTERS, DURATION } from "./send-to-comfy-chapters"
import { C, FONT, u } from "./theme"
import { ClickRing, Hint, MenuItem, MenuLabel, MenuSeparator, Panel, Pointer, PromptCard, SelectTrigger, SettingRow, Switch, WellText } from "./ui"

// The Send to ComfyUI video (10.9.0): install the node, add a workflow,
// turn the mode on, send from a card, send as another format. Same header,
// card, pointer and pacing as the earlier videos; the ComfyUI side is an
// abstract window from comfy-ui.tsx.

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const FRAME = { x: 40, y: 112, width: 880, height: 578 }
const CANVAS_TOP = FRAME.y + WINDOW.titleHeight + WINDOW.barHeight + 2
/** The window is shorter once the list from the site sits under it. */
const SHORT_HEIGHT = 300
const DIALOG = { x: FRAME.x + (FRAME.width - MANAGER.width) / 2, y: CANVAS_TOP + 32 }
const SEARCH = { x: DIALOG.x + 220, y: DIALOG.y + MANAGER.headHeight + MANAGER.searchHeight / 2 }
const INSTALL = { x: DIALOG.x + MANAGER.width - MANAGER.pad - 14 - 80, y: DIALOG.y + MANAGER.headHeight + MANAGER.searchHeight + 14 + MANAGER.rowHeight / 2 }
const BAR_Y = FRAME.y + WINDOW.titleHeight + WINDOW.barHeight / 2

const LIST_BOX = { x: 200, y: FRAME.y + SHORT_HEIGHT + 28, width: 560 }

/** Customize prompt, as in the earlier videos. */
const PANEL = { x: 440, y: 112, width: 480, pad: 26 }
const SEND_ROW_TOP = PANEL.y + PANEL.pad - 1 + 44 + 16 + 24 + 90
const SWITCH = { x: PANEL.x + PANEL.width - PANEL.pad - 35, y: SEND_ROW_TOP + 45 }

/** The card moves to the middle of the frame for the sends. */
const CENTER_SHIFT = 260
const SEND_BUTTON = { x: CARD.x + CARD.pad + (CARD.width - 2 * CARD.pad - 56) / 2, y: CHEVRON.y }
const THUMB = { x: CARD.x + u(8) + u(4) + u(16), y: CARD.y + u(8) + u(4) + u(20) }

// The ▾ menu with Send as on top (copy-options-dropdown.tsx), opening upward.
const MENU = { right: CARD.x + CARD.width - CARD.pad, width: 360, bottom: CHEVRON.y - CARD.buttonHeight / 2 - 8 }
const MENU_HEIGHT = 6 + 41 + 4 * 46 + 13 + 41 + 4 * 46 + 6
const MENU_TOP = MENU.bottom - MENU_HEIGHT
const SEND_AS_Y = (i: number) => MENU_TOP + 6 + 41 + 23 + i * 46
const FORMATS = [
  { label: "Tags", hint: "tags" },
  { label: "Anima", hint: "tags + text" },
  { label: "FLUX.2 · Krea 2", hint: "text" },
  { label: "MOSS-Image", hint: "long text" },
]

// ---------------------------------------------------------------------------
// Timeline (frames)
// ---------------------------------------------------------------------------

const T = {
  searchClick: 34,
  typeFrom: 40,
  installClick: 118,
  installed: 150,
  publishClick: 266,
  useClick: 352,
  switchClick: 478,
  sendClick: 598,
  thumbClick: 798,
  chevronClick: 866,
  fluxClick: 906,
}
const CHAR_FRAMES = 1.4

const JOB1: Job = { send: T.sendClick, queued: T.sendClick + 12, running: T.sendClick + 36, stepFrames: 5, variant: 0 }
const JOB2: Job = { send: T.fluxClick + 2, queued: T.fluxClick + 14, running: T.fluxClick + 32, stepFrames: 3, variant: 1 }

const PILL_FROM = T.publishClick + 4
const PILL_LAND = PILL_FROM + 32

const IDLE = { x: 780, y: 660 }
/** Right of the centered card, while it generates. */
const PARK = { x: 760, y: 470 }

function pointerPath(publishX: number): Key[] {
  const listUseX = LIST_BOX.x + LIST_BOX.width + NEW_ROW_USE.dx
  const listUseY = LIST_BOX.y + NEW_ROW_USE.dy
  return [
    [0, IDLE.x, IDLE.y],
    [12, IDLE.x, IDLE.y],
    [T.searchClick - 4, SEARCH.x, SEARCH.y + 4],
    [T.searchClick + 14, SEARCH.x, SEARCH.y + 4],
    [T.installClick - 22, INSTALL.x - 20, INSTALL.y + 40],
    [T.installClick - 4, INSTALL.x + 4, INSTALL.y + 6],
    [T.installClick + 30, INSTALL.x + 4, INSTALL.y + 6],
    [T.installClick + 70, 760, 560],
    [T.publishClick - 30, 760, 560],
    [T.publishClick - 4, publishX + 10, BAR_Y + 6],
    [T.publishClick + 26, publishX + 10, BAR_Y + 6],
    [T.useClick - 4, listUseX + 4, listUseY + 6],
    [T.useClick + 24, listUseX + 4, listUseY + 6],
    [T.switchClick - 28, 640, 560],
    [T.switchClick - 4, SWITCH.x + 4, SWITCH.y + 6],
    [T.switchClick + 20, SWITCH.x + 4, SWITCH.y + 6],
    [T.sendClick - 28, 640, 600],
    // Clicked right of the label, so the plane leaving stays in view.
    [T.sendClick - 4, SEND_BUTTON.x + CENTER_SHIFT + 78, SEND_BUTTON.y + 8],
    [T.sendClick + 12, SEND_BUTTON.x + CENTER_SHIFT + 78, SEND_BUTTON.y + 8],
    // Out of the way while the card works.
    [T.sendClick + 40, PARK.x, PARK.y],
    [T.thumbClick - 30, PARK.x, PARK.y],
    [T.thumbClick - 4, THUMB.x + CENTER_SHIFT + 4, THUMB.y + 6],
    [T.thumbClick + 20, THUMB.x + CENTER_SHIFT + 4, THUMB.y + 6],
    [T.chevronClick - 4, CHEVRON.x + CENTER_SHIFT + 2, CHEVRON.y + 4],
    [T.chevronClick + 10, CHEVRON.x + CENTER_SHIFT + 2, CHEVRON.y + 4],
    [T.fluxClick - 6, CARD.x + CENTER_SHIFT + 150, SEND_AS_Y(2) + 2],
    [T.fluxClick + 14, CARD.x + CENTER_SHIFT + 150, SEND_AS_Y(2) + 2],
    [T.fluxClick + 50, 740, 640],
  ]
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
  const fade = index === 0 ? 1 : ease(frame, start, start + 10)
  const out = index === CHAPTERS.length - 1 ? 0 : ease(frame, end - 8, end, EASE.exit)
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

/** The status chip in Customize prompt's header (comfyui-status.tsx), connected. */
function StatusChip({ show }: { show: number }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: u(8),
        height: u(32),
        padding: `0 ${u(10)}px`,
        borderRadius: u(6),
        border: `1px solid color-mix(in oklab, ${C.primary} 25%, transparent)`,
        background: `color-mix(in oklab, ${C.primary} 10%, transparent)`,
        color: C.primaryText,
        fontSize: u(12),
        fontWeight: 500,
        opacity: show,
        transform: `translateY(${(1 - show) * 6}px) scale(${0.96 + 0.04 * show})`,
        filter: `blur(${(1 - show) * 3}px)`,
      }}
    >
      <span style={{ position: "relative", display: "flex" }}>
        <Send size={u(14)} />
        <span
          style={{
            position: "absolute",
            right: -u(4),
            bottom: -u(2),
            width: u(8),
            height: u(8),
            borderRadius: 999,
            background: C.success,
            boxShadow: `0 0 0 ${u(2)}px ${C.popover}`,
          }}
        />
      </span>
      ComfyUI
    </div>
  )
}

function SettingsPanel({ frame, opacity, shift }: { frame: number; opacity: number; shift: number }) {
  const on = ease(frame, T.switchClick + 2, T.switchClick + 12)
  const chip = ease(frame, T.switchClick + 8, T.switchClick + 22, EASE.springy)
  const hintSwap = ease(frame, T.switchClick + 6, T.switchClick + 16)
  return (
    <div style={{ position: "absolute", inset: 0, opacity, transform: `translateX(${shift}px)` }}>
      <Panel style={{ left: PANEL.x, top: PANEL.y, width: PANEL.width, padding: `${PANEL.pad - 1}px ${PANEL.pad - 1}px ${PANEL.pad - 10}px`, boxShadow: "none" }}>
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
          <span style={{ marginLeft: "auto" }}>{chip > 0 && <StatusChip show={chip} />}</span>
        </div>
        <div style={{ marginTop: 16, height: 24, fontSize: 17, fontWeight: 600, color: C.mutedForeground }}>Output</div>
        <SettingRow label="Prompt format" hint="Booru tags separated by commas" control={<SelectTrigger value="Tags" open={0} />} last />
        {/* Send to ComfyUI (comfyui-setting-row.tsx): a top rule while off, a tinted box while on. */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 18,
            minHeight: 90,
            margin: `${on * 6}px ${-on * 13}px`,
            padding: `0 ${on * 13}px`,
            borderRadius: u(8),
            borderTop: `1px solid color-mix(in oklab, ${C.border} ${50 * (1 - on)}%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${C.primary} ${25 * on}%, transparent)`,
            background: `color-mix(in oklab, ${C.primary} ${7 * on}%, transparent)`,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 21, fontWeight: on > 0.5 ? 500 : 400 }}>Send to ComfyUI</span>
            <span style={{ display: "grid", fontSize: 17 }}>
              <span style={{ gridArea: "1 / 1", color: C.mutedForeground, opacity: 1 - hintSwap, filter: `blur(${hintSwap * 3}px)` }}>
                Send prompts to ComfyUI on your computer instead of copying
              </span>
              <span
                style={{
                  gridArea: "1 / 1",
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  color: `color-mix(in oklab, ${C.foreground} 80%, transparent)`,
                  opacity: hintSwap,
                  filter: `blur(${(1 - hintSwap) * 3}px)`,
                }}
              >
                <span style={{ width: u(8), height: u(8), borderRadius: 999, background: C.success }} />
                Connected · {WORKFLOW_NAME}
              </span>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 19, flexShrink: 0 }}>
            <span
              style={{
                height: u(32),
                padding: `0 ${u(10)}px`,
                display: "flex",
                alignItems: "center",
                borderRadius: u(6),
                border: `1px solid ${C.border}`,
                background: on > 0.5 ? C.background : "transparent",
                fontSize: u(12),
                fontWeight: 500,
              }}
            >
              Edit
            </span>
            <Switch on={on} />
          </div>
        </div>
      </Panel>
    </div>
  )
}

function SendAsMenu({ open, pointer }: { open: number; pointer: { x: number; y: number } }) {
  if (open <= 0) return null
  return (
    <Panel
      style={{
        left: MENU.right - MENU.width,
        top: MENU_TOP,
        width: MENU.width,
        padding: 6,
        opacity: open,
        transform: `scale(${0.96 + 0.04 * open})`,
        transformOrigin: "bottom right",
      }}
    >
      <MenuLabel>Send as</MenuLabel>
      {FORMATS.map((o, i) => (
        <MenuItem
          key={o.label}
          icon={i === 0 ? <Check size={20} /> : null}
          label={o.label}
          hint={<Hint>{o.hint}</Hint>}
          highlight={Math.abs(pointer.y - SEND_AS_Y(i)) < 23 && pointer.x < MENU.right ? 1 : 0}
        />
      ))}
      <MenuSeparator />
      <MenuLabel>Copy as</MenuLabel>
      {FORMATS.map((o, i) => (
        <MenuItem key={o.label} icon={i === 0 ? <Check size={20} /> : null} label={o.label} hint={<Hint>{o.hint}</Hint>} />
      ))}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export function SendToComfy({ staticFrame, hidePointer }: { staticFrame?: number; hidePointer?: boolean }) {
  const currentFrame = useCurrentFrame()
  const frame = staticFrame ?? currentFrame
  useFontsMeasured()

  // ComfyUI's top bar: Run on the right, the add-on's button before it.
  const publishWidth = 32 + textWidth("Use in Booru Prompt Gallery", 18, 600)
  const runWidth = 32 + 15 + 8 + textWidth("Run", 18, 500)
  const publishX = FRAME.x + FRAME.width - 16 - runWidth - 10 - publishWidth / 2
  const pointer = pointerOn(pointerPath(publishX), frame)
  const { press, ring } = clicksAt(Object.values(T).filter((v) => v !== T.typeFrom && v !== T.installed), frame)

  // Chapter 1: Manager.
  const comfy = Math.min(ease(frame, 0, 14), 1 - ease(frame, 414, 426, EASE.exit))
  const dialog = 1 - ease(frame, 196, 208, EASE.exit)
  const focus = ease(frame, T.searchClick + 1, T.searchClick + 6) * (1 - ease(frame, T.installClick, T.installClick + 4))
  const typed = Math.max(0, Math.min(20, Math.floor((frame - T.typeFrom) / CHAR_FRAMES)))
  const caret = focus * (typed > 0 && typed < 20 ? 1 : 0.5 + 0.5 * Math.cos(((frame - T.searchClick) / 16) * Math.PI) > 0.5 ? 1 : 0)
  const filter = ease(frame, T.typeFrom + 20 * CHAR_FRAMES - 4, T.typeFrom + 20 * CHAR_FRAMES + 18)
  const installing = ease(frame, T.installClick + 2, T.installClick + 9)
  const installed = ease(frame, T.installed, T.installed + 9)
  const installPress = Math.min(ease(frame, T.installClick, T.installClick + 3), 1 - ease(frame, T.installClick + 4, T.installClick + 8))

  // Chapter 2: add your workflow.
  const windowHeight = interpolate(ease(frame, 202, 230, EASE.inOut), [0, 1], [FRAME.height, SHORT_HEIGHT])
  const list = ease(frame, 222, 244)
  const published = ease(frame, T.publishClick + 4, T.publishClick + 14, EASE.springy)
  const publishPress = Math.min(ease(frame, T.publishClick, T.publishClick + 3), 1 - ease(frame, T.publishClick + 4, T.publishClick + 8))
  const arrive = ease(frame, PILL_LAND - 16, PILL_LAND + 2, EASE.inOut)
  const rowContent = ease(frame, PILL_LAND - 2, PILL_LAND + 8)
  const flash = 1 - ease(frame, PILL_LAND + 2, PILL_LAND + 50, EASE.inOut)
  const inUse = ease(frame, T.useClick + 2, T.useClick + 10)
  const usePress = Math.min(ease(frame, T.useClick, T.useClick + 3), 1 - ease(frame, T.useClick + 4, T.useClick + 8))
  // The name drops out of the button, then arcs down into the list.
  const pillStart = { x: publishX - 70, y: BAR_Y + 50 }
  const pillEnd = { x: LIST_BOX.x + NEW_ROW_NAME.dx, y: LIST_BOX.y + NEW_ROW_NAME.dy }
  const flight = ease(frame, PILL_FROM, PILL_LAND, EASE.inOut)
  const pillAt = arc(flight, pillStart, { x: pillStart.x - 60, y: pillEnd.y - 20 }, pillEnd)
  const pillPop = ease(frame, PILL_FROM, PILL_FROM + 9, EASE.springy)
  const pillOn = frame >= PILL_FROM && frame < PILL_LAND + 8

  // Chapter 3: the switch, the card's button.
  const card = Math.min(ease(frame, 426, 444), 1)
  const panel = Math.min(ease(frame, 429, 447), 1 - ease(frame, 540, 556, EASE.exit))
  const send = ease(frame, T.switchClick + 8, T.switchClick + 20)

  // Chapters 4–5: the card in the middle, two sends.
  const shift = ease(frame, 544, 572, EASE.inOut) * CENTER_SHIFT
  const swap = ease(frame, T.thumbClick + 2, T.thumbClick + 8) * (frame < JOB2.send ? 1 : 0)
  const menu = Math.min(ease(frame, T.chevronClick + 2, T.chevronClick + 10), 1 - ease(frame, T.fluxClick + 2, T.fluxClick + 8, EASE.exit))
  const job1Leave = ease(frame, JOB2.send, JOB2.send + 9)

  const pointerOpacity = hidePointer ? 0 : Math.min(ease(frame, 6, 16), 1 - ease(frame, jobDone(JOB2) + 30, jobDone(JOB2) + 44, EASE.exit))

  return (
    <AbsoluteFill style={{ background: C.background, fontFamily: FONT, color: C.foreground }}>
      <Header frame={frame} />

      {comfy > 0 && (
        <div style={{ position: "absolute", inset: 0, opacity: comfy, transform: `translateY(${(1 - Math.min(ease(frame, 0, 14), 1)) * 8 - ease(frame, 414, 426) * 8}px)` }}>
          <ComfyWindow
            x={FRAME.x}
            y={FRAME.y}
            width={FRAME.width}
            height={windowHeight}
            barRight={
              <>
                <PublishButton press={publishPress} done={published} glow={frame < 200 ? 0.4 : 1} />
                <RunButton />
              </>
            }
          >
            <GraphHint width={FRAME.width} opacity={0.35 + 0.65 * (1 - dialog)} />
          </ComfyWindow>
          {dialog > 0 && (
            <>
              <div style={{ position: "absolute", left: FRAME.x + 1, top: CANVAS_TOP, width: FRAME.width - 2, height: FRAME.y + FRAME.height - CANVAS_TOP - 1, borderRadius: "0 0 17px 17px", background: "rgb(10 10 12 / 0.45)", opacity: dialog }} />
              <ManagerDialog
                x={DIALOG.x}
                y={DIALOG.y}
                typed={typed}
                caret={caret}
                filter={filter}
                focus={focus}
                installPress={installPress}
                installing={installing}
                installed={installed}
                frame={frame}
                style={{ opacity: dialog, transform: `translateY(${(1 - dialog) * 6}px) scale(${0.97 + 0.03 * dialog})` }}
              />
            </>
          )}
          {list > 0 && (
            <PublishedList
              x={LIST_BOX.x}
              y={LIST_BOX.y}
              width={LIST_BOX.width}
              arrive={arrive}
              flash={flash}
              rowContent={rowContent}
              inUse={inUse}
              usePress={usePress}
              frame={frame}
              style={{ opacity: list, transform: `translateY(${(1 - list) * 16}px)` }}
            />
          )}
          {pillOn && (
            <NamePill x={pillAt.x} y={pillAt.y} scale={0.9 + 0.1 * pillPop} opacity={Math.min(pillPop, 1 - ease(frame, PILL_LAND, PILL_LAND + 8))} />
          )}
        </div>
      )}

      {card > 0 && (
        <div style={{ position: "absolute", inset: 0, opacity: card, transform: `translate(${shift}px, ${(1 - card) * 8}px)` }}>
          <PromptCard
            image={POST.image}
            buttonLabel={<SendLabel frame={frame} send={send} sends={[JOB1.send, JOB2.send]} />}
            overlay={
              <>
                <CardJob job={JOB1} frame={frame} swap={swap} leave={job1Leave} postImage={POST.image} />
                <CardJob job={JOB2} frame={frame} postImage={POST.image} />
              </>
            }
            well={<WellText>{PROMPTS.tags}</WellText>}
          />
          <SendAsMenu open={menu} pointer={{ x: pointer.x - CENTER_SHIFT, y: pointer.y }} />
        </div>
      )}

      {panel > 0 && <SettingsPanel frame={frame} opacity={panel} shift={ease(frame, 540, 556, EASE.exit) * 16} />}

      <ClickRing x={pointer.x} y={pointer.y} progress={ring} />
      <Pointer x={pointer.x} y={pointer.y} press={press} opacity={pointerOpacity} />
    </AbsoluteFill>
  )
}
