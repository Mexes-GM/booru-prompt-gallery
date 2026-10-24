"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Pause, Play, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { safeTrack } from "@/lib/analytics"
import { cn } from "@/lib/utils"
import { FEATURE_INTRO_POSTER, FEATURE_INTRO_RELEASE } from "@/components/prompt-gallery/feature-intro"

const VIDEO = "/whats-new/10.4.0-prompt-formats"

/**
 * What the video shows, chapter by chapter. `at` is where each chapter starts
 * (seconds); keep it in step with video/src/chapters.ts (frames / 30). The
 * list doubles as the text version of the video, which has no audio.
 */
const CHAPTERS = [
  { at: 0, title: "Pick a prompt format", body: "In Customize prompt. Every card switches to it at once." },
  { at: 7.5, title: "Copy as another format", body: "The ▾ next to Copy copies one prompt in any format, once." },
  { at: 14, title: "Each character described apart", body: "With two or more known characters, each gets their own hair, eyes and outfit." },
  { at: 20, title: "Short or full descriptions", body: "FLUX.2 and MOSS-Image stay short. Keep every detail gives the full text." },
  { at: 26, title: "Rewrite with AI", body: "The AI conversion is still in the card's ⋯ menu, under its new name." },
] as const

type CloseMethod = "close_button" | "x_button" | "escape" | "outside" | "try"

function chapterAt(seconds: number) {
  let index = 0
  CHAPTERS.forEach((c, i) => {
    if (seconds >= c.at) index = i
  })
  return index
}

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

export function FeatureIntroDialog({
  open,
  onOpenChange,
  onTry,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onTry: () => void
}) {
  const reduceMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLSpanElement>(null)
  const closeMethod = useRef<CloseMethod>("outside")
  const furthest = useRef(0)
  const [chapter, setChapter] = useState(0)
  const [state, setState] = useState<"idle" | "playing" | "paused" | "ended">("idle")

  // Follow the playhead: highlight the current chapter and fill its bar.
  const syncChapter = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const index = chapterAt(video.currentTime)
    const start = CHAPTERS[index].at
    const end = CHAPTERS[index + 1]?.at ?? (video.duration || start + 1)
    progressRef.current?.style.setProperty("--chapter-progress", String(Math.min(1, (video.currentTime - start) / (end - start))))
    furthest.current = Math.max(furthest.current, index)
    setChapter(index)
  }, [])

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
    const video = videoRef.current
    if (!video) return
    video.currentTime = CHAPTERS[index].at
    setChapter(index)
    video.play().catch(() => {})
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (state === "playing") video.pause()
    else video.play().catch(() => {})
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
        chapters_seen: furthest.current + 1,
      })
    }
    onOpenChange(next)
  }

  const tryIt = () => {
    safeTrack("feature_intro_try_clicked", { release: FEATURE_INTRO_RELEASE })
    close("try")
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
          // "Choose a format" moves focus to the setting instead.
          if (closeMethod.current === "try") {
            e.preventDefault()
            onTry()
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
            ref={videoRef}
            className="block aspect-[4/3] w-full"
            poster={FEATURE_INTRO_POSTER}
            // Muted autoplay, unless the user asked for reduced motion: then
            // nothing downloads until they press Play on the poster.
            autoPlay={!reduceMotion}
            preload="none"
            muted
            playsInline
            disablePictureInPicture
            aria-label="Demo of the prompt formats, described in the chapter list"
            onPlay={() => setState("playing")}
            onTimeUpdate={syncChapter}
            onPause={(e) => setState(e.currentTarget.ended ? "ended" : "paused")}
            onEnded={() => {
              furthest.current = CHAPTERS.length - 1
              setState("ended")
            }}
          >
            <source src={`${VIDEO}.webm`} type="video/webm" />
            <source src={`${VIDEO}.mp4`} type="video/mp4" />
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

        <div className="flex min-w-0 flex-col p-5 pb-0 sm:p-6 sm:pb-0 lg:pb-6">
          <p className={cn(RISE, "pr-10 text-xs font-medium text-primary-text")} style={delay(0)}>
            New in v{FEATURE_INTRO_RELEASE}
          </p>
          <DialogTitle className={cn(RISE, "mt-1.5 pr-10 text-lg text-balance")} style={delay(1)}>
            Prompts in plain English
          </DialogTitle>
          <DialogDescription id="feature-intro-description" className={cn(RISE, "mt-2 text-pretty")} style={delay(2)}>
            Each card can show its prompt as a description written for Anima, FLUX.2 · Krea 2 or MOSS-Image. It appears
            right away and needs no AI.
          </DialogDescription>

          <ol aria-label="Video chapters" className={cn(RISE, "-mx-2 mt-4 flex flex-col gap-0.5")} style={delay(3)}>
            {CHAPTERS.map((c, i) => {
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

          {/* Pinned to the bottom while the dialog scrolls on short screens,
              so both actions stay in reach. */}
          <div
            style={delay(4)}
            className={cn(
              RISE,
              "sticky bottom-0 -mx-5 mt-auto flex flex-col-reverse gap-2 border-t border-border/60 bg-background px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 sm:-mx-6 sm:flex-row sm:justify-end sm:px-6 sm:pb-6 lg:static lg:mx-0 lg:border-0 lg:px-0 lg:pb-0 lg:pt-5"
            )}
          >
            <Button type="button" variant="ghost" onClick={() => close("close_button")}>
              Close
            </Button>
            <Button type="button" onClick={tryIt}>
              Choose a format
            </Button>
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
