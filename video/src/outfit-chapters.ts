export const FPS = 30

/**
 * Chapter boundaries in frames for the Random outfit video. The dialog on the
 * site (components/prompt-gallery/feature-intro-dialog.tsx) seeks to these
 * times and highlights the chapter that is playing, so keep both in step.
 */
export const CHAPTERS = [
  { id: "outfit", title: "Dress her in a new outfit", from: 0 },
  { id: "styles", title: "Pick the styles and detail", from: 225 },
  { id: "written", title: "Written out in full", from: 450 },
  { id: "pack", title: "Outfits in Pack Mode", from: 690 },
] as const

export const DURATION = 870

/** Frame used for the poster image: the card already shows the new outfit, marked. */
export const POSTER_FRAME = 190
