// sidepanel/11-ledger.js — Job ledger: per-prompt state machine, batch tally, watchdog.
// Classic script: shares the global scope with the other sidepanel/*.js
// files, loaded in numeric order by sidepanel.html. Load-time code may only
// use names declared in this file or an earlier one.

// ─────────────────────────────────────────────────────────────────────────────
// JOB LEDGER (batch send / auto-download pipeline)
// ─────────────────────────────────────────────────────────────────────────────
// Every prompt that enters the queue gets a jobId and travels through the
// pipeline as a tracked "job" instead of a bare string, so every step can be
// verified end-to-end. It is the single source of truth for the
// batch-completion report shown in the UI.
//
// State machine (see JOB_STATE below):
//   queued → injected → submitted → completed
//                            ↘ rejected  (queue-full / paywall / task-failed)
//                            ↘ unconfirmed (no positive AND no negative signal
//                                            within the confirmation window)
//   queued → failed  (field verification failed / no textarea found / max
//                       injection retries exhausted)
//
// `rejected`/`unconfirmed`/`failed` jobs are NOT silently dropped — they are
// re-queued (with their own retry counter, capped) or, once that cap is hit,
// kept in the ledger as terminal failures so the end-of-batch report can
// show an accurate count instead of a queue that silently drained to zero.
const JOB_STATE = Object.freeze({
  QUEUED: "queued",
  INJECTED: "injected",
  SUBMITTED: "submitted",
  COMPLETED: "completed",
  REJECTED: "rejected",
  UNCONFIRMED: "unconfirmed",
  FAILED: "failed",
  STALLED: "stalled",
});

/** All jobs seen this session, keyed by jobId. Not persisted — mirrors the
 *  in-memory promptQueue's own lifetime (a reload starts a fresh batch). */
const jobLedger = new Map();

/** Monotonic id source so jobIds are stable, sortable, and never collide even
 *  when several prompts are enqueued in the same millisecond (bulk send). */
let jobIdCounter = 0;
function nextJobId() {
  jobIdCounter += 1;
  return `job_${Date.now()}_${jobIdCounter}`;
}

/**
 * Registers a brand-new job in the ledger at enqueue time. Returns the jobId
 * so the caller can stamp it onto the queue item and carry it through the
 * rest of the pipeline (injection, submission confirmation, download).
 */
function ledgerCreate(prompt, character, width, height, targetOrigin) {
  const jobId = nextJobId();
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
  });
  persistLedger();
  return jobId;
}

/**
 * Records a state transition + the evidence that justified it. `evidence` is
 * a free-form object (e.g. { reason: "verification_failed" } or
 * { activeTasksDelta: 1 }) kept purely for diagnostics/export — never parsed
 * back out programmatically, so callers can pass whatever is useful to see in
 * the exported log without needing a shared schema.
 */
function ledgerTransition(jobId, state, evidence) {
  const job = jobLedger.get(jobId);
  if (!job) return null;
  job.state = state;
  job.updatedAt = Date.now();
  job.history.push({ state, at: Date.now(), evidence: evidence || undefined });
  console.log(`[Ledger] ${jobId} → ${state}${evidence ? ` ${JSON.stringify(evidence)}` : ""}`);
  batchTallyDirty = true;
  persistLedger();
  return job;
}

function ledgerGet(jobId) {
  return jobLedger.get(jobId) || null;
}

/**
 * Snapshot counts across the whole ledger, for the end-of-batch report and
 * for the live queue-status pill. Cheap enough to recompute on demand (jobs
 * are capped by however many prompts a user actually sends in a session).
 */
function ledgerTally() {
  const tally = {
    total: jobLedger.size,
    queued: 0, injected: 0, submitted: 0, completed: 0,
    rejected: 0, unconfirmed: 0, failed: 0, stalled: 0,
  };
  for (const job of jobLedger.values()) {
    if (tally[job.state] !== undefined) tally[job.state]++;
  }
  return tally;
}

/** Set whenever a transition happens; cleared once the UI has been notified,
 *  so notifyIframe doesn't need to recompute ledgerTally() on every call that
 *  doesn't actually change it (updateQueueUI runs frequently). */
let batchTallyDirty = false;

/**
 * Exports the full ledger as plain JSON-serializable objects. Sent to the React
 * side on request (EXPORT_JOB_LEDGER) so it can be copied/downloaded as a
 * file for post-mortem analysis of a batch that lost items.
 */
function exportJobLedger() {
  return Array.from(jobLedger.values()).map((job) => ({
    jobId: job.jobId,
    prompt: job.prompt,
    character: job.character || null,
    width: job.width || null,
    height: job.height || null,
    targetOrigin: job.targetOrigin || null,
    state: job.state,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    injectRetries: job.injectRetries,
    submitRetries: job.submitRetries,
    history: job.history,
  }));
}

/**
 * Re-enqueues all lost jobs (FAILED, REJECTED, STALLED) back into promptQueue
 * for generation, preserving prompt text, character tagging, resolution, and
 * targetOrigin. Transitions their state in the ledger back to QUEUED, keeping
 * their history.
 */
