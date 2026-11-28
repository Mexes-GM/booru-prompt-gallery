"use client"

/**
 * Generating and handling the results: how many prompts (a number field with
 * steps, 1 to 100), the Generate button, and above the results the format and
 * Copy all, which confirms the copy where it happened; in ComfyUI mode, Send all
 * beside it, which counts the prompts as they go.
 */
import { memo, useId, useState, type ReactNode } from "react"
import { AlertTriangle, Check, ChevronDown, Copy, Info, Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { SendAllState } from "@/lib/pack/pack-comfy-send"
import { cn } from "@/lib/utils"
import { SendGlyph } from "../comfyui-motion"
import { ChoiceGroup, type Choice } from "./choice-group"
import { COPY_FAILED, MAX_PROMPTS, MIN_PROMPTS, SEND_TEXT, SIZE_TEXT, generateLabel, sendAllAnnouncement, sendAllLabel, sendAllNote } from "./pack-text"
import { useCopyResult } from "./use-copy-result"

const clamp = (n: number) => Math.min(MAX_PROMPTS, Math.max(MIN_PROMPTS, Math.round(n)))

const STEP =
  "grid h-full w-9 shrink-0 place-items-center text-muted-foreground pointer-coarse:w-11 " +
  "transition-[color,background-color] duration-150 ease-out-strong hover:bg-muted hover:text-foreground " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring " +
  "disabled:pointer-events-none disabled:opacity-40"

export interface CountStepperProps {
  value: number
  onChange: (value: number) => void
  label?: string
  disabled?: boolean
}

/** A number field between minus and plus. Typing is free; the value settles on blur or Enter. */
export const CountStepper = memo(function CountStepper({ value, onChange, label = "Prompts", disabled }: CountStepperProps) {
  const id = useId()
  const [draft, setDraft] = useState(String(value))
  // A new value from outside (a step button, a preset) replaces whatever was being typed.
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setDraft(String(value))
  }

  const settle = () => {
    const n = Number.parseInt(draft, 10)
    const next = Number.isFinite(n) ? clamp(n) : value
    setDraft(String(next))
    if (next !== value) onChange(next)
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-[13px] font-medium text-muted-foreground max-sm:sr-only">
        {label}
      </label>
      <div
        className={cn(
          "flex h-10 items-center overflow-hidden rounded-lg border border-border/80 bg-background pointer-coarse:h-[46px]",
          "focus-within:ring-2 focus-within:ring-ring/40",
          disabled && "opacity-50",
        )}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label="One fewer prompt"
          disabled={disabled || value <= MIN_PROMPTS}
          onClick={() => onChange(clamp(value - 1))}
          className={STEP}
        >
          <Minus className="size-3.5" aria-hidden />
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={MIN_PROMPTS}
          max={MAX_PROMPTS}
          step={1}
          disabled={disabled}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={settle}
          onKeyDown={(e) => {
            if (e.key === "Enter") settle()
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault()
              const step = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1)
              onChange(clamp(value + step))
            }
          }}
          className={cn(
            "h-full w-10 text-center font-mono pointer-coarse:w-12 text-sm tabular-nums text-foreground outline-none",
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="One more prompt"
          disabled={disabled || value >= MAX_PROMPTS}
          onClick={() => onChange(clamp(value + 1))}
          className={STEP}
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  )
})

export interface GenerateBarProps {
  count: number
  onCountChange: (count: number) => void
  onGenerate: () => void
  generating?: boolean
  /** While generating: prompts done so far, shown as "Generating… 4 of 10". */
  done?: number
  /** Why Generate can't run yet; disables it and is shown beside it. */
  blockedReason?: string
  /** Prompts that are locked and won't be generated again. */
  locked?: number
  className?: string
}

export const GenerateBar = memo(function GenerateBar({
  count,
  onCountChange,
  onGenerate,
  generating = false,
  done,
  blockedReason,
  locked = 0,
  className,
}: GenerateBarProps) {
  const reasonId = useId()
  const blocked = !!blockedReason && !generating
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-x-3 gap-y-2 max-sm:gap-x-2", className)}>
      {blocked ? (
        <p id={reasonId} className="mr-auto flex min-w-0 items-start gap-2 text-[13px] text-foreground text-pretty max-sm:basis-full">
          <Info className="mt-0.5 size-3.5 shrink-0 text-info-text" aria-hidden />
          {blockedReason}
        </p>
      ) : (
        locked > 0 && (
          <p className="mr-auto min-w-0 text-[13px] text-muted-foreground text-pretty max-sm:basis-full">
            {`${locked} locked ${locked === 1 ? "prompt stays" : "prompts stay"} as ${locked === 1 ? "it is" : "they are"}`}
          </p>
        )
      )}
      <CountStepper value={count} onChange={onCountChange} disabled={generating} />
      {/*
        Generating keeps the button at full strength (it is working, not unavailable) and shows
        progress in its text; only a blocked button is drawn faded.
      */}
      <Button
        type="button"
        onClick={generating ? undefined : onGenerate}
        disabled={blocked}
        aria-disabled={generating || undefined}
        aria-busy={generating}
        aria-describedby={blocked ? reasonId : undefined}
        className={cn("h-10 rounded-lg px-5 font-semibold tabular-nums shadow-sm pointer-coarse:h-11 max-sm:flex-1", generating && "cursor-progress hover:bg-primary")}
      >
        {generateLabel(count, generating, done)}
      </Button>
    </div>
  )
})

