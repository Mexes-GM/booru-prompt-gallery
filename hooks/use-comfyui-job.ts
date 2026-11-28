"use client"

import { useCallback, useSyncExternalStore } from "react"
import {
  getComfyJobSnapshot,
  getComfyJobsSnapshot,
  subscribeComfyJobs,
  type ComfyJob,
} from "@/lib/comfyui/session"

const NO_JOBS: ComfyJob[] = []

/**
 * The current snapshot of one job, or null. The snapshot object only changes
 * when that job changes, so the component re-renders only then.
 */
export function useComfyJob(jobId: string | null): ComfyJob | null {
  const getSnapshot = useCallback(() => (jobId ? getComfyJobSnapshot(jobId) : null), [jobId])
  return useSyncExternalStore(subscribeComfyJobs, getSnapshot, () => null)
}

/** All jobs of the active session, oldest first. The array only changes when a job does. */
export function useComfyJobs(): ComfyJob[] {
  return useSyncExternalStore(subscribeComfyJobs, getComfyJobsSnapshot, () => NO_JOBS)
}
