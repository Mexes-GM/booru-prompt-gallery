"use client"

/**
 * The scenes the pack will draw from, before generating: a dense, even grid of
 * square thumbnails, like a photographer's contact sheet. Any scene can be left out
 * with one tap and put back with another; a scene that is out stays in its place,
 * faded, with a dashed edge and a crossed-eye mark.
 *
 * Collapsed, it shows four rows (6, 8 or 10 columns by the width of its container)
 * and a "Show all" button. Keep `onToggle` stable: tiles are memoized.
 */
import { memo, useMemo, useState } from "react"
import { AlertTriangle, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
  className?: string
}

// Collapsed: four rows at 6, 8 and 10 columns. Rendering stops at the widest.
const COLLAPSED_MAX = 40
const COLLAPSE_CLASSES =
  "[&>*:nth-child(n+25)]:hidden @md:[&>*:nth-child(n+25)]:block @md:[&>*:nth-child(n+33)]:hidden @xl:[&>*:nth-child(n+33)]:block"

const Tile = memo(function Tile({
  scene,
  out,
  onToggle,
}: {
  scene: SceneThumb
  out: boolean
  onToggle: (id: string) => void
}) {
  return (
    <button
      type="button"
      aria-pressed={out}
      aria-label={`Leave this scene out, post ${scene.postId}`}
      title={out ? "Put this scene back" : "Leave this scene out"}
      onClick={() => onToggle(scene.id)}
      className={cn(
        "group/tile relative block aspect-square w-full overflow-hidden rounded-[6px] border",
        "transition-[opacity,border-color] duration-150 ease-out-strong",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "animate-in fade-in-0 motion-reduce:animate-none",
        out ? "border-dashed border-muted-foreground/60" : "border-transparent hover:border-foreground/40",
      )}
    >
      <span className={cn("absolute inset-0 transition-opacity duration-150 ease-out-strong", out && "opacity-30 grayscale")}>
        {scene.src ? (
          // Plain img: thumbnails come from several booru hosts and are already small.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={scene.src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center bg-muted font-mono text-[11px] tabular-nums text-muted-foreground">
            {scene.postId}
          </span>
        )}
      </span>
      {out && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-6 place-items-center rounded-full bg-overlay/60 text-overlay-foreground">
            <EyeOff className="size-3.5" aria-hidden />
          </span>
        </span>
      )}
    </button>
  )
})

export const ContactSheet = memo(function ContactSheet({
  scenes,
  leftOut,
  onToggle,
  status = "ready",
  expected = 12,
  onRetry,
  emptyTitle = "No scenes fit this pack",
  emptyHint = "Try taking out a pose or a place.",
  className,
}: ContactSheetProps) {
  const [expanded, setExpanded] = useState(false)
  const out = useMemo(() => new Set(leftOut), [leftOut])
  const loading = status === "loading"

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
  const shown = collapsed ? scenes.slice(0, COLLAPSED_MAX) : scenes
  const placeholders = loading ? Math.max(0, Math.min(12, expected - scenes.length)) : 0
  const hiddenAt = scenes.length + placeholders
  // "Show all" only where some tiles are actually hidden at that width.
  const toggleClass = cn(hiddenAt <= 32 && "@md:hidden", hiddenAt <= 40 && "@xl:hidden")

  return (
    <div className={cn("@container", className)}>
      <div
        role="group"
        aria-label="Scenes for this pack"
        aria-busy={loading}
        className={cn("grid grid-cols-6 gap-1 @md:grid-cols-8 @xl:grid-cols-10", collapsed && COLLAPSE_CLASSES)}
      >
        {shown.map((scene) => (
          <Tile key={scene.id} scene={scene} out={out.has(scene.id)} onToggle={onToggle} />
        ))}
        {Array.from({ length: placeholders }, (_, i) => (
          <span
            key={`pending-${i}`}
            aria-hidden
            style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
            className="block aspect-square rounded-[6px] bg-muted/60 animate-in fade-in-0 fill-mode-both duration-300 motion-reduce:animate-none"
          />
        ))}
      </div>
      {hiddenAt > 24 && (
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
