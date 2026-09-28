/**
 * Verification tests for the "Re-enqueue lost results to queue" logic in the extension.
 *
 * Covers:
 *   1. Correct classification of lost states (FAILED, REJECTED, STALLED) vs other states (COMPLETED, QUEUED, SUBMITTED).
 *   2. Re-queueing transitions lost jobs back to QUEUED with reason 'retry_lost_manual'.
 *   3. Metadata preservation: prompt, character, width, height, targetOrigin.
 *   4. Retries reset: injectRetries = 0, submitRetries = 0.
 *   5. Batch tally recalculation: lostCount goes to 0, queued increases.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/extension-requeue-lost.verify.ts
 */

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

// Mirroring the state machine and ledger from extension/sidepanel.js
const JOB_STATE = Object.freeze({
  QUEUED: "queued",
  INJECTED: "injected",
  SUBMITTED: "submitted",
  COMPLETED: "completed",
  REJECTED: "rejected",
  UNCONFIRMED: "unconfirmed",
  FAILED: "failed",
  STALLED: "stalled",
})

interface LedgerJob {
  jobId: string
  prompt: string
  character?: string
  width?: number
  height?: number
  targetOrigin?: string
  state: string
  createdAt: number
  updatedAt: number
  injectRetries: number
  submitRetries: number
  history: Array<{ state: string; at: number; evidence?: Record<string, unknown> }>
}

interface QueueItem {
  prompt: string
  jobId: string
  character?: string
  width?: number
  height?: number
  targetOrigin?: string
}

