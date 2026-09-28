"use client"

import type React from "react"
import { useState, useEffect, useCallback } from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { motion, AnimatePresence } from "framer-motion"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { DebouncedInput } from "@/components/ui/debounced-input"
import { useDeferredCallback } from "@/hooks/use-deferred-callback"
import { FILTER_COMMIT_DELAY_MS } from "@/lib/motion"
import { cn } from "@/lib/utils"

export interface SmoothFilterSliderProps {
  min: number
  max: number
  step?: number
  value: string
  onChange: (value: string) => void
  onCommit: (value: string) => void
  disabled?: boolean
  labelPrefix: string
  tooltipTitle: string
  tooltipDescription: string
  tooltipVisual?: React.ReactNode
  inputId: string
  isInputValid: boolean
  maxInput?: number
  ariaLabel: string
  dotColor?: string
  /** Shown under the label while `disabled`, so the user knows how to enable the filter. */
  disabledReason?: string
  /**
   * Quick-pick values rendered as a segmented row INSTEAD of the slider track.
   * Use for heavy-tailed ranges (e.g. character post counts) where a linear
   * slider wastes most of its travel. The numeric input stays for custom values.
   */
  presets?: { label: string; value: number }[]
  /** With `presets`, drop the numeric input so the quick picks are the only
   *  control (the main panel avoids two controls for one value). */
  hideInput?: boolean
  /** Replaces the InfoTooltip label with a plain label + one-line hint. */
  hint?: string
  /**
   * Visual density. "default" matches the main gallery panel; "compact" matches
   * the smaller extension side-panel. Only affects Tailwind sizing classes — the
   * behavior is identical in both variants.
   */
  variant?: "default" | "compact"
}

const VARIANT_CLASSES = {
  default: {
    wrapper: "space-y-2",
    label: "text-xs font-medium text-muted-foreground flex items-center gap-2",
    row: "flex items-center gap-3",
    input: "h-8 w-16 text-xs text-center bg-background/50",
  },
  compact: {
    wrapper: "space-y-1",
    label: "text-[11px] font-medium text-muted-foreground flex items-center gap-1.5",
    row: "flex items-center gap-3",
    input: "h-7 w-14 text-[10px] text-center bg-background/50",
  },
} as const

// Strong ease-out — the built-in easing curves are too weak to feel intentional.
const EASE_OUT = [0.23, 1, 0.32, 1] as const

/**
 * Slider + numeric input pair used for numeric filters (min score, min tags…).
 * Keeps a local value so dragging is smooth and only commits on release/blur.
 * Shares the same visual language as RangeSlider (floating value badge while
 * dragging/hovering, growing track, scaling thumb) instead of the bare
 * default Slider — the two controls used to look like they came from
 * different apps.
 * Shared between the web gallery and the browser-extension side panel.
 */
