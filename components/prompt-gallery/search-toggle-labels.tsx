"use client"

import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "framer-motion"
import { Shuffle } from "lucide-react"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------------ */
/* Shuffle: the word itself gets shuffled                                    */
/* ------------------------------------------------------------------------ */

const SCRAMBLE_FRAME_MS = 38
/** Frames each letter stays scrambled beyond the one before it settles. */
const SCRAMBLE_FRAMES_PER_LETTER = 1.6
const SCRAMBLE_LEAD_FRAMES = 3

interface ShuffleLabelProps {
  label?: string
  /** Bump to replay the shuffle (toggle on, or a reshuffle click). */
  playKey: number
  className?: string
}

/**
 * "Shuffle" label whose letters get dealt out of order: each position cycles
 * through random letters of the word itself (an anagram, not random glyphs),
 * hopping a pixel or two like riffled cards, and they settle left to right.
 * Every letter sits in a cell sized by its final glyph (the shown glyph is
 * absolutely positioned inside it), so the button's width never changes
 * mid-animation.
 */
export function ShuffleLabel({ label = "Shuffle", playKey, className }: ShuffleLabelProps) {
  const reduceMotion = useReducedMotion()
  const finalChars = Array.from(label)
  const [frame, setFrame] = useState<{ chars: string[]; lift: number[] } | null>(null)
  const iconRef = useRef<SVGSVGElement>(null)
  const firstRun = useRef(true)

  useEffect(() => {
    // Never animate on mount / rehydration — only on user actions.
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (reduceMotion) return

    iconRef.current?.animate(
      [{ transform: "rotateY(0deg) scale(1)" }, { transform: "rotateY(180deg) scale(1.15)" }, { transform: "rotateY(360deg) scale(1)" }],
      { duration: 460, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
    )

    const pool = finalChars.map((c) => c.toLowerCase())
    const totalFrames = SCRAMBLE_LEAD_FRAMES + Math.ceil(finalChars.length * SCRAMBLE_FRAMES_PER_LETTER)
    let i = 0
    const tick = () => {
      const settled = Math.max(0, Math.floor((i - SCRAMBLE_LEAD_FRAMES) / SCRAMBLE_FRAMES_PER_LETTER))
      const chars = finalChars.map((c, idx) => {
        if (idx < settled) return c
        const pick = pool[Math.floor(Math.random() * pool.length)]
        return idx === 0 ? pick.toUpperCase() : pick
      })
      const lift = finalChars.map((_, idx) => (idx < settled ? 0 : Math.round(Math.random() * 4 - 2)))
      setFrame({ chars, lift })
      i++
      if (i > totalFrames) {
        clearInterval(timer)
        setFrame(null)
      }
    }
    tick()
    const timer = setInterval(tick, SCRAMBLE_FRAME_MS)
    return () => clearInterval(timer)
    // finalChars derives from `label`; replay is driven by playKey only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, reduceMotion])

  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Shuffle ref={iconRef} aria-hidden="true" className="h-4 w-4 shrink-0" style={{ transformStyle: "preserve-3d" }} />
      {/* Screen readers get the plain word; the animated cells are decorative. */}
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="flex">
        {finalChars.map((c, idx) => {
          const shown = frame?.chars[idx] ?? c
          const scrambling = !!frame && shown !== c
          return (
            <span key={idx} style={{ position: "relative", display: "inline-block" }}>
              {/* Invisible final glyph alone sizes the cell; the shown glyph is
                  out of flow, so a wider stand-in letter can't resize it. */}
              <span style={{ visibility: "hidden" }}>{c}</span>
              <span
                style={{
                  position: "absolute",
                  left: "50%",
                  top: 0,
                  transform: `translate(-50%, ${frame?.lift[idx] ?? 0}px)`,
                  opacity: scrambling ? 0.7 : 1,
                }}
              >
                {shown}
              </span>
            </span>
          )
        })}
      </span>
    </span>
  )
}

/* ------------------------------------------------------------------------ */
/* NSFW: a redaction bar passes over the word                                */
/* ------------------------------------------------------------------------ */

const REDACT_MS = 380

interface CensorLabelProps {
  label?: string
  /** true = NSFW shown. */
  revealed: boolean
  className?: string
}

/**
 * "NSFW" label that is always plainly readable at rest — the animation only
 * happens during the change. Toggling slaps a redaction bar over the word
 * (grows from the left), swaps its color underneath while covered, then the
 * bar peels off to the right. Like a document being censored / declassified.
 */
export function CensorLabel({ label = "NSFW", revealed, className }: CensorLabelProps) {
  const reduceMotion = useReducedMotion()
  // Counts real toggles (not the initial value). Each one remounts the bar
  // with a fresh key, so the CSS animation restarts cleanly every time — even
  // on rapid clicks — with no timers or imperative animation handles to leak.
  const [prevRevealed, setPrevRevealed] = useState(revealed)
  const [runs, setRuns] = useState(0)
  if (revealed !== prevRevealed) {
    setPrevRevealed(revealed)
    setRuns((n) => n + 1)
  }
  const animate = runs > 0 && !reduceMotion

  return (
    <span
      className={cn("relative inline-block", revealed ? "text-primary-text" : "text-foreground", className)}
      // The color flips at the midpoint, while the bar covers the word.
      style={{ transition: animate ? `color 0s linear ${REDACT_MS / 2}ms` : "none" }}
    >
      {label}
      {animate && (
        <>
          <style>{REDACT_KEYFRAMES}</style>
          <span
            key={runs}
            aria-hidden="true"
            className="bg-foreground"
            style={{
              position: "absolute",
              left: -3,
              right: -3,
              top: "8%",
              bottom: "8%",
              borderRadius: 2,
              pointerEvents: "none",
              animation: `nsfw-redact ${REDACT_MS}ms cubic-bezier(0.65, 0, 0.35, 1) both`,
            }}
          />
        </>
      )}
    </span>
  )
}

const REDACT_KEYFRAMES = `@keyframes nsfw-redact {
  0% { transform: scaleX(0); transform-origin: left center; }
  45% { transform: scaleX(1); transform-origin: left center; }
  55% { transform: scaleX(1); transform-origin: right center; }
  100% { transform: scaleX(0); transform-origin: right center; }
}`
