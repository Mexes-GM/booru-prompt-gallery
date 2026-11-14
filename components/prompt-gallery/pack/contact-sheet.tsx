"use client"

/**
 * The scenes the pack will draw from, before generating: a dense, even grid of
 * portrait (3:4) thumbnails, like a photographer's contact sheet. Any scene can be
 * left out with one tap and put back with another; a scene that is out stays in its
 * place, its picture faded, with a dashed edge and a crossed-eye mark.
 *
 * The sheet is one stop in the tab order: arrow keys move between scenes in four
 * directions, Home and End go to the first and last, Space or Enter toggles.
 * Collapsed, it shows three rows (6, 9 or 12 columns by the width of its container;
 * six keeps each tile at least 44 px wide in a 343 px column)
 * and a "Show all" button. Keep `onToggle` stable: tiles are memoized.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { AlertTriangle, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { SHEET_TEXT } from "./pack-text"

export interface SceneThumb {
  id: string
  postId: number
  /** Thumbnail URL; without it the tile shows the post number on a plain well. */
  src?: string
}

export type ContactSheetStatus = "loading" | "ready" | "error"

export interface ContactSheetProps {
  scenes: readonly SceneThumb[]
  leftOut: readonly string[]
  onToggle: (id: string) => void
  status?: ContactSheetStatus
  /** While loading: how many tiles to hold places for. */
  expected?: number
  onRetry?: () => void
  /** Shown when there are no scenes. */
  emptyTitle?: string
  emptyHint?: string
  /**
   * One-part pack: the first tile is the scene that repeats. Selecting it starts choosing
   * another; while choosing, selecting a tile makes it the one that repeats.
   */
  fixed?: {
    id: string
    picking: boolean
    onStartPick: () => void
    onPick: (id: string) => void
    onCancelPick: () => void
  }
  className?: string
}

// Collapsed: three rows at 6, 9 and 12 columns. Rendering stops at the widest.
const COLLAPSED = { narrow: 18, mid: 27, wide: 36 }
const COLLAPSE_CLASSES =
  "[&>*:nth-child(n+19)]:hidden @md:[&>*:nth-child(n+19)]:block @md:[&>*:nth-child(n+28)]:hidden @xl:[&>*:nth-child(n+28)]:block"

const Tile = memo(function Tile({
  scene,
  index,
  out,
  tabbable,
  onToggle,
  fixed = false,
  picking = false,
}: {
  scene: SceneThumb
  index: number
  out: boolean
  tabbable: boolean
  onToggle: (id: string) => void
  /** The scene that repeats in every prompt (one-part packs): marked, never left out. */
  fixed?: boolean
  /** Choosing the scene that repeats: a select picks this one. */
  picking?: boolean
}) {
  const label = fixed
    ? `${SHEET_TEXT.fixedBadge} in every prompt, post ${scene.postId}. ${picking ? SHEET_TEXT.keepFixed : SHEET_TEXT.changeFixed}`
    : picking
      ? `${SHEET_TEXT.pickThis}, post ${scene.postId}`
      : `Leave this scene out, post ${scene.postId}`
  return (
    <button
      type="button"
      data-tile={index}
      tabIndex={tabbable ? 0 : -1}
      aria-pressed={fixed || picking ? undefined : out}
      aria-label={label}
      title={fixed ? SHEET_TEXT.changeFixed : picking ? SHEET_TEXT.pickThis : out ? "Put this scene back" : "Leave this scene out"}
      onClick={() => onToggle(scene.id)}
      className={cn(
        "group/tile relative block aspect-[3/4] w-full overflow-hidden rounded-[6px] border",
        "transition-[border-color,background-color] duration-150 ease-out-strong",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "animate-in fade-in-0 motion-reduce:animate-none",
        fixed
          ? "border-2 border-mode-pack bg-muted"
          : out
            ? "border-dashed border-muted-foreground bg-muted/30"
            : picking
              ? "border-mode-pack-border bg-muted hover:border-mode-pack"
              : "border-transparent bg-muted hover:border-foreground/40",
      )}
    >
      {scene.src ? (
        // Plain img: thumbnails come from several booru hosts and are already small.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={scene.src}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn("absolute inset-0 size-full object-cover transition-opacity duration-150 ease-out-strong", out && "opacity-25 grayscale")}
        />
      ) : (
        // The number stays readable when the scene is out; only the well behind it fades.
        <span className="absolute inset-x-0 top-1 text-center font-mono text-[11px] tabular-nums text-foreground">
          {scene.postId}
        </span>
      )}
      {fixed && (
        <span className="absolute inset-x-0 bottom-0 bg-mode-pack px-1 py-0.5 text-center text-[10px] font-medium leading-tight text-mode-pack-foreground">
          {SHEET_TEXT.fixedBadge}
        </span>
      )}
      {out && !fixed && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-6 place-items-center rounded-full bg-overlay/80 text-overlay-foreground">
            <EyeOff className="size-3.5" aria-hidden />
          </span>
        </span>
      )}
    </button>
  )
})

/** Tiles that are on screen (a collapsed sheet hides some with CSS). */
function visibleTiles(grid: HTMLElement): HTMLElement[] {
  return Array.from(grid.querySelectorAll<HTMLElement>("[data-tile]")).filter((el) => el.offsetParent !== null)
}

