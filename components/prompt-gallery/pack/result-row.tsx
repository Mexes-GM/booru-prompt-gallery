"use client"

/**
 * One generated prompt: the post its scene came from (as text, linked to the post
 * on its site; the pack loads no pictures), the prompt in mono, and copy,
 * re-roll and lock; in ComfyUI mode also Send, with the job in a picture box beside the
 * prompt (the actions move under the prompt then). In tag format each tag is a button whose menu puts it on the
 * card as Always or Never. A locked row keeps its prompt when the pack is generated
 * again, and says so.
 *
 * The tags of a prompt are one stop in the tab order: Left and Right move between
 * them, Home and End jump to the ends, Enter opens the menu.
 *
 * Memoized: keep the callbacks stable and pass `tokens` already split. Only the tag
 * that was clicked mounts a menu, so a hundred rows stay light.
 */
import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { AlertTriangle, Check, Copy, Dices, ExternalLink, Lock, LockOpen } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ApiWorkflow } from "@/lib/comfyui/types"
import { cn } from "@/lib/utils"
import { ComfySideJob, ComfySideJobPresence } from "../comfyui-side-job"
import { SendGlyph } from "../comfyui-motion"
import { CAST_MODE_TEXT, COPY_FAILED, SEND_TEXT, SIZE_TEXT } from "./pack-text"
import { SCENE_TEXT } from "./scene-ref"
import { useCopyResult } from "./use-copy-result"

export interface ResultRowProps {
  index: number
  /** Tag format: the prompt's tags in order. */
  tokens?: readonly string[]
  /** Natural-language format: the prompt as text. When given, it is shown instead of the tags. */
  text?: string
  /** The post the scene came from. */
  postId?: number
  /** The post's page on its site; without it the post number is plain text. */
  postHref?: string
  /** The site's name, said on the link ("Danbooru"). */
  postSite?: string
  /** The scene was written by the scene model: there is no post. */
  inventedScene?: boolean
  locked?: boolean
  /** The prompt is being re-rolled or converted. */
  pending?: boolean
  /** Resolves true when the copy worked. */
  onCopy: (index: number) => Promise<boolean> | boolean
  onReroll: (index: number) => void
  /** False when the list has one live region for every row (copy results are said there). */
  announce?: boolean
  /** Why they wait, said on the controls. */
  busyReason?: string
  /** Re-roll and the tag menu wait (a run is going on, or the pack needs Generate first). */
  busy?: boolean
  /** Without it the row has no lock. */
  onToggleLock?: (index: number) => void
  /** The suggested size ("832×1216"), shown beside the actions; none when the scene had no size. */
  size?: string | null
  /** The same size as numbers, for the shape of the picture box before ComfyUI's image is in. */
  width?: number | null
  height?: number | null
  onAlways: (tag: string) => void
  onNever: (tag: string) => void
  /** One character per prompt: the name of the character this prompt is for. */
  character?: string
  /** ComfyUI mode: the row gets Send, and shows its job beside the prompt. Without it, no Send. */
  onSend?: (index: number) => void
  /** The job this row sent, while it is shown. */
  sendJob?: { jobId: string; api: ApiWorkflow } | null
  /** A send of this row is on its way. */
  sending?: boolean
  onDismissSend?: (index: number) => void
}

const ACTION =
  "relative grid size-8 place-items-center rounded-md text-muted-foreground pointer-coarse:size-11 " +
  "transition-[color,background-color,transform] duration-150 ease-out-strong active:scale-[0.96] motion-reduce:active:scale-100 " +
  "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:pointer-events-none disabled:opacity-40"

// A prompt is text: its tags are targets inside a line of reading, not 44 px buttons
// (the menu they open has 44 px items on touch screens).
const TOKEN =
  "rounded-[3px] text-left whitespace-normal " +
  "transition-[color,background-color] duration-150 ease-out-strong " +
  "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "data-[state=open]:bg-muted data-[state=open]:text-foreground"

