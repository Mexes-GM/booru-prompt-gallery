"use client"

/**
 * A gallery card's ComfyUI job, drawn over the post image: the send itself,
 * the queue spot, the steps and live preview while it runs, then the result
 * with the post as a thumbnail. Lives inside the card's image box and never
 * changes its size. Loaded only once a card sends something.
 *
 * One surface from Send to result: a veil rises from the Send button over
 * the post and the queue chip comes up with it; the live preview develops out
 * of the veil; the result develops from the last preview, or, without one,
 * the post shrinks into its corner thumbnail and uncovers the result.
 */
import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from "react"
import { AnimatePresence, motion, usePresence, type Variants } from "framer-motion"
import { AlertCircle, ExternalLink, Loader2, X } from "lucide-react"
import { useComfyJob } from "@/hooks/use-comfyui-job"
import { getComfyUISettings } from "@/hooks/use-comfyui-settings"
import { announcement, errorLine, queueLabel, stepLabel, stepProgress } from "@/lib/comfyui/job-copy"
import { getComfySession, type ComfyJob } from "@/lib/comfyui/session"
import type { ApiWorkflow } from "@/lib/comfyui/types"
import { cn } from "@/lib/utils"
import { COMFY_EASE, developProps, iconProps, swapProps, useComfyMotion, type ComfyMotion } from "./comfyui-motion"

