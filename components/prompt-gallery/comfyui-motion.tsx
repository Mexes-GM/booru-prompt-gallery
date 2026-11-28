"use client"

/**
 * The motion every ComfyUI Send shares: the button's glyph leaves when the
 * prompt goes out, job labels swap in place, images develop instead of
 * popping. Cards and footers use the same curves at different sizes.
 *
 * Reduced motion keeps the same states as short fades. Low motion (phones)
 * keeps the movement and drops the blur filters.
 *
 * Movement is written as `transform` strings, not x/y/scale: Motion hands
 * those to the compositor, so the motion stays smooth while the gallery is
 * busy rendering.
 */
import { useState } from "react"
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion"
import { Send } from "lucide-react"
import { useLowMotion } from "@/hooks/use-low-motion"
import { EASE_DRAWER, EASE_IN_OUT_STRONG, EASE_OUT_STRONG } from "@/lib/motion"
import { cn } from "@/lib/utils"

/** Exits speed up as they leave. */
export const EASE_EXIT = [0.4, 0, 1, 1] as const

export interface ComfyMotion {
  /** prefers-reduced-motion: fades only. */
  reduced: boolean
  /** Blur filters are on (off with reduced or low motion). */
  blur: boolean
}

export function useComfyMotion(): ComfyMotion {
  const reduced = !!useReducedMotion()
  const lowMotion = useLowMotion()
  return { reduced, blur: !reduced && !lowMotion }
}

const FADE: Transition = { duration: 0.12, ease: "linear" }

const blurOf = (m: ComfyMotion, px: number) => (m.blur ? `blur(${px}px)` : "blur(0px)")

/**
 * A short status line that changes in place ("Sending" → "Next in queue" →
 * "Step 3 of 20"). Use inside <AnimatePresence mode="popLayout" initial={false}>,
 * keyed by the kind of line, not its numbers. "still" only blurs through,
 * for lines inside a box that animates its own size.
 */
export function swapProps(m: ComfyMotion, from: "right" | "still" = "still") {
  if (m.reduced) {
    return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: FADE }
  }
  const move = from === "right"
  return {
    initial: { opacity: 0, filter: blurOf(m, 3), ...(move && { transform: "translateX(8px)" }) },
    animate: { opacity: 1, filter: "blur(0px)", ...(move && { transform: "translateX(0px)" }) },
    exit: {
      opacity: 0,
      filter: blurOf(m, 3),
      ...(move && { transform: "translateX(-8px)" }),
      transition: { duration: 0.14, ease: EASE_EXIT },
    },
    transition: { duration: 0.24, ease: EASE_OUT_STRONG },
  }
}

/** A small icon arriving next to a label. */
export function iconProps(m: ComfyMotion) {
  if (m.reduced) return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: FADE }
  return {
    initial: { opacity: 0, transform: "scale(0.25)", filter: blurOf(m, 4) },
    animate: { opacity: 1, transform: "scale(1)", filter: "blur(0px)" },
    exit: { opacity: 0, transform: "scale(0.25)", filter: blurOf(m, 4) },
    transition: { type: "spring", duration: 0.3, bounce: 0 } as Transition,
  }
}

/**
 * An image that comes out of the surface under it: from soft and slightly
 * large to sharp. `strength` scales the blur and the zoom (1 for a card's
 * preview, less for a final image over its last preview).
 */
export function developProps(m: ComfyMotion, strength = 1) {
  if (m.reduced) return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15, ease: "linear" } as Transition }
  return {
    initial: { opacity: 0, transform: `scale(${1 + 0.04 * strength})`, filter: blurOf(m, 12 * strength) },
    animate: { opacity: 1, transform: "scale(1)", filter: "blur(0px)" },
    transition: { duration: 0.5 + 0.2 * strength, ease: EASE_OUT_STRONG },
  }
}

export const COMFY_EASE = { out: EASE_OUT_STRONG, inOut: EASE_IN_OUT_STRONG, rise: EASE_DRAWER, exit: EASE_EXIT }

/**
 * The paper plane on a Send button. When a send starts it flies off toward
 * the top right and a new one slides back in from the bottom left, so the
 * button says "sent" without turning into a spinner. Its box never changes
 * size, so the label doesn't move.
 */
export function SendGlyph({ sending, className }: { sending: boolean; className?: string }) {
  const m = useComfyMotion()
  const [flights, setFlights] = useState(0)
  const [wasSending, setWasSending] = useState(sending)
  if (sending !== wasSending) {
    setWasSending(sending)
    if (sending && !m.reduced) setFlights((n) => n + 1)
  }
  return (
    <span aria-hidden className={cn("relative inline-grid shrink-0 place-items-center", className)}>
      <AnimatePresence initial={false}>
        <motion.span
          key={flights}
          className="col-start-1 row-start-1 grid place-items-center"
          initial={{ opacity: 0, transform: "translate(-7px, 7px) scale(0.6)" }}
          animate={{ opacity: 1, transform: "translate(0px, 0px) scale(1)", transition: { type: "spring", duration: 0.34, bounce: 0, delay: 0.28 } }}
          exit={{ opacity: 0, transform: "translate(10px, -10px) scale(0.7)", transition: { duration: 0.22, ease: EASE_EXIT } }}
        >
          <Send className="h-full w-full" />
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
