/**
 * Shared by the two things that open on their own: the welcome tour
 * (components/prompt-gallery/main-tour.tsx) and the release dialog
 * (components/prompt-gallery/feature-intro.tsx). The tour runs on the first
 * visit; the dialog waits for a later one.
 */

/** Set once the welcome tour has started (it never auto-starts again). */
export const MAIN_TOUR_STORAGE_KEY = "booru_main_tour_done"

/** A dialog, menu, popover, list or tour is on screen. */
export function isOverlayOpen(): boolean {
  return !!document.querySelector(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-expanded="true"], .react-joyride__overlay'
  )
}

/** Dev-only `/?feature-intro`: shows the release dialog right away and nothing else. */
export function isFeatureIntroPreview(): boolean {
  return process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).has("feature-intro")
}