function columnsOf(grid: HTMLElement): number {
  return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length)
}

export const ContactSheet = memo(function ContactSheet({
  scenes,
  leftOut,
  onToggle,
  status = "ready",
  expected = 12,
  onRetry,
  emptyTitle = "No scenes fit this pack",
  emptyHint = "Try taking out a pose or a place.",
  fixed,
  className,
}: ContactSheetProps) {
  const [expanded, setExpanded] = useState(false)
  const [current, setCurrent] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)
  const helpId = useId()
  const out = useMemo(() => new Set(leftOut), [leftOut])
  const loading = status === "loading"
  // One handler for every tile, so the tiles stay memoized.
  const fixedRef = useRef(fixed)
  useEffect(() => { fixedRef.current = fixed }, [fixed])
  const onTile = useCallback((id: string) => {
    const f = fixedRef.current
    if (!f) return onToggle(id)
    if (id === f.id) return f.picking ? f.onCancelPick() : f.onStartPick()
    if (f.picking) return f.onPick(id)
    onToggle(id)
  }, [onToggle])

  if (status === "error") {
    return (
      <div role="alert" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-border px-3 py-4 text-sm", className)}>
        <AlertTriangle className="size-4 shrink-0 text-destructive-text" aria-hidden />
        <span className="min-w-0 flex-1 text-pretty">Couldn&apos;t load the scenes. Check your connection and try again.</span>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry} className="pointer-coarse:h-11">
            Try again
          </Button>
        )}
      </div>
    )
  }

  if (!loading && scenes.length === 0) {
    return (
      <div className={cn("rounded-lg border border-dashed border-border px-3 py-6 text-center", className)}>
        <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
        {emptyHint && <p className="mt-1 text-xs text-muted-foreground">{emptyHint}</p>}
      </div>
    )
  }

  const collapsed = !expanded
  const shown = collapsed ? scenes.slice(0, COLLAPSED.wide) : scenes
  const placeholders = loading ? Math.max(0, Math.min(12, expected - scenes.length)) : 0
  const total = scenes.length + placeholders
  // "Show all" only where some tiles are actually hidden at that width.
  const toggleClass = cn(total <= COLLAPSED.mid && "@md:hidden", total <= COLLAPSED.wide && "@xl:hidden")
  // The tab stop must be a tile that is on screen; the first rows always are.
  const tabStop = Math.min(current, Math.max(0, (collapsed ? Math.min(shown.length, COLLAPSED.narrow) : shown.length) - 1))

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grid = gridRef.current
    const from = (e.target as HTMLElement).closest<HTMLElement>("[data-tile]")
    if (!grid || !from) return
    const tiles = visibleTiles(grid)
    const at = tiles.indexOf(from)
    if (at < 0) return
    const cols = columnsOf(grid)
    const moves: Record<string, number> = {
      ArrowRight: at + 1,
      ArrowLeft: at - 1,
      ArrowDown: at + cols,
      ArrowUp: at - cols,
      Home: 0,
      End: tiles.length - 1,
    }
    const to = moves[e.key]
    if (to === undefined) return
    e.preventDefault()
    const target = tiles[Math.max(0, Math.min(tiles.length - 1, to))]
    setCurrent(Number(target.dataset.tile))
    target.focus()
  }

  return (
    <div className={cn("@container", className)}>
      <p id={helpId} className="sr-only">
        {fixed ? SHEET_TEXT.helpFixed : "Use the arrow keys to move between scenes. Space leaves a scene out or puts it back."}
      </p>
      {fixed?.picking && (
        <div role="status" className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-foreground">
          <span>{SHEET_TEXT.picking}</span>
          <Button type="button" variant="ghost" size="sm" onClick={fixed.onCancelPick} className="h-7 px-2 text-xs pointer-coarse:h-11">
            Cancel
          </Button>
        </div>
      )}
      <div
        ref={gridRef}
        role="group"
        aria-label="Scenes for this pack"
        aria-describedby={helpId}
        aria-busy={loading}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          const tile = (e.target as HTMLElement).closest<HTMLElement>("[data-tile]")
          if (tile) setCurrent(Number(tile.dataset.tile))
        }}
        className={cn("grid grid-cols-6 gap-1 @md:grid-cols-9 @xl:grid-cols-12", collapsed && COLLAPSE_CLASSES)}
      >
        {shown.map((scene, i) => (
          <Tile
            key={scene.id}
            scene={scene}
            index={i}
            out={out.has(scene.id)}
            tabbable={i === tabStop}
            onToggle={onTile}
            fixed={fixed?.id === scene.id}
            picking={!!fixed?.picking}
          />
        ))}
        {Array.from({ length: placeholders }, (_, i) => (
          <span
            key={`pending-${scenes.length + i}`}
            aria-hidden
            style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
            className="block aspect-[3/4] rounded-[6px] bg-muted/60 animate-in fade-in-0 fill-mode-both duration-300 motion-reduce:animate-none"
          />
        ))}
      </div>
      {total > COLLAPSED.narrow && (
        <div className={cn("mt-1.5", collapsed && toggleClass)}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground pointer-coarse:h-11"
          >
            {expanded ? "Show fewer" : <>Show all <span className="tabular-nums">{scenes.length}</span></>}
          </Button>
        </div>
      )}
    </div>
  )
})
