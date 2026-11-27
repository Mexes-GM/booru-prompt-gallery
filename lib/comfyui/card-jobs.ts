/**
 * Which ComfyUI job each gallery card shows, kept in memory only. Cards are
 * virtualized, so one that scrolls out and back reads its job from here
 * instead of losing it. Nothing subscribes: the card that sends is the only
 * writer, and it keeps its own copy in state.
 */
import type { ApiWorkflow } from "./types"

export interface CardJob {
  jobId: string
  /** The workflow it was sent with, to name a failing node. */
  api: ApiWorkflow
}

const jobs = new Map<string, CardJob>()

export function cardJobKey(provider: string, postId: number): string {
  return `${provider}:${postId}`
}

export function getCardJob(key: string): CardJob | null {
  return jobs.get(key) ?? null
}

export function setCardJob(key: string, job: CardJob | null): void {
  if (job) jobs.set(key, job)
  else jobs.delete(key)
}
