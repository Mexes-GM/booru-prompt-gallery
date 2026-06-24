// ─────────────────────────────────────────────────────────────────────────────
// Environment switching logic
// ─────────────────────────────────────────────────────────────────────────────
const btnLocal = document.getElementById("btn-local");
const btnProd = document.getElementById("btn-prod");
const appFrame = document.getElementById("app-frame");

const LOCAL_STORAGE_KEY = "booru_sidebar_env";

function setEnvironment(url) {
  appFrame.src = url;
  if (url.includes("localhost")) {
    btnLocal.classList.add("active");
    btnProd.classList.remove("active");
  } else {
    btnProd.classList.add("active");
    btnLocal.classList.remove("active");
  }
}

// Load saved environment on startup
const savedEnvUrl = localStorage.getItem(LOCAL_STORAGE_KEY) || "http://localhost:3000/extension";
setEnvironment(savedEnvUrl);

btnLocal.addEventListener("click", () => {
  const url = btnLocal.getAttribute("data-url");
  localStorage.setItem(LOCAL_STORAGE_KEY, url);
  setEnvironment(url);
});

btnProd.addEventListener("click", () => {
  const url = btnProd.getAttribute("data-url");
  localStorage.setItem(LOCAL_STORAGE_KEY, url);
  setEnvironment(url);
});

// ─────────────────────────────────────────────────────────────────────────────
// Queue State
// ─────────────────────────────────────────────────────────────────────────────
/** @type {string[]} */
const promptQueue = [];
let isProcessing = false;
let isWaitingForSlot = false; // True when paused due to SeaArt task limit
let currentActiveTasks = 0;   // Last known active task count
let seaArtLimit = 5;          // Default to 5 (Standard plan). Auto-updated if upgrade modal reveals a different number.

// Timeout (ms) to wait for the Generate button to free up before giving up on an item
const GENERATE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
// Polling interval (ms) to check if the Generate button is free
const POLL_INTERVAL_MS = 1500;
// Interval (ms) to poll while waiting for a task slot to open
const SLOT_POLL_INTERVAL_MS = 3000;
// Time (ms) to keep watching for SeaArt's upgrade modal after clicking Generate.
// The Generate button in ComfyUI never becomes 'busy', so we MUST wait this long
// to catch the modal before declaring the generation "free".
const POST_CLICK_MODAL_WATCH_MS = 6000;
// Grace period (ms) after button becomes clickable before we inject the next prompt
// (gives SeaArt a moment to fully settle its UI state)
const GRACE_PERIOD_MS = 800;

// ─────────────────────────────────────────────────────────────────────────────
// Queue Status UI helpers
// ─────────────────────────────────────────────────────────────────────────────
const queueStatusDot  = document.getElementById("queue-status-dot");
const queueStatusText = document.getElementById("queue-status-text");
const queueBadge      = document.getElementById("queue-badge");
const queueTargetBtn  = document.getElementById("queue-target-btn");
const queueClearBtn   = document.getElementById("queue-clear-btn");
const queueBar        = document.getElementById("queue-bar");

function updateQueueUI() {
  const count = promptQueue.length;

  // Badge
  if (count > 0) {
    queueBadge.textContent = `${count} queued`;
    queueBadge.style.display = "inline-flex";
  } else {
    queueBadge.style.display = "none";
  }

  // Clear button & Target button
  queueClearBtn.style.display = count > 0 ? "inline-flex" : "none";
  queueTargetBtn.style.display = "inline-flex";

  // Status dot + text
  if (isWaitingForSlot) {
    queueStatusDot.className = "queue-dot waiting";
    const limitStr = seaArtLimit ? `${currentActiveTasks}/${seaArtLimit}` : `${currentActiveTasks} active`;
    queueStatusText.textContent = `Waiting for slot (${limitStr})`;
  } else if (isProcessing) {
    queueStatusDot.className = "queue-dot generating";
    queueStatusText.textContent = "Generating...";
  } else if (count > 0) {
    queueStatusDot.className = "queue-dot queued";
    queueStatusText.textContent = "Queued";
  } else {
    queueStatusDot.className = "queue-dot idle";
    queueStatusText.textContent = "Ready";
  }

  // Show/hide bar
  queueBar.style.display = "flex"; // Always show so Target is accessible

  // Notify the iframe about queue state
  notifyIframe({ queueLength: count, isProcessing, isWaitingForSlot, currentActiveTasks, seaArtLimit });
}

