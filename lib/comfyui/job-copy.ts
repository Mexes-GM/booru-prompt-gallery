/** The short lines Send buttons show for a job, shared by cards and footers. */
import type { ComfyJob } from "./session"
import type { ApiWorkflow } from "./types"
import { nodeTitle } from "./role-choices"

const ORDINAL = new Intl.PluralRules("en", { type: "ordinal" })
const SUFFIX: Record<string, string> = { one: "st", two: "nd", few: "rd", other: "th" }

function ordinal(n: number): string {
  return `${n}${SUFFIX[ORDINAL.select(n)] ?? "th"}`
}

/** "Next in queue", "2nd in queue", or "In queue" before ComfyUI says. */
export function queueLabel(job: ComfyJob): string {
  if (job.queuePosition === undefined) return "In queue"
  return job.queuePosition === 0 ? "Next in queue" : `${ordinal(job.queuePosition + 1)} in queue`
}

/** "Step 14 of 28", or "Generating" while ComfyUI runs a node without steps. */
export function stepLabel(job: ComfyJob): string {
  return job.totalSteps ? `Step ${Math.min(job.step ?? 0, job.totalSteps)} of ${job.totalSteps}` : "Generating"
}

/** 0 to 1, or null when there are no steps to count. */
export function stepProgress(job: ComfyJob): number | null {
  return job.status === "running" && job.totalSteps ? Math.min(1, (job.step ?? 0) / job.totalSteps) : null
}

/** The error with the failing node's title in front, when ComfyUI named it. */
export function errorLine(job: ComfyJob, api: ApiWorkflow | null): string {
  const message = (job.error?.message ?? "").trim() || "The generation failed in ComfyUI."
  const node = job.error?.node && api?.[job.error.node] ? nodeTitle(api, job.error.node) : null
  return node ? `${node}: ${message}` : message
}

/** What a screen reader hears when the job changes state (not on every step). */
export function announcement(job: ComfyJob): string {
  switch (job.status) {
    case "queued":
      return "Sent to ComfyUI. Waiting in the queue."
    case "running":
      return "ComfyUI started generating."
    case "done":
      return "The image from ComfyUI is ready."
    case "error":
      return "ComfyUI couldn't generate the image."
    case "cancelled":
      return "Generation canceled."
  }
}
