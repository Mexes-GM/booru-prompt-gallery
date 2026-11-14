"use client"

/**
 * One generated prompt: the scene it came from, the prompt in mono, and copy,
 * re-roll and lock. In tag format each tag is a button whose menu puts it on the
 * card as Always or Never. A locked row keeps its prompt when the pack is generated
 * again, and says so.
 *
 * The tags of a prompt are one stop in the tab order: Left and Right move between
 * them, Home and End jump to the ends, Enter opens the menu.
 *
 * Memoized: keep the callbacks stable and pass `tokens` already split. Only the tag
 * that was clicked mounts a menu, so a hundred rows stay light.
 */
import { memo, useRef, useState, type KeyboardEvent } from "react"
import { AlertTriangle, Check, Copy, Dices, Lock, LockOpen } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { COPY_FAILED } from "./pack-text"
import { useCopyResult } from "./use-copy-result"

export interface ResultRowProps {
  index: number
  /** Tag format: the prompt's tags in order. */
  tokens?: readonly string[]
  /** Natural-language format: the prompt as text. When given, it is shown instead of the tags. */
  text?: string
  /** The post the scene came from. */
  postId?: number
  thumbSrc?: string
  locked?: boolean
  /** The prompt is being re-rolled or converted. */
  pending?: boolean
  /** Resolves true when the copy worked. */
  onCopy: (index: number) => Promise<boolean> | boolean
  onReroll: (index: number) => void
  /** Re-roll and the tag menu wait (a run is going on, or the pack needs Generate first). */
  busy?: boolean
  /** Without it the row has no lock. */
  onToggleLock?: (index: number) => void
  onAlways: (tag: string) => void
  onNever: (tag: string) => void
}

const ACTION =
  "relative grid size-8 place-items-center rounded-md text-muted-foreground pointer-coarse:size-11 " +
  "transition-[color,background-color,transform] duration-150 ease-out-strong active:scale-[0.96] motion-reduce:active:scale-100 " +
  "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:pointer-events-none disabled:opacity-40"

// In-line targets: on coarse pointers the padding gives each tag a 28px box and the
// line height (36px) keeps the boxes of two lines apart.
const TOKEN =
  "rounded-[4px] px-0.5 text-left pointer-coarse:px-1 pointer-coarse:py-1.5 " +
  "transition-[color,background-color] duration-150 ease-out-strong " +
  "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "data-[state=open]:bg-muted data-[state=open]:text-foreground"