function TokenMenu({
  tag,
  index,
  busy = false,
  busyReason,
  onClose,
  onReturnFocus,
  onAlways,
  onNever,
}: {
  busy?: boolean
  busyReason?: string
  tag: string
  index: number
  onClose: () => void
  onReturnFocus: () => void
  onAlways: (tag: string) => void
  onNever: (tag: string) => void
}) {
  // The first choice takes focus once the menu is open, so Down goes to the second and
  // Enter or Space applies the one in focus (Home, End and Escape are the menu's own).
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      contentRef.current?.querySelector<HTMLElement>("[role='menuitem']:not([data-disabled])")?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <DropdownMenu defaultOpen modal={false} onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuTrigger data-token={index} tabIndex={0} className={TOKEN}>
        {tag}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        loop
        collisionPadding={8}
        ref={contentRef}
        className="w-56 max-w-[calc(100vw-1rem)]"
        onCloseAutoFocus={(e) => {
          // The trigger is swapped back for a plain button on close; focus that one instead.
          e.preventDefault()
          onReturnFocus()
        }}
      >
        <DropdownMenuLabel className="truncate font-mono text-xs font-medium text-muted-foreground">{tag}</DropdownMenuLabel>
        {busy && busyReason && <p className="px-2 pb-1 text-xs text-muted-foreground">{busyReason}</p>}
        <DropdownMenuItem disabled={busy} className="pointer-coarse:min-h-11" onSelect={() => onAlways(tag)}>Always in every prompt</DropdownMenuItem>
        <DropdownMenuItem disabled={busy} className="pointer-coarse:min-h-11" onSelect={() => onNever(tag)}>Never in this pack</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const ResultRow = memo(function ResultRow({
  index,
  tokens = [],
  text,
  postId,
  postHref,
  postSite,
  inventedScene = false,
  locked = false,
  busy = false,
  busyReason,
  announce = true,
  pending = false,
  onCopy,
  onReroll,
  onToggleLock,
  size,
  width,
  height,
  onAlways,
  onNever,
  character,
  onSend,
  sendJob = null,
  sending = false,
  onDismissSend,
}: ResultRowProps) {
  const [copy, reportCopy] = useCopyResult()
  const [menuAt, setMenuAt] = useState<number | null>(null)
  // A menu open on a tag closes when the prompt changes under it, never moving to another tag.
  const [menuTokens, setMenuTokens] = useState(tokens)
  if (menuTokens !== tokens) {
    setMenuTokens(tokens)
    if (menuAt !== null) setMenuAt(null)
  }
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

  // The post the scene came from, as text: the pack shows no pictures.
  const ref = inventedScene ? (
    <span className="shrink-0">{SCENE_TEXT.inventedScene}</span>
  ) : postId !== undefined && postId > 0 ? (
    postHref ? (
      <a
        href={postHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={SCENE_TEXT.openPost(postId, postSite ?? "its site")}
        title={SCENE_TEXT.openPost(postId, postSite ?? "its site")}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-[3px] font-mono tabular-nums underline-offset-2",
          "transition-colors duration-150 ease-out-strong hover:text-foreground hover:underline",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {SCENE_TEXT.post(postId)}
        <ExternalLink className="size-3" aria-hidden />
      </a>
    ) : (
      <span className="shrink-0 font-mono tabular-nums">{SCENE_TEXT.post(postId)}</span>
    )
  ) : null

  const sendRef = useRef<HTMLButtonElement>(null)
  const focusSend = useCallback(() => sendRef.current?.focus(), [])
  const dismissSend = useCallback(() => onDismissSend?.(index), [onDismissSend, index])
  // The picture box's column stays until the box has finished leaving.
  const showJob = !!onSend && (sendJob !== null || sending)
  const [boxShown, setBoxShown] = useState(showJob)
  if (showJob && !boxShown) setBoxShown(true)
  const hideBox = useCallback(() => setBoxShown(false), [])
  const side = boxShown

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
          // Narrow: number and text, then the row's actions in one line under the text.
          // With a picture box: the box beside the text, and the actions under them until the row is wide.
          "group grid items-start gap-x-2.5 gap-y-1.5 rounded-xl border p-3",
          side
            ? "grid-cols-[1.5rem_minmax(0,1fr)_auto] @2xl:grid-cols-[1.5rem_minmax(0,1fr)_auto_auto]"
            : "grid-cols-[1.5rem_minmax(0,1fr)] @md:grid-cols-[1.5rem_minmax(0,1fr)_auto]",
          "transition-[border-color,background-color] duration-150 ease-out-strong",
          locked ? "border-mode-pack-border bg-mode-pack-soft" : "border-border/60 bg-card hover:border-border",
        )}
      >
        <span className="pt-0.5 font-mono text-xs leading-5 tabular-nums text-muted-foreground" aria-hidden>
          {String(n).padStart(2, "0")}
        </span>

        <div className="min-w-0 pt-0.5">
          {locked && (
            <p className="mb-1 flex items-center gap-1 text-xs font-medium text-mode-pack-text">
              <Lock className="size-3" aria-hidden />
              Locked: stays when you generate again
            </p>
          )}
          {(character || ref) && (
            <p className="mb-0.5 flex min-w-0 items-baseline gap-x-2 text-xs text-muted-foreground">
              {character && (
                <span className="min-w-0 truncate font-medium">
                  <span className="sr-only">{CAST_MODE_TEXT.rowLabel}: </span>
                  {character}
                </span>
              )}
              {ref}
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
                "font-mono text-[13px] leading-relaxed [overflow-wrap:anywhere]",
                pending ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {tokens.map((tag, i) => (
                // By position: when a correction changes the prompt, the tag in focus keeps its place.
                // The comma stays on the tag's line (no break between them); the space after it is where lines break.
                <span key={i}>
                  <span className="whitespace-nowrap">
                    {menuAt === i ? (
                      <TokenMenu
                        busy={busy}
                        busyReason={busyReason}
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
                        title={busy && busyReason ? busyReason : undefined}
                        aria-haspopup="menu"
                        onFocus={() => setStop(i)}
                        onClick={() => setMenuAt(i)}
                      >
                        {tag}
                      </button>
                    )}
                    {i < tokens.length - 1 && <span className="text-muted-foreground">,</span>}
                  </span>
                  {i < tokens.length - 1 && " "}
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

        <div
          className={cn(
            "col-start-2 -mr-1 flex flex-row flex-wrap items-center justify-end gap-0.5",
            // Narrow, they run under the text and the box; from @lg, under the text only.
            side ? "col-span-2 row-start-2 @lg:col-span-1 @2xl:col-start-3 @2xl:row-start-1 @2xl:mr-0" : "@md:col-start-3 @md:row-start-1 @md:mr-0",
          )}
        >
          {size && (
            <span className="mr-1 font-mono text-[11px] tabular-nums text-muted-foreground">
              <span className="sr-only">{SIZE_TEXT.rowLabel}: </span>
              {size}
            </span>
          )}
          {onSend && (
            <button
              ref={sendRef}
              type="button"
              onClick={() => onSend(index)}
              aria-label={SEND_TEXT.row(n)}
              aria-busy={sending || undefined}
              title={SEND_TEXT.rowTitle}
              className={ACTION}
            >
              <SendGlyph sending={sending} className="size-4 [&_svg]:size-full!" />
            </button>
          )}
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
            title={locked ? "Unlock to re-roll" : busy && busyReason ? busyReason : "Re-roll this prompt"}
            className={ACTION}
          >
            <Dices className="size-4" aria-hidden />
          </button>
          {onToggleLock && <button
            type="button"
            onClick={() => onToggleLock(index)}
            aria-pressed={locked}
            aria-label={`${locked ? "Unlock" : "Lock"} prompt ${n}`}
            title={locked ? "Unlock" : "Lock: this prompt stays when you generate again"}
            className={cn(ACTION, locked && "text-mode-pack-text")}
          >
            {locked ? <Lock className="size-4" aria-hidden /> : <LockOpen className="size-4" aria-hidden />}
          </button>}
        </div>

        {onSend && side && (
          <ComfySideJobPresence
            show={showJob}
            onExitComplete={hideBox}
            className="col-start-3 row-start-1 @lg:row-span-2 @2xl:col-start-4"
          >
            <ComfySideJob
              jobId={sendJob?.jobId ?? null}
              api={sendJob?.api ?? null}
              launching={sending}
              onDismiss={dismissSend}
              returnFocus={focusSend}
              width={width}
              height={height}
              className="w-[4.5rem] @sm:w-24 @lg:w-28"
            />
          </ComfySideJobPresence>
        )}
      </div>
      <span className="sr-only" role={announce ? "status" : undefined} aria-live={announce ? "polite" : undefined}>
        {copy === "copied" ? `Prompt ${n} copied` : copy === "failed" ? COPY_FAILED : ""}
      </span>
    </div>
  )
})
