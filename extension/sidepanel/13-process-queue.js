// sidepanel/13-process-queue.js — processNext: the queue driver (one item at a time).
// Classic script: shares the global scope with the other sidepanel/*.js
// files, loaded in numeric order by sidepanel.html. Load-time code may only
// use names declared in this file or an earlier one.

/**
 * Confirms a generation was actually submitted by comparing a pre-click
 * countActiveTasks() snapshot against the state after the post-click wait
 * resolved -- instead of trusting the wait's own "free"/timeout status alone.
 *
 * Never re-queues or blocks the pipeline: it only records the delta on the
 * ledger entry (submitted, with a confidence field) for the batch report.
 * The signal is too noisy to act on automatically: `seaArtLimit` defaults to 5,
 * so `hasTaskSignal` is true even on sites with no task counter, and SeaArt
 * takes several seconds to show a new task in the DOM. Re-queuing on "no
 * increase yet" re-submitted successful prompts and tripped the
 * MAX_CONSECUTIVE_SAME safety pause.
 */
async function confirmSubmitByDelta(jobId, tabId, preClickSnapshot, context) {
  if (!jobId) return true; // no ledger entry to update (e.g. legacy path) -- nothing to do
  const job = ledgerGet(jobId);
  if (!job || job.state !== JOB_STATE.INJECTED) return true; // already transitioned (e.g. rejected) -- don't override

  const postSnapshot = await countActiveTasks(tabId);
  const activeTasksIncreased = postSnapshot.activeTasks > preClickSnapshot.activeTasks;
  console.log(`[Queue][Ledger][confirmSubmitByDelta] ${jobId} context="${context}" activeTasks ${preClickSnapshot.activeTasks} -> ${postSnapshot.activeTasks} (increased=${activeTasksIncreased}) seaArtLimit=${seaArtLimit} currentPlatform="${currentPlatform}"`);

  ledgerTransition(jobId, JOB_STATE.SUBMITTED, {
    via: context,
    activeTasksBefore: preClickSnapshot.activeTasks,
    activeTasksAfter: postSnapshot.activeTasks,
    confidence: activeTasksIncreased ? "confirmed" : "no_delta_observed",
  });
  return true;
}

