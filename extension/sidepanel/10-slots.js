// sidepanel/10-slots.js — Active task counting + system readiness checks.
// Classic script: shares the global scope with the other sidepanel/*.js
// files, loaded in numeric order by sidepanel.html. Load-time code may only
// use names declared in this file or an earlier one.

// ─────────────────────────────────────────────────────────────────────────────
// Core: process the queue one item at a time
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Counts the number of currently active tasks on the SeaArt page.
 * Returns a Promise<number> with the count across all frames.
 */
function countActiveTasks(tabId) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const querySelectorAllDeep = (selector, root = document) => {
          const list = [];
          const seen = new Set();
          const find = (node) => {
            if (!node) return;
            if (node.querySelectorAll) {
              const matches = node.querySelectorAll(selector);
              for (const m of matches) {
                if (!seen.has(m)) {
                  seen.add(m);
                  list.push(m);
                }
              }
            }
            if (node.shadowRoot) find(node.shadowRoot);
            if (node.children) {
              for (const child of node.children) find(child);
            }
          };
          find(root);
          return list;
        };
        const querySelectorDeep = (selector, root = document) => {
          const list = querySelectorAllDeep(selector, root);
          return list.length > 0 ? list[0] : null;
        };

        // Count items in the history sidebar that are actively running
        // These are the history items that show the loading spinner animation
        const loadingSpans = querySelectorAllDeep(".message-process-loading-span");
        let active = loadingSpans.length;

        // Also check for text-based indicators in case the spinner class changes
        if (active === 0) {
          const historyItems = querySelectorAllDeep(".c-workflow-history-item");
          for (const item of historyItems) {
            const text = item.textContent?.trim() || "";
            if (
              text.includes("Task is being created") ||
              text.includes("Waiting to start") ||
              text.includes("Running") ||
              text.includes("Queued")
            ) {
              active++;
            }
          }
        }

        // TensorArt specific active task detection (using h2 elements as seen in TensorArt DOM)
        const tensorTasks = querySelectorAllDeep("h2").filter(el => {
          // Ignore hidden elements (e.g. mobile versions of the sidebar)
          if (el.offsetParent === null) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;

          const txt = el.textContent?.trim() || "";
          return txt === "Generating" || txt === "Queued" || txt === "Pending" || txt === "Running";
        });
        active += tensorTasks.length;

        // Fallback: walk all text nodes looking for active-task indicators
        if (active === 0) {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
          let node;
          while (node = walker.nextNode()) {
            const txt = node.nodeValue?.trim() || "";
            if (txt.startsWith("Task is being created") || txt.startsWith("Waiting to start")) {
              active++;
            }
          }
        }

        // Check for upgrade modal and extract limit info if present
        let detectedLimit = null;
        const upgradeModal = querySelectorDeep(".user-upgrade, .hy-business-dialog, .business-modal-backdrop");
        if (upgradeModal) {
          // Instead of parsing VIP text, the limit is the number of active tasks that triggered the modal
          detectedLimit = active || null;

          // Close the modal so it doesn't block future interactions
          try {
            const closeBtn = upgradeModal.querySelector(".user-upgrade-close");
            if (closeBtn) closeBtn.click();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
          } catch (e) { /* ignore */ }
        }

        return { active, detectedLimit, hasUpgradeModal: !!upgradeModal, isHidden: document.hidden };
      }
    }, (results) => {
      if (chrome.runtime.lastError || !results || results.length === 0) {
        resolve({ activeTasks: 0, detectedLimit: null, hasUpgradeModal: false, isHidden: false });
        return;
      }

      let totalActive = 0;
      let detectedLimit = null;
      let hasUpgradeModal = false;
      let isHidden = false;

      for (const r of results) {
        if (r.result) {
          totalActive = Math.max(totalActive, r.result.active || 0);
          if (r.result.detectedLimit) detectedLimit = r.result.detectedLimit;
          if (r.result.hasUpgradeModal) hasUpgradeModal = true;
          if (r.result.isHidden) isHidden = true;
        }
      }

      resolve({ activeTasks: totalActive, detectedLimit, hasUpgradeModal, isHidden });
    });
  });
}

/**
 * Blocks until there is a free task slot on SeaArt.
 * Updates the UI to show "Waiting for slot" while blocked.
 * If no limit is known yet, returns immediately (optimistic).
 */
async function waitUntilSystemReady(tabId) {
  if (!seaArtLimit) return; // Not discovered yet — proceed optimistically

  return new Promise(resolve => {
    function check() {
      countActiveTasks(tabId).then(({ activeTasks, detectedLimit, hasUpgradeModal, isHidden }) => {
        // Update limit if we detected a new one from the modal
        if (detectedLimit && detectedLimit > 0) {
          seaArtLimit = detectedLimit;
        }
        // If upgrade modal appeared, that itself confirms we're at the limit
        if (hasUpgradeModal && !seaArtLimit) {
          seaArtLimit = Math.max(1, activeTasks);
        }

        // Pause queue if the tab is hidden — UNLESS background generation is on.
        if (isHidden && !backgroundGenerationEnabled) {
          if (!isPausedForVisibility) {
            dlog("[SeaArt Queue] Tab is hidden. Pausing queue to prevent lost prompts.");
            isPausedForVisibility = true;
            isWaitingForSlot = false;
            updateQueueUI();
          }
          setTimeout(check, 2000); // Check every 2s if it's visible again
          return;
        } else if (isPausedForVisibility) {
          isPausedForVisibility = false;
        }

        // When tab is visible, we trust the activeTasks count.
        let effectiveTasks = activeTasks;
        if (hasUpgradeModal) {
          effectiveTasks = Math.max(effectiveTasks, seaArtLimit || 1);
        }

        currentActiveTasks = effectiveTasks;
        dlog(`[SeaArt Queue] Active tasks: ${effectiveTasks}/${seaArtLimit}`);

        if (effectiveTasks < seaArtLimit) {
          // Slot available!
          isWaitingForSlot = false;
          updateQueueUI();
          resolve();
        } else {
          // Still at limit — show waiting state and keep polling
          isWaitingForSlot = true;
          updateQueueUI();
          setTimeout(check, SLOT_POLL_INTERVAL_MS);
        }
      });
    }
    check();
  });
}