function notifyIframe(payload) {
  try {
    appFrame.contentWindow.postMessage({ type: "QUEUE_STATUS", ...payload }, "*");
  } catch (_) {
    // iframe may not be ready yet
  }
}

// Target button handler
queueTargetBtn.addEventListener("click", () => {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (!activeTab || !activeTab.id) return;

    chrome.scripting.executeScript({
      target: { tabId: activeTab.id, allFrames: true },
      func: () => {
        const styleId = "booru-target-style";
        if (!document.getElementById(styleId)) {
          const style = document.createElement("style");
          style.id = styleId;
          style.textContent = `
            .booru-selectable-textarea {
              outline: 2px dashed #3b82f6 !important;
              cursor: crosshair !important;
            }
            .booru-selectable-textarea:hover {
              outline: 3px solid #3b82f6 !important;
              background-color: rgba(59, 130, 246, 0.1) !important;
            }
          `;
          document.head.appendChild(style);
        }

        const textareas = document.querySelectorAll("textarea");
        if (textareas.length === 0) {
          // Instead of alerting (which pops up on every frame without a textarea),
          // we silently return. If no frames have textareas, nothing will happen.
          return { count: 0 };
        }

        function onMouseOver(e) {
          e.target.classList.add("booru-selectable-textarea");
        }
        function onMouseOut(e) {
          e.target.classList.remove("booru-selectable-textarea");
        }
        function onClick(e) {
          e.preventDefault();
          e.stopPropagation();

          // Clear previous target
          document.querySelectorAll(".booru-target-textarea").forEach(el => el.classList.remove("booru-target-textarea"));

          // Set new target
          e.target.classList.add("booru-target-textarea");

          // Clean up
          textareas.forEach(t => {
            t.classList.remove("booru-selectable-textarea");
            t.removeEventListener("mouseover", onMouseOver);
            t.removeEventListener("mouseout", onMouseOut);
            t.removeEventListener("click", onClick, true);
          });

          // Visual confirmation
          const originalOutline = e.target.style.outline;
          e.target.style.outline = "3px solid #22c55e";
          setTimeout(() => {
            e.target.style.outline = originalOutline;
          }, 1000);
        }

        textareas.forEach(t => {
          t.addEventListener("mouseover", onMouseOver);
          t.addEventListener("mouseout", onMouseOut);
          t.addEventListener("click", onClick, true);
        });

        return { count: textareas.length };
      }
    }, (results) => {
      if (chrome.runtime.lastError) {
        console.error("Targeting error:", chrome.runtime.lastError);
        return;
      }
      
      const foundTextareas = results.some(r => r.result && r.result.count > 0);
      if (!foundTextareas) {
        // We only want to alert once if we are sure no frames have textareas
        chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: () => alert("No textareas found on this page. If this is a canvas-based tool without textareas, targeting may not work.")
        });
      }
    });
  });
});

// Clear button handler
queueClearBtn.addEventListener("click", () => {
  promptQueue.length = 0;
  updateQueueUI();
});

// ─────────────────────────────────────────────────────────────────────────────
// Core: wait for the Generate action to be confirmed or rejected by SeaArt
// ─────────────────────────────────────────────────────────────────────────────
/**
 * After clicking Generate, polls the page to detect whether SeaArt accepted
 * the generation or rejected it (upgrade modal / "task creation failed").
 *
 * CRITICAL: In SeaArt ComfyUI the Generate button NEVER becomes "busy" ─
 * it stays clickable. So we CANNOT rely on button state alone. Instead we
 * use a mandatory "modal watch window" (POST_CLICK_MODAL_WATCH_MS) during
 * which we keep polling for the upgrade modal regardless of button state.
 *
 * Returns a Promise resolving to:
 *   { status: "free" }                             – generation accepted
 *   { status: "limit_reached", activeTasks, ... }  – upgrade modal or error
 *   { status: "error" }                            – scripting failure
 *   { status: "timeout" }                          – 5-min deadline hit
 */
