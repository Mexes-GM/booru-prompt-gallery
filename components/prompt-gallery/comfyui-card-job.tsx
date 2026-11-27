"use client"

/**
 * A gallery card's ComfyUI job, drawn over the post image: the queue spot,
 * the steps and live preview while it runs, then the result with the post
 * as a thumbnail. Lives inside the card's image box and never changes its
 * size. Loaded only once a card has sent something.
 */
import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { AlertCircle, ExternalLink, Loader2, X } from "lucide-react"
import { useComfyJob } from "@/hooks/use-comfyui-job"
import { useLowMotion } from "@/hooks/use-low-motion"
import { getComfyUISettings } from "@/hooks/use-comfyui-settings"
import { announcement, errorLine, queueLabel, stepLabel, stepProgress } from "@/lib/comfyui/job-copy"
import { getComfySession, type ComfyJob } from "@/lib/comfyui/session"
import type { ApiWorkflow } from "@/lib/comfyui/types"
import { cn } from "@/lib/utils"

export interface ComfyCardJobProps {
  jobId: string
  api: ApiWorkflow
  /** The post image, for the thumbnail once the result is in. */
  originalSrc: string
  referrerPolicy?: React.HTMLAttributeReferrerPolicy
  /** Back to the plain card. */
  onDismiss: () => void
  /** Moves focus to the card's Send button when the focused control goes away. */
  returnFocus?: () => void
}

