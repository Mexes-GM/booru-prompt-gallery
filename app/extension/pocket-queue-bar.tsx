"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, Crosshair, Download, Loader2, MousePointerClick, Pause, Play, RotateCcw, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { SiteTargetStatusBadge } from "@/components/prompt-gallery/target-setup-wizard"
import { useToast } from "@/hooks/use-toast"
import { useLowMotion } from "@/hooks/use-low-motion"
import { sendQueueAction, useHostMessage } from "./pocket-bridge"

export interface BatchTally {
  total: number
  queued: number
  injected: number
  submitted: number
  completed: number
  rejected: number
  unconfirmed: number
  failed: number
  stalled: number
}

interface QueueStatus {
  length: number
  isProcessing: boolean
  isWaitingForSlot: boolean
  isPausedForVisibility: boolean
  isPausedForError: boolean
  isPausedManually: boolean
  activeTasks: number
  limit: number
  platform: string
  batchTally?: BatchTally
}

const INITIAL_STATUS: QueueStatus = {
  length: 0,
  isProcessing: false,
  isWaitingForSlot: false,
  isPausedForVisibility: false,
  isPausedForError: false,
  isPausedManually: false,
  activeTasks: 0,
  limit: 5,
  platform: "Unknown",
}

type Tone = "muted" | "destructive" | "warning" | "info" | "success"

const DOT_CLASS: Record<Tone, string> = {
  muted: "bg-muted-foreground/60",
  destructive: "bg-destructive",
  warning: "bg-warning",
  info: "bg-info",
  success: "bg-success",
}

function describeStatus(s: QueueStatus): { label: string; tone: Tone; busy: boolean } {
  if (s.isPausedManually) return { label: "Paused", tone: "muted", busy: false }
  if (s.isPausedForError) return { label: "Paused · error", tone: "destructive", busy: false }
  if (s.isPausedForVisibility) return { label: "Paused · tab hidden", tone: "destructive", busy: false }
  if (s.isWaitingForSlot) {
    return { label: `Waiting ${s.limit ? `${s.activeTasks}/${s.limit}` : `${s.activeTasks} active`}`, tone: "warning", busy: true }
  }
  if (s.isProcessing) return { label: "Generating", tone: "info", busy: true }
  if (s.length > 0) return { label: "Queued", tone: "warning", busy: true }
  return { label: "Ready", tone: "success", busy: false }
}

interface PocketQueueBarProps {
  /** "idle" | "arming" | "waiting" | "selected" | "none" | "error" | "cancelled" */
  targetState: string
  onTarget: () => void
  onOpenWizard: () => void
}

/**
 * Floating queue bar. Owns the high-frequency QUEUE_STATUS state from the
 * sidepanel host on its own so a running batch only re-renders this bar — not
 * the whole Pocket and its card grid.
 */