export interface ComfyCardJobProps {
  /** The job to show; null while the first send is still on its way. */
  jobId: string | null
  api: ApiWorkflow | null
  /** A send from this card is on its way to ComfyUI. */
  launching: boolean
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

const CHIP = "flex items-center gap-1.5 overflow-hidden bg-overlay/75 text-overlay-foreground shadow-sm backdrop-blur-sm"
const ICON_BUTTON =
  "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-overlay-foreground/85 transition-colors hover:bg-overlay-foreground/15 hover:text-overlay-foreground focus-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5"

const RISE = { duration: 0.5, ease: COMFY_EASE.rise }

/** "drop": back down into the Send button (failed send, cancel). "fade": the job moved on. */
type Leave = "drop" | "fade"

function veilVariants(m: ComfyMotion): Variants {
  if (m.reduced) return { hidden: { opacity: 0, transition: { duration: 0.12 } }, shown: { opacity: 1, transition: { duration: 0.12 } } }
  return {
    hidden: (leave: Leave) =>
      leave === "drop"
        ? { transform: "translateY(100%)", opacity: 1, transition: { duration: 0.32, ease: COMFY_EASE.inOut } }
        : { opacity: 0, transition: { duration: 0.45, ease: COMFY_EASE.out } },
    shown: { transform: "translateY(0%)", opacity: 1, transition: RISE },
  }
}

/** Starts below the card, where the Send button is. */
const VEIL_START = { transform: "translateY(100%)", opacity: 1 }

function chipVariants(m: ComfyMotion): Variants {
  if (m.reduced) return { hidden: { opacity: 0, transition: { duration: 0.12 } }, shown: { opacity: 1, transition: { duration: 0.12 } } }
  const blur = (px: number) => (m.blur ? `blur(${px}px)` : "blur(0px)")
  return {
    enter: { opacity: 0, transform: "translateY(26px) scale(1)", filter: blur(4) },
    shown: {
      opacity: 1,
      transform: "translateY(0px) scale(1)",
      filter: "blur(0px)",
      transition: { type: "spring", duration: 0.5, bounce: 0.12, delay: 0.09 },
    },
    hidden: (leave: Leave) =>
      leave === "drop"
        ? { opacity: 0, transform: "translateY(22px) scale(1)", filter: blur(3), transition: { duration: 0.22, ease: COMFY_EASE.exit } }
        : { opacity: 0, transform: "translateY(6px) scale(0.96)", transition: { duration: 0.18, ease: COMFY_EASE.exit } },
  }
}

/**
 * The bright edge on top of the rising veil. It runs a little past the top
 * and fades, so the prompt reads as leaving the card. One per send.
 */
function Glint({ onDone }: { onDone: () => void }) {
  return (
    <motion.div
      aria-hidden
      className="absolute inset-0"
      initial={{ transform: "translateY(100%)", opacity: 0 }}
      animate={{ transform: "translateY(-6%)", opacity: [0, 1, 1, 0] }}
      transition={{ transform: { duration: 0.56, ease: COMFY_EASE.rise }, opacity: { duration: 0.56, times: [0, 0.12, 0.62, 1], ease: "linear" } }}
      onAnimationComplete={onDone}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-overlay-foreground/70" />
      <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-primary/35 to-transparent" />
    </motion.div>
  )
}

function ChipContent({
  job,
  launching,
  m,
  onCancel,
}: {
  job: ComfyJob | null
  launching: boolean
  m: ComfyMotion
  onCancel: () => void
}) {
  const kind = launching || !job ? "sending" : job.status
  const label = kind === "sending" ? "Sending" : job?.status === "queued" ? queueLabel(job) : job ? stepLabel(job) : ""
  // The chip animates its width (layout), which moves its children with
  // transforms; so the children only fade and blur, and the icons scale
  // inside a wrapper.
  const swap = swapProps(m, "still")
  const icon = iconProps(m)
  const slot = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0.12 } } }
  return (
    <>
      <AnimatePresence initial={false} mode="popLayout">
        {kind === "running" && (
          <motion.span key="spin" layout="position" className="grid shrink-0 place-items-center" {...slot}>
            <motion.span className="grid place-items-center" initial={icon.initial} animate={icon.animate} transition={icon.transition}>
              <Loader2 aria-hidden className={cn("h-3.5 w-3.5", !m.reduced && "motion-safe:animate-spin")} />
            </motion.span>
          </motion.span>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={kind} layout="position" className="min-w-0 truncate whitespace-nowrap tabular-nums" {...swap}>
          {label}
        </motion.span>
      </AnimatePresence>
      <AnimatePresence initial={false} mode="popLayout">
        {kind !== "sending" && (
          <motion.span key="cancel" layout="position" className="grid shrink-0 place-items-center" {...slot}>
            <motion.span className="grid place-items-center" initial={icon.initial} animate={icon.animate} transition={icon.transition}>
              <button type="button" onClick={onCancel} aria-label="Cancel generation" title="Cancel" className={ICON_BUTTON}>
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            </motion.span>
          </motion.span>
        )}
      </AnimatePresence>
    </>
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
  thumbRef,
  thumbVisible,
  onSwap,
  onClose,
}: {
  imageUrl: string
  originalSrc: string
  referrerPolicy?: React.HTMLAttributeReferrerPolicy
  swapped: boolean
  thumbRef: RefObject<HTMLButtonElement | null>
  thumbVisible: boolean
  onSwap: () => void
  onClose: () => void
}) {
  const swapLabel = swapped ? "Show the generated image" : "Show the original image"
  return (
    <>
      <button
        ref={thumbRef}
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
          className={cn("h-full w-full object-cover object-top", !thumbVisible && "opacity-0")}
        />
      </button>
      <a href={imageUrl} target="_blank" rel="noreferrer" aria-label="Open the generated image in a new tab" title="Open full size" className={ICON_BUTTON}>
        <ExternalLink aria-hidden className="h-3.5 w-3.5" />
      </a>
      <button type="button" onClick={onClose} aria-label="Close the generated image" title="Close" className={ICON_BUTTON}>
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </>
  )
}

type Ghost = {
  transform: string
  clipPath: string
}

/**
 * Where the post has to go to sit exactly on the thumbnail: one uniform scale
 * that covers the thumbnail, then a clip to its box (top-aligned like the
 * thumbnail's object-top) with its rounded corners.
 */
function ghostTarget(root: DOMRect, thumb: DOMRect): Ghost {
  const W = root.width
  const H = root.height
  const scale = Math.max(thumb.width / W, thumb.height / H)
  const side = Math.max(0, (W - thumb.width / scale) / 2)
  const bottom = Math.max(0, H - thumb.height / scale)
  const x = thumb.left - root.left - side * scale
  const y = thumb.top - root.top
  return {
    transform: `translate(${x}px, ${y}px) scale(${scale})`,
    clipPath: `inset(0px ${side}px ${bottom}px ${side}px round ${6 / scale}px)`,
  }
}

const GHOST_START: Ghost = { transform: "translate(0px, 0px) scale(1)", clipPath: "inset(0px 0px 0px 0px round 0px)" }

function ComfyCardJobInner({ jobId, api, launching, originalSrc, referrerPolicy, onDismiss, returnFocus }: ComfyCardJobProps) {
  const live = useComfyJob(jobId)
  const m = useComfyMotion()
  // Leaving (failed send, cancel, close): every layer plays its own way out,
  // then the card lets go of this surface. A timer, not the animations, ends
  // it, so a page that isn't drawing can't leave the surface stuck.
  const [isPresent, safeToRemove] = usePresence()
  useEffect(() => {
    if (isPresent) return
    const t = setTimeout(safeToRemove, m.reduced ? 160 : 380)
    return () => clearTimeout(t)
  }, [isPresent, safeToRemove, m.reduced])
  const rootRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLButtonElement>(null)

  // Mounted by a send: play the way in. Mounted later (the card scrolled
  // back): show the current state as it is.
  const [animateMount] = useState(launching)

  // The last snapshot, kept so the card can still draw it while it leaves
  // after the job is canceled or forgotten.
  const [job, setJob] = useState<ComfyJob | null>(live)
  // Per-job state, reset when a new send replaces the job.
  const [forId, setForId] = useState(jobId)
  const [swapped, setSwapped] = useState(false)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const [ghostDone, setGhostDone] = useState(false)
  const [finalSettled, setFinalSettled] = useState(false)
  const [barSeen, setBarSeen] = useState(false)

  if (jobId !== forId) {
    setForId(jobId)
    if (jobId) {
      setJob(null)
      setSwapped(false)
      setPreviewSrc(null)
      setLoadedSrc(null)
      setGhost(null)
      setGhostDone(false)
      setFinalSettled(false)
      setBarSeen(false)
    }
  }
  if (live && live.status !== "cancelled" && live !== job && jobId === forId) setJob(live)

  // One glint per send; a failed send drops the veil back into the button.
  const [launchedFrom, setLaunchedFrom] = useState<{ id: string | null } | null>(launching ? { id: jobId } : null)
  const [failed, setFailed] = useState(false)
  const [glints, setGlints] = useState(launching && !m.reduced ? 1 : 0)
  const [glintsDone, setGlintsDone] = useState(0)
  if (launching && !launchedFrom) {
    setLaunchedFrom({ id: jobId })
    setFailed(false)
    if (!m.reduced) setGlints((n) => n + 1)
  }
  if (!launching && launchedFrom) {
    setLaunchedFrom(null)
    setFailed(launchedFrom.id === jobId)
  }

  const status = job?.status ?? null
  if (status === "running" && job?.previewUrl && job.previewUrl !== previewSrc) setPreviewSrc(job.previewUrl)

  const progress = job ? stepProgress(job) : null
  if (progress !== null && !barSeen) setBarSeen(true)

  // Announce state changes, not steps.
  const [spoken, setSpoken] = useState("")
  const [spokenFor, setSpokenFor] = useState<string | null>(null)
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
    if (jobId) getComfySession(getComfyUISettings().url).forget(jobId)
    onDismiss()
  }

  // Canceled, or gone because the ComfyUI address changed: back to the post.
  const liveStatus = live?.status ?? null
  useEffect(() => {
    if (!isPresent || launching || !jobId) return
    if (liveStatus === null || liveStatus === "cancelled") close()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close reads the latest props
  }, [liveStatus, jobId, launching, isPresent])

  const cancel = () => {
    keepFocus()
    if (jobId) void getComfySession(getComfyUISettings().url).cancel(jobId).catch(() => {})
  }

  const imageUrl = status === "done" ? job?.imageUrl : undefined
  const finalLoaded = !!imageUrl && loadedSrc === imageUrl
  // Without a preview to resolve from, the post shrinks into its thumbnail.
  const viaGhost = !!imageUrl && !previewSrc && !m.reduced
  const ghostFlying = viaGhost && finalLoaded && ghost !== null && !ghostDone
  const ghostOn = viaGhost && !ghostDone

  // The veil stays until there is something to show instead: the first
  // preview, or the loaded result.
  const waiting =
    isPresent &&
    (launching || status === "queued" || (status === "running" && !previewSrc) || (status === "done" && !previewSrc && !finalLoaded))
  const chipOn = isPresent && (launching || status === "queued" || status === "running")
  const barOn = isPresent && ((status === "running" && progress !== null) || (status === "done" && barSeen && !finalLoaded))
  // Kept under the result until it has fully resolved over it.
  const previewOn = !!previewSrc && (status === "running" || (status === "done" && !finalSettled))
  const controlsOn = isPresent && !!imageUrl && finalLoaded && (!viaGhost || ghost !== null || ghostDone)
  const leave: Leave = !isPresent || failed ? "drop" : "fade"

  const onFinalLoad = () => {
    if (!imageUrl) return
    if (viaGhost) {
      // Nothing to measure (shouldn't happen): skip the flight rather than cover the result.
      if (rootRef.current && thumbRef.current) {
        setGhost(ghostTarget(rootRef.current.getBoundingClientRect(), thumbRef.current.getBoundingClientRect()))
      } else {
        setGhostDone(true)
      }
    }
    setLoadedSrc(imageUrl)
  }

  const veil = veilVariants(m)
  const chip = chipVariants(m)
  const develop = developProps(m, 1)
  const resolve = developProps(m, 0.5)

  if (!job && !launching && isPresent) return null

  return (
    <div
      ref={rootRef}
      className={cn("absolute inset-0 overflow-hidden", isPresent ? "pointer-events-none" : "pointer-events-none [&_*]:pointer-events-none!")}
      onClick={stop}
      onKeyDown={stop}
    >
      {/* Live preview: develops out of the veil, then the result resolves from its last frame. */}
      <AnimatePresence>
        {previewOn && isPresent && (
          <motion.img
            key={`preview-${forId}`}
            src={previewSrc ?? undefined}
            alt="Live preview from ComfyUI"
            className="absolute inset-0 h-full w-full object-cover object-top"
            initial={develop.initial}
            animate={develop.animate}
            transition={develop.transition}
            // Only seen when the job is canceled mid-run: back to the post.
            exit={{ opacity: 0, transition: { duration: 0.3, ease: COMFY_EASE.out } }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {imageUrl && isPresent && (
          <motion.img
            key={`final-${forId}`}
            src={imageUrl}
            // ComfyUI's /view only answers a request that carries an allowed Origin.
            crossOrigin="anonymous"
            alt="Image generated in ComfyUI"
            onLoad={onFinalLoad}
            onError={onFinalLoad}
            onAnimationComplete={() => {
              if (finalLoaded && !swapped) setFinalSettled(true)
            }}
            className="absolute inset-0 h-full w-full object-cover object-top"
            initial={viaGhost ? { opacity: 0 } : resolve.initial}
            animate={
              !finalLoaded
                ? viaGhost
                  ? { opacity: 0 }
                  : resolve.initial
                : swapped
                  ? { opacity: 0, transition: { duration: 0.18, ease: COMFY_EASE.out } }
                  : viaGhost
                    ? { opacity: 1, transition: { duration: 0 } }
                    : { ...resolve.animate, transition: resolve.transition }
            }
            exit={{ opacity: 0, transition: { duration: 0.3, ease: COMFY_EASE.out } }}
          />
        )}
      </AnimatePresence>

      {/* The post itself, on its way into the corner thumbnail. */}
      {ghostOn && (
        <motion.img
          src={originalSrc}
          referrerPolicy={referrerPolicy}
          alt=""
          aria-hidden
          // Above the corner panel, so it lands on the thumbnail instead of behind it.
          className="absolute inset-0 z-30 h-full w-full object-cover object-top"
          style={{ transformOrigin: "0 0" }}
          initial={GHOST_START}
          animate={ghostFlying && ghost ? ghost : GHOST_START}
          transition={{ duration: 0.56, ease: COMFY_EASE.rise }}
          onAnimationComplete={(target) => {
            if (ghostFlying && (target as Partial<Ghost>).transform !== GHOST_START.transform) setGhostDone(true)
          }}
        />
      )}

      <AnimatePresence custom={leave} initial={animateMount}>
        {waiting && (
          <motion.div
            key="veil"
            aria-hidden
            custom={leave}
            variants={veil}
            initial={m.reduced ? "hidden" : VEIL_START}
            animate="shown"
            exit="hidden"
            className="absolute inset-0 bg-gradient-to-b from-overlay/15 via-overlay/25 to-overlay/45"
          />
        )}
      </AnimatePresence>

      {Array.from({ length: glints - glintsDone }, (_, i) => {
        const n = glintsDone + i + 1
        return <Glint key={n} onDone={() => setGlintsDone((d) => Math.max(d, n))} />
      })}

      <AnimatePresence>
        {barOn && (
          <motion.div
            key="bar"
            role="progressbar"
            aria-label="Generation progress"
            aria-valuemin={0}
            aria-valuemax={job?.totalSteps}
            aria-valuenow={job?.step ?? 0}
            className="absolute inset-x-0 bottom-0 z-20 h-1 origin-bottom bg-overlay/40"
            initial={m.reduced ? { opacity: 0 } : { transform: "scaleY(0)" }}
            animate={{ transform: "scaleY(1)", opacity: 1, transition: { duration: 0.25, ease: COMFY_EASE.out } }}
            exit={{ opacity: 0, transition: { duration: 0.3, delay: 0.1 } }}
          >
            <div
              className="h-full origin-left bg-primary transition-transform duration-300 ease-out-strong motion-reduce:transition-none"
              style={{ transform: `scaleX(${status === "done" ? 1 : (progress ?? 0)})` }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-none absolute inset-x-2 bottom-9 z-20 flex justify-center">
        <AnimatePresence custom={leave} initial={animateMount}>
          {chipOn && (
            <motion.div
              key="chip"
              custom={leave}
              variants={chip}
              initial={m.reduced ? "hidden" : "enter"}
              animate="shown"
              exit="hidden"
              className="pointer-events-auto flex max-w-full"
            >
              {/* Its own box, so the width can follow the label while the outer one rises. */}
              <motion.div
                layout={!m.reduced}
                transition={{ layout: { type: "spring", duration: 0.32, bounce: 0 } }}
                style={{ borderRadius: 14 }}
                className={cn(CHIP, "h-7 max-w-full pl-2.5 text-xs font-medium", launching || !job ? "pr-2.5" : "pr-0.5")}
              >
                <ChipContent job={job} launching={launching} m={m} onCancel={cancel} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {imageUrl && isPresent && (
          <motion.div
            key={`controls-${forId}`}
            className="pointer-events-auto absolute left-2 top-2 z-20 flex flex-col items-center gap-0.5 rounded-lg bg-overlay/75 p-1 shadow-sm backdrop-blur-sm"
            style={{ transformOrigin: "0 0" }}
            // Measured for the post's flight, so it must not be scaled then.
            initial={m.reduced || viaGhost ? { opacity: 0 } : { opacity: 0, transform: "translateY(-4px) scale(0.9)" }}
            animate={
              controlsOn
                ? { opacity: 1, ...(!m.reduced && !viaGhost && { transform: "translateY(0px) scale(1)" }), transition: viaGhost ? { duration: 0.3, delay: 0.22 } : { duration: 0.32, delay: 0.16, ease: COMFY_EASE.out } }
                : m.reduced || viaGhost
                  ? { opacity: 0 }
                  : { opacity: 0, transform: "translateY(-4px) scale(0.9)" }
            }
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            aria-hidden={!controlsOn || undefined}
            inert={!controlsOn || undefined}
          >
            <ResultControls
              imageUrl={imageUrl}
              originalSrc={originalSrc}
              referrerPolicy={referrerPolicy}
              swapped={swapped}
              thumbRef={thumbRef}
              thumbVisible={!viaGhost || ghostDone}
              onSwap={() => setSwapped((v) => !v)}
              onClose={close}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isPresent && status === "error" && job && (
          <motion.div
            key="error"
            className="pointer-events-auto absolute inset-x-2 top-1/2 z-20 -translate-y-1/2"
            initial={m.reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px) scale(0.98)" }}
            animate={{ opacity: 1, ...(!m.reduced && { transform: "translateY(0px) scale(1)" }), transition: m.reduced ? { duration: 0.12 } : { type: "spring", duration: 0.36, bounce: 0 } }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          >
            <ErrorPanel message={errorLine(job, api)} onDismiss={close} />
          </motion.div>
        )}
      </AnimatePresence>

      <span className="sr-only" role="status" aria-live="polite">
        {spoken}
      </span>
    </div>
  )
}

function ErrorPanel({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-overlay/85 p-2.5 text-overlay-foreground shadow-md backdrop-blur-sm">
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

export const ComfyCardJob = memo(ComfyCardJobInner)
export default ComfyCardJob
