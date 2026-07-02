import { useReducedMotion } from "framer-motion"
import { useIsMobile } from "@/hooks/use-mobile"

/**
 * Returns `true` when animations should be minimized — either because the user
 * has requested reduced motion (accessibility) OR because they are on a mobile
 * device.
 *
 * Rationale: expensive effects (animating `backdrop-filter`, `repeat: Infinity`
 * loops, radial-gradient repaints) are handled fine by desktop GPUs but cause
 * jank and battery drain on mobile. Desktop animations are left untouched.
 *
 * Use this to gate costly motion: disable infinite loops, drop `backdrop-blur`
 * from animated surfaces, and simplify entrance animations to opacity-only.
 */
export function useLowMotion(): boolean {
  const prefersReducedMotion = useReducedMotion()
  const isMobile = useIsMobile()
  return !!prefersReducedMotion || isMobile
}