function TokenMenu({
  tag,
  index,
  busy = false,
  onClose,
  onReturnFocus,
  onAlways,
  onNever,
}: {
  busy?: boolean
  tag: string
  index: number
  onClose: () => void
  onReturnFocus: () => void
  onAlways: (tag: string) => void
  onNever: (tag: string) => void
}) {
  return (
    <DropdownMenu defaultOpen modal={false} onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuTrigger data-token={index} tabIndex={0} className={TOKEN}>
        {tag}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56"
        onCloseAutoFocus={(e) => {
          // The trigger is swapped back for a plain button on close; focus that one instead.
          e.preventDefault()
          onReturnFocus()
        }}
      >
        <DropdownMenuLabel className="truncate font-mono text-xs font-medium text-muted-foreground">{tag}</DropdownMenuLabel>
        <DropdownMenuItem disabled={busy} onSelect={() => onAlways(tag)}>Always in every prompt</DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={() => onNever(tag)}>Never in this pack</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const ResultRow = memo(function ResultRow({
  index,
  tokens = [],
  text,
  postId,
  thumbSrc,
  locked = false,
  busy = false,
  pending = false,
  onCopy,
  onReroll,
  onToggleLock,
  onAlways,
  onNever,
}: ResultRowProps) {
  const [copy, reportCopy] = useCopyResult()
  const [menuAt, setMenuAt] = useState<number | null>(null)
  const [stop, setStop] = useState(0)
  const tagsRef = useRef<HTMLDivElement>(null)
  const n = index + 1
  const tabStop = Math.min(stop, Math.max(0, tokens.length - 1))

  const focusToken = (i: number) => tagsRef.current?.querySelector<HTMLElement>(`[data-token="${i}"]`)?.focus()

  const returnFocus = (i: number) => () =>
    requestAnimationFrame(() => {
      // Only when focus has nowhere else to be (Escape or a menu choice, not a click elsewhere).
      const active = document.activeElement
      if (active && active !== document.body) return
      focusToken(Math.min(i, tokens.length - 1))
    })

  const onTagsKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Keys from the open menu bubble here through the portal; they belong to the menu.
    if (!tagsRef.current?.contains(e.target as Node)) return
    const moves: Record<string, number> = {
      ArrowRight: tabStop + 1,
      ArrowLeft: tabStop - 1,
      Home: 0,
      End: tokens.length - 1,
    }
    const to = moves[e.key]
    if (to === undefined || tokens.length === 0) return
    e.preventDefault()
    const next = Math.max(0, Math.min(tokens.length - 1, to))
    setStop(next)
    focusToken(next)
  }

  const copyPrompt = async () => {
    let ok = false
    try {
      ok = await onCopy(index)
    } catch {
      ok = false
    }
    reportCopy(ok)
  }

  return (
    <div className="@container">
      <div
        className={cn(
          "group grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg border p-2",
          "transition-[border-color,background-color] duration-150 ease-out-strong",
          locked ? "border-foreground/25 bg-muted/40" : "border-border/60 hover:border-border",
        )}
      >
        <div className="relative">
          <div className="aspect-[3/4] w-10 overflow-hidden rounded-[6px] bg-muted">
            {thumbSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbSrc} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
            ) : (
              postId !== undefined && (
                <span className="grid size-full place-items-center font-mono text-[10px] tabular-nums text-foreground [overflow-wrap:anywhere]">
                  {postId}
                </span>
              )
            )}
          </div>
          <span className="mt-1 block text-center font-mono text-xs tabular-nums text-muted-foreground" aria-hidden>
            {String(n).padStart(2, "0")}
          </span>
        </div>

        <div className="min-w-0 pt-0.5">
          {locked && (
            <p className="mb-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="size-3" aria-hidden />
              Locked: stays when you generate again
            </p>
          )}
          {pending && <p className="mb-0.5 text-xs text-muted-foreground">Updating…</p>}
          {text !== undefined ? (
            <p className={cn("text-[13px] leading-relaxed [overflow-wrap:anywhere] text-pretty", pending ? "text-muted-foreground" : "text-foreground")}>
              {text}
            </p>
          ) : (
            <div
              ref={tagsRef}
              role="group"
              aria-label={`Prompt ${n} tags`}
              onKeyDown={onTagsKeyDown}
              className={cn(
                "font-mono text-[13px] leading-relaxed [overflow-wrap:anywhere] pointer-coarse:leading-9",
                pending ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {tokens.map((tag, i) => (
                // Tags can repeat inside one prompt, so the position is part of the key.
                <span key={`${i}-${tag}`}>
                  {menuAt === i ? (
                    <TokenMenu
                      busy={busy}
                      tag={tag}
                      index={i}
                      onClose={() => setMenuAt(null)}
                      onReturnFocus={returnFocus(i)}
                      onAlways={onAlways}
                      onNever={onNever}
                    />
                  ) : (
                    <button
                      type="button"
                      data-token={i}
                      tabIndex={i === tabStop ? 0 : -1}
                      className={TOKEN}
                      aria-haspopup="menu"
                      onFocus={() => setStop(i)}
                      onClick={() => setMenuAt(i)}
                    >
                      {tag}
                    </button>
                  )}
                  {i < tokens.length - 1 && <span className="text-muted-foreground">, </span>}
                </span>
              ))}
            </div>
          )}
          {copy === "failed" && (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-destructive-text">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
              {COPY_FAILED}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-0.5 @md:flex-row pointer-coarse:flex-col">
          <button
            type="button"
            onClick={copyPrompt}
            aria-label={`Copy prompt ${n}`}
            className={cn(
              ACTION,
              copy === "copied" && "bg-success-soft text-success-text hover:bg-success-soft hover:text-success-text",
              copy === "failed" && "text-destructive-text hover:text-destructive-text",
            )}
          >
            {copy === "copied" ? (
              <Check className="size-4" aria-hidden />
            ) : copy === "failed" ? (
              <AlertTriangle className="size-4" aria-hidden />
            ) : (
              <Copy className="size-4" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={() => onReroll(index)}
            disabled={locked || pending || busy}
            aria-label={`Re-roll prompt ${n}`}
            title={locked ? "Unlock to re-roll" : "Re-roll this prompt"}
            className={ACTION}
          >
            <Dices className="size-4" aria-hidden />
          </button>
          {onToggleLock && <button
            type="button"
            onClick={() => onToggleLock(index)}
            aria-pressed={locked}
            aria-label={`Lock prompt ${n}`}
            title={locked ? "Unlock" : "Lock: this prompt stays when you generate again"}
            className={cn(ACTION, locked && "text-foreground")}
          >
            {locked ? <Lock className="size-4" aria-hidden /> : <LockOpen className="size-4" aria-hidden />}
          </button>}
        </div>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {copy === "copied" ? `Prompt ${n} copied` : copy === "failed" ? COPY_FAILED : ""}
      </span>
    </div>
  )
})
