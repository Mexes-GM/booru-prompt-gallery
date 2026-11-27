"use client"

/**
 * The scenes the pack will draw from, before generating: a dense, even grid of small
 * tiles, one per scene, each with its post number (no pictures: the pack loads no
 * images) and, when it tells them apart, a short detail such as the people count.
 * Any scene can be left out with one tap and put back with another; a scene that is
 * out stays in its place, faded, with a dashed edge and a crossed-eye mark.
 *
 * The sheet is one stop in the tab order: arrow keys move between scenes in four
 * directions, Home and End go to the first and last, Space or Enter toggles.
 * Collapsed, it shows three rows (4, 6 or 8 columns by the width of its container;
 * four keeps an eight-digit post number on one line in a 343 px column)
 * and a "Show all" button. Collapsed, only the tiles on screen are mounted; "Show all" mounts the
 * rest a batch per frame, so a few hundred scenes never block the page at once. Keep `onToggle`
 * stable: tiles are memoized.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { AlertTriangle, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { SHEET_TEXT } from "./pack-text"

export interface SceneThumb {
  id: string
  postId: number
  /** Shown instead of the post number for a scene with no post ("Invented"). */
  name?: string
  /** How screen readers name such a scene ("Invented scene"); defaults to `name`. */
  spokenName?: string
  /** A second, quieter line that tells scenes apart ("2 people"). */
  detail?: string
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
    /** Choosing another is not possible now, and why. */
    blockedReason?: string
    onStartPick: () => void
    onPick: (id: string) => void
    onCancelPick: () => void
  }
  className?: string
}

// Collapsed: three rows at 4, 6 and 8 columns. Rendering stops at the widest.
const COLLAPSED = { narrow: 12, mid: 18, wide: 24 }
/** Tiles "Show all" mounts per frame. */
const SHOW_ALL_BATCH = 60
const COLLAPSE_CLASSES =
  "[&>*:nth-child(n+13)]:hidden @md:[&>*:nth-child(n+13)]:flex @md:[&>*:nth-child(n+19)]:hidden @xl:[&>*:nth-child(n+19)]:flex"