async function processNext() {
  // Guard: only one processNext flow at a time
  if (isProcessing || isWaitingForSlot || isPausedForError || isPausedManually || promptQueue.length === 0) return;

  isProcessing = true;
  updateQueueUI();

  // Get the target generation tab — prefer finding it directly, regardless of which tab is active.
  // This allows the queue to keep running even if the user switches to another tab.
  // Supported platforms: SeaArt, TensorArt, TensorHub, Yodayo
  const PLATFORM_DOMAINS = ["seaart.ai", "tensor.art", "tensorhub.net", "yodayo.com"];
  const WORKFLOW_PATHS = ["/workflow", "/canvas", "/comfyui", "/generate", "/models"];

  chrome.tabs.query({ currentWindow: true }, async (allTabs) => {
    // Peek (do NOT shift yet) the next item so we can honor the origin it was
    // pinned to at enqueue time — see the INJECT_PROMPT handler's targetOrigin.
    const pinnedItem = promptQueue[0];
    const pinnedOrigin = pinnedItem && pinnedItem.targetOrigin ? pinnedItem.targetOrigin : null;

    let activeTab = null;
    const currentActive = allTabs.find(t => t.active);

    // 0. HIGHEST priority: this prompt was queued for a specific
    //    origin. Send it to the tab with THAT origin, regardless of which tab
    //    is active right now. Without this, switching from SeaArt to TensorArt
    //    mid-queue made the remaining SeaArt prompts get injected into
    //    TensorArt (the queue "followed" the active tab across platforms).
    if (pinnedOrigin) {
      activeTab =
        allTabs.find(t => t.url && originFromUrl(t.url) === pinnedOrigin) ||
        // Same-platform fallback: covers www vs non-www origin differences and
        // the tab being reopened at a slightly different URL. Never leaks to a
        // DIFFERENT platform.
        allTabs.find(t => {
          if (!t.url) return false;
          const p = platformFromUrl(pinnedOrigin);
          return p !== "Unknown" && platformFromUrl(t.url) === p;
        }) ||
        null;

      if (!activeTab) {
        // The site this prompt was queued for isn't open anymore. Pause instead
        // of sending it to whatever else happens to be open. Reopening that
        // site and adding a prompt (or clearing the queue) resumes processing.
        console.warn(`[Queue] Target site for the next prompt (${pinnedOrigin}) is not open — pausing so it isn't sent to a different platform.`);
        isProcessing = false;
        updateQueueUI();
        return;
      }
      dlog(`[Queue][processNext] Pinned to origin "${pinnedOrigin}" → tab id=${activeTab.id} url="${activeTab.url}"`);
    }

    // 1. HIGHEST priority: If the currently active tab is a supported platform, or looks like a local UI (A1111/ComfyUI)
    if (!activeTab && currentActive && currentActive.url && (
      urlHasAnyHost(currentActive.url, PLATFORM_DOMAINS) ||
      currentActive.url.includes("127.0.0.1") ||
      currentActive.url.includes("localhost") ||
      currentActive.url.includes("gradio.live")
    )) {
      activeTab = currentActive;
    }

    // 1b. If the active tab has a persisted SiteProfile (the
    // user explicitly configured it via the Target wizard),
    // trust that intent and use it too, even though its domain isn't on the
    // hardcoded PLATFORM_DOMAINS allowlist. Without this, a site the user
    // configured (e.g. comfy.civitai.com) would lose to ANY background tab
    // on a known platform in steps 2/3 below, silently injecting prompts
    // into the wrong tab. This is the same class of bug fixed in
    // resolveTargetTab for the Target flow itself.
    if (!activeTab && currentActive && isInjectableTabUrl(currentActive.url)) {
      const activeOrigin = originFromUrl(currentActive.url);
      if (activeOrigin && siteProfiles[activeOrigin]) {
        activeTab = currentActive;
        dlog(`[Queue][processNext] Active tab has a configured SiteProfile ("${activeOrigin}") not on PLATFORM_DOMAINS — using it over any background platform tab.`);
      }
    }

    // 2. Fallback: look for a workflow/canvas page on any supported platform in the background
    if (!activeTab) {
      activeTab = allTabs.find(t =>
        t.url && PLATFORM_DOMAINS.some(d => t.url.includes(d)) &&
        WORKFLOW_PATHS.some(p => t.url.includes(p))
      );
    }

    // 3. Fallback: any background tab on a supported platform
    if (!activeTab) {
      activeTab = allTabs.find(t =>
        t.url && PLATFORM_DOMAINS.some(d => t.url.includes(d))
      );
    }

    // 4. Last resort: the currently active tab (even if we don't recognize the URL)
    if (!activeTab) activeTab = currentActive;

    if (
      !activeTab ||
      !activeTab.id ||
      !isInjectableTabUrl(activeTab.url)
    ) {
      console.warn("[Queue] No valid tab found, pausing queue.");
      isProcessing = false;
      updateQueueUI();
      return;
    }

    const tabId = activeTab.id;

    // Keep currentPlatform in sync with the tab we actually resolved, so the
    // platform-specific queue logic (SeaArt/TensorArt paywall/modal handling)
    // and the auto-download gate reflect the site being used right now instead
    // of a stale value left over from a previous tab/session. Also prevents a
    // mismatch where the queue operates on one platform's tab while
    // currentPlatform still names another.
    currentPlatform = platformFromUrl(activeTab.url);

    // Helper function to block if tab is hidden before we even try to check limit
    async function waitForVisibility() {
      return new Promise(resolve => {
        async function check() {
          const { isHidden } = await countActiveTasks(tabId);
          if (isHidden && !backgroundGenerationEnabled) {
            if (!isPausedForVisibility) {
              dlog("[SeaArt Queue] Tab is hidden. Pausing queue before injection.");
              isPausedForVisibility = true;
              updateQueueUI();
            }
            setTimeout(check, 2000);
          } else {
            if (isPausedForVisibility) {
              isPausedForVisibility = false;
              updateQueueUI();
            }
            resolve();
          }
        }
        check();
      });
    }

    await waitForVisibility();

    // ── Resolve this origin's queue strategy ──────────────────
    // queue.mode: "none" (default skeleton, unconfigured site) → Level 0 fixed
    // pacing; "button" (built-in SeaArt/TensorArt profiles, or any site where
    // the user pointed Target at the Generate button) → the richer platform-
    // aware pre-flight/limit logic below stays reserved for KNOWN platforms
    // (currentPlatform is one we have hardcoded modal/task-counter support
    // for); everything else with mode:"button" uses the generic Level 1
    // button-watcher instead. "container" is not implemented yet and
    // currently falls back to Level 1/0 like "button"/"none" respectively.
    const queueConfig = await resolveQueueConfigForTab(tabId);
    const KNOWN_PLATFORMS = ["SeaArt", "TensorArt", "TensorHub", "Yodayo"];
    // "unlimited" overrides ANY richer strategy — including the
    // platform-specific paywall/modal-aware path for built-in SeaArt/TensorArt
    // profiles — because the user has explicitly told us this site's queue is
    // permissive/parallel enough that waiting for it is pure wasted time.
    const usePlatformSpecificQueueLogic = !queueConfig.unlimited && queueConfig.mode === "button" && KNOWN_PLATFORMS.includes(currentPlatform);
    dlog(`[Queue][processNext] ▶ tabId=${tabId} platform="${currentPlatform}" queueConfig.mode="${queueConfig.mode}" unlimited=${!!queueConfig.unlimited} → usePlatformSpecificQueueLogic=${usePlatformSpecificQueueLogic} (${queueConfig.unlimited ? "unlimited override: skipping all queue waits" : usePlatformSpecificQueueLogic ? "platform-specific pre-flight + waitForGenerateButtonFree" : queueConfig.mode === "container" ? "will use Level 2 container watch post-injection" : "will use Level 1 button-watch or Level 0 pacing post-injection"})`);

    // ── PRE-FLIGHT CHECK (platform-specific path only) ─────────────────────
    // Before even injecting, check if we're at the task limit. This prevents
    // wasted generation attempts that would just trigger the upgrade modal and
    // fail. Skipped entirely for Level 0/1 sites — they have no known task
    // counter or paywall modal to watch for, so probing for one would just be
    // wasted work and possibly false positives on unrelated page elements.
    if (usePlatformSpecificQueueLogic) {
    dlog(`[Queue][Platform] Pre-flight check: probing task counter/paywall modal before injection (platform="${currentPlatform}")...`);
    const preCheck = await countActiveTasks(tabId);
    currentActiveTasks = preCheck.activeTasks;

    // Update limit from modal if discovered
    if (preCheck.detectedLimit) seaArtLimit = preCheck.detectedLimit;
    if (preCheck.hasUpgradeModal && !seaArtLimit) {
      seaArtLimit = Math.max(1, preCheck.activeTasks);
    }

    if (seaArtLimit && preCheck.activeTasks >= seaArtLimit) {
      dlog(`[SeaArt Queue] Pre-flight: at limit (${preCheck.activeTasks}/${seaArtLimit}). Waiting for slot...`);
      isWaitingForSlot = true;
      // Keep isProcessing = true to prevent re-entry during the wait
      updateQueueUI();
      // Wait for slot then retry
      await waitUntilSystemReady(tabId);
      // Ready to process — reset flags and re-enter
      isProcessing = false;
      isWaitingForSlot = false;
      processNext();
      return;
    }

    // Block until the system has an open slot (if limit is known)
    await waitUntilSystemReady(tabId);
    } // end usePlatformSpecificQueueLogic pre-flight

    // Now safely pull from queue
    const queueItem = promptQueue.shift();
    persistQueue(); // ← Save queue state after removing item

    const promptText = queueItem && typeof queueItem.prompt === "string" ? queueItem.prompt : null;

    // Visible (non-dev) diagnostic log: exactly which item is about to be
    // processed, how many are left behind it, and its ledger job id (if any)
    // so the console output can be correlated with the exported ledger JSON.
    console.log(`[Queue] ▶ Pulling next item — jobId=${queueItem?.jobId || "none"} remainingInQueue=${promptQueue.length} prompt="${(promptText || "").slice(0, 60)}..."`);

    if (!promptText || promptText.trim() === "") {
      console.warn("[Queue] Invalid or empty prompt pulled from queue, skipping:", queueItem);
      isProcessing = false;
      isWaitingForSlot = false;
      updateQueueUI();
      processNext();
      return;
    }

    // ── SAFETY: Stuck-on-same-prompt detection ───────────────────────────
    // If we're about to generate the exact same prompt as the last one,
    // increment the counter. If it exceeds the max, PAUSE the queue.
    if (lastGeneratedPrompt !== null && promptText.trim() === lastGeneratedPrompt.trim()) {
      consecutiveSamePrompt++;
      console.warn(`[Queue Safety] Same prompt as last generation (${consecutiveSamePrompt}/${MAX_CONSECUTIVE_SAME}): "${promptText.substring(0, 80)}..." jobId=${queueItem?.jobId || "none"}`);
      if (consecutiveSamePrompt > MAX_CONSECUTIVE_SAME) {
        console.error(`[Queue Safety] ⚠ PAUSING QUEUE: Same prompt generated ${consecutiveSamePrompt} times in a row. This looks like a bug. jobId=${queueItem?.jobId || "none"} remainingInQueue=${promptQueue.length}`);
        if (queueItem?.jobId) {
          const job = ledgerGet(queueItem.jobId);
          console.error(`[Queue Safety]   Ledger history for ${queueItem.jobId}:`, job ? JSON.stringify(job.history) : "not found");
        }
        promptQueue.unshift(queueItem); // Put it back
        persistQueue();
        isPausedForError = true;
        isProcessing = false;
        updateQueueUI();
        return;
      }
    } else {
      consecutiveSamePrompt = 0;
    }

    // Ensure the auto-download observer is running on the SeaArt page (idempotent;
    // re-installs it if the page was reloaded since it was first enabled).
    if (autoDownloadEnabled && currentPlatform === "SeaArt") {
      startAutoDownloadObserver();
    }

    // Resolve this tab's persisted prompt-field + generate-button locators
    //, if any were configured via Target for this origin.
    // injectPromptToTab tries them first and falls back to the legacy
    // heuristic cascades when they're absent/stale.
    const promptLocator = await resolvePromptLocatorForTab(tabId);
    const generateLocator = await resolveGenerateLocatorForTab(tabId);
    // Only needed when queue.mode === "container"; cheap enough to
    // resolve unconditionally and let the post-injection branch decide.
    const queueContainerLocator = await resolveQueueContainerLocatorForTab(tabId);

    // "Match image resolution": only resolve width/height locators when this
    // queue item actually carries dimensions (React only computes them when
    // the toggle is on AND the source post had usable width/height). Cheap to
    // resolve unconditionally otherwise-not-needed locators, but skipping
    // avoids two pointless chrome.tabs.get round-trips per item when unused.
    const hasSizeRequest = typeof queueItem.width === "number" && typeof queueItem.height === "number";
    dlog(`[Queue][MatchResolution] queueItem=${JSON.stringify(queueItem)} hasSizeRequest=${hasSizeRequest}`);

    // Try the LiteGraph/ComfyUI path FIRST (see tryApplyLiteGraphSize's doc
    // comment): this MUST run as its own executeScript call with
    // { world: "MAIN" } — window.app/window.graph live in the page's own JS
    // realm, invisible to the ISOLATED world injectPromptToTab's function
    // runs in (that world only shares the DOM, not globals). Harmless no-op
    // on non-LiteGraph sites (resolves applied:false quickly).
    let liteGraphApplied = false;
    if (hasSizeRequest) {
      const liteGraphResult = await tryApplyLiteGraphSize(tabId, queueItem.width, queueItem.height);
      liteGraphApplied = liteGraphResult.applied;
    }

    const widthLocator = (hasSizeRequest && !liteGraphApplied) ? await resolveWidthLocatorForTab(tabId) : null;
    const heightLocator = (hasSizeRequest && !liteGraphApplied) ? await resolveHeightLocatorForTab(tabId) : null;
    const sizeConfig = hasSizeRequest
      ? { width: queueItem.width, height: queueItem.height, widthLocator, heightLocator, liteGraphApplied }
      : null;
    if (hasSizeRequest) {
      dlog(`[Queue][MatchResolution] sizeConfig for this send: ${JSON.stringify({ width: sizeConfig.width, height: sizeConfig.height, liteGraphApplied })}`);
    }
    if (hasSizeRequest && !liteGraphApplied && (!widthLocator || !heightLocator)) {
      dlog(`[Queue][MatchResolution] Size requested (${queueItem.width}x${queueItem.height}) — LiteGraph path didn't apply and width/height fields aren't Target-configured for this origin. Sending prompt without resizing.`);
    }

    // Inject the prompt and click Generate
    // ── Ledger: pre-click snapshot for submit confirmation by DELTA ────────
    // Captured right before injectPromptToTab so the post-click comparison
    // (further down) has a true "before" baseline — activeTasks and the
    // count of history items are the cheapest observable proxies for "a new
    // generation task was actually created", independent of any button-busy
    // heuristic (which SeaArt's own Generate button famously never reflects).
    const preClickSnapshot = await countActiveTasks(tabId);
    const injectResult = await injectPromptToTab(tabId, promptText, promptLocator, generateLocator, sizeConfig);

    if (!injectResult.success) {
      currentPromptRetries++;
      console.warn(`[Queue] Prompt injection failed (attempt ${currentPromptRetries}/${MAX_PROMPT_RETRIES}), reason: ${injectResult.reason}`);
      if (queueItem.jobId) ledgerTransition(queueItem.jobId, JOB_STATE.QUEUED, { reason: "inject_failed", detail: injectResult.reason, attempt: currentPromptRetries });

      if (currentPromptRetries >= MAX_PROMPT_RETRIES) {
        // ── Max retries exceeded: skip this prompt ──────────────────────
        console.error(`[Queue] ✗ Skipping prompt after ${MAX_PROMPT_RETRIES} failed attempts: "${promptText.substring(0, 80)}..."`);
        console.error(`[Queue]   Last failure reason: ${injectResult.reason}`);
        currentPromptRetries = 0;
        // Recorded as FAILED so the end-of-batch report counts it, while the
        // queue still moves on instead of looping forever.
        if (queueItem.jobId) ledgerTransition(queueItem.jobId, JOB_STATE.FAILED, { reason: "max_inject_retries_exhausted", lastReason: injectResult.reason });
        persistQueue();
        isProcessing = false;
        updateQueueUI();
        // Brief delay, then continue with next
        setTimeout(processNext, 2000);
        return;
      }

      // Re-queue for retry
      promptQueue.unshift(queueItem);
      persistQueue();
      isProcessing = false;
      updateQueueUI();
      // Exponential backoff: 2s, 4s, 8s
      const backoffMs = 2000 * Math.pow(2, currentPromptRetries - 1);
      dlog(`[Queue] Retrying in ${backoffMs}ms...`);
      setTimeout(processNext, backoffMs);
      return;
    }

    // ── Injection succeeded! Reset retry counter ───────────────────────
    currentPromptRetries = 0;
    lastGeneratedPrompt = promptText;
    console.log(`[Queue] ✓ Injected jobId=${queueItem.jobId || "none"} hasButton=${injectResult.hasButton} usePlatformSpecificQueueLogic=${usePlatformSpecificQueueLogic} queueConfig.mode="${queueConfig.mode}" platform="${currentPlatform}"`);
    if (queueItem.jobId) ledgerTransition(queueItem.jobId, JOB_STATE.INJECTED, { hasButton: injectResult.hasButton });
    // Record the REAL sent prompt for auto-download's metadata embedding —
    // but only for paths where injection isn't still subject to a possible
    // paywall-modal block/retry below (usePlatformSpecificQueueLogic). For
    // that path the push happens further down, once we know the generation
    // was actually accepted (not silently rejected + retried), so each
    // completed image maps to exactly one queue entry.
    if (!(injectResult.hasButton && usePlatformSpecificQueueLogic)) {
      sentPromptsQueue.push({ prompt: promptText, character: queueItem.character, jobId: queueItem.jobId });
    }

    // If we found a Generate button and clicked it, wait for it to free up.
    // Platform-specific origins (built-in SeaArt/TensorArt
    // profiles) keep the full paywall/modal-aware wait logic unchanged below.
    // Everyone else uses the generic, universal strategies: Level 1 polls the
    // actual button element for busy/disabled cues; Level 0 (no button found,
    // or the origin has no queue config at all) just waits a fixed pacing delay.
    if (injectResult.hasButton && usePlatformSpecificQueueLogic) {
      dlog(`[Queue][Platform] Watching Generate button with platform-specific paywall/modal-aware logic (waitForGenerateButtonFree)...`);
      const waitResult = await waitForGenerateButtonFree(tabId, injectResult.frameId);
      
      if (waitResult?.status === "limit_reached") {
        // Smart queue detector: if we hit the limit modal, we know for a fact the queue is full.
        // Update our internal understanding of the limit.
        dlog("[SeaArt Queue] Hit paywall/upgrade modal! Recalibrating queue knowledge.");
        if (waitResult.detectedLimit) {
          seaArtLimit = waitResult.detectedLimit;
        } else if (!seaArtLimit) {
          const postCheck = await countActiveTasks(tabId);
          seaArtLimit = Math.max(1, postCheck.detectedLimit || postCheck.activeTasks || waitResult.activeTasks || 1);
        }
        
        // Force current active tasks to equal the limit so we wait properly.
        currentActiveTasks = seaArtLimit;
        console.warn(`[SeaArt Queue] Limit reached. Calibrated: ${currentActiveTasks}/${seaArtLimit}.`);
        if (queueItem.jobId) ledgerTransition(queueItem.jobId, JOB_STATE.REJECTED, { reason: "limit_reached", detectedLimit: seaArtLimit });

        // ── Retry strategy (NO re-queue) ─────────────────────────────────
        // Re-queuing would create a tight loop: same prompt → inject → blocked → re-queue → pull again.
        // Instead, keep the prompt in-hand and retry ONCE after a genuine slot opens.
        // If still blocked, skip the prompt — don't loop.
        isWaitingForSlot = true;
        updateQueueUI();

        // Wait for a genuine slot to open
        dlog(`[SeaArt Queue] Waiting for slot before retrying prompt (no re-queue)...`);
        await waitUntilSystemReady(tabId);
        isWaitingForSlot = false;
        updateQueueUI();

        // Retry the same prompt directly (not through processNext/queue)
        dlog(`[SeaArt Queue] Retrying blocked prompt: "${promptText.substring(0, 60)}..."`);
        const retryResult = await injectPromptToTab(tabId, promptText, promptLocator, generateLocator, sizeConfig);
        
        if (!retryResult.success) {
          console.warn(`[SeaArt Queue] Retry injection failed (${retryResult.reason}), skipping prompt.`);
          consecutiveSamePrompt = 0; // Reset — we're moving on
          // Already marked REJECTED above; this makes it terminal (no further
          // retry) so the batch report is accurate.
          if (queueItem.jobId) ledgerTransition(queueItem.jobId, JOB_STATE.FAILED, { reason: "retry_after_limit_inject_failed", detail: retryResult.reason });
          isProcessing = false;
          updateQueueUI();
          processNext();
          return;
        }

        if (retryResult.hasButton) {
          const retryWait = await waitForGenerateButtonFree(tabId, retryResult.frameId);
          if (retryWait?.status === "limit_reached") {
            // Still at limit — give up on this prompt, move to next
            console.warn(`[SeaArt Queue] Prompt still blocked after retry, skipping to next.`);
            consecutiveSamePrompt = 0;
            // Skip the prompt without looping, but record it as FAILED.
            if (queueItem.jobId) ledgerTransition(queueItem.jobId, JOB_STATE.FAILED, { reason: "still_limit_reached_after_retry" });
            isProcessing = false;
            updateQueueUI();
            processNext();
            return;
          }
        }

        // Retry succeeded! Reset safety counter and continue normally.
        consecutiveSamePrompt = 0;
        lastGeneratedPrompt = promptText; // Mark as generated so next same-prompt detection is fresh
        sentPromptsQueue.push({ prompt: promptText, character: queueItem.character, jobId: queueItem.jobId }); // The retried prompt is what SeaArt actually generated
        if (queueItem.jobId) ledgerTransition(queueItem.jobId, JOB_STATE.SUBMITTED, { via: "retry_after_limit" });
        await new Promise((r) => setTimeout(r, GRACE_PERIOD_MS));
        isProcessing = false;
        updateQueueUI();
        processNext();
        return;
      }

      if (waitResult?.status !== "free") {
        console.warn("[Queue] Generate button did not free up within timeout, moving on.");
      }

      // No paywall/limit modal appeared — the generation was accepted.
      sentPromptsQueue.push({ prompt: promptText, character: queueItem.character, jobId: queueItem.jobId });
      await confirmSubmitByDelta(queueItem.jobId, tabId, preClickSnapshot, `platform (${waitResult?.status || "unknown"})`);

      // Grace period before next injection
      await new Promise((r) => setTimeout(r, GRACE_PERIOD_MS));
    } else if (queueConfig.mode === "container" && queueContainerLocator) {
      // ── Level 2: configured queue container + busy signal ──────
      dlog(`[Queue][L2] Branch chosen: queueConfig.mode="container" + container locator present. busySignal: ${queueConfig.busySignal ? queueConfig.busySignal.type : "child-count"})...`);
      const waitResult = await waitForContainerQueueFree(tabId, queueContainerLocator, queueConfig.busySignal, queueConfig.concurrencyLimit, queueConfig.unlimited);
      if (waitResult.status !== "free") {
        dlog(`[Queue][L2] container watch ended with status="${waitResult.status}", proceeding anyway.`);
      }
      // NOTE: confirmSubmitByDelta is intentionally NOT called here. Real
      // logs (2026-09-04 batch) showed activeTasks flat at 0→0, 1→1, 2→2,
      // 3→3 across 4/4 successful, correctly-downloaded generations — the
      // container-mode watch resolves "free" (~800ms, 1 poll) well before a
      // new task shows up in the activeTasks-counting DOM elements
      // countActiveTasks reads, so the delta check would ALWAYS read
      // "no_delta_observed" here regardless of success, adding pure noise to
      // the ledger. waitForContainerQueueFree's own "free" IS the meaningful
      // confirmation signal for this mode (the queue container it watches is
      // exactly what this queue strategy was configured to trust).
      if (queueItem.jobId) ledgerTransition(queueItem.jobId, JOB_STATE.SUBMITTED, { via: `container (${waitResult.status})` });
      await new Promise((r) => setTimeout(r, GRACE_PERIOD_MS));
    } else if (injectResult.hasButton) {
      // ── Level 1: generic button-watcher, any site ──────────────
      dlog(`[Queue][L1] Branch chosen: button found post-injection, queueConfig.mode="${queueConfig.mode}" (not container, or container unconfigured)...`);
      const waitResult = await waitForGenericButtonFree(tabId, generateLocator, queueConfig.unlimited);
      if (waitResult.status !== "free") {
        dlog(`[Queue][L1] button watch ended with status="${waitResult.status}", proceeding anyway.`);
      }
      await confirmSubmitByDelta(queueItem.jobId, tabId, preClickSnapshot, `generic-button (${waitResult.status})`);
      await new Promise((r) => setTimeout(r, GRACE_PERIOD_MS));
    } else {
      // ── Level 0: no button found at all — fixed pacing delay ────
      // "unlimited" sites skip the conservative default pacing too —
      // only a minimal delay to let the DOM register the click, since there's
      // no queue signal at all to wait on anyway.
      const pacingMs = queueConfig.unlimited
        ? UNLIMITED_PACING_MS
        : ((queueConfig && typeof queueConfig.pacingMs === "number") ? queueConfig.pacingMs : GENERATE_PACING_DEFAULT_MS);
      dlog(`[Queue][L0] Branch chosen: no Generate button resolved (injectResult.hasButton=false). Waiting ${queueConfig.unlimited ? "minimal unlimited" : "fixed"} pacing (${pacingMs}ms).`);
      await new Promise((r) => setTimeout(r, pacingMs));
      // No button to watch at all — the ledger still records this job as
      // "submitted" (best-effort, no delta signal available) so it isn't
      // stuck at "injected" forever; the watchdog (see below) can still catch
      // it as stalled if no image ever shows up.
      if (queueItem.jobId) ledgerTransition(queueItem.jobId, JOB_STATE.SUBMITTED, { via: "level0_pacing_no_signal" });
    }

    const expectsAutoDownload = autoDownloadEnabled && (
      (queueItem.targetOrigin && queueItem.targetOrigin.includes("seaart.ai")) ||
      (!queueItem.targetOrigin && currentPlatform === "SeaArt")
    );
    if (!expectsAutoDownload && queueItem.jobId) {
      const currentJob = ledgerGet(queueItem.jobId);
      if (currentJob && currentJob.state === JOB_STATE.SUBMITTED) {
        ledgerTransition(queueItem.jobId, JOB_STATE.COMPLETED, { via: "submitted_no_download_tracking" });
      }
    }

    isProcessing = false;
    isWaitingForSlot = false;
    console.log(`[Queue] ◀ Finished cycle for jobId=${queueItem.jobId || "none"} — state=${queueItem.jobId ? (ledgerGet(queueItem.jobId)?.state || "unknown") : "no-ledger"} remainingInQueue=${promptQueue.length}`);
    updateQueueUI();
    processNext(); // ← process next item in queue
  });
}
