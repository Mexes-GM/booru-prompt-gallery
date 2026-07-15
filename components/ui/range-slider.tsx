"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { motion, AnimatePresence } from "framer-motion"

import { cn } from "@/lib/utils"
import { DebouncedInput } from "@/components/ui/debounced-input"
import { InfoTooltip } from "@/components/ui/info-tooltip"

interface RangeSliderProps {
  min: number
  max: number
  step?: number
  value: readonly [number, number]
  onValueChange: (value: [number, number]) => void
  onValueCommit: (value: [number, number]) => void
  disabled?: boolean
  labelPrefix: string
  formatLabel?: (value: [number, number]) => string
  tooltipTitle: string
  tooltipDescription: string
  tooltipVisual?: React.ReactNode
  minInputId: string
  maxInputId: string
  isInputValid: boolean
  maxInput?: number
  ariaLabel: string
  dotColor?: string
  /** Show tick marks at this interval (0 = no ticks, default 0) */
  tickInterval?: number
  /** Override active track color (default "bg-primary") */
  trackColor?: string
}

/**
 * EnhancedRangeSlider — Dual-thumb range slider with polished visuals.
 *
 * Visual features:
 * - Active zone between thumbs (colored), muted outside
 * - Animated thumbs with scale-on-drag (framer-motion whileDrag)
 * - Floating value badges during interaction
 * - Optional tick marks at configurable intervals
 * - Debounced numeric inputs synced with slider
 */
