// sidepanel/05-host-bridge.js — Queue status -> iframe, and QUEUE_ACTION / REQUEST_* / THEME_CHANGE from the iframe.
// Classic script: shares the global scope with the other sidepanel/*.js
// files, loaded in numeric order by sidepanel.html. Load-time code may only
// use names declared in this file or an earlier one.

// ─────────────────────────────────────────────────────────────────────────────
// Queue Status UI helpers
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: The visible queue UI (status pill, target/clear buttons, badge) is
// rendered entirely by the React iframe. This sidepanel owns only the queue
// *logic* and pushes state to the iframe via postMessage.
function updateQueueUI() {
  const count = promptQueue.length;

  // Notify the iframe about queue state
  notifyIframe({ queueLength: count, isProcessing, isWaitingForSlot, isPausedForVisibility, isPausedForError, isPausedManually, currentActiveTasks, seaArtLimit, platform: currentPlatform, batchTally: ledgerTally() });
}

function notifyIframe(payload) {
  try {
    // Post with "*" — the React app verifies event.source === window.parent.
    // Using a pinned origin fails because the iframe (localhost / vercel) and
    // this sidepanel (chrome-extension://) have different origins.
    appFrame.contentWindow.postMessage({ type: "QUEUE_STATUS", ...payload, autoDownloadEnabled, backgroundGenerationEnabled, characterSubfoldersEnabled }, "*");
  } catch (_) {
    // iframe may not be ready yet
  }
}

// Allow iframe to trigger actions
window.addEventListener("message", (e) => {
  if (e.source !== appFrame.contentWindow) return;
  try { if (e.origin !== new URL(appFrame.src).origin) return; } catch (_) { return; }
  if (e.data && e.data.type === "QUEUE_ACTION") {
    // e.data.targetKind: "prompt" (default) | "generate" | "queue".
    // Lets the React wizard drive which element kind Target selects next.
    if (e.data.action === "target") startTargeting(e.data.targetKind);
    if (e.data.action === "clear") clearQueue();
    // Manual pause/resume — user-initiated safety valve from the queue pill's
    // pause button, distinct from the automatic pauses (visibility/error):
    // it is NOT auto-cleared by enqueueAndProcess when a new prompt arrives,
    // so the user stays in control until they explicitly resume.
    if (e.data.action === "pause") {
      isPausedManually = true;
      updateQueueUI();
    }
    if (e.data.action === "resume") {
      isPausedManually = false;
      updateQueueUI();
      processNext();
    }
    if (e.data.action === "set_auto_download") {
      autoDownloadEnabled = !!e.data.value;
      persistQueue();
      if (autoDownloadEnabled) startAutoDownloadObserver();
      else stopAutoDownloadObserver();
    }
    // Auto-Downloading "group by character" — see characterSubfoldersEnabled
    // declaration above and triggerAutoDownload's folder-name logic.
    if (e.data.action === "set_character_subfolders") {
      characterSubfoldersEnabled = !!e.data.value;
      persistQueue();
      updateQueueUI();
    }
    // (Option 2 + 3) Keep the queue running while the target tab is hidden and
    // arm the audio keep-alive against background timer throttling. Fired from
    // the React settings toggle; the toggle click's user gesture propagates
    // through this postMessage hop, which is what lets AudioContext.resume()
    // succeed on start (same gesture-forwarding the permission request relies on).
    if (e.data.action === "set_background_generation") {
      backgroundGenerationEnabled = !!e.data.value;
      persistQueue();
      if (backgroundGenerationEnabled) {
        startBackgroundAudioKeepAlive();
        // If the tab was paused purely for visibility, resume processing now.
        if (isPausedForVisibility) {
          isPausedForVisibility = false;
          updateQueueUI();
          processNext();
        }
      } else {
        stopBackgroundAudioKeepAlive();
      }
      updateQueueUI();
    }
    // "Learn the busy signal live": snapshot the configured queue
    // container's descendant class list twice — once while idle, once while
    // a generation the user manually triggered is running — and diff them to
    // find the class that only appears while busy (e.g. a spinner/progress
    // element). e.data.step: "idle" | "busy". See captureBusySignalStep below.
    if (e.data.action === "capture_busy_signal") captureBusySignalStep(e.data.step);
    // Persist how many simultaneous generations this site's queue tolerates
    // before it's considered "busy" (used by waitForContainerQueueFree's
    // count-vs-limit comparisons, and as a general per-site override for
    // permissive/parallel queues like TensorArt). e.data.value: positive int.
    // e.data.unlimited: true short-circuits ALL queue waiting for
    // this origin (Level 0/1/2 and even the platform-specific SeaArt/TensorArt
    // path) — for sites the user knows are effectively never full.
    if (e.data.action === "set_concurrency_limit") setConcurrencyLimitForActiveTab(e.data.value, e.data.unlimited);
    // ── Job ledger export + batch report ──
    // Sends the full per-prompt state history
    // back to the React side so a batch that lost items can be diagnosed
    // after the fact instead of relying on console logs alone.
    if (e.data.action === "export_job_ledger") {
      try {
        appFrame.contentWindow.postMessage({ type: "JOB_LEDGER_EXPORT", jobs: exportJobLedger(), tally: ledgerTally() }, "*");
      } catch (_) { /* iframe not ready */ }
    }
    // Re-enqueues lost jobs (failed, rejected, stalled) for generation
    if (e.data.action === "requeue_lost_jobs" || e.data.action === "retry_lost_jobs") {
      const count = requeueLostJobs();
      try {
        appFrame.contentWindow.postMessage({
          type: "REQUEUE_LOST_ACK",
          count,
          queueLength: promptQueue.length,
          success: true,
        }, "*");
      } catch (_) { /* iframe not ready */ }
    }
    // Clears completed/failed/rejected/stalled entries from a finished batch
    // so the next one starts its report from zero. When idle, clears the entire
    // ledger so lingering submitted jobs don't stall later.
    if (e.data.action === "clear_batch_report") {
      if (promptQueue.length === 0 && !isProcessing) {
        jobLedger.clear();
      } else {
        for (const [jobId, job] of jobLedger.entries()) {
          if ([JOB_STATE.COMPLETED, JOB_STATE.FAILED, JOB_STATE.REJECTED, JOB_STATE.STALLED, JOB_STATE.SUBMITTED].includes(job.state)) {
            jobLedger.delete(jobId);
          }
        }
      }
      persistLedger();
      updateQueueUI();
    }
  }
  // App booted — hide the boot screen. Older deployments don't send
  // POCKET_READY, but always ask for the queue status on mount.
  if (e.data && (e.data.type === "POCKET_READY" || e.data.type === "REQUEST_QUEUE_STATUS")) {
    bootMarkReady();
  }
  // React app asking for initial state on mount
  if (e.data && e.data.type === "REQUEST_QUEUE_STATUS") {
    updateQueueUI();
  }
  // React wizard/status panel asking for this origin's SiteProfile
  // summary — which of promptField/generateButton/queue.container are
  // configured, and the resolved queue level (0/1/2). Answered on the active
  // tab's origin so the panel reflects whatever page the user has open.
  if (e.data && e.data.type === "REQUEST_SITE_PROFILE_STATUS") {
    sendSiteProfileStatus();
  }
  // App reports its resolved theme ("dark" | "light") so the native wrapper
  // (body background + dev config bar) matches the app even when the user
  // overrides the OS preference via the in-app theme toggle.
  if (e.data && e.data.type === "THEME_CHANGE") {
    const t = e.data.theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("booru_sidebar_theme", t); } catch (_) {}
  }
});