export function SmoothFilterSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  onCommit,
  disabled = false,
  labelPrefix,
  tooltipTitle,
  tooltipDescription,
  tooltipVisual,
  inputId,
  isInputValid,
  maxInput = 1000000,
  ariaLabel,
  dotColor,
  disabledReason,
  presets,
  hideInput = false,
  hint,
  variant = "default",
}: SmoothFilterSliderProps) {
  const [localValue, setLocalValue] = useState(value)
  const [isDragging, setIsDragging] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  const classes = VARIANT_CLASSES[variant]

  // Keep local value in sync with external value changes
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const handleSliderChange = useCallback((val: number[]) => {
    setLocalValue(val[0].toString())
  }, [])

  // Committing re-renders the whole gallery and refetches, so presets and
  // slider releases update localValue at once and commit once the control's
  // own animation has settled (rapid picks collapse into a single commit).
  const { schedule: scheduleCommit } = useDeferredCallback((stringVal: string) => {
    onChange(stringVal)
    onCommit(stringVal)
  }, FILTER_COMMIT_DELAY_MS)

  const handleSliderCommit = useCallback((val: number[]) => {
    const stringVal = val[0].toString()
    setLocalValue(stringVal)
    scheduleCommit(stringVal)
    setIsDragging(false)
  }, [scheduleCommit])

  const handleInputChange = useCallback((newVal: string) => {
    setLocalValue(newVal)
    onChange(newVal)
  }, [onChange])

  const handleInputBlur = useCallback(() => {
    onCommit(localValue)
  }, [onCommit, localValue])

  const handlePresetSelect = useCallback((preset: number) => {
    const stringVal = preset.toString()
    setLocalValue(stringVal)
    scheduleCommit(stringVal)
  }, [scheduleCommit])

  const numericValue = parseInt(localValue) || min
  const isActive = numericValue !== min
  const showBadge = (isDragging || isHovering) && !disabled

  return (
    <div className={classes.wrapper}>
      {hint !== undefined ? (
        <div className="flex items-baseline justify-between gap-3">
          <span id={`${inputId}-label`} className="text-sm font-medium text-foreground">{labelPrefix}</span>
          <span className="truncate text-xs text-muted-foreground">
            {disabled && disabledReason ? `Off — ${disabledReason}` : hint}
          </span>
        </div>
      ) : (
      <label htmlFor={inputId} className={classes.label}>
        {dotColor && <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`}></span>}
        <InfoTooltip
          title={tooltipTitle}
          description={tooltipDescription}
          visual={tooltipVisual}
        >
          {labelPrefix}
        </InfoTooltip>
        {disabled && disabledReason && (
          <span className="text-[10px] font-normal text-muted-foreground/70">— {disabledReason}</span>
        )}
      </label>
      )}
      <div className={classes.row}>
        {presets ? (
          <div
            role="group"
            aria-label={`${ariaLabel} presets`}
            className={cn(
              "grid flex-1 gap-0.5 rounded-md border border-input bg-muted/50 p-0.5",
              variant === "compact" ? "h-7" : hideInput ? "h-10 sm:h-9 rounded-lg p-[3px]" : "h-8",
              disabled && "opacity-50 cursor-not-allowed"
            )}
            style={{ gridTemplateColumns: `repeat(${presets.length}, minmax(0, 1fr))` }}
          >
            {presets.map((preset) => {
              const active = numericValue === preset.value
              return (
                <button
                  key={preset.value}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => handlePresetSelect(preset.value)}
                  className={cn(
                    "rounded-[5px] font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
                    variant === "compact" ? "text-[10px]" : hideInput ? "text-sm rounded-md" : "text-xs",
                    active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-background/40"
                  )}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
        ) : (
        <SliderPrimitive.Root
          min={min}
          max={max}
          step={step}
          value={[numericValue]}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
          disabled={disabled}
          onPointerDown={() => setIsDragging(true)}
          className={cn(
            "relative flex flex-1 touch-none select-none items-center py-2",
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
          )}
        >
          <SliderPrimitive.Track
            className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary shadow-[inset_0_1px_2px_color-mix(in_oklab,var(--foreground)_9%,transparent)] transition-[height] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]"
            onPointerEnter={() => setIsHovering(true)}
            onPointerLeave={() => setIsHovering(false)}
          >
            <SliderPrimitive.Range className="absolute h-full rounded-full bg-linear-to-r from-primary/70 to-primary" />
          </SliderPrimitive.Track>

          <SliderPrimitive.Thumb asChild>
            <motion.span
              className={cn(
                "relative grid h-5 w-5 place-items-center rounded-full border border-primary/50",
                "bg-[radial-gradient(circle_at_50%_30%,var(--background),var(--secondary))]",
                "shadow-[0_1px_3px_color-mix(in_oklab,var(--foreground)_12%,transparent),0_0_0_3px_color-mix(in_oklab,var(--primary)_10%,transparent)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
              whileDrag={disabled ? undefined : { scale: 1.25, boxShadow: "0 2px 8px color-mix(in oklab, var(--foreground) 16%, transparent), 0 0 0 6px color-mix(in oklab, var(--primary) 18%, transparent)" }}
              transition={{ type: "spring", stiffness: 420, damping: 26 }}
            >
              {/* Aperture dot — brightens to full primary once active, dim
                  otherwise, so the knob's center tracks whether the filter is on. */}
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors duration-150",
                  isActive ? "bg-primary" : "bg-primary/40",
                )}
              />
              <AnimatePresence>
                {showBadge && (
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.95 }}
                    transition={{ duration: 0.15, ease: EASE_OUT }}
                    className={cn(
                      "absolute -top-8 left-1/2 -translate-x-1/2",
                      "px-2 py-0.5 rounded-md text-[11px] font-semibold font-mono whitespace-nowrap",
                      "bg-primary text-primary-foreground shadow-sm",
                      "pointer-events-none select-none"
                    )}
                  >
                    {numericValue}
                    <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-2 h-2 rotate-45 bg-primary" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.span>
          </SliderPrimitive.Thumb>
        </SliderPrimitive.Root>
        )}
        {!(presets && hideInput) && (
        <DebouncedInput
          id={inputId}
          type="number"
          min={min}
          max={maxInput}
          value={localValue}
          onChange={handleInputChange}
          debounceTime={500}
          onBlur={handleInputBlur}
          disabled={disabled}
          className={`${classes.input} ${!isInputValid ? "border-destructive focus-visible:ring-destructive" : ""} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          aria-label={`${ariaLabel} input`}
        />
        )}
      </div>
    </div>
  )
}
