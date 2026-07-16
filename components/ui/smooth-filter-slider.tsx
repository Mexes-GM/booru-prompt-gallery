"use client"

import type React from "react"
import { useState, useEffect, useCallback } from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { motion, AnimatePresence } from "framer-motion"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { DebouncedInput } from "@/components/ui/debounced-input"
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
    row: "flex items-center",
    input: "h-8 w-16 text-xs text-center bg-background/50",
  },
  compact: {
    wrapper: "space-y-1 mt-2",
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

  const handleSliderCommit = useCallback((val: number[]) => {
    const stringVal = val[0].toString()
    onChange(stringVal)
    onCommit(stringVal)
    setIsDragging(false)
  }, [onChange, onCommit])

  const handleInputChange = useCallback((newVal: string) => {
    setLocalValue(newVal)
    onChange(newVal)
  }, [onChange])

  const handleInputBlur = useCallback(() => {
    onCommit(localValue)
  }, [onCommit, localValue])

  const numericValue = parseInt(localValue) || min
  const isActive = numericValue !== min
  const showBadge = (isDragging || isHovering) && !disabled

  return (
    <div className={classes.wrapper}>
      <label htmlFor={inputId} className={classes.label}>
        {dotColor && <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`}></span>}
        <InfoTooltip
          title={tooltipTitle}
          description={tooltipDescription}
          visual={tooltipVisual}
        >
          {labelPrefix} ({`>=`} {localValue})
        </InfoTooltip>
      </label>
      <div className={classes.row}>
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
            className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary shadow-[inset_0_1px_2px_hsl(var(--foreground)/0.09)] transition-[height] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]"
            onPointerEnter={() => setIsHovering(true)}
            onPointerLeave={() => setIsHovering(false)}
          >
            <SliderPrimitive.Range className="absolute h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--primary)/0.7),hsl(var(--primary)))]" />
          </SliderPrimitive.Track>

          <SliderPrimitive.Thumb asChild>
            <motion.span
              className={cn(
                "relative grid h-5 w-5 place-items-center rounded-full border border-primary/50",
                "bg-[radial-gradient(circle_at_50%_30%,hsl(var(--background)),hsl(var(--secondary)))]",
                "shadow-[0_1px_3px_hsl(var(--foreground)/0.12),0_0_0_3px_hsl(var(--primary)/0.1)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
              whileDrag={disabled ? undefined : { scale: 1.25, boxShadow: "0 2px 8px hsl(var(--foreground) / 0.16), 0 0 0 6px hsl(var(--primary) / 0.18)" }}
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
          className={`${classes.input} ${!isInputValid ? "border-red-500 focus-visible:ring-red-500" : ""} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          aria-label={`${ariaLabel} input`}
        />
      </div>
    </div>
  )
}
