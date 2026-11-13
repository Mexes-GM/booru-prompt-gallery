"use client"

/**
 * One generated prompt: the scene it came from, the prompt in mono, and copy,
 * re-roll and lock. In tag format each tag is a button whose menu puts it on the
 * card as Always or Never. A locked row keeps its prompt when the pack is generated
 * again, and says so.
 *
 * Memoized: keep the callbacks stable and pass `tokens` already split. Only the tag
 * that was clicked mounts a menu, so a hundred rows stay light.
 */
import { memo, useRef, useState } from "react"
import { Check, Copy, Dices, Lock, LockOpen } from "lucide-react"
import { useCopyFeedback } from "@/hooks/use-copy-feedback"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

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
  onToggleLock: (index: number) => void
  onAlways: (tag: string) => void
  onNever: (tag: string) => void
}

const ACTION =
  "relative grid size-8 place-items-center rounded-md text-muted-foreground pointer-coarse:size-11 " +
  "transition-[color,background-color,transform] duration-150 ease-out-strong active:scale-[0.96] motion-reduce:active:scale-100 " +
  "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:pointer-events-none disabled:opacity-40"

const TOKEN =
  "rounded-[4px] px-0.5 text-left transition-[color,background-color] duration-150 ease-out-strong " +
  "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "data-[state=open]:bg-muted data-[state=open]:text-foreground"

function TokenMenu({
  tag,
  onClose,
  onReturnFocus,
  onAlways,
  onNever,
}: {
  tag: string
  onClose: () => void
  onReturnFocus: () => void
  onAlways: (tag: string) => void
  onNever: (tag: string) => void
}) {
  return (
    <DropdownMenu defaultOpen modal={false} onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuTrigger className={TOKEN}>{tag}</DropdownMenuTrigger>
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
        <DropdownMenuItem onSelect={() => onAlways(tag)}>Always in every prompt</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onNever(tag)}>Never in this pack</DropdownMenuItem>
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
  pending = false,
  onCopy,
  onReroll,
  onToggleLock,
  onAlways,
  onNever,
}: ResultRowProps) {
  const [copied, flashCopied] = useCopyFeedback(1500)
  const [menuAt, setMenuAt] = useState<number | null>(null)
  const promptRef = useRef<HTMLParagraphElement>(null)
  const returnFocus = (i: number) => () =>
    requestAnimationFrame(() => {
      // Only when focus has nowhere else to be (Escape or a menu choice, not a click elsewhere).
      const active = document.activeElement
      if (active && active !== document.body) return
      promptRef.current?.querySelector<HTMLButtonElement>(`[data-token="${i}"]`)?.focus()
    })
  const n = index + 1

  const copy = async () => {
    if (await onCopy(index)) flashCopied()
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
        <div className="aspect-square w-10 overflow-hidden rounded-[6px] bg-muted">
          {thumbSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbSrc} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
          ) : (
            postId !== undefined && (
              <span className="grid size-full place-items-center font-mono text-[10px] tabular-nums text-muted-foreground">
                {postId}
              </span>
            )
          )}
        </div>
        <span className="mt-1 block text-center font-mono text-xs tabular-nums text-faint-foreground" aria-hidden>
          {String(n).padStart(2, "0")}
        </span>
      </div>

      <div className={cn("min-w-0 pt-0.5", pending && "opacity-60")}>
        {locked && (
          <p className="mb-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3" aria-hidden />
            Locked: stays when you generate again
          </p>
        )}
        {text !== undefined ? (
          <p className="text-[13px] leading-relaxed text-foreground [overflow-wrap:anywhere] text-pretty">{text}</p>
        ) : (
          <p ref={promptRef} className="font-mono text-[13px] leading-relaxed text-foreground [overflow-wrap:anywhere]">
            <span className="sr-only">Prompt {n}: </span>
            {tokens.map((tag, i) => (
              <span key={`${i}-${tag}`}>
                {menuAt === i ? (
                  <TokenMenu tag={tag} onClose={() => setMenuAt(null)} onReturnFocus={returnFocus(i)} onAlways={onAlways} onNever={onNever} />
                ) : (
                  <button type="button" data-token={i} className={TOKEN} aria-haspopup="menu" onClick={() => setMenuAt(i)}>
                    {tag}
                  </button>
                )}
                {i < tokens.length - 1 && <span className="text-faint-foreground">, </span>}
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-0.5 @md:flex-row pointer-coarse:flex-col">
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? `Prompt ${n} copied` : `Copy prompt ${n}`}
          className={cn(ACTION, copied && "bg-success-soft text-success-text hover:bg-success-soft hover:text-success-text")}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </button>
        <button
          type="button"
          onClick={() => onReroll(index)}
          disabled={locked || pending}
          aria-label={`Re-roll prompt ${n}`}
          title={locked ? "Unlock to re-roll" : "Re-roll this prompt"}
          className={ACTION}
        >
          <Dices className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onToggleLock(index)}
          aria-pressed={locked}
          aria-label={`Lock prompt ${n}`}
          title={locked ? "Unlock" : "Lock: this prompt stays when you generate again"}
          className={cn(ACTION, locked && "text-foreground")}
        >
          {locked ? <Lock className="size-4" aria-hidden /> : <LockOpen className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
    </div>
  )
})
