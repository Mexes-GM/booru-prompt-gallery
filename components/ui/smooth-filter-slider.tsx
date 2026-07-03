"use client"

import type React from "react"
import { useState, useEffect, useCallback } from "react"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { Slider } from "@/components/ui/slider"
import { DebouncedInput } from "@/components/ui/debounced-input"

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

/**
 * Slider + numeric input pair used for numeric filters (min score, min tags…).
 * Keeps a local value so dragging is smooth and only commits on release/blur.
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
  }, [onChange, onCommit])

  const handleInputChange = useCallback((newVal: string) => {
    setLocalValue(newVal)
    onChange(newVal)
  }, [onChange])

  const handleInputBlur = useCallback(() => {
    onCommit(localValue)
  }, [onCommit, localValue])

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
        <Slider
          min={min}
          max={max}
          step={step}
          value={[parseInt(localValue) || min]}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
          disabled={disabled}
          className={`flex-1 ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          aria-label={ariaLabel}
        />
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