export function RangeSlider({
  min,
  max,
  step = 1,
  value,
  onValueChange,
  onValueCommit,
  disabled = false,
  labelPrefix,
  formatLabel,
  tooltipTitle,
  tooltipDescription,
  tooltipVisual,
  minInputId,
  maxInputId,
  isInputValid,
  maxInput = 1000000,
  ariaLabel,
  dotColor,
  tickInterval = 0,
  trackColor = "bg-primary",
}: RangeSliderProps) {
  const [localMin, setLocalMin] = useState(value[0])
  const [localMax, setLocalMax] = useState(value[1])
  const [isDragging, setIsDragging] = useState(false)
  const [isHovering, setIsHovering] = useState(false)

  useEffect(() => {
    setLocalMin(value[0])
    setLocalMax(value[1])
  }, [value])

  const handleSliderChange = useCallback((val: number[]) => {
    const clampedMin = Math.min(val[0], val[1])
    const clampedMax = Math.max(val[0], val[1])
    setLocalMin(clampedMin)
    setLocalMax(clampedMax)
  }, [])

  const handleSliderCommit = useCallback((val: number[]) => {
    const clampedMin = Math.min(val[0], val[1])
    const clampedMax = Math.max(val[0], val[1])
    const newValue: [number, number] = [clampedMin, clampedMax]
    onValueChange(newValue)
    onValueCommit(newValue)
    setIsDragging(false)
  }, [onValueChange, onValueCommit])

  const handleMinInputChange = useCallback((newVal: string) => {
    const parsed = parseInt(newVal) || min
    const clampedMin = Math.min(parsed, localMax)
    setLocalMin(clampedMin)
  }, [localMax, min])

  const handleMaxInputChange = useCallback((newVal: string) => {
    const parsed = parseInt(newVal) || max
    const clampedMax = Math.max(parsed, localMin)
    setLocalMax(clampedMax)
  }, [localMin, max])

  const handleMinInputBlur = useCallback(() => {
    const newValue: [number, number] = [localMin, localMax]
    onValueChange(newValue)
    onValueCommit(newValue)
  }, [onValueChange, onValueCommit, localMin, localMax])

  const handleMaxInputBlur = useCallback(() => {
    const newValue: [number, number] = [localMin, localMax]
    onValueChange(newValue)
    onValueCommit(newValue)
  }, [onValueChange, onValueCommit, localMin, localMax])

  const label = formatLabel
    ? `${labelPrefix}: ${formatLabel([localMin, localMax])}`
    : `${labelPrefix} (${localMin} - ${localMax})`

  const isMinActive = localMin !== min
  const isMaxActive = localMax !== max

  // Percentages for positioning badges
  const rangeSpan = max - min
  const minPct = rangeSpan > 0 ? ((localMin - min) / rangeSpan) * 100 : 0
  const maxPct = rangeSpan > 0 ? ((localMax - min) / rangeSpan) * 100 : 0

  // Build tick marks
  const ticks: number[] = []
  if (tickInterval > 0 && !disabled) {
    for (let v = min; v <= max; v += tickInterval) {
      ticks.push(v)
    }
  }

  const showBadges = (isDragging || isHovering) && !disabled

  return (
    <div className="space-y-2">
      <label htmlFor={minInputId} className="text-xs font-medium text-muted-foreground flex items-center gap-2">
        {dotColor && <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />}
        <InfoTooltip
          title={tooltipTitle}
          description={tooltipDescription}
          visual={tooltipVisual}
        >
          {label}
        </InfoTooltip>
      </label>
      <div className="flex items-center gap-2">
        <DebouncedInput
          id={minInputId}
          type="number"
          min={min}
          max={localMax}
          value={localMin.toString()}
          onChange={handleMinInputChange}
          debounceTime={500}
          onBlur={handleMinInputBlur}
          disabled={disabled}
          className={cn(
            "h-8 w-16 text-xs text-center bg-background/50",
            !isInputValid && "border-red-500 focus-visible:ring-red-500",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          aria-label={`${ariaLabel} minimum input`}
        />
        <SliderPrimitive.Root
          min={min}
          max={max}
          step={step}
          minStepsBetweenThumbs={1}
          value={[localMin, localMax]}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
          disabled={disabled}
          onPointerDown={() => setIsDragging(true)}
          className={cn(
            "relative flex w-full touch-none select-none items-center flex-1 py-2",
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
          )}
        >
          {/* Tick marks */}
          {ticks.length > 0 && (
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 pointer-events-none">
              {ticks.map(t => {
                const pct = ((t - min) / rangeSpan) * 100
                const isActive = t >= localMin && t <= localMax
                return (
                  <div
                    key={t}
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 w-0.5 rounded-full transition-colors duration-150",
                      isActive ? "h-3 bg-primary/60" : "h-2 bg-muted-foreground/25"
                    )}
                    style={{ left: `${pct}%` }}
                  />
                )
              })}
            </div>
          )}

          <SliderPrimitive.Track
            className="relative h-2 w-full grow overflow-visible rounded-full bg-secondary"
            onPointerEnter={() => setIsHovering(true)}
            onPointerLeave={() => setIsHovering(false)}
          >
            <SliderPrimitive.Range className={cn("absolute h-full rounded-full", trackColor)} />
          </SliderPrimitive.Track>

          {/* Min thumb */}
          <SliderPrimitive.Thumb asChild>
            <motion.span
              className={cn(
                "relative block h-5 w-5 rounded-full border-2 border-primary bg-background shadow-sm",
                "ring-offset-background transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:pointer-events-none disabled:opacity-50",
                !disabled && "hover:border-primary/80",
                isMinActive ? "bg-background" : "bg-primary/15"
              )}
              whileHover={disabled ? undefined : { scale: 1.15 }}
              whileDrag={disabled ? undefined : { scale: 1.25, boxShadow: "0 0 0 4px hsl(var(--primary) / 0.2)" }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              <AnimatePresence>
                {showBadges && (
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.9 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className={cn(
                      "absolute -top-8 left-1/2 -translate-x-1/2",
                      "px-2 py-0.5 rounded-md text-[11px] font-semibold font-mono whitespace-nowrap",
                      "bg-primary text-primary-foreground shadow-sm",
                      "pointer-events-none select-none"
                    )}
                  >
                    {localMin}
                    <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-2 h-2 rotate-45 bg-primary" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.span>
          </SliderPrimitive.Thumb>

          {/* Max thumb */}
          <SliderPrimitive.Thumb asChild>
            <motion.span
              className={cn(
                "relative block h-5 w-5 rounded-full border-2 border-primary bg-background shadow-sm",
                "ring-offset-background transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:pointer-events-none disabled:opacity-50",
                !disabled && "hover:border-primary/80",
                isMaxActive ? "bg-background" : "bg-primary/15"
              )}
              whileHover={disabled ? undefined : { scale: 1.15 }}
              whileDrag={disabled ? undefined : { scale: 1.25, boxShadow: "0 0 0 4px hsl(var(--primary) / 0.2)" }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              <AnimatePresence>
                {showBadges && (
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.9 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className={cn(
                      "absolute -top-8 left-1/2 -translate-x-1/2",
                      "px-2 py-0.5 rounded-md text-[11px] font-semibold font-mono whitespace-nowrap",
                      "bg-primary text-primary-foreground shadow-sm",
                      "pointer-events-none select-none"
                    )}
                  >
                    {localMax}
                    <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-2 h-2 rotate-45 bg-primary" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.span>
          </SliderPrimitive.Thumb>
        </SliderPrimitive.Root>
        <DebouncedInput
          id={maxInputId}
          type="number"
          min={localMin}
          max={maxInput}
          value={localMax.toString()}
          onChange={handleMaxInputChange}
          debounceTime={500}
          onBlur={handleMaxInputBlur}
          disabled={disabled}
          className={cn(
            "h-8 w-16 text-xs text-center bg-background/50",
            !isInputValid && "border-red-500 focus-visible:ring-red-500",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          aria-label={`${ariaLabel} maximum input`}
        />
      </div>
    </div>
  )
}