// The card's image box toggles the full prompt on click and Enter; controls
// in here must not.
const stop = (e: MouseEvent | KeyboardEvent) => {
  if (e.type === "click" || (e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") e.stopPropagation()
}

const CHIP = "flex items-center gap-1.5 rounded-full bg-overlay/75 text-overlay-foreground shadow-sm backdrop-blur-sm"
const ICON_BUTTON =
  "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-overlay-foreground/85 transition-colors hover:bg-overlay-foreground/15 hover:text-overlay-foreground focus-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5"

/** Queue spot or steps, with Cancel. Bottom center, above the card's corner chips. */
function ProgressChip({ job, lowMotion, onCancel }: { job: ComfyJob; lowMotion: boolean; onCancel: () => void }) {
  return (
    <div className={cn(CHIP, "pointer-events-auto absolute bottom-9 left-1/2 z-20 h-7 max-w-[calc(100%-1rem)] -translate-x-1/2 pl-2.5 pr-0.5 text-xs font-medium")}>
      {job.status === "running" && <Loader2 aria-hidden className={cn("h-3.5 w-3.5 shrink-0", !lowMotion && "motion-safe:animate-spin")} />}
      <span className="min-w-0 truncate tabular-nums">{job.status === "queued" ? queueLabel(job) : stepLabel(job)}</span>
      <button type="button" onClick={onCancel} aria-label="Cancel generation" title="Cancel" className={ICON_BUTTON}>
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function ProgressBar({ job, progress, lowMotion }: { job: ComfyJob; progress: number; lowMotion: boolean }) {
  return (
    <div
      role="progressbar"
      aria-label="Generation progress"
      aria-valuemin={0}
      aria-valuemax={job.totalSteps}
      aria-valuenow={job.step ?? 0}
      className="absolute inset-x-0 bottom-0 z-20 h-1 bg-overlay/40"
    >
      <div
        className={cn("h-full bg-primary", !lowMotion && "transition-[width] duration-200 ease-out")}
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  )
}

/**
 * Swap with the post, open full size, close. A narrow column, so it never
 * reaches the card's buttons in the other corner.
 */
function ResultControls({
  imageUrl,
  originalSrc,
  referrerPolicy,
  swapped,
  onSwap,
  onClose,
}: {
  imageUrl: string
  originalSrc: string
  referrerPolicy?: React.HTMLAttributeReferrerPolicy
  swapped: boolean
  onSwap: () => void
  onClose: () => void
}) {
  const swapLabel = swapped ? "Show the generated image" : "Show the original image"
  return (
    <div className="pointer-events-auto absolute left-2 top-2 z-20 flex flex-col items-center gap-0.5 rounded-lg bg-overlay/75 p-1 shadow-sm backdrop-blur-sm">
      <button
        type="button"
        onClick={onSwap}
        aria-label={swapLabel}
        aria-pressed={swapped}
        title={swapLabel}
        className="relative h-10 w-8 shrink-0 pointer-coarse:h-11 pointer-coarse:w-9 overflow-hidden rounded-md ring-1 ring-overlay-foreground/40 transition-shadow hover:ring-overlay-foreground/80 focus-ring"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- post thumbnail or local ComfyUI image */}
        <img
          src={swapped ? imageUrl : originalSrc}
          crossOrigin={swapped ? "anonymous" : undefined}
          referrerPolicy={swapped ? undefined : referrerPolicy}
          alt=""
          className="h-full w-full object-cover object-top"
        />
      </button>
      <a href={imageUrl} target="_blank" rel="noreferrer" aria-label="Open the generated image in a new tab" title="Open full size" className={ICON_BUTTON}>
        <ExternalLink aria-hidden className="h-3.5 w-3.5" />
      </a>
      <button type="button" onClick={onClose} aria-label="Close the generated image" title="Close" className={ICON_BUTTON}>
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function ErrorPanel({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="pointer-events-auto absolute inset-x-2 top-1/2 z-20 flex -translate-y-1/2 items-start gap-2 rounded-lg bg-overlay/85 p-2.5 text-overlay-foreground shadow-md backdrop-blur-sm">
      <AlertCircle aria-hidden className="mt-px h-4 w-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-semibold">Couldn&apos;t generate</span>
        <span className="line-clamp-3 break-words text-xs text-overlay-foreground/85" title={message}>
          {message}
        </span>
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss the error" title="Dismiss" className={cn(ICON_BUTTON, "-mr-1 -mt-1")}>
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function ComfyCardJobInner({ jobId, api, originalSrc, referrerPolicy, onDismiss, returnFocus }: ComfyCardJobProps) {
  const job = useComfyJob(jobId)
  const lowMotion = useLowMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const [swapped, setSwapped] = useState(false)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [spoken, setSpoken] = useState("")
  const [spokenFor, setSpokenFor] = useState<string | null>(null)

  const status = job?.status ?? null

  // Announce state changes, not steps.
  if (job && status !== spokenFor) {
    setSpokenFor(status)
    setSpoken(announcement(job))
  }

  // When the focused control goes away, focus moves to the card's Send button.
  const keepFocus = () => {
    const root = rootRef.current
    if (!root?.contains(document.activeElement)) return
    if (returnFocus) returnFocus()
    else root.parentElement?.focus()
  }

  const close = () => {
    keepFocus()
    getComfySession(getComfyUISettings().url).forget(jobId)
    onDismiss()
  }

  // Cancelled, or gone because the ComfyUI address changed: back to the post.
  useEffect(() => {
    if (status === null || status === "cancelled") close()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close reads the latest props
  }, [status])

  if (!job || status === "cancelled") return null

  const cancel = () => {
    keepFocus()
    void getComfySession(getComfyUISettings().url).cancel(jobId).catch(() => {})
  }

  const progress = stepProgress(job)
  const imageUrl = job.status === "done" ? job.imageUrl : undefined
  const bigSrc = imageUrl ? (swapped ? null : imageUrl) : job.status === "running" ? job.previewUrl : null

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0" onClick={stop} onKeyDown={stop}>
      {bigSrc && (
        // eslint-disable-next-line @next/next/no-img-element -- a local ComfyUI image (blob or loopback URL)
        <img
          src={bigSrc}
          // ComfyUI's /view only answers a request that carries an allowed Origin.
          crossOrigin={imageUrl ? "anonymous" : undefined}
          alt={imageUrl ? "Image generated in ComfyUI" : "Live preview from ComfyUI"}
          onLoad={() => setLoadedSrc(bigSrc)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover object-top",
            imageUrl && !lowMotion && "transition-opacity duration-300 ease-out",
            imageUrl && loadedSrc !== bigSrc && "opacity-0",
          )}
        />
      )}
      {job.status === "queued" && <div aria-hidden className="absolute inset-0 bg-overlay/25" />}
      {(job.status === "queued" || job.status === "running") && <ProgressChip job={job} lowMotion={lowMotion} onCancel={cancel} />}
      {progress !== null && <ProgressBar job={job} progress={progress} lowMotion={lowMotion} />}
      {imageUrl && (
        <ResultControls
          imageUrl={imageUrl}
          originalSrc={originalSrc}
          referrerPolicy={referrerPolicy}
          swapped={swapped}
          onSwap={() => setSwapped((v) => !v)}
          onClose={close}
        />
      )}
      {job.status === "error" && <ErrorPanel message={errorLine(job, api)} onDismiss={close} />}
      <span className="sr-only" role="status" aria-live="polite">
        {spoken}
      </span>
    </div>
  )
}

export const ComfyCardJob = memo(ComfyCardJobInner)
export default ComfyCardJob
