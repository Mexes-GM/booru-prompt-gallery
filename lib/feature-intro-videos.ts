/**
 * The videos the "what's new" dialog (components/prompt-gallery/feature-intro-dialog.tsx)
 * presents for the release, in the order of its tabs, and the small rules it plays them by.
 *
 * Each chapter's `at` is where it starts, in seconds: keep it in step with the video's
 * chapter file in video/src (frames / 30). The chapter list doubles as the text version
 * of a video, which has no audio.
 */

export type FeatureVideoId = "pack" | "comfyui"

export interface FeatureChapter {
  at: number
  title: string
  body: string
}

export interface FeatureVideo {
  id: FeatureVideoId
  /** The tab, and the feature's name. */
  label: string
  /** Path without extension: the dialog offers `.webm` and `.mp4`. */
  src: string
  poster: string
  description: string
  /** The video's name for screen readers. */
  videoLabel: string
  /** The dialog's main button for this video. */
  action: string
  chapters: readonly FeatureChapter[]
}

/** Mirrors video/src/pack-chapters.ts. */
const PACK: FeatureVideo = {
  id: "pack",
  label: "Pack Mode",
  src: "/whats-new/10.9.0-pack-mode",
  poster: "/whats-new/10.9.0-pack-mode-poster.jpg",
  description:
    "Pack Mode now opens on a screen of its own. Say who you want, and what they wear, do and where, and the pack finds scenes that fit and writes a batch of prompts you can fix and copy at once.",
  videoLabel: "Demo of Pack Mode, described in the chapter list",
  action: "Open Pack Mode",
  chapters: [
    {
      at: 0,
      title: "Start from a character",
      body: "Type a name in Who. With two or more, show them together or one per prompt. Add several and Random characters pick them for you.",
    },
    {
      at: 8,
      title: "Ask for what you want",
      body: "Add what they wear, what they do and where, each in its row. Any gives each prompt its own kind; Exactly uses that tag. Weights like (smile:1.2) work in any row.",
    },
    {
      at: 16,
      title: "Scenes that fit",
      body: "The pack finds posts that match and lists them by number. Select one to leave it out, then press Generate.",
    },
    {
      at: 22,
      title: "Fix it from the results",
      body: "Select a tag to keep it in every prompt or out of all of them. Re-roll a prompt, or lock one so it stays.",
    },
    {
      at: 29,
      title: "Copy them all",
      body: "Pick a prompt format and copy every prompt at once, with its suggested size if you want it.",
    },
  ],
}

/** Mirrors video/src/send-to-comfy-chapters.ts. */
const COMFYUI: FeatureVideo = {
  id: "comfyui",
  label: "Send to ComfyUI",
  src: "/whats-new/10.9.0-send-to-comfyui",
  poster: "/whats-new/10.9.0-send-to-comfyui-poster.jpg",
  description:
    "Send a card's prompt straight to ComfyUI on your computer and watch the image generate on the card. It needs a free node for ComfyUI, and the setup guide shows how to add it.",
  videoLabel: "Demo of Send to ComfyUI, described in the chapter list",
  action: "Set up ComfyUI",
  chapters: [
    { at: 0, title: "Install the node", body: "In ComfyUI Manager, search for Booru Prompt Gallery and install it. Then restart ComfyUI." },
    {
      at: 6.5,
      title: "Add your workflow",
      body: "In ComfyUI, click Use in Booru Prompt Gallery next to Run. The workflow stays on your computer and shows up in the setup guide.",
    },
    { at: 14, title: "Turn on Send to ComfyUI", body: "It's in Customize prompt. Copy buttons on the cards become Send." },
    {
      at: 18,
      title: "Send from any card",
      body: "The card shows the queue, the steps and a live preview. The post moves to a corner thumbnail you can switch to.",
    },
    { at: 28, title: "Send as another format", body: "The ▾ menu next to Send sends the card once in another prompt format." },
  ],
}

/** In tab order: the first one is the one the dialog opens on. */
export const FEATURE_VIDEOS: readonly FeatureVideo[] = [PACK, COMFYUI]

/** The chapter playing at `seconds`: the last one that has started (the first before any has). */
export function chapterAt(chapters: readonly Pick<FeatureChapter, "at">[], seconds: number): number {
  let index = 0
  chapters.forEach((c, i) => {
    if (seconds >= c.at) index = i
  })
  return index
}

/** How far through chapter `index` the playhead is, 0 to 1; the last chapter ends with the video. */
export function chapterProgress(chapters: readonly Pick<FeatureChapter, "at">[], index: number, seconds: number, duration: number): number {
  const start = chapters[index].at
  const end = chapters[index + 1]?.at ?? (Number.isFinite(duration) && duration > start ? duration : start + 1)
  return Math.min(1, Math.max(0, (seconds - start) / (end - start)))
}

/** The tab a key moves to from `index` (arrows wrap, Home and End jump), or null for any other key. */
export function tabAfterKey(index: number, key: string, count: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count
    case "Home":
      return 0
    case "End":
      return count - 1
    default:
      return null
  }
}
