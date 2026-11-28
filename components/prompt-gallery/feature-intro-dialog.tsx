"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { ArrowRight, Pause, Play, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { safeTrack } from "@/lib/analytics"
import { FEATURE_VIDEOS, chapterAt, chapterProgress, stepActions, tabAfterKey, type FeatureVideoId } from "@/lib/feature-intro-videos"
import { cn } from "@/lib/utils"
import { FEATURE_INTRO_RELEASE } from "@/components/prompt-gallery/feature-intro"

type CloseMethod = "close_button" | "x_button" | "escape" | "outside" | "try"

/** Text column enters in small steps; each block passes its own delay (none with reduced motion). */
const RISE = "animate-in fade-in slide-in-from-bottom-1.5 fill-mode-both duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none"
const delay = (step: number) => ({ animationDelay: `${80 + step * 50}ms` })

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"
function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}
const prefersReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches

const tabId = (id: FeatureVideoId) => `feature-intro-tab-${id}`
const PANEL_ID = "feature-intro-panel"

const videoById = (id: FeatureVideoId) => FEATURE_VIDEOS.find((v) => v.id === id)!

/**
 * The release's videos, one at a time: a numbered tab per feature above its description
 * and chapters. The tabs are steps: Next leads through them, and only the last one offers
 * the features' buttons, so opening one never skips the rest. Only the video on screen is
 * in the page, so the other one downloads nothing until its tab is chosen; with reduced
 * motion, nothing downloads until Play.
 */
