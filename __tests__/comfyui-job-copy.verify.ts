/**
 * Tests for the job lines Send buttons show (lib/comfyui/job-copy.ts) and the
 * card -> job map (lib/comfyui/card-jobs.ts).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/comfyui-job-copy.verify.ts
 */
import { announcement, errorLine, queueLabel, stepLabel, stepProgress } from "../lib/comfyui/job-copy"
import { cardJobKey, getCardJob, setCardJob } from "../lib/comfyui/card-jobs"
import type { ComfyJob } from "../lib/comfyui/session"
import type { ApiWorkflow } from "../lib/comfyui/types"

let passed = 0
let failed = 0
function assert(condition: boolean, label: string) {
  if (condition) passed++
  else {
    failed++
    console.error(`  FAIL: ${label}`)
  }
}
function eq(actual: unknown, expected: unknown, label: string) {
  assert(actual === expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}

const job = (over: Partial<ComfyJob>): ComfyJob => ({ id: "p1", status: "queued", createdAt: 0, ...over })

// Queue position: 0 is next in line.
eq(queueLabel(job({})), "In queue", "unknown position")
eq(queueLabel(job({ queuePosition: 0 })), "Next in queue", "position 0")
eq(queueLabel(job({ queuePosition: 1 })), "2nd in queue", "position 1")
eq(queueLabel(job({ queuePosition: 2 })), "3rd in queue", "position 2")
eq(queueLabel(job({ queuePosition: 3 })), "4th in queue", "position 3")
eq(queueLabel(job({ queuePosition: 10 })), "11th in queue", "position 10")
eq(queueLabel(job({ queuePosition: 20 })), "21st in queue", "position 20")

// Steps
eq(stepLabel(job({ status: "running" })), "Generating", "no steps yet")
eq(stepLabel(job({ status: "running", step: 14, totalSteps: 28 })), "Step 14 of 28", "steps")
eq(stepLabel(job({ status: "running", step: 30, totalSteps: 28 })), "Step 28 of 28", "step clamped")
eq(stepProgress(job({ status: "running", step: 7, totalSteps: 28 })), 0.25, "progress fraction")
eq(stepProgress(job({ status: "running" })), null, "no progress without steps")
eq(stepProgress(job({ status: "queued", step: 1, totalSteps: 2 })), null, "no progress while queued")

// Errors name the node by its title when the workflow has it.
const api: ApiWorkflow = {
  "4": { class_type: "CheckpointLoaderSimple", inputs: {}, _meta: { title: "Load Checkpoint" } },
  "9": { class_type: "SaveImage", inputs: {} },
}
eq(errorLine(job({ status: "error", error: { message: "ckpt missing", node: "4" } }), api), "Load Checkpoint: ckpt missing", "titled node")
eq(errorLine(job({ status: "error", error: { message: "boom", node: "9" } }), api), "SaveImage: boom", "untitled node uses class")
eq(errorLine(job({ status: "error", error: { message: "boom", node: "77" } }), api), "boom", "unknown node left out")
eq(errorLine(job({ status: "error", error: { message: "  " } }), null), "The generation failed in ComfyUI.", "empty message")

// One announcement per state.
const said = new Set((["queued", "running", "done", "error", "cancelled"] as const).map((s) => announcement(job({ status: s }))))
eq(said.size, 5, "a distinct announcement for each state")

// Card map
const key = cardJobKey("danbooru", 42)
eq(key, "danbooru:42", "key")
eq(getCardJob(key), null, "empty by default")
setCardJob(key, { jobId: "a", api })
eq(getCardJob(key)?.jobId, "a", "stored")
setCardJob(key, { jobId: "b", api })
eq(getCardJob(key)?.jobId, "b", "sending again replaces the job")
eq(getCardJob(cardJobKey("gelbooru", 42)), null, "keyed by provider too")
setCardJob(key, null)
eq(getCardJob(key), null, "cleared")

console.log(`comfyui-job-copy: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
