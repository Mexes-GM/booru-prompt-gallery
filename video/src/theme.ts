import { Easing, interpolate } from "remotion"
import { loadFont as loadGeist } from "@remotion/google-fonts/Geist"
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono"

const geist = loadGeist("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] })
const geistMono = loadGeistMono("normal", { weights: ["500"], subsets: ["latin"] })

export const FONT = geist.fontFamily
export const MONO = geistMono.fontFamily

/** Dark theme tokens, copied from app/globals.css (.dark). */
export const C = {
  background: "oklch(0.27 0.022 250)",
  foreground: "oklch(0.94 0.014 248)",
  card: "oklch(0.305 0.024 250)",
  popover: "oklch(0.305 0.024 250)",
  primary: "oklch(0.64 0.11 150)",
  primaryForeground: "oklch(0.2 0.02 250)",
  primaryText: "oklch(0.66 0.11 150)",
  secondary: "oklch(0.35 0.022 250)",
  muted: "oklch(0.37 0.022 250)",
  mutedForeground: "oklch(0.78 0.02 250)",
  accent: "oklch(0.37 0.022 250)",
  border: "oklch(0.4 0.024 250)",
  overlay: "oklch(0.18 0.02 265)",
  info: "oklch(0.71 0.16 246)",
  favorites: "oklch(0.72 0.13 5)",
  pack: "oklch(0.71 0.11 225)",
} as const

/**
 * The UI is drawn at 1.6× its real size: the video plays at roughly 560 px
 * wide in the dialog, so the controls come out close to their size on the site.
 */
export const S = 1.6
export const u = (px: number) => px * S

/** Same curve the site uses for UI motion. */
export const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1)

/** Eased, clamped interpolation between two frames. */
export function tween(frame: number, from: number, to: number, output: [number, number] = [0, 1]) {
  return interpolate(frame, [from, to], output, {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
}

/** 0 → 1 → 0: visible between `start` and `end`, fading over `fade` frames. */
export function visible(frame: number, start: number, end: number, fade = 8) {
  return Math.min(tween(frame, start, start + fade), 1 - tween(frame, end - fade, end))
}
