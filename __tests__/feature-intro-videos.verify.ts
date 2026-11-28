/**
 * Tests for the "what's new" dialog's videos (lib/feature-intro-videos.ts): the chapter
 * under the playhead, how far through it is, the tab keys, and that each video's chapter
 * list matches the video it describes (video/src/*-chapters.ts, seconds = frames / 30) and
 * its files are in public/.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/feature-intro-videos.verify.ts
 */
import { existsSync } from "node:fs"
import { join } from "node:path"

/* eslint-disable @typescript-eslint/no-require-imports */
const intro = require("../lib/feature-intro-videos") as typeof import("../lib/feature-intro-videos")
const packVideo = require("../video/src/pack-chapters") as {
  FPS: number
  DURATION: number
  CHAPTERS: readonly { title: string; body: string; from: number }[]
}
const comfyVideo = require("../video/src/send-to-comfy-chapters") as {
  FPS: number
  DURATION: number
  CHAPTERS: readonly { title: string; body: string; from: number }[]
}

let passed = 0
let failed = 0
function assert(condition: boolean, label: string) {
  if (condition) passed++
  else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

const { FEATURE_VIDEOS, chapterAt, chapterProgress, stepActions, tabAfterKey } = intro
const byId = (id: string) => FEATURE_VIDEOS.find((v) => v.id === id)!

// ── chapterAt ────────────────────────────────────────────────────────────────────
{
  const chapters = [{ at: 0 }, { at: 6.5 }, { at: 14 }]
  assert(chapterAt(chapters, 0) === 0, "chapterAt: the start is the first chapter")
  assert(chapterAt(chapters, 6.49) === 0, "chapterAt: just before a boundary stays in the chapter")
  assert(chapterAt(chapters, 6.5) === 1, "chapterAt: a boundary starts the next chapter")
  assert(chapterAt(chapters, 99) === 2, "chapterAt: past the end is the last chapter")
  assert(chapterAt(chapters, -1) === 0, "chapterAt: before the start is the first chapter")
}

// ── chapterProgress ──────────────────────────────────────────────────────────────
{
  const chapters = [{ at: 0 }, { at: 10 }]
  assert(chapterProgress(chapters, 0, 5, 30) === 0.5, "chapterProgress: halfway through a chapter")
  assert(chapterProgress(chapters, 1, 20, 30) === 0.5, "chapterProgress: the last chapter ends with the video")
  assert(chapterProgress(chapters, 1, 10.5, NaN) === 0.5, "chapterProgress: an unknown duration counts the last chapter as one second")
  assert(chapterProgress(chapters, 0, 12, 30) === 1, "chapterProgress: never past 1")
  assert(chapterProgress(chapters, 1, 9, 30) === 0, "chapterProgress: never below 0")
}

// ── tabAfterKey ──────────────────────────────────────────────────────────────────
{
  assert(tabAfterKey(0, "ArrowRight", 2) === 1, "tabs: Right moves to the next tab")
  assert(tabAfterKey(1, "ArrowRight", 2) === 0, "tabs: Right wraps to the first")
  assert(tabAfterKey(0, "ArrowLeft", 2) === 1, "tabs: Left wraps to the last")
  assert(tabAfterKey(1, "Home", 2) === 0, "tabs: Home goes to the first")
  assert(tabAfterKey(0, "End", 2) === 1, "tabs: End goes to the last")
  assert(tabAfterKey(0, "Enter", 2) === null, "tabs: other keys do nothing")
}

// ── stepActions ──────────────────────────────────────────────────────────────────
{
  const two = [{ id: "pack" }, { id: "comfyui" }] as const
  const first = stepActions(two, 0)
  assert(first.kind === "next" && first.next === "comfyui", "steps: the first of two offers Next to the second")
  assert(!("video" in first), "steps: the first of two has no feature button, so it can't close before the second")
  const last = stepActions(two, 1)
  assert(last.kind === "try" && last.video === "comfyui", "steps: the last opens its own feature")
  assert(last.kind === "try" && last.others.length === 1 && last.others[0] === "pack", "steps: the last also offers the earlier feature")

  const three = [{ id: "pack" }, { id: "comfyui" }, { id: "pack" }] as const
  const middle = stepActions(three, 1)
  assert(middle.kind === "next" && middle.next === "pack", "steps: a middle step offers Next, not its feature")
  const end = stepActions(three, 2)
  assert(end.kind === "try" && end.others.join() === "pack,comfyui", "steps: the last offers every earlier feature, in tab order")

  const one = stepActions([{ id: "comfyui" }], 0)
  assert(one.kind === "try" && one.video === "comfyui" && one.others.length === 0, "steps: a single video opens its feature, with nothing else")

  const real = stepActions(FEATURE_VIDEOS, 0)
  assert(real.kind === "next" && real.next === "comfyui", "steps: the dialog opens on Pack Mode with Next to Send to ComfyUI")
}

// ── The release's videos ─────────────────────────────────────────────────────────
{
  assert(FEATURE_VIDEOS[0]?.id === "pack", "videos: Pack Mode is the first tab")
  assert(FEATURE_VIDEOS[1]?.id === "comfyui", "videos: Send to ComfyUI is the second tab")
  assert(new Set(FEATURE_VIDEOS.map((v) => v.id)).size === FEATURE_VIDEOS.length, "videos: ids are unique")

  for (const v of FEATURE_VIDEOS) {
    const times = v.chapters.map((c) => c.at)
    assert(times[0] === 0, `${v.id}: the first chapter starts at 0`)
    assert(times.every((t, i) => i === 0 || t > times[i - 1]), `${v.id}: chapters start in order`)
    assert(new Set(v.chapters.map((c) => c.title)).size === v.chapters.length, `${v.id}: chapter titles are unique (they key the list)`)
    for (const file of [`${v.src}.webm`, `${v.src}.mp4`, v.poster]) {
      assert(existsSync(join(__dirname, "..", "public", file)), `${v.id}: public${file} exists`)
    }
  }

  // Pack Mode: the dialog's chapters are the video's, word for word.
  const pack = byId("pack")
  assert(pack.chapters.length === packVideo.CHAPTERS.length, "pack: as many chapters as the video")
  packVideo.CHAPTERS.forEach((c, i) => {
    assert(pack.chapters[i]?.at === c.from / packVideo.FPS, `pack: chapter ${i + 1} starts where the video's does`)
    assert(pack.chapters[i]?.title === c.title, `pack: chapter ${i + 1} has the video's title`)
    assert(pack.chapters[i]?.body === c.body, `pack: chapter ${i + 1} has the video's text`)
  })
  assert(pack.chapters.at(-1)!.at < packVideo.DURATION / packVideo.FPS, "pack: the last chapter starts before the video ends")

  // Send to ComfyUI: the same timings as its video.
  const comfy = byId("comfyui")
  assert(comfy.chapters.length === comfyVideo.CHAPTERS.length, "comfyui: as many chapters as the video")
  comfyVideo.CHAPTERS.forEach((c, i) => {
    assert(comfy.chapters[i]?.at === c.from / comfyVideo.FPS, `comfyui: chapter ${i + 1} starts where the video's does`)
  })
}

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
