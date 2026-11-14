"use client"

/**
 * Generating and handling the results: how many prompts (a number field with
 * steps, 1 to 100), the Generate button, and above the results the format and
 * Copy all, which confirms the copy where it happened.
 */
import { memo, useId, useState, type ReactNode } from "react"
import { AlertTriangle, Check, Copy, Info, Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ChoiceGroup, type Choice } from "./choice-group"
import { COPY_FAILED, MAX_PROMPTS, MIN_PROMPTS, generateLabel } from "./pack-text"
import { useCopyResult } from "./use-copy-result"

const clamp = (n: number) => Math.min(MAX_PROMPTS, Math.max(MIN_PROMPTS, Math.round(n)))

const STEP =
  "grid size-8 shrink-0 place-items-center text-muted-foreground pointer-coarse:size-11 " +
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
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div
        className={cn(
          "flex h-8 items-center overflow-hidden rounded-md border border-border bg-background pointer-coarse:h-11",
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
    <div className={cn("flex flex-wrap items-center justify-end gap-x-3 gap-y-2", className)}>
      {blocked ? (
        <p id={reasonId} className="mr-auto flex min-w-0 items-start gap-1.5 text-xs text-foreground text-pretty">
          <Info className="mt-px size-3.5 shrink-0 text-info-text" aria-hidden />
          {blockedReason}
        </p>
      ) : (
        locked > 0 && (
          <p className="mr-auto min-w-0 text-xs text-muted-foreground text-pretty">
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
        className={cn("h-10 tabular-nums pointer-coarse:h-11", generating && "cursor-progress hover:bg-primary")}
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
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={copy}
          disabled={count === 0}
          className={cn(
            "h-8 gap-1.5 tabular-nums pointer-coarse:h-11",
            copied && "bg-primary text-primary-foreground hover:bg-primary",
            failed && "text-destructive-text",
          )}
        >
          {copied ? <Check aria-hidden /> : failed ? <AlertTriangle aria-hidden /> : <Copy aria-hidden />}
          {copied ? `Copied ${count}` : failed ? "Couldn't copy" : "Copy all"}
        </Button>
        <span className="sr-only" role="status" aria-live="polite">
          {copied ? `Copied ${count} ${count === 1 ? "prompt" : "prompts"}${copyNote ? `. ${copyNote}` : ""}` : failed ? COPY_FAILED : ""}
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
    </div>
  )
}

export const ResultsToolbar = memo(ResultsToolbarInner) as typeof ResultsToolbarInner