function waitForGenerateButtonFree(tabId, frameId) {
  return new Promise((resolve) => {
    const deadline = Date.now() + GENERATE_TIMEOUT_MS;
    const modalWatchUntil = Date.now() + POST_CLICK_MODAL_WATCH_MS;

    // Give SeaArt a moment to register the click before first poll
    setTimeout(poll, 1500);

    function poll() {
      if (Date.now() > deadline) {
        console.warn("[Queue] Timed out waiting for generation response.");
        resolve({ status: "timeout" });
        return;
      }

      chrome.scripting.executeScript(
        {
          target: { tabId, allFrames: true },
          func: () => {
            // ── 1. Count active tasks ─────────────────────────────────────
            let activeTasks = document.querySelectorAll(".message-process-loading-span").length;
            if (activeTasks === 0) {
              const historyItems = document.querySelectorAll(".c-workflow-history-item");
              for (const item of historyItems) {
                const t = item.textContent?.trim() || "";
                if (
                  t.includes("Task is being created") ||
                  t.includes("Waiting to start") ||
                  t.includes("Running")
                ) {
                  activeTasks++;
                }
              }
            }
            if (activeTasks === 0) {
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
              let node;
              while (node = walker.nextNode()) {
                const txt = node.nodeValue?.trim() || "";
                if (txt.startsWith("Task is being created") || txt.startsWith("Waiting to start")) activeTasks++;
              }
            }

            // ── 2. Check for the Upgrade / paywall modal ──────────────────
            const upgradeModalBtn = document.querySelector(".user-upgrade-close");
            const businessModal = document.querySelector(
              ".business-modal-backdrop, .user-upgrade, .hy-business-dialog"
            );
            let hitLimit = false;
            let detectedLimit = null;

            if (upgradeModalBtn || businessModal) {
              hitLimit = true;

              // Parse the concurrent task limit from the modal text
              // e.g. "create 10 tasks simultaneously"
              const modalEl = businessModal || upgradeModalBtn?.closest(".user-upgrade") ||
                              document.querySelector(".el-overlay-dialog");
              if (modalEl) {
                const mText = modalEl.textContent || "";
                const match = mText.match(/(\d+)\s*tasks\s*simultaneously/i);
                if (match) detectedLimit = parseInt(match[1], 10);
              }

              // Close the modal
              try {
                if (upgradeModalBtn) upgradeModalBtn.click();
                document.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "Escape", code: "Escape",
                    keyCode: 27, which: 27, bubbles: true,
                  })
                );
              } catch (e) { /* ignore */ }
            }

            // ── 3. Check for "task creation failed" error notification ─────
            let taskFailed = false;
            // SeaArt shows a top banner / notification when creation fails
            const errorEls = document.querySelectorAll(
              ".el-notification, .el-message, .el-message--error, " +
              "[class*='notification'], [class*='message-error'], " +
              ".el-notification__content, [class*='error-tip']"
            );
            for (const el of errorEls) {
              const txt = (el.textContent || "").toLowerCase();
              if (
                txt.includes("task creation failed") ||
                txt.includes("task failed") ||
                txt.includes("creation failed") ||
                txt.includes("tarea fallida")
              ) {
                taskFailed = true;
                break;
              }
            }

            // ── 4. Check Generate button state ────────────────────────────
            const btn =
              document.querySelector('button[data-gtm-event="Complete Generation Image"]') ||
              document.querySelector('button[data-gtm-event*="Generation"]') ||
              document.querySelector("#txt2img_generate") ||
              document.querySelector(".work-flow-bottom-btn-main-text") ||
              document.querySelector(".work-flow-bottom-btn") ||
              (() => {
                const buttons = Array.from(document.querySelectorAll("button"));
                return buttons.find((b) => {
                  const text = b.textContent?.trim().toLowerCase();
                  return (
                    text &&
                    (text === "generate" || text === "generar" ||
                     text.includes("generate image") || text.includes("generar imagen"))
                  );
                });
              })();

            if (!btn) {
              return { hitLimit, activeTasks, detectedLimit, taskFailed, found: false, busy: false };
            }

            const isDisabled = btn.disabled || btn.getAttribute("aria-disabled") === "true";
            const hasSpinner = !!btn.querySelector(
              ".animate-spin, .loading, [class*='spinner'], [class*='loading']"
            );
            const computedStyle = window.getComputedStyle(btn);
            const hasLowOpacity = parseFloat(computedStyle.opacity) < 0.6;
            const text = btn.textContent?.trim().toLowerCase() || "";
            const isGeneratingText =
              text.includes("generating") || text.includes("generando") ||
              text.includes("processing") || text.includes("procesando");

            const busy = isDisabled || hasSpinner || hasLowOpacity || isGeneratingText;
            return { hitLimit, activeTasks, detectedLimit, taskFailed, found: true, busy };
          },
        },
        (results) => {
          if (chrome.runtime.lastError) {
            console.warn("[Queue] Tab scripting error:", chrome.runtime.lastError.message);
            resolve({ status: "error" });
            return;
          }

          if (!results || results.length === 0) {
            resolve({ status: "error" });
            return;
          }

          let anyHitLimit = false;
          let anyTaskFailed = false;
          let maxTasks = 0;
          let detectedLimit = null;
          let buttonFound = false;
          let buttonBusy = false;

          for (const r of results) {
            if (r.result?.hitLimit) anyHitLimit = true;
            if (r.result?.taskFailed) anyTaskFailed = true;
            if (r.result?.activeTasks) maxTasks = Math.max(maxTasks, r.result.activeTasks);
            if (r.result?.detectedLimit) detectedLimit = r.result.detectedLimit;
            if (r.result?.found) {
              buttonFound = true;
              if (r.result.busy) buttonBusy = true;
            }
          }

          // ── Immediate resolve: limit modal detected ─────────────────────
          if (anyHitLimit) {
            console.warn(`[Queue] Upgrade modal detected! Tasks: ${maxTasks}, Limit: ${detectedLimit}`);
            resolve({ status: "limit_reached", activeTasks: maxTasks, detectedLimit, taskFailed: anyTaskFailed });
            return;
          }

          // ── Immediate resolve: "task creation failed" error ─────────────
          if (anyTaskFailed) {
            console.warn(`[Queue] "task creation failed" detected! Tasks: ${maxTasks}`);
            resolve({ status: "limit_reached", activeTasks: maxTasks, detectedLimit, taskFailed: true });
            return;
          }

          // ── MODAL WATCH WINDOW ──────────────────────────────────────────
          // The Generate button in SeaArt ComfyUI NEVER becomes "busy".
          // If we resolved "free" immediately, we'd miss the upgrade modal
          // that appears 2-4 seconds later. So we MUST keep polling during
          // this window even if the button looks free.
          const stillWatching = Date.now() < modalWatchUntil;

          if (stillWatching) {
            // Fast polling during modal watch (every 800ms)
            setTimeout(poll, 800);
            return;
          }

          // ── Post-watch: also check active tasks vs known limit ──────────
          if (seaArtLimit && maxTasks >= seaArtLimit) {
            console.warn(`[Queue] Active tasks ${maxTasks} >= limit ${seaArtLimit} (no modal but at capacity)`);
            resolve({ status: "limit_reached", activeTasks: maxTasks, detectedLimit });
            return;
          }

          // ── Post-watch: normal button-state check ───────────────────────
          if (!buttonFound || !buttonBusy) {
            resolve({ status: "free" });
          } else {
            setTimeout(poll, POLL_INTERVAL_MS);
          }
        }
      );
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: inject prompt into the active tab
// ─────────────────────────────────────────────────────────────────────────────
function injectPromptToTab(tabId, promptText) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId, allFrames: true },
        func: async (text) => {
          // 1. Selector patterns for A1111 / WebUI Forge and TensorArt / TensorHub / SeaArt
          let promptTextarea =
            document.querySelector(".booru-target-textarea") ||
            document.querySelector("#txt2img_prompt textarea") ||
            document.querySelector("#txt2img_prompt_row textarea") ||
            document.querySelector("textarea[placeholder*='Prompt (press Ctrl+Enter to generate)']") ||
            document.querySelector("#txt2img_prompt_row #txt2img_prompt textarea") ||
            document.querySelector("textarea.comfy-multiline-input"); // SeaArt

          // Advanced Fallback
          if (!promptTextarea) {
            const textareas = Array.from(document.querySelectorAll("textarea"));
            promptTextarea =
              textareas.find((t) => t.classList.contains("group-input")) ||
              textareas.find((t) => t.placeholder && t.placeholder.toLowerCase().includes("prompt")) ||
              textareas.find((t) => {
                const style = window.getComputedStyle(t);
                return style.display !== "none" && style.visibility !== "hidden";
              });
          }

          if (promptTextarea) {
            // Input injection supporting React, Vue, and vanilla DOM setters
            try {
              const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                "value"
              ).set;
              nativeSetter.call(promptTextarea, text);
            } catch (e) {
              promptTextarea.value = text;
            }

            promptTextarea.dispatchEvent(new Event("input", { bubbles: true }));
            promptTextarea.dispatchEvent(new Event("change", { bubbles: true }));

            // Give React/Vue time to update its state before clicking Generate
            await new Promise((r) => setTimeout(r, 400));

            // 2. Selector patterns for generate button
            let genBtn =
              document.querySelector("#txt2img_generate") ||
              document.querySelector('button[data-gtm-event="Complete Generation Image"]') ||
              document.querySelector('button[data-gtm-event*="Generation"]') ||
              document.querySelector(".work-flow-bottom-btn-main-text") ||
              document.querySelector(".work-flow-bottom-btn");

            if (!genBtn) {
              const buttons = Array.from(document.querySelectorAll("button"));
              genBtn = buttons.find((b) => {
                const bText = b.textContent?.trim().toLowerCase();
                return (
                  bText &&
                  (bText === "generate" ||
                    bText === "generar" ||
                    bText.includes("generate image") ||
                    bText.includes("generar imagen"))
                );
              });
            }

            if (genBtn) {
              // Standard click
              genBtn.click();
              
              // Dispatch mouse events for frameworks that rely on mousedown/up
              const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
              for (const type of events) {
                genBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
              }
              
              // If we selected the parent div, try to click the inner text just in case
              const innerText = genBtn.querySelector(".work-flow-bottom-btn-main-text");
              if (innerText) {
                innerText.click();
                for (const type of events) {
                  innerText.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
                }
              }
            }
            return { success: true, hasButton: !!genBtn };
          }

          return { success: false, hasButton: false };
        },
        args: [promptText],
      },
      (results) => {
        if (chrome.runtime.lastError) {
          console.warn("[Queue] Injection error:", chrome.runtime.lastError.message);
          resolve({ success: false });
          return;
        }
        
        // Find a successful injection result in any frame
        const successfulFrame = results?.find(r => r.result && r.result.success);
        if (successfulFrame) {
          resolve({ 
            success: true, 
            hasButton: successfulFrame.result.hasButton,
            frameId: successfulFrame.frameId 
          });
        } else {
          resolve({ success: false });
        }
      }
    );
  });
}

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
        // Count items in the history sidebar that are actively running
        // These are the history items that show the loading spinner animation
        const loadingSpans = document.querySelectorAll(".message-process-loading-span");
        let active = loadingSpans.length;

        // Also check for text-based indicators in case the spinner class changes
        if (active === 0) {
          const historyItems = document.querySelectorAll(".c-workflow-history-item");
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
        const upgradeModal = document.querySelector(".user-upgrade, .hy-business-dialog, .business-modal-backdrop");
        if (upgradeModal) {
          // The modal tells us the limit. Try to parse it.
          const modalText = upgradeModal.textContent || "";
          // e.g. "Upgrade to Professional Plan SVIP to create 10 tasks simultaneously"
          const match = modalText.match(/(\d+)\s*tasks\s*simultaneously/i);
          if (match) {
            detectedLimit = parseInt(match[1], 10);
          }

          // Close the modal so it doesn't block future interactions
          try {
            const closeBtn = upgradeModal.querySelector(".user-upgrade-close");
            if (closeBtn) closeBtn.click();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
          } catch (e) { /* ignore */ }
        }

        return { active, detectedLimit, hasUpgradeModal: !!upgradeModal };
      }
    }, (results) => {
      if (chrome.runtime.lastError || !results || results.length === 0) {
        resolve({ activeTasks: 0, detectedLimit: null, hasUpgradeModal: false });
        return;
      }

      let totalActive = 0;
      let detectedLimit = null;
      let hasUpgradeModal = false;

      for (const r of results) {
        if (r.result) {
          totalActive = Math.max(totalActive, r.result.active || 0);
          if (r.result.detectedLimit) detectedLimit = r.result.detectedLimit;
          if (r.result.hasUpgradeModal) hasUpgradeModal = true;
        }
      }

      resolve({ activeTasks: totalActive, detectedLimit, hasUpgradeModal });
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
      countActiveTasks(tabId).then(({ activeTasks, detectedLimit, hasUpgradeModal }) => {
        // Update limit if we detected a new one from the modal
        if (detectedLimit && detectedLimit > 0) {
          seaArtLimit = detectedLimit;
        }
        // If upgrade modal appeared, that itself confirms we're at the limit
        if (hasUpgradeModal && !seaArtLimit) {
          seaArtLimit = Math.max(1, activeTasks);
        }

        currentActiveTasks = activeTasks;
        console.log(`[SeaArt Queue] Active tasks: ${activeTasks}/${seaArtLimit}`);

        if (activeTasks < seaArtLimit) {
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

async function processNext() {
  // Guard: only one processNext flow at a time
  if (isProcessing || isWaitingForSlot || promptQueue.length === 0) return;

  isProcessing = true;
  updateQueueUI();

  // Get the active tab of the current window (where the side panel is attached)
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    let activeTab = tabs[0];

    // If for some reason we don't have a valid tab, try finding any SeaArt tab
    if (!activeTab || !activeTab.url || activeTab.url.startsWith("chrome://") || activeTab.url.startsWith("devtools://") || activeTab.url.startsWith("chrome-extension://")) {
       const seaArtTabs = await chrome.tabs.query({ url: "*://*.seaart.ai/*" });
       if (seaArtTabs.length > 0) activeTab = seaArtTabs[0];
    }

    if (
      !activeTab ||
      !activeTab.id ||
      !activeTab.url ||
      activeTab.url.startsWith("chrome://") ||
      activeTab.url.startsWith("devtools://") ||
      activeTab.url.startsWith("chrome-extension://")
    ) {
      console.warn("[Queue] No valid active tab found, pausing queue.");
      isProcessing = false;
      updateQueueUI();
      // DO NOT DISCARD the prompt. Just stop processing until they go back to SeaArt.
      return;
    }

    const tabId = activeTab.id;

    // ── PRE-FLIGHT CHECK ──────────────────────────────────────────────────
    // Before even injecting, check if we're at the task limit.
    // This prevents wasted generation attempts that would just trigger the
    // upgrade modal and fail.
    // NOTE: Runs ALWAYS (even when seaArtLimit is null) to detect the modal
    // proactively and discover the limit early.
    const preCheck = await countActiveTasks(tabId);
    currentActiveTasks = preCheck.activeTasks;

    // Update limit from modal if discovered
    if (preCheck.detectedLimit) seaArtLimit = preCheck.detectedLimit;
    if (preCheck.hasUpgradeModal && !seaArtLimit) {
      seaArtLimit = Math.max(1, preCheck.activeTasks);
    }

    if (seaArtLimit && preCheck.activeTasks >= seaArtLimit) {
      console.log(`[SeaArt Queue] Pre-flight: at limit (${preCheck.activeTasks}/${seaArtLimit}). Waiting for slot...`);
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

    // Now safely pull from queue
    const promptText = promptQueue.shift();

    // Inject the prompt and click Generate
    const injectResult = await injectPromptToTab(tabId, promptText);

    if (!injectResult.success) {
      console.warn("[Queue] Prompt injection failed, re-queuing.");
      promptQueue.unshift(promptText); // Put it back, don't lose it
      isProcessing = false;
      updateQueueUI();
      // Brief delay before retry to avoid tight loop
      setTimeout(processNext, 2000);
      return;
    }

    // If we found a Generate button and clicked it, wait for it to free up
    if (injectResult.hasButton) {
      const waitResult = await waitForGenerateButtonFree(tabId, injectResult.frameId);
      
      if (waitResult?.status === "limit_reached") {
        // Discover/update the limit from the modal encounter
        if (waitResult.detectedLimit) {
          seaArtLimit = waitResult.detectedLimit;
        } else {
          // Fallback: count tasks now to infer the limit
          const postCheck = await countActiveTasks(tabId);
          if (postCheck.detectedLimit) {
            seaArtLimit = postCheck.detectedLimit;
          } else {
            seaArtLimit = Math.max(1, waitResult.activeTasks || postCheck.activeTasks || 1);
          }
          currentActiveTasks = postCheck.activeTasks || waitResult.activeTasks || seaArtLimit;
        }
        currentActiveTasks = waitResult.activeTasks || currentActiveTasks || seaArtLimit;
        console.warn(`[SeaArt Queue] Limit reached! Discovered limit: ${seaArtLimit}. Active: ${currentActiveTasks}. Task failed: ${waitResult.taskFailed}`);

        // SeaArt shows "task creation failed" → the prompt was NOT accepted.
        // Re-queue it so it's not lost.
        if (waitResult.taskFailed) {
          console.log(`[SeaArt Queue] Re-queuing failed prompt.`);
          promptQueue.unshift(promptText);
        }

        isWaitingForSlot = true;
        // Keep isProcessing = true to prevent re-entry during the wait
        updateQueueUI();

        // Wait for a slot, then continue
        await waitUntilSystemReady(tabId);
        isProcessing = false;
        isWaitingForSlot = false;
        processNext();
        return;
      }

      if (waitResult?.status !== "free") {
        console.warn("[Queue] Generate button did not free up within timeout, moving on.");
      }
      
      // Grace period before next injection
      await new Promise((r) => setTimeout(r, GRACE_PERIOD_MS));
    } else {
      // No Generate button found (e.g. A1111 direct), just wait a short grace period
      await new Promise((r) => setTimeout(r, 2000));
    }

    isProcessing = false;
    isWaitingForSlot = false;
    updateQueueUI();
    processNext(); // ← process next item in queue
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Listener for postMessage events from the Next.js page inside the iframe
// ─────────────────────────────────────────────────────────────────────────────
window.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "INJECT_PROMPT") {
    const promptText = event.data.prompt;
    if (!promptText) return;

    promptQueue.push(promptText);
    updateQueueUI();

    // Kick off processing if not already running
    processNext();
  }
});

// When the iframe finishes loading, send it the current queue state
// (the initial notifyIframe call in updateQueueUI fires before the iframe is ready)
appFrame.addEventListener("load", () => {
  notifyIframe({ queueLength: promptQueue.length, isProcessing, isWaitingForSlot, currentActiveTasks, seaArtLimit });
});

// Initial UI state
updateQueueUI();
