"use client"

import { memo, useEffect, useState } from "react"
import { useReducedMotion } from "framer-motion"
import { cn } from "@/lib/utils"

// 16×22 sprite, one char per pixel ("." = transparent). A full-body chibi
// girl in the usual pixel-chibi proportions: oversized head, big low-set eyes
// with a shine pixel, blush beside them, heavy bangs, long hair framing a tiny
// sailor-uniform body. Rows 8–10 are the eyes — BLINK_ROWS swaps them for a
// closed-eye frame.
const SPRITE = [
  ".....oooooo.....",
  "...oohhhhhhoo...",
  "..ohhhhhhhhhho..",
  ".ohhHhhhhhhHhho.",
  ".ohhhhhhhhhhhho.",
  ".ohhhkhhhhkhhho.",
  "ohhhhhshhshhhhho",
  "ohhsssssssssshho",
  "ohhseesssseeshho",
  "ohhswgsssswgshho",
  "ohhbggssssggbhho",
  "ohhhsssssssshhho",
  "ohhhhooSSoohhhho",
  "ohhhoWWrrWWohhho",
  "ohhocWrrrrWcohho",
  "ohhscccrrcccshho",
  "ohhoCccccccCohho",
  "okhoCccccccCohko",
  ".oooCCCCCCCCooo.",
  "....olloollo....",
  "....offooffo....",
  "....ooo..ooo....",
]

// Closed-eye frame: the three eye rows collapse into a single lash line.
const BLINK_ROWS: Record<number, string> = {
  8: "ohhsssssssssshho",
  9: "ohhseesssseeshho",
  10: "ohhbssssssssbhho",
}

const PALETTE: Record<string, string> = {
  o: "#1b1722", // outline
  h: "#3b3550", // hair
  H: "#a9a3c4", // hair shine
  k: "#27222f", // hair strands
  s: "#fdebdd", // skin
  S: "#efc3ae", // skin shadow (neck)
  e: "#2a2838", // eyes (lashes / pupil)
  g: "#6d7391", // eyes (iris)
  w: "#ffffff", // eye shine
  b: "#f59aa3", // blush
  W: "#f3f3f8", // collar
  r: "#e2485f", // ribbon
  c: "#3a4674", // uniform
  C: "#56649a", // uniform light
  l: "#2b2838", // socks
  f: "#8a3346", // shoes
}

// Smoke puff the mascot vanishes into (see UpdateNotesTab's exit animation).
const PUFF = [
  "...oo.oo...",
  "..owwowwo..",
  ".owwwwwwwo.",
  "owwwwwwwwwo",
  ".owwwwwwwo.",
  "..oowwwoo..",
  "....ooo....",
]

const PUFF_PALETTE: Record<string, string> = {
  o: "#9ca3af",
  w: "#f3f4f6",
}

const WIDTH = SPRITE[0].length
const HEIGHT = SPRITE.length

// Merge horizontal runs of the same color into one <rect> each, so the sprite
// is ~80 rects instead of ~250.
function toRects(rows: string[], palette: Record<string, string> = PALETTE) {
  const rects: { x: number; y: number; w: number; fill: string }[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      let end = x + 1
      while (end < row.length && row[end] === ch) end++
      if (ch !== ".") rects.push({ x, y, w: end - x, fill: palette[ch] })
      x = end
    }
  })
  return rects
}

const OPEN_RECTS = toRects(SPRITE)
const BLINK_RECTS = toRects(SPRITE.map((row, y) => BLINK_ROWS[y] ?? row))
const PUFF_RECTS = toRects(PUFF, PUFF_PALETTE)

interface PixelMascotProps {
  /** Rendered pixels per sprite pixel. */
  scale?: number
  /** Idle bob + a blinking "!" — used while there are unseen update notes. */
  alert?: boolean
  className?: string
}

/**
 * Tiny pixel-art mascot. Blinks every few seconds; with `alert` she also bobs
 * and shows a "!" so she reads as "something new here". All motion is off
 * under prefers-reduced-motion.
 */
export const PixelMascot = memo(function PixelMascot({ scale = 2, alert = false, className }: PixelMascotProps) {
  const reduceMotion = useReducedMotion()
  const [blink, setBlink] = useState(false)

  useEffect(() => {
    if (reduceMotion) return
    let closeTimer: ReturnType<typeof setTimeout>
    let openTimer: ReturnType<typeof setTimeout>
    const schedule = () => {
      closeTimer = setTimeout(() => {
        setBlink(true)
        openTimer = setTimeout(() => {
          setBlink(false)
          schedule()
        }, 140)
      }, 2200 + Math.random() * 2800)
    }
    schedule()
    return () => {
      clearTimeout(closeTimer)
      clearTimeout(openTimer)
    }
  }, [reduceMotion])

  const rects = blink ? BLINK_RECTS : OPEN_RECTS

  return (
    <span className={cn("relative inline-block", className)} aria-hidden="true">
      <svg
        width={WIDTH * scale}
        height={HEIGHT * scale}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        shapeRendering="crispEdges"
        className={cn("block pixel-sticker", alert && "animate-mascot-bob")}
      >
        {rects.map((r) => (
          <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
        ))}
      </svg>
      {alert && (
        <svg
          width={3 * scale}
          height={7 * scale}
          viewBox="0 0 3 7"
          shapeRendering="crispEdges"
          className="absolute -right-3 -top-1 pixel-sticker animate-mascot-alert"
        >
          <rect x={0} y={0} width={3} height={4} fill="#2b1b36" />
          <rect x={1} y={0} width={1} height={3} fill="#ffd23f" />
          <rect x={0} y={5} width={3} height={2} fill="#2b1b36" />
          <rect x={1} y={5} width={1} height={1} fill="#ffd23f" />
        </svg>
      )}
    </span>
  )
})

/** Pixel smoke puff, same pixel grid as PixelMascot. */
export function PixelPuff({ scale = 2, className }: { scale?: number; className?: string }) {
  return (
    <svg
      width={PUFF[0].length * scale}
      height={PUFF.length * scale}
      viewBox={`0 0 ${PUFF[0].length} ${PUFF.length}`}
      shapeRendering="crispEdges"
      className={className}
      aria-hidden="true"
    >
      {PUFF_RECTS.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  )
}
