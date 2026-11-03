/** Loads the Joyride half of the welcome tour (see MainTour). */
export const loadMainTourJoyride = () => import("@/components/prompt-gallery/main-tour-joyride")

/** Starts downloading the tour's code ahead of a replay (e.g. when its menu opens). */
export function preloadMainTour() {
  void loadMainTourJoyride()
}