export interface ResultsToolbarProps<F extends string> {
  formats: readonly Choice<F>[]
  format: F
  onFormatChange: (format: F) => void
  /** Prompts in the list. */
  count: number
  /** Resolves true when the copy worked. */
  onCopyAll: () => Promise<boolean> | boolean
  /** Said after a copy that worked, when what was copied isn't the whole, current pack. */
  copyNote?: string
  /** "Add size as [WIDTHxHEIGHT]": a menu beside Copy all; Copy all says when the size goes with the prompts. */
  withSize?: { value: boolean; onChange: (value: boolean) => void }
  /** ComfyUI mode: Send all, before Copy all. Without it, no Send all. */
  send?: { state: SendAllState; onSendAll: () => void }
  /** Extra controls on the right. */
  children?: ReactNode
  className?: string
}

function ResultsToolbarInner<F extends string>({
  formats,
  format,
  onFormatChange,
  count,
  onCopyAll,
  copyNote,
  withSize,
  send,
  children,
  className,
}: ResultsToolbarProps<F>) {
  const [result, reportCopy] = useCopyResult(2000, 5000)
  const copied = result === "copied"
  const failed = result === "failed"
  const copy = async () => {
    let ok = false
    try {
      ok = await onCopyAll()
    } catch {
      ok = false
    }
    reportCopy(ok)
  }
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
      <ChoiceGroup size="sm" choices={formats} value={format} onChange={onFormatChange} label="Prompt format" />
      <div className="flex items-center gap-1.5">
        {children}
        {send && <SendAllButton count={count} state={send.state} onSendAll={send.onSendAll} />}
        <div className="flex items-center">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={copy}
            disabled={count === 0}
            className={cn(
              "h-8 gap-1.5 tabular-nums pointer-coarse:h-11",
              withSize && "rounded-r-none",
              copied && "bg-primary text-primary-foreground hover:bg-primary",
              failed && "text-destructive-text",
            )}
          >
            {copied ? <Check aria-hidden /> : failed ? <AlertTriangle aria-hidden /> : <Copy aria-hidden />}
            {copied
              ? `Copied ${count}${withSize?.value ? " with size" : ""}`
              : failed
                ? "Couldn't copy"
                : withSize?.value ? SIZE_TEXT.copyAll : "Copy all"}
          </Button>
          {withSize && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={SIZE_TEXT.menu}
                  className="h-8 w-7 rounded-l-none border-l border-border/60 px-0 pointer-coarse:h-11 pointer-coarse:w-11"
                >
                  <ChevronDown className="size-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuCheckboxItem
                  checked={withSize.value}
                  onCheckedChange={(v) => withSize.onChange(v === true)}
                  onSelect={(e) => e.preventDefault()}
                  className="items-start pointer-coarse:min-h-11"
                >
                  <span className="flex flex-col gap-0.5">
                    <span>{SIZE_TEXT.option}</span>
                    <span className="text-xs text-muted-foreground">{SIZE_TEXT.optionDetail}</span>
                  </span>
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <span className="sr-only" role="status" aria-live="polite">
          {copied
            ? `Copied ${count} ${count === 1 ? "prompt" : "prompts"}${withSize?.value ? ` with ${count === 1 ? "its" : "their"} size` : ""}${copyNote ? `. ${copyNote}` : ""}`
            : failed ? COPY_FAILED : ""}
        </span>
      </div>
      {copied && copyNote && (
        <p className="flex basis-full items-start gap-1.5 text-xs text-warning-text" aria-hidden>
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          {copyNote}
        </p>
      )}
      {failed && (
        <p className="flex basis-full items-start gap-1.5 text-xs text-destructive-text" aria-hidden>
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          {COPY_FAILED}
        </p>
      )}
      {send && sendAllNote(send.state) && (
        <p className="flex basis-full items-start gap-1.5 text-xs text-warning-text" aria-hidden>
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          {sendAllNote(send.state)}
        </p>
      )}
    </div>
  )
}

/**
 * Send all: queues every prompt in ComfyUI, one after another. The button counts them as
 * they go and says how it ended; each row shows its own job.
 */
function SendAllButton({ count, state, onSendAll }: { count: number; state: SendAllState; onSendAll: () => void }) {
  const busy = state.kind === "sending"
  const allSent = state.kind === "ended" && state.sent === state.total
  const stopped = state.kind === "ended" && state.sent < state.total
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={busy ? undefined : onSendAll}
        disabled={count === 0}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        aria-label={state.kind === "idle" ? SEND_TEXT.allLabel : undefined}
        className={cn(
          "h-8 gap-1.5 tabular-nums pointer-coarse:h-11",
          busy && "cursor-progress",
          allSent && "bg-primary text-primary-foreground hover:bg-primary",
          stopped && "text-warning-text",
        )}
      >
        {allSent ? <Check aria-hidden /> : stopped ? <AlertTriangle aria-hidden /> : <SendGlyph sending={busy} className="size-4 [&_svg]:size-full!" />}
        {sendAllLabel(state)}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {sendAllAnnouncement(state)}
      </span>
    </>
  )
}

export const ResultsToolbar = memo(ResultsToolbarInner) as typeof ResultsToolbarInner
