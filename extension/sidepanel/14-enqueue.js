// sidepanel/14-enqueue.js — INJECT_PROMPT listener, enqueue pinning, iframe load resync.
// Classic script: shares the global scope with the other sidepanel/*.js
// files, loaded in numeric order by sidepanel.html. Load-time code may only
// use names declared in this file or an earlier one.

// ─────────────────────────────────────────────────────────────────────────────
// Listener for postMessage events from the Next.js page inside the iframe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve which generation target a newly-queued prompt should be pinned to.
 * Prefers the tab the user is currently looking at (active tab) when it's a
 * supported platform, a local UI, or a site configured via Target; otherwise
 * falls back to any such tab open in the window. Returns { origin, platform },
 * or null when no generation tab is found (the item then queues unpinned and
 * uses processNext's legacy resolution for backwards compatibility).
 */
function resolveEnqueueTarget() {
  return new Promise((resolve) => {
    chrome.tabs.query({ currentWindow: true }, (allTabs) => {
      const PLATFORM_DOMAINS = ["seaart.ai", "tensor.art", "tensorhub.net", "yodayo.com"];
      const isLocalUi = (u) => u && (u.includes("127.0.0.1") || u.includes("localhost") || u.includes("gradio.live"));
      const isGenerationTab = (t) => {
        if (!t || !isInjectableTabUrl(t.url)) return false;
        const origin = originFromUrl(t.url);
        return PLATFORM_DOMAINS.some(d => t.url.includes(d)) || isLocalUi(t.url) || !!(origin && siteProfiles[origin]);
      };

      const currentActive = allTabs.find(t => t.active);
      let tab = (currentActive && isGenerationTab(currentActive)) ? currentActive : null;
      if (!tab) tab = allTabs.find(isGenerationTab) || null;

      if (!tab || !tab.url) { resolve(null); return; }
      resolve({ origin: originFromUrl(tab.url), platform: platformFromUrl(tab.url) });
    });
  });
}

window.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.source !== appFrame.contentWindow) return;
  try { if (event.origin !== new URL(appFrame.src).origin) return; } catch (_) { return; }
  if (event.data.type === "INJECT_PROMPT") {
    const promptText = event.data.prompt;
    if (!promptText) return;

    // "Match image resolution": React includes width/height when the toggle
    // is on and the source post had usable dimensions. Both must be finite
    // positive numbers to be accepted — anything else is dropped (the item
    // still queues as a plain prompt; resizing degrades gracefully).
    const rawWidth = event.data.width;
    const rawHeight = event.data.height;
    const hasValidSize =
      typeof rawWidth === "number" && Number.isFinite(rawWidth) && rawWidth > 0 &&
      typeof rawHeight === "number" && Number.isFinite(rawHeight) && rawHeight > 0;

    const queueItem = hasValidSize
      ? { prompt: promptText, width: rawWidth, height: rawHeight }
      : { prompt: promptText };

    // Auto-Downloading "group by character": the character folder name the
    // React app detected for the search this prompt was queued from (see
    // detectSearchCharacterName), if any. Carried through the queue item so
    // it survives to sentPromptsQueue and triggerAutoDownload.
    if (typeof event.data.character === "string" && event.data.character.trim()) {
      queueItem.character = event.data.character.trim();
    }

    // ── Pin the target platform at enqueue time ──
    // Bind this prompt to the origin of the generation tab the user is looking
    // at right now, so switching tabs mid-queue (e.g. SeaArt → TensorArt)
    // doesn't send the remaining prompts to the wrong site.
    resolveEnqueueTarget().then((target) => {
      if (target && target.origin) queueItem.targetOrigin = target.origin;
      dlog(`[Queue] Enqueue pinned to origin="${target?.origin || "none"}" (platform="${target?.platform || "Unknown"}").`);
      enqueueAndProcess(queueItem);
    });
  }
});

/** Push a (possibly pinned) queue item, persist, resume from error pause if
 *  needed, refresh the UI, and kick processing. Extracted so the INJECT_PROMPT
 *  handler can call it after the async targetOrigin resolution. */
function enqueueAndProcess(queueItem) {
  // If starting a fresh batch from an idle queue, clean up old finished ledger jobs
  if (promptQueue.length === 0 && !isProcessing) {
    const hasActiveJobs = Array.from(jobLedger.values()).some(j =>
      j.state === JOB_STATE.QUEUED || j.state === JOB_STATE.INJECTED
    );
    if (!hasActiveJobs) {
      jobLedger.clear();
      persistLedger();
    }
  }

  promptQueue.push(queueItem);

  // ── Ledger: register this prompt as a tracked job ──
  // jobId travels with the queue item through processNext/injectPromptToTab/
  // the auto-download pool, so every stage can report evidence-based
  // transitions instead of the pipeline silently draining the queue while
  // losing items. See the JOB LEDGER block above buildAutoDLPath.
  queueItem.jobId = ledgerCreate(queueItem.prompt, queueItem.character, queueItem.width, queueItem.height, queueItem.targetOrigin);
  dlog(`[Queue] + Enqueued jobId=${queueItem.jobId} queueLength=${promptQueue.length} targetOrigin="${queueItem.targetOrigin || "unpinned"}" prompt="${(queueItem.prompt || "").slice(0, 60)}..."`);

  // Count this character as "queued" NOW, not when its image finishes
  // downloading — see characterQueuedCounts' comment for why: sending several
  // of the same character at once should file ALL of them into the subfolder,
  // including the ones still sitting in the generation queue.
  if (queueItem.character) {
    characterQueuedCounts.set(queueItem.character, (characterQueuedCounts.get(queueItem.character) || 0) + 1);
  }

  persistQueue(); // save queue state after adding item

  // If queue was paused for error, resume it (user is actively adding prompts)
  if (isPausedForError) {
    dlog("[Queue] Resuming from error pause — user added new prompt.");
    isPausedForError = false;
    consecutiveSamePrompt = 0;
  }

  updateQueueUI();

  // Kick off processing if not already running
  processNext();
}

// When the iframe finishes loading, send it the current queue state
// (the initial notifyIframe call in updateQueueUI fires before the iframe is ready)
appFrame.addEventListener("load", () => {
  // Full payload (updateQueueUI), not a partial one: a partial status would
  // briefly reset platform/pause/tally fields in the app on every reload.
  updateQueueUI();
});
