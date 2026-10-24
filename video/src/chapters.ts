export const FPS = 30

/**
 * Chapter boundaries in frames. The dialog on the site
 * (components/prompt-gallery/feature-intro-dialog.tsx) seeks to these times
 * and highlights the chapter that is playing, so keep both in step.
 */
export const CHAPTERS = [
  { id: "format", title: "Pick a prompt format", from: 0 },
  { id: "copy-as", title: "Copy as another format", from: 225 },
  { id: "characters", title: "Each character described apart", from: 420 },
  { id: "length", title: "Short or full descriptions", from: 600 },
  { id: "ai", title: "Rewrite with AI", from: 780 },
] as const

export const DURATION = 915

/** Frame used for the poster image: the card already shows its FLUX.2 text. */
export const POSTER_FRAME = 200