const Tile = memo(function Tile({
  scene,
  index,
  out,
  tabbable,
  onToggle,
  fixed = false,
  picking = false,
  fixedNote,
}: {
  /** For the scene that repeats: why another can't be chosen now. */
  fixedNote?: string
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
  const said = scene.spokenName ?? (scene.name ? scene.name : `post ${scene.postId}`)
  const label = fixed
    ? `${SHEET_TEXT.fixedBadge} in every prompt, ${said}. ${fixedNote ?? (picking ? SHEET_TEXT.keepFixed : SHEET_TEXT.changeFixed)}`
    : picking
      ? `${SHEET_TEXT.pickThis}, ${said}`
      : `Leave this scene out, ${said}${scene.detail ? `, ${scene.detail.toLowerCase()}` : ""}`
  // The fixed tile's second line says it repeats; the others' says what tells them apart.
  const second = fixed ? SHEET_TEXT.fixedBadge : scene.detail
  return (
    <button
      type="button"
      data-tile={index}
      tabIndex={tabbable ? 0 : -1}
      aria-pressed={fixed || picking ? undefined : out}
      aria-label={label}
      title={fixed ? fixedNote ?? SHEET_TEXT.changeFixed : picking ? SHEET_TEXT.pickThis : out ? "Put this scene back" : "Leave this scene out"}
      onClick={() => onToggle(scene.id)}
      className={cn(
        "relative flex h-10 w-full min-w-0 flex-col items-center justify-center gap-px rounded-[6px] border px-1 pointer-coarse:h-11",
        "transition-[border-color,background-color,color] duration-150 ease-out-strong",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "animate-in fade-in-0 motion-reduce:animate-none",
        fixed
          ? "border-mode-pack bg-mode-pack-soft text-foreground"
          : out
            ? "border-dashed border-muted-foreground/70 bg-transparent text-muted-foreground"
            : picking
              ? "border-mode-pack-border bg-muted text-foreground hover:border-mode-pack"
              : "border-transparent bg-muted text-foreground hover:border-foreground/50",
      )}
    >
      <span className="max-w-full truncate font-mono text-xs leading-4 tabular-nums">
        {scene.name ?? scene.postId}
      </span>
      {second && (
        <span
          className={cn(
            "max-w-full truncate text-[10px] leading-3",
            fixed ? "font-medium text-mode-pack-text" : "text-muted-foreground",
          )}
        >
          {second}
        </span>
      )}
      {out && !fixed && (
        <EyeOff className="absolute right-0.5 top-0.5 size-2.5 text-muted-foreground" aria-hidden />
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
  // Expanded: the tiles mounted so far (a batch more each frame until all are).
  const [mounted, setMounted] = useState(SHOW_ALL_BATCH)
  const toggleExpanded = useCallback(() => {
    setMounted(SHOW_ALL_BATCH)
    setExpanded((v) => !v)
  }, [])
  const allMounted = mounted >= scenes.length
  useEffect(() => {
    if (!expanded || allMounted) return
    const frame = requestAnimationFrame(() => setMounted((n) => n + SHOW_ALL_BATCH))
    return () => cancelAnimationFrame(frame)
  }, [expanded, allMounted, mounted])
  const [current, setCurrent] = useState(0)
  // Tiles a folded sheet shows at its width (three rows of 4, 6 or 8 columns).
  const [foldedVisible, setFoldedVisible] = useState(COLLAPSED.narrow)
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

  // Measured while the grid is on screen; it comes and goes with the empty and error states.
  const hasGrid = status !== "error" && (loading || scenes.length > 0)
  useEffect(() => {
    const grid = gridRef.current
    if (!hasGrid || !grid || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => setFoldedVisible(columnsOf(grid) * 3))
    observer.observe(grid)
    return () => observer.disconnect()
  }, [hasGrid])

  if (status === "error") {
    return (
      <div role="alert" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-destructive-border bg-destructive-soft px-3.5 py-3 text-sm", className)}>
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
      <div className={cn("rounded-xl bg-muted/40 px-4 py-8 text-center", className)}>
        <p className="text-sm font-medium text-foreground text-balance">{emptyTitle}</p>
        {emptyHint && <p className="mt-1 text-[13px] text-muted-foreground text-balance">{emptyHint}</p>}
      </div>
    )
  }

  const collapsed = !expanded
  // Collapsed: the tiles the three rows show at this width (the CSS below hides the rest until measured).
  const shown = collapsed ? scenes.slice(0, Math.min(COLLAPSED.wide, foldedVisible)) : scenes.slice(0, mounted)
  const placeholders = loading ? Math.max(0, Math.min(12, expected - scenes.length)) : 0
  const total = scenes.length + placeholders
  // "Show all" only where some tiles are actually hidden at that width.
  const toggleClass = cn(total <= COLLAPSED.mid && "@md:hidden", total <= COLLAPSED.wide && "@xl:hidden")
  // The tab stop must be a tile that is on screen; the first rows always are.
  const tabStop = Math.min(current, Math.max(0, (collapsed ? Math.min(shown.length, foldedVisible) : shown.length) - 1))

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && fixed?.picking) {
      e.preventDefault()
      e.stopPropagation()
      fixed.onCancelPick()
      return
    }
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
      {fixed?.blockedReason && <p className="mb-1.5 text-xs text-muted-foreground">{fixed.blockedReason}</p>}
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
        className={cn("grid grid-cols-4 gap-1.5 @md:grid-cols-6 @xl:grid-cols-8", collapsed && COLLAPSE_CLASSES)}
      >
        {shown.map((scene, i) => (
          <Tile
            key={scene.id}
            fixedNote={fixed?.blockedReason}
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
            className="flex h-10 rounded-[6px] bg-muted/70 pointer-coarse:h-11 animate-in fade-in-0 fill-mode-both duration-300 motion-reduce:animate-none"
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
            onClick={toggleExpanded}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground pointer-coarse:h-11"
          >
            {expanded ? "Show fewer" : <>Show all <span className="tabular-nums">{scenes.length}</span></>}
          </Button>
        </div>
      )}
    </div>
  )
})