function requeueLostJobs() {
  const lostJobs = [];
  for (const job of jobLedger.values()) {
    if ([JOB_STATE.FAILED, JOB_STATE.REJECTED, JOB_STATE.STALLED].includes(job.state)) {
      lostJobs.push(job);
    }
  }

  if (lostJobs.length === 0) {
    dlog("[Queue] requeueLostJobs called, but no lost jobs found in ledger.");
    return 0;
  }

  dlog(`[Queue] Re-enqueueing ${lostJobs.length} lost jobs to queue for generation.`);

  for (const job of lostJobs) {
    job.injectRetries = 0;
    job.submitRetries = 0;
    ledgerTransition(job.jobId, JOB_STATE.QUEUED, { reason: "retry_lost_manual" });

    const queueItem = {
      prompt: job.prompt,
      jobId: job.jobId,
    };

    if (typeof job.width === "number" && typeof job.height === "number") {
      queueItem.width = job.width;
      queueItem.height = job.height;
    }
    if (job.character) {
      queueItem.character = job.character;
      characterQueuedCounts.set(job.character, (characterQueuedCounts.get(job.character) || 0) + 1);
    }
    if (job.targetOrigin) {
      queueItem.targetOrigin = job.targetOrigin;
    }

    promptQueue.push(queueItem);
  }

  persistQueue();
  persistLedger();

  // Reset ALL queue stall/pause flags so processNext() is guaranteed to execute
  isProcessing = false;
  isWaitingForSlot = false;
  isPausedForVisibility = false;
  isPausedForError = false;
  isPausedManually = false;
  consecutiveSamePrompt = 0;
  lastGeneratedPrompt = null;

  updateQueueUI();
  processNext();

  return lostJobs.length;
}

/**
 * Reconciliation watchdog: a prompt whose image never arrives was, somewhere
 * along the way, never actually generated. Jobs sitting in SUBMITTED for longer than STALLED_THRESHOLD_MS without ever
 * reaching COMPLETED are marked STALLED: the generation was (as far as the
 * ledger knows) accepted, but no matching image ever arrived. This catches
 * failure modes none of the earlier per-stage checks can see on their own —
 * e.g. a generation that silently errored out server-side well after
 * submission, or an auto-download observer that missed an image because the
 * page was reloaded at exactly the wrong moment.
 *
 * Deliberately does NOT auto-requeue stalled jobs (unlike UNCONFIRMED, which
 * has strong evidence the click had no effect) — a SUBMITTED job might still
 * complete a few seconds later, and blindly resubmitting it risks a genuine
 * duplicate generation on the site. Surfaced in the ledger/tally for the
 * batch report instead, so the user can decide (re-add the prompt manually,
 * or accept the loss) with actual information instead of a queue that just
 * looks "done".
 */
const STALLED_THRESHOLD_MS = 6 * 60 * 1000; // 6 minutes — generous vs. GENERATE_TIMEOUT_MS (5 min) elsewhere
// A fixed threshold alone mislabels jobs under load: with concurrencyLimit=4
// and a long queue, SeaArt's own backlog can legitimately take longer than 6
// minutes to reach a job. The threshold is therefore STALLED_THRESHOLD_MS plus
// a per-job margin for every job still in flight (queued, injected or
// submitted) at tick time, a rough proxy for the backlog SeaArt is still
// working through. Never shrinks below the base.
const STALLED_PER_INFLIGHT_JOB_MS = 20 * 1000; // ~20s/job of extra grace per job still ahead in the pipeline
const WATCHDOG_INTERVAL_MS = 30 * 1000;
let ledgerWatchdogTimer = null;

function ledgerWatchdogTick() {
  const now = Date.now();
  let changed = false;
  let inFlightCount = 0;
  for (const job of jobLedger.values()) {
    if (job.state === JOB_STATE.QUEUED || job.state === JOB_STATE.INJECTED || job.state === JOB_STATE.SUBMITTED) {
      inFlightCount++;
    }
  }
  const dynamicThresholdMs = STALLED_THRESHOLD_MS + inFlightCount * STALLED_PER_INFLIGHT_JOB_MS;
  for (const job of jobLedger.values()) {
    if (job.state === JOB_STATE.SUBMITTED) {
      const expectsDownload = autoDownloadEnabled && (
        (job.targetOrigin && job.targetOrigin.includes("seaart.ai")) ||
        (!job.targetOrigin && currentPlatform === "SeaArt")
      );
      if (!expectsDownload) {
        // Not tracking downloads for this job — it was already submitted successfully
        ledgerTransition(job.jobId, JOB_STATE.COMPLETED, { via: "no_download_tracking" });
        changed = true;
      } else if (now - job.updatedAt > dynamicThresholdMs) {
        ledgerTransition(job.jobId, JOB_STATE.STALLED, { staleForMs: now - job.updatedAt, thresholdUsedMs: dynamicThresholdMs, inFlightCount });
        changed = true;
      }
    }
  }
  if (changed) updateQueueUI();
}

function startLedgerWatchdog() {
  if (ledgerWatchdogTimer) return;
  ledgerWatchdogTimer = setInterval(ledgerWatchdogTick, WATCHDOG_INTERVAL_MS);
}

function stopLedgerWatchdog() {
  if (ledgerWatchdogTimer) { clearInterval(ledgerWatchdogTimer); ledgerWatchdogTimer = null; }
}
