export const FPS = 30

/**
 * Chapter boundaries in frames for the Send to ComfyUI video. The dialog on
 * the site (components/prompt-gallery/feature-intro-dialog.tsx) seeks to these
 * times, highlights the chapter that is playing and lists `body` under each
 * title, so keep both in step (seconds = frames / 30).
 */
export const CHAPTERS = [
  {
    id: "install",
    title: "Install the node",
    body: "In ComfyUI Manager, search for Booru Prompt Gallery and install it. Then restart ComfyUI.",
    from: 0,
  },
  {
    id: "publish",
    title: "Add your workflow",
    body: "In ComfyUI, click Use in Booru Prompt Gallery next to Run. The workflow stays on your computer and shows up in the setup guide.",
    from: 195,
  },
  {
    id: "turn-on",
    title: "Turn on Send to ComfyUI",
    body: "It's in Customize prompt. Copy buttons on the cards become Send.",
    from: 420,
  },
  {
    id: "send",
    title: "Send from any card",
    body: "The card shows the queue, the steps and a live preview. The post moves to a corner thumbnail you can switch to.",
    from: 540,
  },
  {
    id: "send-as",
    title: "Send as another format",
    body: "The ▾ menu next to Send sends the card once in another prompt format.",
    from: 840,
  },
] as const

export const DURATION = 1080

/** Frame used for the poster image: the live preview half developed, the chip counting steps. */
export const POSTER_FRAME = 700