export function PocketQueueBar({ targetState, onTarget, onOpenWizard }: PocketQueueBarProps) {
  const { toast } = useToast()
  const lowMotion = useLowMotion()
  const [status, setStatus] = useState<QueueStatus>(INITIAL_STATUS)
  const [isRequeuing, setIsRequeuing] = useState(false)
  const requeueTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (requeueTimeoutRef.current) clearTimeout(requeueTimeoutRef.current)
  }, [])

  useHostMessage<Record<string, unknown>>("QUEUE_STATUS", (d) => {
    setStatus({
      length: (d.queueLength as number) ?? 0,
      isProcessing: (d.isProcessing as boolean) ?? false,
      isWaitingForSlot: (d.isWaitingForSlot as boolean) ?? false,
      isPausedForVisibility: (d.isPausedForVisibility as boolean) ?? false,
      isPausedForError: (d.isPausedForError as boolean) ?? false,
      isPausedManually: (d.isPausedManually as boolean) ?? false,
      activeTasks: (d.currentActiveTasks as number) ?? 0,
      limit: (d.seaArtLimit as number) ?? 5,
      platform: (d.platform as string) ?? "Unknown",
      batchTally: (d.batchTally as BatchTally | undefined) ?? undefined,
    })
  })

  // Response to QUEUE_ACTION "export_job_ledger": download the per-prompt
  // state history as JSON and toast a quick human-readable summary.
  useHostMessage<{ jobs?: unknown[]; tally?: BatchTally }>("JOB_LEDGER_EXPORT", (d) => {
    const jobs = Array.isArray(d.jobs) ? d.jobs : []
    try {
      const blob = new Blob([JSON.stringify(jobs, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `booru-batch-report-${Date.now()}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (err) {
      console.error("Failed to export job ledger:", err)
    }
    const t = d.tally
    toast({
      title: "Batch report exported",
      description: t
        ? `${t.completed} completed · ${t.failed} failed · ${t.rejected} rejected · ${t.stalled} stalled · ${t.unconfirmed} retrying`
        : "Downloaded the batch report JSON.",
    })
  })

  useHostMessage<{ count?: number }>("REQUEUE_LOST_ACK", (d) => {
    if (requeueTimeoutRef.current) {
      clearTimeout(requeueTimeoutRef.current)
      requeueTimeoutRef.current = null
    }
    setIsRequeuing(false)
    const count = typeof d.count === "number" ? d.count : 0
    toast(count > 0
      ? { title: "Retrying lost prompts", description: `${count} prompt${count === 1 ? "" : "s"} sent back to the generation queue.` }
      : { title: "Nothing to retry", description: "No failed or stalled prompts were found." })
  })

  const requeueLost = () => {
    if (isRequeuing) return
    setIsRequeuing(true)
    sendQueueAction({ action: "requeue_lost_jobs" })
    if (requeueTimeoutRef.current) clearTimeout(requeueTimeoutRef.current)
    // No ACK means the sidepanel script predates this action (the extension
    // wasn't reloaded after an update).
    requeueTimeoutRef.current = setTimeout(() => {
      setIsRequeuing(false)
      requeueTimeoutRef.current = null
      toast({
        variant: "destructive",
        title: "Extension needs a reload",
        description: "The sidebar script is out of date. Reload the extension from your browser's extensions page, then try again.",
        duration: 8000,
      })
    }, 1500)
  }

  const dismissReport = () => {
    setStatus((prev) => ({ ...prev, batchTally: undefined }))
    sendQueueAction({ action: "clear_batch_report" })
  }

  const { label, tone, busy } = describeStatus(status)
  const isTargeting = targetState === "arming" || targetState === "waiting"
  const tally = status.batchTally
  const lostCount = tally ? tally.failed + tally.rejected + tally.stalled : 0
  const showReport = status.length === 0 && !status.isProcessing && lostCount > 0

  return (
    <div className="fixed bottom-3 inset-x-3 flex flex-col items-center gap-1.5 z-50 pointer-events-none">
      {/* Target pill + per-site config status */}
      <div className="flex items-center gap-1.5 pointer-events-auto">
        <AnimatePresence initial={false}>
          {status.platform !== "Unknown" && (
            <motion.div
              initial={lowMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={lowMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
              className="bg-secondary/90 border border-border backdrop-blur-md px-2.5 py-0.5 rounded-full text-[11px] font-medium text-secondary-foreground shadow-sm"
            >
              Target: <span className="font-semibold">{status.platform}</span>
            </motion.div>
          )}
        </AnimatePresence>
        <SiteTargetStatusBadge onOpenWizard={onOpenWizard} />
      </div>

      <Card className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl border-border bg-background/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {/* Status */}
        <div className="flex items-center gap-1.5 shrink-0" role="status" aria-live="polite">
          <span className="relative flex h-2 w-2 shrink-0">
            {busy && !lowMotion && (
              <span className={`absolute inset-0 rounded-full opacity-60 animate-ping ${DOT_CLASS[tone]}`} aria-hidden="true" />
            )}
            <span className={`relative h-2 w-2 rounded-full ${DOT_CLASS[tone]}`} />
          </span>
          <span className="font-semibold text-foreground whitespace-nowrap">{label}</span>
          {status.length > 0 && (
            <Badge variant="default" className="h-5 rounded-full px-1.5 py-0 text-[10px] font-semibold tabular-nums">
              {status.length}
            </Badge>
          )}
        </div>

        {/* Batch report — only when a drained batch lost items. */}
        {showReport && tally && (
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              variant="destructive"
              size="sm"
              className="h-6 rounded-full px-2 text-[10px] font-semibold gap-1"
              disabled={isRequeuing}
              title={`${tally.completed} completed, ${tally.failed} failed, ${tally.rejected} rejected, ${tally.stalled} stalled. Click to retry the ${lostCount} lost.`}
              onClick={requeueLost}
            >
              <RotateCcw className={`w-3 h-3 ${isRequeuing && !lowMotion ? "animate-spin" : ""}`} />
              {isRequeuing ? "Retrying…" : `${lostCount} lost · Retry`}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 rounded-full text-muted-foreground hover:text-foreground"
              title="Download batch report (JSON)"
              aria-label="Download batch report"
              onClick={() => sendQueueAction({ action: "export_job_ledger" })}
            >
              <Download className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 rounded-full text-muted-foreground hover:text-destructive-text"
              title="Dismiss report"
              aria-label="Dismiss batch report"
              onClick={dismissReport}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            id="extension-target-btn"
            variant="outline"
            size="sm"
            title="Pick the prompt field on the generator page"
            aria-label="Select the target prompt field on the generator page"
            onClick={onTarget}
            disabled={isTargeting}
            className={`h-6 px-2 rounded-full text-[11px] gap-1 transition-colors ${
              isTargeting
                ? "bg-info/15 text-info-text border-info-border disabled:opacity-100"
                : targetState === "selected"
                ? "bg-success-soft text-success-text border-success-border"
                : "bg-transparent hover:bg-success-soft hover:text-success-text hover:border-success-border"
            }`}
          >
            {targetState === "arming" ? (
              <><Loader2 className={`w-3 h-3 ${lowMotion ? "" : "animate-spin"}`} /> Detecting…</>
            ) : targetState === "waiting" ? (
              <><MousePointerClick className={`w-3 h-3 ${lowMotion ? "" : "animate-nudge"}`} /> Click field…</>
            ) : targetState === "selected" ? (
              <><Check className="w-3 h-3" /> Target set</>
            ) : (
              <><Crosshair className="w-3 h-3" /> Target</>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            title="Full setup: prompt, generate button, and queue"
            aria-label="Open the site setup wizard"
            onClick={onOpenWizard}
            className="h-6 w-6 p-0 rounded-full bg-transparent hover:bg-primary/10 hover:text-primary-text hover:border-primary/50"
          >
            <Sparkles className="w-3 h-3" />
          </Button>

          {/* Manual pause/resume — stops sending without dropping the queue
              (unlike Clear). Always available so the user can pre-emptively
              pause before a Bulk Send. */}
          <Button
            variant="outline"
            size="sm"
            title={status.isPausedManually ? "Resume sending prompts" : "Pause sending prompts"}
            aria-label={status.isPausedManually ? "Resume the prompt queue" : "Pause the prompt queue"}
            aria-pressed={status.isPausedManually}
            onClick={() => sendQueueAction({ action: status.isPausedManually ? "resume" : "pause" })}
            className={`h-6 w-6 p-0 rounded-full transition-colors ${
              status.isPausedManually
                ? "bg-warning-soft text-warning-text border-warning-border hover:bg-warning-soft"
                : "bg-transparent hover:bg-warning-soft hover:text-warning-text hover:border-warning-border"
            }`}
          >
            {status.isPausedManually ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
          </Button>

          {status.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              title="Clear prompt queue"
              aria-label="Clear the prompt queue"
              onClick={() => sendQueueAction({ action: "clear" })}
              className="h-6 w-6 p-0 rounded-full bg-transparent hover:bg-destructive/10 hover:text-destructive-text hover:border-destructive/50"
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}
