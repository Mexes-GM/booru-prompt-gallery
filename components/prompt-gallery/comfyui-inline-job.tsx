"use client"

/**
 * One ComfyUI job in a single compact row, for footers: the queue spot, the
 * steps, then a small thumbnail of the result that opens it full size.
 */
import { memo, useEffect, useRef, useState } from "react"
import { AlertCircle, X } from "lucide-react"
import { useComfyJob } from "@/hooks/use-comfyui-job"
import { useLowMotion } from "@/hooks/use-low-motion"
import { getComfyUISettings } from "@/hooks/use-comfyui-settings"
import { announcement, errorLine, queueLabel, stepLabel, stepProgress } from "@/lib/comfyui/job-copy"
import { getComfySession } from "@/lib/comfyui/session"
import type { ApiWorkflow } from "@/lib/comfyui/types"
import { cn } from "@/lib/utils"

export interface ComfyInlineJobProps {
  jobId: string
  api: ApiWorkflow
  onDismiss: () => void
  /** Moves focus to the Send button when the focused control goes away. */
  returnFocus?: () => void
  className?: string
}

const ICON_BUTTON =
  "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5"

function ComfyInlineJobInner({ jobId, api, onDismiss, returnFocus, className }: ComfyInlineJobProps) {
  const job = useComfyJob(jobId)
  const lowMotion = useLowMotion()
  const [spoken, setSpoken] = useState("")
  const [spokenFor, setSpokenFor] = useState<string | null>(null)
  const status = job?.status ?? null

  // Announce state changes, not steps.
  if (job && status !== spokenFor) {
    setSpokenFor(status)
    setSpoken(announcement(job))
  }

  const rootRef = useRef<HTMLDivElement>(null)
  const keepFocus = () => {
    if (rootRef.current?.contains(document.activeElement)) returnFocus?.()
  }

  const close = () => {
    keepFocus()
    getComfySession(getComfyUISettings().url).forget(jobId)
    onDismiss()
  }

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

  return (
    <div ref={rootRef} className={cn("flex min-w-0 items-center gap-2 text-xs text-muted-foreground", className)}>
      {job.status === "queued" && <span className="whitespace-nowrap tabular-nums">{queueLabel(job)}</span>}

      {job.status === "running" && (
        <>
          {progress !== null && (
            <div
              role="progressbar"
              aria-label="Generation progress"
              aria-valuemin={0}
              aria-valuemax={job.totalSteps}
              aria-valuenow={job.step ?? 0}
              className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn("h-full rounded-full bg-primary", !lowMotion && "transition-[width] duration-200 ease-out")}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}
          <span className="whitespace-nowrap tabular-nums text-foreground">{stepLabel(job)}</span>
        </>
      )}

      {(job.status === "queued" || job.status === "running") && (
        <button type="button" onClick={cancel} aria-label="Cancel generation" title="Cancel" className={ICON_BUTTON}>
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      )}

      {job.status === "done" && job.imageUrl && (
        <>
          <a
            href={job.imageUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open the generated image in a new tab"
            title="Open full size"
            className="block h-8 w-8 shrink-0 overflow-hidden rounded-md ring-1 ring-border transition-shadow hover:ring-foreground/40 focus-ring"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local ComfyUI image */}
            <img src={job.imageUrl} crossOrigin="anonymous" alt="" className="h-full w-full object-cover object-top" />
          </a>
          <span className="whitespace-nowrap text-foreground">Done</span>
          <button type="button" onClick={close} aria-label="Close the generated image" title="Close" className={ICON_BUTTON}>
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        </>
      )}

      {job.status === "error" && (
        <>
          <AlertCircle aria-hidden className="h-3.5 w-3.5 shrink-0 text-destructive-text" />
          <span className="min-w-0 truncate text-destructive-text" title={errorLine(job, api)}>
            {errorLine(job, api)}
          </span>
          <button type="button" onClick={close} aria-label="Dismiss the error" title="Dismiss" className={ICON_BUTTON}>
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        </>
      )}

      <span className="sr-only" role="status" aria-live="polite">
        {spoken}
      </span>
    </div>
  )
}

export const ComfyInlineJob = memo(ComfyInlineJobInner)