export function FeatureIntroDialog({
  open,
  onOpenChange,
  onTry,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The feature button pressed on the last step, run once the dialog has closed. */
  onTry: (video: FeatureVideoId) => void
}) {
  const reduceMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLSpanElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const closeMethod = useRef<CloseMethod>("outside")
  // The feature whose button closed the dialog, opened once it has.
  const tryVideo = useRef<FeatureVideoId | null>(null)
  // Furthest chapter reached in each video, and the videos opened, for the close event.
  const furthest = useRef<Partial<Record<FeatureVideoId, number>>>({})
  const [viewed] = useState(() => new Set<FeatureVideoId>([FEATURE_VIDEOS[0].id]))
  const [active, setActive] = useState(0)
  const [chapter, setChapter] = useState(0)
  const [state, setState] = useState<"idle" | "playing" | "paused" | "ended">("idle")
  // After the first switch, a panel's text comes in without the opening's stagger delay.
  const [switched, setSwitched] = useState(false)
  const video = FEATURE_VIDEOS[active]
  const chapters = video.chapters
  const actions = stepActions(FEATURE_VIDEOS, active)

  // Follow the playhead: highlight the current chapter and fill its bar.
  const syncChapter = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    const index = chapterAt(chapters, el.currentTime)
    progressRef.current?.style.setProperty("--chapter-progress", String(chapterProgress(chapters, index, el.currentTime, el.duration)))
    furthest.current[video.id] = Math.max(furthest.current[video.id] ?? 0, index)
    setChapter(index)
  }, [chapters, video.id])

  // Every frame while playing, for a smooth bar (timeupdate alone ticks ~4×/s).
  useEffect(() => {
    if (state !== "playing") return
    let raf = 0
    const tick = () => {
      syncChapter()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [state, syncChapter])

  const seek = (index: number) => {
    const el = videoRef.current
    if (!el) return
    el.currentTime = chapters[index].at
    setChapter(index)
    el.play().catch(() => {})
  }

  const togglePlay = () => {
    const el = videoRef.current
    if (!el) return
    if (state === "playing") el.pause()
    else el.play().catch(() => {})
  }

  // Another video: the one on screen is swapped out (its element unmounts), the new one starts
  // from its poster and plays as the first one did.
  const select = (index: number) => {
    if (index === active) return
    videoRef.current?.pause()
    viewed.add(FEATURE_VIDEOS[index].id)
    setActive(index)
    setSwitched(true)
    setChapter(0)
    setState("idle")
  }

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = tabAfterKey(active, e.key, FEATURE_VIDEOS.length)
    if (next === null) return
    e.preventDefault()
    select(next)
    tabRefs.current[next]?.focus()
  }

  const close = (method: CloseMethod) => {
    closeMethod.current = method
    onOpenChange(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      videoRef.current?.pause()
      safeTrack("feature_intro_closed", {
        release: FEATURE_INTRO_RELEASE,
        method: closeMethod.current,
        video: video.id,
        chapters_seen: (furthest.current[video.id] ?? 0) + 1,
        videos_viewed: viewed.size,
      })
    }
    onOpenChange(next)
  }

  // On the last step, opens one of the features; `step` says which tab it was pressed on.
  const tryIt = (id: FeatureVideoId) => {
    safeTrack("feature_intro_try_clicked", { release: FEATURE_INTRO_RELEASE, video: id, step: active + 1 })
    tryVideo.current = id
    close("try")
  }

  // The next step, with focus on its tab: the button under the pointer becomes another
  // one, and the tab announces the new step to screen readers.
  const goNext = (id: FeatureVideoId) => {
    const index = FEATURE_VIDEOS.findIndex((v) => v.id === id)
    safeTrack("feature_intro_next_clicked", { release: FEATURE_INTRO_RELEASE, from: video.id, to: id, step: active + 1 })
    select(index)
    tabRefs.current[index]?.focus()
  }

  const playLabel = state === "playing" ? "Pause video" : state === "ended" ? "Replay video" : "Play video"

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={contentRef}
        showCloseButton={false}
        aria-describedby="feature-intro-description"
        // Focus the dialog itself: screen readers start at the title, and no
        // control shows a focus ring the user didn't ask for.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          contentRef.current?.focus({ preventScroll: true })
        }}
        onCloseAutoFocus={(e) => {
          // "Open Pack Mode" and "Set up ComfyUI" open their own screen, which takes focus.
          if (closeMethod.current === "try" && tryVideo.current) {
            e.preventDefault()
            onTry(tryVideo.current)
          }
        }}
        onEscapeKeyDown={() => {
          closeMethod.current = "escape"
        }}
        onPointerDownOutside={() => {
          closeMethod.current = "outside"
        }}
        className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-xl gap-0 overflow-y-auto overscroll-contain rounded-xl p-0 outline-none sm:rounded-xl lg:max-w-[59rem] lg:grid-cols-[minmax(0,1fr)_21rem] lg:overflow-hidden"
      >
        {/* Same color as the video's own background, so it blends with the frame. */}
        <div className="relative flex items-center bg-[oklch(0.27_0.022_250)] lg:rounded-l-xl">
          <video
            // A new element per video: the old one stops downloading, the new one shows its own poster.
            key={video.id}
            ref={videoRef}
            className="block aspect-[4/3] w-full"
            poster={video.poster}
            // Muted autoplay, unless the user asked for reduced motion: then
            // nothing downloads until they press Play on the poster.
            autoPlay={!reduceMotion}
            preload="none"
            muted
            playsInline
            disablePictureInPicture
            aria-label={video.videoLabel}
            onPlay={() => setState("playing")}
            onTimeUpdate={syncChapter}
            onPause={(e) => setState(e.currentTarget.ended ? "ended" : "paused")}
            onEnded={() => {
              furthest.current[video.id] = chapters.length - 1
              setState("ended")
            }}
          >
            <source src={`${video.src}.webm`} type="video/webm" />
            <source src={`${video.src}.mp4`} type="video/mp4" />
          </video>

          {state === "idle" ? (
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playLabel}
              className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-overlay/65 text-overlay-foreground shadow-sm transition-[background-color,scale] duration-150 ease-out hover:bg-overlay/80 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:active:scale-100"
            >
              <Play className="ml-0.5 h-6 w-6" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playLabel}
              className="touch-hit absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-overlay/65 text-overlay-foreground shadow-sm transition-[background-color,scale] duration-150 ease-out hover:bg-overlay/80 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:active:scale-100"
            >
              {state === "playing" ? (
                <Pause className="h-4 w-4" aria-hidden="true" />
              ) : state === "ended" ? (
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Play className="ml-0.5 h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        <div className="flex min-w-0 flex-col p-5 pb-0 sm:p-6 sm:pb-0 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:overscroll-contain lg:pb-6">
          <DialogTitle className={cn(RISE, "pr-10 text-lg text-balance")} style={delay(0)}>
            New in v{FEATURE_INTRO_RELEASE}
          </DialogTitle>

          {/* One numbered tab per feature, read as steps; the arrow keys move between them. */}
          <div
            role="tablist"
            aria-label="Features"
            className={cn(RISE, "mt-3 flex gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5")}
            style={delay(1)}
          >
            {FEATURE_VIDEOS.map((v, i) => {
              const selected = i === active
              return (
                <button
                  key={v.id}
                  ref={(el) => {
                    tabRefs.current[i] = el
                  }}
                  type="button"
                  role="tab"
                  id={tabId(v.id)}
                  aria-selected={selected}
                  aria-controls={PANEL_ID}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(i)}
                  onKeyDown={onTabKeyDown}
                  className={cn(
                    "flex h-8 min-w-0 flex-auto items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium pointer-coarse:h-11",
                    "transition-[color,background-color,box-shadow] duration-150 ease-out",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full text-[0.6875rem] leading-none tabular-nums transition-colors duration-150 ease-out",
                      selected ? "bg-primary text-primary-foreground" : "bg-muted-foreground/15 text-muted-foreground"
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="truncate">{v.label}</span>
                </button>
              )
            })}
          </div>

          <div
            // A new panel per video, so its text fades in with the switch.
            key={video.id}
            role="tabpanel"
            id={PANEL_ID}
            aria-labelledby={tabId(video.id)}
            className={cn(RISE, "flex flex-col")}
            style={switched ? undefined : delay(2)}
          >
            <DialogDescription id="feature-intro-description" className="mt-3 text-pretty">
              {video.description}
            </DialogDescription>

            <ol aria-label="Video chapters" className="-mx-2 mt-4 flex flex-col gap-0.5">
              {chapters.map((c, i) => {
                const current = i === chapter && state !== "idle"
                return (
                  <li key={c.title}>
                    <button
                      type="button"
                      onClick={() => seek(i)}
                      aria-current={current ? "step" : undefined}
                      className={cn(
                        "flex w-full gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        current && "bg-muted hover:bg-muted"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn("mt-px w-3 shrink-0 text-xs tabular-nums", current ? "text-primary-text" : "text-muted-foreground")}
                      >
                        {i + 1}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm font-medium leading-snug text-foreground">{c.title}</span>
                        <span className="text-xs leading-snug text-muted-foreground text-pretty">{c.body}</span>
                        {current && (
                          <span ref={progressRef} aria-hidden="true" className="mt-1.5 block h-0.5 overflow-hidden rounded-full bg-border">
                            <span className="block h-full origin-left scale-x-[var(--chapter-progress,0)] rounded-full bg-primary" />
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>

          {/* Pinned to the bottom while the dialog scrolls on short screens,
              so the actions stay in reach. With three buttons, the main one
              takes a row of its own where they don't fit side by side. */}
          <div
            style={delay(3)}
            className={cn(
              RISE,
              "sticky bottom-0 -mx-5 mt-auto gap-2 border-t border-border/60 bg-background px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 sm:-mx-6 sm:px-6 sm:pb-6 lg:static lg:mx-0 lg:border-0 lg:px-0 lg:pb-0 lg:pt-5",
              actions.kind === "try" && actions.others.length > 0
                ? "grid grid-cols-2 sm:flex sm:justify-end lg:grid"
                : "flex flex-col-reverse sm:flex-row sm:justify-end"
            )}
          >
            <Button type="button" variant="ghost" onClick={() => close("close_button")}>
              Close
            </Button>
            {actions.kind === "next" ? (
              <Button
                key="next"
                type="button"
                onClick={() => goNext(actions.next)}
                aria-label={`Next: ${videoById(actions.next).label}`}
              >
                Next
                <ArrowRight aria-hidden="true" />
              </Button>
            ) : (
              <>
                {actions.others.map((id) => (
                  <Button key={id} type="button" variant="outline" onClick={() => tryIt(id)}>
                    {videoById(id).action}
                  </Button>
                ))}
                <Button
                  key={actions.video}
                  type="button"
                  onClick={() => tryIt(actions.video)}
                  className={cn(actions.others.length > 0 && "order-first col-span-2 sm:order-none lg:order-first")}
                >
                  {videoById(actions.video).action}
                </Button>
              </>
            )}
          </div>
        </div>

        <DialogPrimitive.Close
          onClick={() => {
            closeMethod.current = "x_button"
          }}
          className="touch-hit absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-overlay/65 text-overlay-foreground transition-colors duration-150 ease-out hover:bg-overlay/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:bg-transparent lg:text-muted-foreground lg:hover:bg-muted lg:hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogContent>
    </Dialog>
  )
}