function runTests() {
  const jobLedger = new Map<string, LedgerJob>()
  const promptQueue: QueueItem[] = []
  let jobIdCounter = 0

  function nextJobId() {
    jobIdCounter += 1
    return `job_test_${jobIdCounter}`
  }

  function ledgerCreate(
    prompt: string,
    character?: string,
    width?: number,
    height?: number,
    targetOrigin?: string
  ): string {
    const jobId = nextJobId()
    jobLedger.set(jobId, {
      jobId,
      prompt,
      character: character || undefined,
      width: typeof width === "number" ? width : undefined,
      height: typeof height === "number" ? height : undefined,
      targetOrigin: targetOrigin || undefined,
      state: JOB_STATE.QUEUED,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      injectRetries: 0,
      submitRetries: 0,
      history: [{ state: JOB_STATE.QUEUED, at: Date.now() }],
    })
    return jobId
  }

  function ledgerTransition(jobId: string, state: string, evidence?: Record<string, unknown>) {
    const job = jobLedger.get(jobId)
    if (!job) return null
    job.state = state
    job.updatedAt = Date.now()
    job.history.push({ state, at: Date.now(), evidence })
    return job
  }

  function ledgerTally() {
    const tally: Record<string, number> = {
      total: jobLedger.size,
      queued: 0,
      injected: 0,
      submitted: 0,
      completed: 0,
      rejected: 0,
      unconfirmed: 0,
      failed: 0,
      stalled: 0,
    }
    for (const job of jobLedger.values()) {
      if (tally[job.state] !== undefined) tally[job.state]++
    }
    return tally
  }

  function requeueLostJobs(): number {
    const lostJobs: LedgerJob[] = []
    for (const job of jobLedger.values()) {
      if (([JOB_STATE.FAILED, JOB_STATE.REJECTED, JOB_STATE.STALLED] as string[]).includes(job.state)) {
        lostJobs.push(job)
      }
    }

    if (lostJobs.length === 0) return 0

    for (const job of lostJobs) {
      job.injectRetries = 0
      job.submitRetries = 0
      ledgerTransition(job.jobId, JOB_STATE.QUEUED, { reason: "retry_lost_manual" })

      const queueItem: QueueItem = {
        prompt: job.prompt,
        jobId: job.jobId,
      }

      if (typeof job.width === "number" && typeof job.height === "number") {
        queueItem.width = job.width
        queueItem.height = job.height
      }
      if (job.character) {
        queueItem.character = job.character
      }
      if (job.targetOrigin) {
        queueItem.targetOrigin = job.targetOrigin
      }

      promptQueue.push(queueItem)
    }

    return lostJobs.length
  }

  function clearBatchReport(isProcessing = false) {
    if (promptQueue.length === 0 && !isProcessing) {
      jobLedger.clear()
    } else {
      for (const [jobId, job] of jobLedger.entries()) {
        if (([JOB_STATE.COMPLETED, JOB_STATE.FAILED, JOB_STATE.REJECTED, JOB_STATE.STALLED, JOB_STATE.SUBMITTED] as string[]).includes(job.state)) {
          jobLedger.delete(jobId)
        }
      }
    }
  }

  function clearQueue() {
    promptQueue.length = 0
    jobLedger.clear()
  }

  function ledgerWatchdogTick(autoDownloadEnabled: boolean, currentPlatform: string, now: number) {
    const dynamicThresholdMs = 6 * 60 * 1000
    for (const job of jobLedger.values()) {
      if (job.state === JOB_STATE.SUBMITTED) {
        const expectsDownload = autoDownloadEnabled && (
          (job.targetOrigin && job.targetOrigin.includes("seaart.ai")) ||
          (!job.targetOrigin && currentPlatform === "SeaArt")
        )
        if (!expectsDownload) {
          ledgerTransition(job.jobId, JOB_STATE.COMPLETED, { via: "no_download_tracking" })
        } else if (now - job.updatedAt > dynamicThresholdMs) {
          ledgerTransition(job.jobId, JOB_STATE.STALLED, { staleForMs: now - job.updatedAt })
        }
      }
    }
  }

  // ── Test 1: ledgerCreate preserves width, height, targetOrigin, character ──
  {
    const id1 = ledgerCreate("1girl, solo", "hatsune_miku", 832, 1216, "https://seaart.ai")
    const j1 = jobLedger.get(id1)!
    assert(j1 !== undefined, "Job 1 created in ledger")
    assert(j1.prompt === "1girl, solo", "Job 1 prompt stored")
    assert(j1.character === "hatsune_miku", "Job 1 character stored")
    assert(j1.width === 832 && j1.height === 1216, "Job 1 dimensions stored")
    assert(j1.targetOrigin === "https://seaart.ai", "Job 1 targetOrigin stored")
  }

  // ── Test 2: Simulating mixed batch outcome ──
  {
    const id2 = ledgerCreate("1boy, looking at viewer", undefined, 512, 768, "https://tensor.art")
    const id3 = ledgerCreate("scenery, landscape", undefined, undefined, undefined, undefined)
    const id4 = ledgerCreate("1girl, blue hair", "aqua", 1024, 1024, "https://seaart.ai")

    // Transition jobs to various states
    const j1 = Array.from(jobLedger.values())[0]
    ledgerTransition(j1.jobId, JOB_STATE.COMPLETED)
    ledgerTransition(id2, JOB_STATE.FAILED, { reason: "verification_failed" })
    ledgerTransition(id3, JOB_STATE.REJECTED, { reason: "limit_reached" })
    ledgerTransition(id4, JOB_STATE.STALLED, { staleForMs: 400000 })

    const tBefore = ledgerTally()
    assert(tBefore.completed === 1, "Tally has 1 completed")
    assert(tBefore.failed === 1, "Tally has 1 failed")
    assert(tBefore.rejected === 1, "Tally has 1 rejected")
    assert(tBefore.stalled === 1, "Tally has 1 stalled")
    assert(tBefore.queued === 0, "Tally has 0 queued before retry")

    const lostCount = tBefore.failed + tBefore.rejected + tBefore.stalled
    assert(lostCount === 3, "Lost count before retry is 3")

    // ── Test 3: requeueLostJobs re-enqueues only the 3 lost jobs ──
    const requeuedCount = requeueLostJobs()
    assert(requeuedCount === 3, "requeueLostJobs returned 3")
    assert(promptQueue.length === 3, "promptQueue has 3 items")

    // Verify queue items metadata
    const qItem2 = promptQueue.find((q) => q.jobId === id2)!
    assert(qItem2 !== undefined, "Failed job is in promptQueue")
    assert(qItem2.width === 512 && qItem2.height === 768, "Dimensions preserved for id2")
    assert(qItem2.targetOrigin === "https://tensor.art", "targetOrigin preserved for id2")

    const qItem4 = promptQueue.find((q) => q.jobId === id4)!
    assert(qItem4 !== undefined, "Stalled job is in promptQueue")
    assert(qItem4.character === "aqua", "Character preserved for id4")
    assert(qItem4.width === 1024 && qItem4.height === 1024, "Dimensions preserved for id4")

    // Verify completed job was NOT requeued
    const qItem1 = promptQueue.find((q) => q.jobId === j1.jobId)
    assert(qItem1 === undefined, "Completed job was NOT requeued")

    // Verify ledger history and state
    const j2 = jobLedger.get(id2)!
    assert(j2.state === JOB_STATE.QUEUED, "id2 state transitioned to queued")
    assert(j2.history[j2.history.length - 1].state === JOB_STATE.QUEUED, "id2 history has queued at end")
    assert(
      (j2.history[j2.history.length - 1].evidence as any)?.reason === "retry_lost_manual",
      "id2 history evidence records retry_lost_manual"
    )

    // Verify new tally
    const tAfter = ledgerTally()
    assert(tAfter.failed === 0, "Tally failed is now 0")
    assert(tAfter.rejected === 0, "Tally rejected is now 0")
    assert(tAfter.stalled === 0, "Tally stalled is now 0")
    assert(tAfter.completed === 1, "Tally completed remains 1")
    assert(tAfter.queued === 3, "Tally queued is now 3")
    assert(tAfter.failed + tAfter.rejected + tAfter.stalled === 0, "Lost count after retry is 0")
  }

  // ── Test 4: Idempotent when no lost jobs exist ──
  {
    const count = requeueLostJobs()
    assert(count === 0, "requeueLostJobs with 0 lost returns 0")
    assert(promptQueue.length === 3, "promptQueue unchanged")
  }

  // ── Test 5: clearBatchReport clears all jobs when queue is idle ──
  {
    // Empty queue simulating finished batch
    promptQueue.length = 0
    clearBatchReport(false)
    assert(jobLedger.size === 0, "jobLedger is empty after clearBatchReport when idle")
    const tCleared = ledgerTally()
    assert(tCleared.total === 0, "Total tally is 0")
    assert(tCleared.failed + tCleared.rejected + tCleared.stalled === 0, "Lost count is 0")
  }

  // ── Test 6: Watchdog does not stall non-SeaArt or non-autoDL jobs ──
  {
    const idTensor = ledgerCreate("tensor test", undefined, 512, 512, "https://tensor.art")
    const idSeaArtNoDL = ledgerCreate("seaart no dl", undefined, 512, 512, "https://seaart.ai")
    const idSeaArtWithDL = ledgerCreate("seaart with dl", undefined, 512, 512, "https://seaart.ai")

    ledgerTransition(idTensor, JOB_STATE.SUBMITTED)
    ledgerTransition(idSeaArtNoDL, JOB_STATE.SUBMITTED)
    ledgerTransition(idSeaArtWithDL, JOB_STATE.SUBMITTED)

    const tenMinAgo = Date.now() - 10 * 60 * 1000
    jobLedger.get(idTensor)!.updatedAt = tenMinAgo
    jobLedger.get(idSeaArtNoDL)!.updatedAt = tenMinAgo
    jobLedger.get(idSeaArtWithDL)!.updatedAt = tenMinAgo

    // Run watchdog with autoDownloadEnabled = false
    ledgerWatchdogTick(false, "SeaArt", Date.now())
    assert(jobLedger.get(idTensor)!.state === JOB_STATE.COMPLETED, "TensorArt job completed without autodownload")
    assert(jobLedger.get(idSeaArtNoDL)!.state === JOB_STATE.COMPLETED, "SeaArt job without autodownload completed cleanly")

    // Now test with autoDownloadEnabled = true on SeaArt
    ledgerTransition(idSeaArtWithDL, JOB_STATE.SUBMITTED)
    jobLedger.get(idSeaArtWithDL)!.updatedAt = tenMinAgo
    ledgerWatchdogTick(true, "SeaArt", Date.now())
    assert(jobLedger.get(idSeaArtWithDL)!.state === JOB_STATE.STALLED, "SeaArt job with autodownload enabled stalls when missing download")
  }

  // ── Test 7: clearQueue wipes queue and ledger ──
  {
    promptQueue.push({ prompt: "orphan queue item", jobId: "orphan_1" })
    clearQueue()
    assert(promptQueue.length === 0, "promptQueue is 0 after clearQueue")
    assert(jobLedger.size === 0, "jobLedger is 0 after clearQueue")
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

runTests()
