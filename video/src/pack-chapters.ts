export const FPS = 30

/**
 * Chapter boundaries in frames for the Pack Mode video. The dialog on the site
 * (components/prompt-gallery/feature-intro-dialog.tsx) seeks to these times,
 * highlights the chapter that is playing and lists `body` under each title,
 * so keep both in step (seconds = frames / 30).
 */
export const CHAPTERS = [
  {
    id: "who",
    title: "Start from a character",
    body: "Type a name in Who. With two or more, show them together or one per prompt. Add several and Random characters pick them for you.",
    from: 0,
  },
  {
    id: "ask",
    title: "Ask for what you want",
    body: "Add what they wear, what they do and where, each in its row. Any gives each prompt its own kind; Exactly uses that tag. Weights like (smile:1.2) work in any row.",
    from: 240,
  },
  {
    id: "scenes",
    title: "Scenes that fit",
    body: "The pack finds posts that match and lists them by number. Select one to leave it out, then press Generate.",
    from: 480,
  },
  {
    id: "fix",
    title: "Fix it from the results",
    body: "Select a tag to keep it in every prompt or out of all of them. Re-roll a prompt, or lock one so it stays.",
    from: 660,
  },
  {
    id: "copy",
    title: "Copy them all",
    body: "Pick a prompt format and copy every prompt at once, with its suggested size if you want it.",
    from: 870,
  },
] as const

export const DURATION = 1080

/** Frame used for the poster image: the pack with every row filled in (Wearing, Doing, Where, Also). */
export const POSTER_FRAME = 465
