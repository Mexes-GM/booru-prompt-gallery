"use client"

/**
 * One ComfyUI job in a single compact row, for footers: the send, the queue
 * spot, the steps, then a small thumbnail of the result that opens it full
 * size. The card's motion at footer size: the row comes out of the Send
 * button beside it, its line changes in place, the result develops in, and a
 * failed send goes back into the button.
 */
import { memo, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useIsPresent } from "framer-motion"
import { AlertCircle, X } from "lucide-react"
import { useComfyJob } from "@/hooks/use-comfyui-job"
import { getComfyUISettings } from "@/hooks/use-comfyui-settings"
import { announcement, errorLine, queueLabel, stepLabel, stepProgress } from "@/lib/comfyui/job-copy"
import { getComfySession, type ComfyJob } from "@/lib/comfyui/session"
import type { ApiWorkflow } from "@/lib/comfyui/types"
import { cn } from "@/lib/utils"
import { COMFY_EASE, developProps, iconProps, swapProps, useComfyMotion } from "./comfyui-motion"

export interface ComfyInlineJobProps {
  /** The job to show; null while the first send is still on its way. */
  jobId: string | null
  api: ApiWorkflow | null
  /** A send is on its way to ComfyUI. */
  launching: boolean
  onDismiss: () => void
  /** Moves focus to the Send button when the focused control goes away. */
  returnFocus?: () => void
  className?: string
}

const ICON_BUTTON =
  "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5"

function ComfyInlineJobInner({ jobId, api, launching, onDismiss, returnFocus, className }: ComfyInlineJobProps) {
  const live = useComfyJob(jobId)
  const m = useComfyMotion()
  const isPresent = useIsPresent()

  // The last snapshot, so the row can still draw it while it leaves.
  const [job, setJob] = useState<ComfyJob | null>(live)
  const [forId, setForId] = useState(jobId)
  if (jobId !== forId) {
    setForId(jobId)
    if (jobId) setJob(null)
  }
  if (live && live.status !== "cancelled" && live !== job && jobId === forId) setJob(live)

  const status = job?.status ?? null
  const liveStatus = live?.status ?? null

  // Announce state changes, not steps.
  const [spoken, setSpoken] = useState("")
  const [spokenFor, setSpokenFor] = useState<string | null>(null)
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
    if (jobId) getComfySession(getComfyUISettings().url).forget(jobId)
    onDismiss()
  }

  useEffect(() => {
    if (!isPresent || launching || !jobId) return
    if (liveStatus === null || liveStatus === "cancelled") close()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close reads the latest props
  }, [liveStatus, jobId, launching, isPresent])

  if (!job && !launching && isPresent) return null

  const cancel = () => {
    keepFocus()
    if (jobId) void getComfySession(getComfyUISettings().url).cancel(jobId).catch(() => {})
  }
  const progress = job ? stepProgress(job) : null
  const kind = launching || !job ? "sending" : job.status
  const swap = swapProps(m, "right")
  const icon = iconProps(m)
  const develop = developProps(m, 0.6)

  return (
    <div
      ref={rootRef}
      className={cn("flex min-w-0 items-center gap-2 text-xs text-muted-foreground", !isPresent && "pointer-events-none", className)}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {kind === "running" && progress !== null && (
          <motion.div
            key="bar"
            role="progressbar"
            aria-label="Generation progress"
            aria-valuemin={0}
            aria-valuemax={job?.totalSteps}
            aria-valuenow={job?.step ?? 0}
            className="h-1 w-12 shrink-0 origin-right overflow-hidden rounded-full bg-muted"
            initial={m.reduced ? { opacity: 0 } : { opacity: 0, transform: "scaleX(0.3)" }}
            animate={{ opacity: 1, transform: "scaleX(1)", transition: { duration: 0.28, ease: COMFY_EASE.out } }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          >
            <div
              className="h-full origin-left rounded-full bg-primary transition-transform duration-300 ease-out-strong motion-reduce:transition-none"
              style={{ transform: `scaleX(${progress})` }}
            />
          </motion.div>
        )}

        {kind === "done" && job?.imageUrl && (
          <motion.a
            key="thumb"
            href={job.imageUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open the generated image in a new tab"
            title="Open full size"
            className="block h-8 w-8 shrink-0 overflow-hidden rounded-md ring-1 ring-border transition-shadow hover:ring-foreground/40 focus-ring"
            {...develop}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local ComfyUI image */}
            <img src={job.imageUrl} crossOrigin="anonymous" alt="" className="h-full w-full object-cover object-top" />
          </motion.a>
        )}

        {kind === "error" && (
          <motion.span key="alert" className="grid shrink-0 place-items-center" {...icon}>
            <AlertCircle aria-hidden className="h-3.5 w-3.5 text-destructive-text" />
          </motion.span>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={kind}
          className={cn(
            "min-w-0 truncate whitespace-nowrap tabular-nums",
            (kind === "running" || kind === "done") && "text-foreground",
            kind === "error" && "text-destructive-text",
          )}
          title={kind === "error" && job ? errorLine(job, api) : undefined}
          {...swap}
        >
          {kind === "sending"
            ? "Sending"
            : kind === "queued" && job
              ? queueLabel(job)
              : kind === "running" && job
                ? stepLabel(job)
                : kind === "done"
                  ? "Done"
                  : job
                    ? errorLine(job, api)
                    : ""}
        </motion.span>
      </AnimatePresence>

      <AnimatePresence initial={false} mode="popLayout">
        {kind !== "sending" && (
          <motion.span key={kind === "queued" || kind === "running" ? "cancel" : "close"} className="grid shrink-0 place-items-center" {...icon}>
            {kind === "queued" || kind === "running" ? (
              <button type="button" onClick={cancel} aria-label="Cancel generation" title="Cancel" className={ICON_BUTTON}>
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={close}
                aria-label={kind === "error" ? "Dismiss the error" : "Close the generated image"}
                title={kind === "error" ? "Dismiss" : "Close"}
                className={ICON_BUTTON}
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            )}
          </motion.span>
        )}
      </AnimatePresence>

      <span className="sr-only" role="status" aria-live="polite">
        {spoken}
      </span>
    </div>
  )
}

export const ComfyInlineJob = memo(ComfyInlineJobInner)

/**
 * Wraps a footer's job row so it enters from the Send button beside it and,
 * after a failed send or a cancel, goes back into it.
 */
export function ComfyInlineJobPresence({ show, children }: { show: boolean; children: React.ReactNode }) {
  const m = useComfyMotion()
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="comfy-inline-job"
          className="mr-auto flex min-w-0"
          initial={m.reduced ? { opacity: 0 } : { opacity: 0, transform: "translateX(14px)", filter: m.blur ? "blur(3px)" : "blur(0px)" }}
          animate={{
            opacity: 1,
            filter: "blur(0px)",
            ...(!m.reduced && { transform: "translateX(0px)" }),
            transition: m.reduced ? { duration: 0.12 } : { duration: 0.32, ease: COMFY_EASE.out },
          }}
          exit={
            m.reduced
              ? { opacity: 0, transition: { duration: 0.12 } }
              : { opacity: 0, transform: "translateX(14px)", transition: { duration: 0.2, ease: COMFY_EASE.exit } }
          }
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
