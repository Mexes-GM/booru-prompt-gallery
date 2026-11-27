"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "@/hooks/use-toast"
import { useComfyEnabled } from "@/hooks/use-comfyui-settings"
import type { ComfySent } from "@/components/prompt-gallery/comfyui-send"
import { sendInOrder, type PackSendRequest, type SendAllState } from "@/lib/pack/pack-comfy-send"

/** A row's job, with the prompt it was sent for: a row whose prompt changed no longer shows it. */
interface RowJob extends ComfySent {
  forPrompt: string
}

/** One row for Send all: its key, its prompt now, and what it sends (built when its turn comes). */
export interface PackSendRow {
  key: number
  forPrompt: string
  build: () => Promise<PackSendRequest>
  onCopyInstead?: () => void
}

const IDLE: SendAllState = { kind: "idle" }
const NO_JOBS: ReadonlyMap<number, RowJob> = new Map()

/** How long Send all's outcome stays on its button. */
const ENDED_MS = { all: 2500, some: 8000 }

const loadSend = () => import("@/components/prompt-gallery/comfyui-send").then((m) => m.sendToComfy)

/**
 * Send to ComfyUI for a pack's list: one job per row, drawn by the row, and Send
 * all, which queues the rows one after another. Sending a row again replaces its
 * job (a job still waiting in ComfyUI's queue is canceled), Send all included.
 */
export function usePackComfySend() {
  const enabled = useComfyEnabled()
  // The ref is the truth while sends are on their way; state mirrors it for rendering.
  const jobsRef = useRef<ReadonlyMap<number, RowJob>>(NO_JOBS)
  const [jobs, setJobs] = useState(NO_JOBS)
  const [sending, setSending] = useState<ReadonlySet<number>>(() => new Set())
  const sendingRef = useRef(new Set<number>())
  const [all, setAll] = useState<SendAllState>(IDLE)
  const allRunningRef = useRef(false)
  const goneRef = useRef(false)
  useEffect(() => {
    goneRef.current = false
    return () => {
      goneRef.current = true
    }
  }, [])

  const setJob = useCallback((key: number, job: RowJob | null) => {
    const next = new Map(jobsRef.current)
    if (job) next.set(key, job)
    else next.delete(key)
    jobsRef.current = next
    setJobs(next)
  }, [])

  const markSending = useCallback((key: number, on: boolean) => {
    if (on) sendingRef.current.add(key)
    else sendingRef.current.delete(key)
    setSending(new Set(sendingRef.current))
  }, [])

  /** Sends one row; false when nothing went (sendToComfy has said why). */
  const sendRow = useCallback(
    async (row: PackSendRow): Promise<boolean> => {
      if (sendingRef.current.has(row.key)) return false
      markSending(row.key, true)
      try {
        const [sendToComfy, request] = await Promise.all([loadSend(), row.build()])
        if (!request.prompt) return false
        const sent = await sendToComfy({
          ...request,
          previousJobId: jobsRef.current.get(row.key)?.jobId,
          onCopyInstead: row.onCopyInstead,
        })
        if (!sent) return false
        if (!goneRef.current) setJob(row.key, { ...sent, forPrompt: row.forPrompt })
        return true
      } catch {
        toast({ description: "Couldn't load Send to ComfyUI. Check your connection and try again.", variant: "destructive", duration: 3000 })
        return false
      } finally {
        if (!goneRef.current) markSending(row.key, false)
      }
    },
    [markSending, setJob],
  )

  const sendOne = useCallback(
    (row: PackSendRow) => {
      if (allRunningRef.current) return
      void sendRow(row)
    },
    [sendRow],
  )

  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (endTimer.current) clearTimeout(endTimer.current)
  }, [])

  const sendAll = useCallback(
    async (rows: readonly PackSendRow[]) => {
      if (allRunningRef.current || rows.length === 0) return
      allRunningRef.current = true
      if (endTimer.current) clearTimeout(endTimer.current)
      try {
        const result = await sendInOrder(
          rows,
          (row) => sendRow(row),
          ({ done, total }) => {
            if (!goneRef.current) setAll({ kind: "sending", done, total })
          },
          () => goneRef.current,
        )
        if (goneRef.current) return
        setAll({ kind: "ended", ...result })
        endTimer.current = setTimeout(() => setAll(IDLE), result.sent === result.total ? ENDED_MS.all : ENDED_MS.some)
      } finally {
        allRunningRef.current = false
      }
    },
    [sendRow],
  )

  /** The row's job, when it was sent for the prompt the row shows now. */
  const jobOf = useCallback(
    (key: number, forPrompt: string): ComfySent | null => {
      const job = jobs.get(key)
      return job && job.forPrompt === forPrompt ? job : null
    },
    [jobs],
  )

  const dismiss = useCallback((key: number) => setJob(key, null), [setJob])

  return { enabled, jobs, jobOf, sending, sendOne, sendAll, all, dismiss }
}
