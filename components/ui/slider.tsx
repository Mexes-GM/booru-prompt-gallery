"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

/**
 * Slider — a tactile "precision knob" control, deliberately distinct from the
 * stock shadcn/Radix circle-on-a-bar.
 *
 * The design language (shared with RangeSlider + SmoothFilterSlider so every
 * slider in the app feels like the same instrument):
 * - Track reads as a recessed groove: `bg-secondary` with a subtle inset
 *   shadow, thin at rest (h-1.5) and growing to h-2 on hover/focus/drag — a
 *   "breathing" cue instead of a flat static bar.
 * - Range fill is a directional violet gradient (primary/70 → primary), not a
 *   solid block, giving the filled portion depth and a sense of travel.
 * - Thumb is a domed knob (radial top-light gradient) with a violet aperture
 *   dot at its center — an intentional, on-theme control for an art tool, not
 *   a default form widget. A soft ambient halo makes it float above the groove.
 * - Real drag feedback: the knob scales up + the halo blooms while
 *   `data-dragging` is true (driven by onPointerDown/up, since Radix doesn't
 *   expose this as a data attribute itself).
 * - Custom ease-out curve (cubic-bezier(0.23,1,0.32,1)) — the built-in easings
 *   are too weak to feel intentional.
 * - Honors reduced-motion via the global media query in globals.css (all
 *   transition/animation durations are neutralized there).
 */
const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    /**
     * Keep the position transition alive while the pointer is down so the
     * thumb glides to the clicked/dragged position instead of teleporting.
     * Off by default (continuous sliders want zero-lag pointer tracking).
     * Turn ON for low-step/discrete sliders (e.g. the Score Floor's 4 tiers),
     * where snapping between a handful of stops should animate — including on
     * click and drag, not just arrow keys.
     */
    animateWhileDragging?: boolean
    /**
     * Overrides the thumb's center aperture-dot color (defaults to the brand
     * primary). Pass a bg-* utility so the knob's inner dot reflects the
     * current selection — e.g. the Score Floor's active tier color.
     */
    thumbAccentClassName?: string
    /**
     * Keep the track a constant height — disables the focus/drag "breathing"
     * growth. Use for controls where a fixed groove reads cleaner (e.g. the
     * Score Floor tier slider).
     */
    staticTrack?: boolean
  }
>(({ className, onPointerDown, animateWhileDragging = false, thumbAccentClassName, staticTrack = false, ...props }, ref) => {
  const [dragging, setDragging] = React.useState(false)

  React.useEffect(() => {
    if (!dragging) return
    const stop = () => setDragging(false)
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    return () => {
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
    }
  }, [dragging])

  return (
    <SliderPrimitive.Root
      ref={ref}
      data-dragging={dragging || undefined}
      onPointerDown={(e) => {
        setDragging(true)
        onPointerDown?.(e)
      }}
      className={cn(
        "group relative flex w-full touch-none select-none items-center",
        // Radix's own positioning wrapper (the span carrying the
        // --radix-slider-thumb-transform inline style) isn't reachable via
        // className on Thumb/asChild, so we target it here by that
        // Radix-authored style attribute. IMPORTANT: Radix moves the thumb via
        // the inset property (`left`/`right`, e.g. `left: calc(50% + 0px)`) —
        // the `transform` only holds a constant `translateX(-50%)` to center
        // it, so transitioning transform animates nothing. We transition the
        // inset instead, which is what makes stepped jumps (arrow keys,
        // snapping to a step on release) glide instead of teleport. Especially
        // visible on low-step sliders like the Score Floor (4 discrete stops).
        "[&_[style*=radix-slider-thumb-transform]]:transition-[left,right]",
        "[&_[style*=radix-slider-thumb-transform]]:duration-150",
        "[&_[style*=radix-slider-thumb-transform]]:ease-[cubic-bezier(0.23,1,0.32,1)]",
        // By default the transition is dropped during an active drag so the
        // thumb tracks the pointer with zero lag (right for continuous
        // sliders). But that also suppresses gliding on click/drag — the exact
        // gestures a user makes — because pointerdown sets data-dragging before
        // Radix moves the thumb. Discrete sliders opt in via animateWhileDragging
        // to keep the glide on every gesture (they only snap between a few
        // stops, so there's no pointer-tracking lag to worry about).
        !animateWhileDragging &&
          "data-[dragging]:[&_[style*=radix-slider-thumb-transform]]:transition-none",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        className={cn(
          "relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary",
          "shadow-[inset_0_1px_2px_hsl(var(--foreground)/0.09)]",
          !staticTrack && "transition-[height] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]",
          !staticTrack && "group-focus-within:h-2 group-data-[dragging]:h-2"
        )}
      >
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--primary)/0.7),hsl(var(--primary)))]" />
      </SliderPrimitive.Track>
      {/* Radix positions this thumb by writing the inset property
          (`left`/`right`, e.g. `left: calc(50% + 0px)`) on an
          absolutely-positioned span it renders around it — a wrapper we can't
          reach via className/asChild (asChild only swaps the inner
          role="slider" element, not this outer one). The `transform` on that
          wrapper is a constant `translateX(-50%)` (centering only), so the
          transition that makes stepped jumps (arrow keys, snapping to a step
          on release) glide instead of teleport must target the inset, scoped
          to this Root via the [&_...] arbitrary variant keyed off the
          Radix-authored --radix-slider-thumb-transform style. It's dropped
          during an active drag so the thumb still tracks the pointer with zero
          lag. */}
      <SliderPrimitive.Thumb
        aria-label={props["aria-label"]}
        aria-valuenow={props.value ? props.value[0] : props.defaultValue ? props.defaultValue[0] : undefined}
        aria-valuemin={props.min}
        aria-valuemax={props.max}
        className={cn(
          "relative grid h-5 w-5 place-items-center rounded-full border border-primary/50",
          "bg-[radial-gradient(circle_at_50%_30%,hsl(var(--background)),hsl(var(--secondary)))]",
          "shadow-[0_1px_3px_hsl(var(--foreground)/0.12),0_0_0_3px_hsl(var(--primary)/0.1)]",
          "transition-[transform,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
          "group-data-[dragging]:transition-none",
          "group-data-[dragging]:scale-125 group-data-[dragging]:shadow-[0_2px_8px_hsl(var(--foreground)/0.16),0_0_0_6px_hsl(var(--primary)/0.18)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50"
        )}
      >
        {/* Aperture dot — the on-theme signature detail. Scales with the knob
            on drag (transform on the parent scales children). Its color can be
            overridden (thumbAccentClassName) to mirror the current selection. */}
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full transition-colors duration-200",
            thumbAccentClassName || "bg-primary"
          )}
        />
      </SliderPrimitive.Thumb>
    </SliderPrimitive.Root>
  )
})
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
