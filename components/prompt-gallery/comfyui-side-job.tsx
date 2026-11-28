"use client"

/**
 * One ComfyUI job as a picture box beside a Pack prompt. The box takes the
 * shape of the size the row sent before anything arrives, so the row doesn't
 * jump; the send, the queue spot, the steps and the live preview show inside
 * it, then the result, which opens full size in the app's viewer.
 *
 * Same job logic as the footers' one-line row (useInlineJob); only the layout
 * differs. Give it its width with `className`; the height follows the image.
 */
import { memo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { AlertCircle, Loader2, X } from "lucide-react"
import { errorLine, queueLabel, stepLabel, stepProgress } from "@/lib/comfyui/job-copy"
import { previewAspect } from "@/lib/comfyui/image-view"
import { cn } from "@/lib/utils"
import { ComfyImageViewer } from "./comfyui-image-viewer"
import { VIEWER_TEXT } from "./comfyui-image-viewer-text"
import { useInlineJob, type ComfyInlineJobProps } from "./comfyui-inline-job"
import { COMFY_EASE, developProps, iconProps, swapProps, useComfyMotion } from "./comfyui-motion"

export interface ComfySideJobProps extends ComfyInlineJobProps {
  /** The size the row sent, for the box's shape before the image is in. */
  width?: number | null
  height?: number | null
}

const CORNER_BUTTON =
  "relative grid size-6 place-items-center rounded-full bg-overlay/65 text-overlay-foreground backdrop-blur-sm " +
  "transition-colors duration-150 hover:bg-overlay/85 focus-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5"

function ComfySideJobInner({ jobId, api, launching, onDismiss, returnFocus, width, height, className }: ComfySideJobProps) {
  const { job, kind, spoken, rootRef, close, cancel, isPresent, empty } = useInlineJob({ jobId, launching, onDismiss, returnFocus })
  const m = useComfyMotion()
  const [viewing, setViewing] = useState(false)
  const [loaded, setLoaded] = useState<{ url: string; width: number; height: number } | null>(null)
  const imageRef = useRef<HTMLButtonElement>(null)

  if (empty) return null

  const imageUrl = kind === "done" ? job?.imageUrl : undefined
  const preview = kind === "running" ? job?.previewUrl : undefined
  const aspect = previewAspect({ width, height }, loaded && loaded.url === imageUrl ? loaded : null)
  const progress = job ? stepProgress(job) : null
  const swap = swapProps(m)
  const icon = iconProps(m)
  const onImage = !!preview

  const label =
    kind === "sending"
      ? "Sending"
      : kind === "queued" && job
        ? queueLabel(job)
        : kind === "running" && job
          ? stepLabel(job)
          : ""

  return (
    <div
      ref={rootRef}
      style={{ aspectRatio: aspect }}
      className={cn(
        "relative isolate overflow-hidden rounded-lg bg-muted/70 ring-1 ring-border/70",
        !isPresent && "pointer-events-none",
        className,
      )}
    >
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element -- a live preview frame from ComfyUI
        <img src={preview} alt="" className="absolute inset-0 -z-10 size-full object-cover object-top" />
      )}

      <AnimatePresence initial={false}>
        {imageUrl && (
          <motion.button
            key="image"
            ref={imageRef}
            type="button"
            onClick={() => setViewing(true)}
            aria-label={VIEWER_TEXT.open}
            title={VIEWER_TEXT.open}
            className="absolute inset-0 -z-10 cursor-zoom-in focus-ring rounded-lg"
            {...developProps(m, 0.6)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local ComfyUI image */}
            <img
              src={imageUrl}
              crossOrigin="anonymous"
              alt=""
              onLoad={(e) => setLoaded({ url: imageUrl, width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
              className="size-full object-cover object-top transition-[filter] duration-150 hover:brightness-105"
            />
          </motion.button>
        )}
      </AnimatePresence>

      {kind === "error" && job ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center" title={errorLine(job, api)}>
          <AlertCircle aria-hidden className="size-4 shrink-0 text-destructive-text" />
          <p className="line-clamp-4 text-[11px] leading-snug text-destructive-text [overflow-wrap:anywhere]">{errorLine(job, api)}</p>
        </div>
      ) : (
        kind !== "done" && (
          <div className={cn("flex h-full flex-col items-center gap-1.5 p-1.5 text-center", onImage ? "justify-end" : "justify-center")}>
            {kind === "sending" && <Loader2 aria-hidden className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />}
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={kind}
                className={cn(
                  "max-w-full text-[11px] leading-tight tabular-nums text-pretty",
                  onImage ? "rounded-full bg-overlay/70 px-2 py-0.5 text-overlay-foreground backdrop-blur-sm" : "text-muted-foreground",
                  kind === "running" && !onImage && "text-foreground",
                )}
                {...swap}
              >
                {label}
              </motion.span>
            </AnimatePresence>
            {kind === "running" && progress !== null && (
              <motion.div
                role="progressbar"
                aria-label="Generation progress"
                aria-valuemin={0}
                aria-valuemax={job?.totalSteps}
                aria-valuenow={job?.step ?? 0}
                className={cn("h-1 w-full max-w-16 shrink-0 overflow-hidden rounded-full", onImage ? "bg-overlay/50" : "bg-background")}
                initial={m.reduced ? { opacity: 0 } : { opacity: 0, transform: "scaleX(0.3)" }}
                animate={{ opacity: 1, transform: "scaleX(1)", transition: { duration: 0.28, ease: COMFY_EASE.out } }}
              >
                <div
                  className="h-full origin-left rounded-full bg-primary transition-transform duration-300 ease-out-strong motion-reduce:transition-none"
                  style={{ transform: `scaleX(${progress})` }}
                />
              </motion.div>
            )}
          </div>
        )
      )}

      <AnimatePresence initial={false} mode="popLayout">
        {kind !== "sending" && (
          <motion.span key={kind === "queued" || kind === "running" ? "cancel" : "close"} className="absolute right-1 top-1 grid place-items-center" {...icon}>
            {kind === "queued" || kind === "running" ? (
              <button type="button" onClick={cancel} aria-label="Cancel generation" title="Cancel" className={CORNER_BUTTON}>
                <X aria-hidden className="size-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={close}
                aria-label={kind === "error" ? "Dismiss the error" : "Close the generated image"}
                title={kind === "error" ? "Dismiss" : "Close"}
                className={CORNER_BUTTON}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            )}
          </motion.span>
        )}
      </AnimatePresence>

      <span className="sr-only" role="status" aria-live="polite">
        {spoken}
      </span>
      {job?.imageUrl && <ComfyImageViewer url={job.imageUrl} open={viewing} onOpenChange={setViewing} returnFocusRef={imageRef} />}
    </div>
  )
}

export const ComfySideJob = memo(ComfySideJobInner)

/**
 * Wraps a row's picture box so it develops in beside the prompt and leaves the
 * same way. `onExitComplete` tells the row when the box is gone, so the row
 * keeps its column until then.
 */
export function ComfySideJobPresence({
  show,
  onExitComplete,
  className,
  children,
}: {
  show: boolean
  onExitComplete?: () => void
  className?: string
  children: React.ReactNode
}) {
  const m = useComfyMotion()
  return (
    <AnimatePresence initial={false} onExitComplete={onExitComplete}>
      {show && (
        <motion.div
          key="comfy-side-job"
          className={className}
          initial={m.reduced ? { opacity: 0 } : { opacity: 0, transform: "scale(0.94)", filter: m.blur ? "blur(4px)" : "blur(0px)" }}
          animate={{
            opacity: 1,
            filter: "blur(0px)",
            ...(!m.reduced && { transform: "scale(1)" }),
            transition: m.reduced ? { duration: 0.12 } : { duration: 0.32, ease: COMFY_EASE.out },
          }}
          exit={
            m.reduced
              ? { opacity: 0, transition: { duration: 0.12 } }
              : { opacity: 0, transform: "scale(0.94)", transition: { duration: 0.2, ease: COMFY_EASE.exit } }
          }
          style={{ transformOrigin: "100% 0%" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
