import { AbsoluteFill, useCurrentFrame } from "remotion"
import {
  CF,
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
  WINDOW,
  arc,
  clicksAt,
  ease,
  pointerOn,
  textWidth,
  useFontsMeasured,
  type Key,
} from "./comfy-ui"
import { ClickRing, Pointer } from "./ui"

// Short loops for the setup guide's "Install the node" and "Publish your
// workflow" steps (components/prompt-gallery/comfyui-setup-wizard.tsx). They
// play muted on repeat, so each one ends exactly where it starts: the same
// empty search, the same list, the pointer back at rest.

export const LOOP = { width: 960, height: 480, fps: 30 }

// ---------------------------------------------------------------------------
// Install: search the Manager, Install, Installed; then the search clears.
// ---------------------------------------------------------------------------

export const INSTALL_LOOP_FRAMES = 150
/** Poster (and reduced motion): the name typed, the pointer on Install. */
export const INSTALL_POSTER_FRAME = 86

const IL = {
  searchClick: 24,
  typeFrom: 28,
  installClick: 88,
  installed: 112,
  /** The search text is selected, then cleared. */
  select: 126,
  clear: 131,
}
const IL_CHAR = 1.4

export function InstallLoop({ staticFrame }: { staticFrame?: number }) {
  const current = useCurrentFrame()
  const frame = staticFrame ?? current
  useFontsMeasured()

  // Centered between its two heights (full list, then the one match), so neither state sits off balance.
  const full = MANAGER.headHeight + MANAGER.searchHeight + 14 + 2 * MANAGER.rowHeight + MANAGER.pad
  const narrowed = full - MANAGER.rowHeight
  const dialog = { x: (LOOP.width - MANAGER.width) / 2, y: (LOOP.height - (full + narrowed) / 2) / 2 }
  const search = { x: dialog.x + 230, y: dialog.y + MANAGER.headHeight + MANAGER.searchHeight / 2 }
  const install = { x: dialog.x + MANAGER.width - MANAGER.pad - 14 - 80, y: dialog.y + MANAGER.headHeight + MANAGER.searchHeight + 14 + MANAGER.rowHeight / 2 }
  const rest = { x: 760, y: 420 }
  const path: Key[] = [
    [0, rest.x, rest.y],
    [6, rest.x, rest.y],
    [IL.searchClick - 3, search.x, search.y + 4],
    [IL.searchClick + 30, search.x, search.y + 4],
    [IL.installClick - 4, install.x + 4, install.y + 6],
    [IL.installClick + 30, install.x + 4, install.y + 6],
    [INSTALL_LOOP_FRAMES - 4, rest.x, rest.y],
  ]
  const pointer = pointerOn(path, frame)
  const { press, ring } = clicksAt([IL.searchClick, IL.installClick], frame)

  const typed = frame >= IL.clear ? 0 : Math.max(0, Math.min(20, Math.floor((frame - IL.typeFrom) / IL_CHAR)))
  const focus = ease(frame, IL.searchClick + 1, IL.searchClick + 6) * (1 - ease(frame, IL.installClick, IL.installClick + 4))
  const typing = typed > 0 && typed < 20
  const caret = focus * (typing ? 1 : Math.cos(((frame - IL.searchClick) / 16) * Math.PI) > 0 ? 1 : 0)
  const filterIn = ease(frame, IL.typeFrom + 20 * IL_CHAR - 4, IL.typeFrom + 20 * IL_CHAR + 18)
  const filterOut = ease(frame, IL.clear, IL.clear + 16, EASE.inOut)
  const filter = filterIn * (1 - filterOut)
  // The button goes back to Install only once its row has closed.
  const reset = frame >= IL.clear + 16
  const installing = reset ? 0 : ease(frame, IL.installClick + 2, IL.installClick + 9)
  const installed = reset ? 0 : ease(frame, IL.installed, IL.installed + 9)
  const installPress = Math.min(ease(frame, IL.installClick, IL.installClick + 3), 1 - ease(frame, IL.installClick + 4, IL.installClick + 8))
  const selected = frame >= IL.select && frame < IL.clear

  return (
    <AbsoluteFill
      style={{
        background: CF.canvas,
        backgroundImage: `radial-gradient(circle, ${CF.dot} 1.6px, transparent 1.8px)`,
        backgroundSize: "28px 28px",
        backgroundPosition: "14px 14px",
      }}
    >
      <ManagerDialog
        x={dialog.x}
        y={dialog.y}
        otherRows={2}
        typed={typed}
        caret={caret}
        filter={filter}
        focus={focus}
        installPress={installPress}
        installing={installing}
        installed={installed}
        frame={frame}
      />
      {selected && (
        // The search text, selected before it clears.
        <div
          style={{
            position: "absolute",
            left: dialog.x + MANAGER.pad + 16 + 20 + 12 - 2,
            top: search.y - 15,
            width: textWidth("Booru Prompt Gallery", 20, 400) + 4,
            height: 30,
            borderRadius: 4,
            background: "rgb(120 150 220 / 0.35)",
          }}
        />
      )}
      <ClickRing x={pointer.x} y={pointer.y} progress={ring} />
      <Pointer x={pointer.x} y={pointer.y} press={press} />
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------------------
// Publish: the button next to Run, the name lands in the site's list, Use;
// then the new row folds away and the button resets.
// ---------------------------------------------------------------------------

export const PUBLISH_LOOP_FRAMES = 180
/** Poster: the new workflow just landed in the list. */
export const PUBLISH_POSTER_FRAME = 92

const PL = { publishClick: 34, useClick: 110, fold: 140 }
const PL_PILL_FROM = PL.publishClick + 4
const PL_PILL_LAND = PL_PILL_FROM + 30

const WIN = { x: 24, y: 14, width: 912, height: WINDOW.titleHeight + WINDOW.barHeight + 96 }
const LIST_BOX = { x: 200, y: WIN.y + WIN.height + 22, width: 560 }

export function PublishLoop({ staticFrame }: { staticFrame?: number }) {
  const current = useCurrentFrame()
  const frame = staticFrame ?? current
  useFontsMeasured()

  const publishWidth = 32 + textWidth("Use in Booru Prompt Gallery", 18, 600)
  const runWidth = 32 + 15 + 8 + textWidth("Run", 18, 500)
  const publishX = WIN.x + WIN.width - 16 - runWidth - 10 - publishWidth / 2
  const barY = WIN.y + WINDOW.titleHeight + WINDOW.barHeight / 2
  const use = { x: LIST_BOX.x + LIST_BOX.width + NEW_ROW_USE.dx, y: LIST_BOX.y + NEW_ROW_USE.dy }
  const rest = { x: 790, y: 440 }
  const path: Key[] = [
    [0, rest.x, rest.y],
    [8, rest.x, rest.y],
    [PL.publishClick - 4, publishX + 10, barY + 6],
    [PL.publishClick + 30, publishX + 10, barY + 6],
    [PL.useClick - 4, use.x + 4, use.y + 6],
    [PL.useClick + 18, use.x + 4, use.y + 6],
    [PUBLISH_LOOP_FRAMES - 6, rest.x, rest.y],
  ]
  const pointer = pointerOn(path, frame)
  const { press, ring } = clicksAt([PL.publishClick, PL.useClick], frame)

  const fold = ease(frame, PL.fold, PL.fold + 18, EASE.inOut)
  const published = ease(frame, PL.publishClick + 4, PL.publishClick + 14, EASE.springy) * (1 - ease(frame, PL.fold + 6, PL.fold + 16))
  const publishPress = Math.min(ease(frame, PL.publishClick, PL.publishClick + 3), 1 - ease(frame, PL.publishClick + 4, PL.publishClick + 8))
  const arrive = ease(frame, PL_PILL_LAND - 16, PL_PILL_LAND + 2, EASE.inOut) * (1 - fold)
  const rowContent = ease(frame, PL_PILL_LAND - 2, PL_PILL_LAND + 8) * (1 - ease(frame, PL.fold - 2, PL.fold + 8))
  const flash = 1 - ease(frame, PL_PILL_LAND + 2, PL_PILL_LAND + 50, EASE.inOut)
  const inUse = frame >= PL.fold + 18 ? 0 : ease(frame, PL.useClick + 2, PL.useClick + 10)
  const usePress = Math.min(ease(frame, PL.useClick, PL.useClick + 3), 1 - ease(frame, PL.useClick + 4, PL.useClick + 8))

  const pillStart = { x: publishX - 70, y: barY + 50 }
  const pillEnd = { x: LIST_BOX.x + NEW_ROW_NAME.dx, y: LIST_BOX.y + NEW_ROW_NAME.dy }
  const flight = ease(frame, PL_PILL_FROM, PL_PILL_LAND, EASE.inOut)
  const pillAt = arc(flight, pillStart, { x: pillStart.x - 60, y: pillEnd.y - 20 }, pillEnd)
  const pillPop = ease(frame, PL_PILL_FROM, PL_PILL_FROM + 9, EASE.springy)
  const pillOn = frame >= PL_PILL_FROM && frame < PL_PILL_LAND + 8

  return (
    <AbsoluteFill style={{ background: "oklch(0.27 0.022 250)" }}>
      <ComfyWindow
        x={WIN.x}
        y={WIN.y}
        width={WIN.width}
        height={WIN.height}
        barRight={
          <>
            <PublishButton press={publishPress} done={published} />
            <RunButton />
          </>
        }
      >
        <GraphHint width={WIN.width} top={18} />
      </ComfyWindow>
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
      />
      {pillOn && <NamePill x={pillAt.x} y={pillAt.y} scale={0.9 + 0.1 * pillPop} opacity={Math.min(pillPop, 1 - ease(frame, PL_PILL_LAND, PL_PILL_LAND + 8))} />}
      <ClickRing x={pointer.x} y={pointer.y} progress={ring} />
      <Pointer x={pointer.x} y={pointer.y} press={press} />
    </AbsoluteFill>
  )
}
