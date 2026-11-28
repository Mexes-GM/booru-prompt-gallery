import { AbsoluteFill, useCurrentFrame } from "remotion"
import {
  CF,
  ComfyWindow,
  EASE,
  GraphHint,
  MANAGER,
  ManagerDialog,
  PublishButton,
  RunButton,
  WINDOW,
  clicksAt,
  ease,
  pointerOn,
  textWidth,
  useFontsMeasured,
  type Key,
} from "./comfy-ui"
import { ClickRing, Pointer } from "./ui"

// Short loops for the setup guide's "Install the node" and "Add your
// workflow" steps (components/prompt-gallery/comfyui-setup-wizard.tsx). They
// play muted on repeat, so each one ends exactly where it starts: the same
// empty search, the same button, the pointer back at rest.

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
// Add your workflow: the pointer clicks the button next to Run, a check shows
// it worked, then the check fades and the pointer goes back to rest. Only
// ComfyUI is drawn: the setup guide shows its own list right under the loop.
// ---------------------------------------------------------------------------

export const PUBLISH_LOOP_FRAMES = 120
/** Poster (and reduced motion): the check on the button, the pointer on it. */
export const PUBLISH_POSTER_FRAME = 58

const PL = { click: 34, reset: 86 }
/** Drawn 1.4× so the top bar reads at the step's ~530 px width. */
const PL_ZOOM = 1.4
const PL_VIEW = { width: LOOP.width / PL_ZOOM, height: LOOP.height / PL_ZOOM }
const WIN = { x: 16, y: 18, width: PL_VIEW.width - 32, height: PL_VIEW.height - 36 }

export function PublishLoop({ staticFrame }: { staticFrame?: number }) {
  const current = useCurrentFrame()
  const frame = staticFrame ?? current
  useFontsMeasured()

  const publishWidth = 32 + textWidth("Use in Booru Prompt Gallery", 18, 600)
  const runWidth = 32 + 15 + 8 + textWidth("Run", 18, 500)
  const publishX = WIN.x + WIN.width - 16 - runWidth - 10 - publishWidth / 2
  const barY = WIN.y + WINDOW.titleHeight + WINDOW.barHeight / 2
  const rest = { x: publishX + 40, y: WIN.y + WIN.height - 40 }
  const path: Key[] = [
    [0, rest.x, rest.y],
    [6, rest.x, rest.y],
    [PL.click - 4, publishX + 10, barY + 6],
    [PL.reset + 4, publishX + 10, barY + 6],
    [PUBLISH_LOOP_FRAMES - 8, rest.x, rest.y],
  ]
  const pointer = pointerOn(path, frame)
  const { press, ring } = clicksAt([PL.click], frame)

  const done = ease(frame, PL.click + 4, PL.click + 14, EASE.springy) * (1 - ease(frame, PL.reset, PL.reset + 12, EASE.inOut))
  const buttonPress = Math.min(ease(frame, PL.click, PL.click + 3), 1 - ease(frame, PL.click + 4, PL.click + 8))
  // The ring round the button breathes once with the check, then settles.
  const glow = 1 + 0.6 * Math.min(ease(frame, PL.click + 4, PL.click + 12), 1 - ease(frame, PL.click + 20, PL.click + 44, EASE.inOut))

  return (
    <AbsoluteFill style={{ background: "oklch(0.27 0.022 250)" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: PL_VIEW.width, height: PL_VIEW.height, transform: `scale(${PL_ZOOM})`, transformOrigin: "0 0" }}>
        <ComfyWindow
          x={WIN.x}
          y={WIN.y}
          width={WIN.width}
          height={WIN.height}
          barRight={
            <>
              <PublishButton press={buttonPress} done={done} glow={glow} />
              <RunButton />
            </>
          }
        >
          <GraphHint width={WIN.width} top={44} />
        </ComfyWindow>
        <ClickRing x={pointer.x} y={pointer.y} progress={ring} />
        <Pointer x={pointer.x} y={pointer.y} press={press} />
      </div>
    </AbsoluteFill>
  )
}
