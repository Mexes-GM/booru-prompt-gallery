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
let isPausedForVisibility = false; // True when target tab is hidden
let currentActiveTasks = 0;   // Last known active task count
let seaArtLimit = 5;          // Default to 5 (Standard plan). Auto-updated if upgrade modal reveals a different number.
let currentPlatform = "Unknown";

// ── Safety: duplicate / stuck-prompt detection ──────────────────────────────
let lastGeneratedPrompt = null;     // Track the last prompt that was successfully sent to Generate
let consecutiveSamePrompt = 0;      // How many times in a row the same prompt was generated
const MAX_CONSECUTIVE_SAME = 2;     // Pause queue if same prompt generated more than this many times
let currentPromptRetries = 0;       // Retry counter for the current prompt
const MAX_PROMPT_RETRIES = 3;       // Max retries before skipping a prompt
let isPausedForError = false;       // True when paused due to safety error (stuck prompt, etc.)

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
// Queue Persistence (chrome.storage.local)
// ─────────────────────────────────────────────────────────────────────────────
const QUEUE_STORAGE_KEY = "booru_prompt_queue";

/** Save the current promptQueue to chrome.storage.local */
function persistQueue() {
  try {
    chrome.storage.local.set({ [QUEUE_STORAGE_KEY]: [...promptQueue] });
  } catch (e) {
    console.warn("[Queue] Failed to persist queue:", e);
  }
}

/** Restore promptQueue from chrome.storage.local on startup */
function restoreQueue() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([QUEUE_STORAGE_KEY], (result) => {
        const saved = result[QUEUE_STORAGE_KEY];
        if (Array.isArray(saved) && saved.length > 0) {
          promptQueue.push(...saved);
          console.log(`[Queue] Restored ${saved.length} prompts from storage.`);
          updateQueueUI();
        }
        resolve();
      });
    } catch (e) {
      console.warn("[Queue] Failed to restore queue:", e);
      resolve();
    }
  });
}

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
  if (isPausedForError) {
    queueStatusDot.className = "queue-dot error";
    queueStatusText.textContent = "⚠ Error: Same prompt detected — paused";
  } else if (isPausedForVisibility) {
    queueStatusDot.className = "queue-dot idle"; // or paused class if you have one
    queueStatusText.textContent = "Paused (Tab Hidden)";
  } else if (isWaitingForSlot) {
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
  notifyIframe({ queueLength: count, isProcessing, isWaitingForSlot, isPausedForVisibility, isPausedForError, currentActiveTasks, seaArtLimit, platform: currentPlatform });
}

function notifyIframe(payload) {
  try {
    const _to=(function(){try{return new URL(appFrame.src).origin;}catch(_){return "*";}})();
    appFrame.contentWindow.postMessage({ type: "QUEUE_STATUS", ...payload }, _to);
  } catch (_) {
    // iframe may not be ready yet
  }
}

// Allow iframe to trigger actions
window.addEventListener("message", (e) => {
  if (e.source !== appFrame.contentWindow) return;
  try { if (e.origin !== new URL(appFrame.src).origin) return; } catch (_) { return; }
  if (e.data && e.data.type === "QUEUE_ACTION") {
    if (e.data.action === "target") queueTargetBtn.click();
    if (e.data.action === "clear") queueClearBtn.click();
  }
  // React app asking for initial state on mount
  if (e.data && e.data.type === "REQUEST_QUEUE_STATUS") {
    updateQueueUI();
  }
});

// Target button handler
queueTargetBtn.addEventListener("click", () => {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (!activeTab || !activeTab.id) return;

    // Update target info pill
    const url = activeTab.url || "";
    let platform = "Unknown";
    if (url.includes("seaart.ai")) platform = "SeaArt";
    else if (url.includes("tensor.art")) platform = "TensorArt";
    else if (url.includes("tensorhub.net")) platform = "TensorHub";
    else if (url.includes("yodayo.com")) platform = "Yodayo";
    else if (url) {
      try { platform = new URL(url).hostname.replace('www.', ''); } catch(e) {}
    }
    currentPlatform = platform;
    document.getElementById("target-info-platform").textContent = platform;
    document.getElementById("target-info-pill").style.display = "block";
    updateQueueUI(); // Notify iframe

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
  // Reset safety state
  isPausedForError = false;
  consecutiveSamePrompt = 0;
  currentPromptRetries = 0;
  lastGeneratedPrompt = null;
  persistQueue();
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
            // ── 1. Count active tasks (SeaArt & TensorArt) ────────────────
            let activeTasks = document.querySelectorAll(".message-process-loading-span").length;
            if (activeTasks === 0) {
              const historyItems = document.querySelectorAll(".c-workflow-history-item");
              for (const item of historyItems) {
                const t = item.textContent?.trim() || "";
                if (
                  t.includes("Task is being created") ||
                  t.includes("Waiting to start") ||
                  t.includes("Running") ||
                  t.includes("Queued")
                ) {
                  activeTasks++;
                }
              }
            }
            
            // TensorArt active tasks (look for "Generating", "Queued" in h2 elements)
            const tensorTasks = Array.from(document.querySelectorAll("h2")).filter(el => {
              // Ignore hidden elements (e.g. mobile versions of the sidebar)
              if (el.offsetParent === null) return false;
              const style = window.getComputedStyle(el);
              if (style.display === "none" || style.visibility === "hidden") return false;

              const txt = el.textContent?.trim() || "";
              return txt === "Generating" || txt === "Queued" || txt === "Pending" || txt === "Running";
            });
            activeTasks += tensorTasks.length;
            if (activeTasks === 0) {
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
              let node;
              while (node = walker.nextNode()) {
                const txt = node.nodeValue?.trim() || "";
                if (txt.startsWith("Task is being created") || txt.startsWith("Waiting to start")) activeTasks++;
              }
            }

            // ── 2. Check for the Upgrade / paywall / queue limit modals ──────────────────
            const upgradeModalBtn = document.querySelector(".user-upgrade-close");
            const businessModal = document.querySelector(
              ".business-modal-backdrop, .user-upgrade, .hy-business-dialog"
            );
            
            // TensorArt Queue Full Modal
            const tensorModal = document.querySelector(".n-dialog");
            let isTensorQueueFull = false;
            let tensorCloseBtn = null;
            if (tensorModal) {
              const textContent = tensorModal.textContent || "";
              if (textContent.includes("Generate failed") && textContent.includes("Generation queue is full")) {
                isTensorQueueFull = true;
                tensorCloseBtn = tensorModal.querySelector(".n-dialog__close, .n-base-close");
              }
            }

            let hitLimit = false;
            let detectedLimit = null;

            if (upgradeModalBtn || businessModal || isTensorQueueFull) {
              hitLimit = true;

              // Parse the concurrent task limit from the modal text (SeaArt)
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
                if (tensorCloseBtn) tensorCloseBtn.click();
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

            // ── 3.5 Check for TensorArt success / loading spinners ─────────
            let taskSucceeded = false;
            let globalBusy = false;

            if (document.querySelector(".n-message__icon--success-type") || 
                Array.from(document.querySelectorAll(".n-message, .n-message__content")).some(el => (el.textContent || "").includes("successfully"))) {
              taskSucceeded = true;
            }

            if (document.querySelector(".n-spin-body, .__spin-dark-njtao5-m, .n-base-loading")) {
              globalBusy = true;
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
              return { hitLimit, activeTasks, detectedLimit, taskFailed, taskSucceeded, globalBusy, found: false, busy: false };
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
            return { hitLimit, activeTasks, detectedLimit, taskFailed, taskSucceeded, globalBusy, found: true, busy };
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
          let anyTaskSucceeded = false;
          let anyGlobalBusy = false;
          let maxTasks = 0;
          let detectedLimit = null;
          let buttonFound = false;
          let buttonBusy = false;

          for (const r of results) {
            if (r.result?.hitLimit) anyHitLimit = true;
            if (r.result?.taskFailed) anyTaskFailed = true;
            if (r.result?.taskSucceeded) anyTaskSucceeded = true;
            if (r.result?.globalBusy) anyGlobalBusy = true;
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

          // ── Immediate resolve: "Task submitted successfully" (TensorArt) ──
          if (anyTaskSucceeded) {
            console.log(`[Queue] Task submitted successfully (fast-track resolve).`);
            resolve({ status: "free" });
            return;
          }

          // ── MODAL WATCH WINDOW ──────────────────────────────────────────
          // The Generate button in SeaArt ComfyUI NEVER becomes "busy".
          // If we resolved "free" immediately, we'd miss the upgrade modal
          // that appears 2-4 seconds later. So we MUST keep polling during
          // this window even if the button looks free.
          
          if (anyGlobalBusy) {
            // TensorArt spinner is active, wait for it to finish
            setTimeout(poll, 800);
            return;
          }

          const stillWatching = Date.now() < modalWatchUntil;
          if (stillWatching) {
            // Fast polling during modal watch (every 800ms)
            setTimeout(poll, 800);
            return;
          }

          // ── Post-watch: normal button-state check ───────────────────────
          // NOTE: maxTasks >= limit WITHOUT the upgrade modal is NOT a block.
          // SeaArt accepts tasks beyond the displayed limit (internal queue).
          // Only the upgrade modal (anyHitLimit) or "task creation failed" are real blocks.
          if (seaArtLimit && maxTasks >= seaArtLimit) {
            console.log(`[Queue] Active tasks at capacity (${maxTasks}/${seaArtLimit}) but no modal — generation was accepted.`);
          }
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
          // ── 1. Find the prompt textarea ────────────────────────────────────
          // Priority order: user-targeted > platform-specific > generic fallback
          let promptTextarea =
            document.querySelector(".booru-target-textarea") ||
            document.querySelector("#txt2img_prompt textarea") ||
            document.querySelector("#txt2img_prompt_row textarea") ||
            document.querySelector("textarea[placeholder*='Prompt (press Ctrl+Enter to generate)']") ||
            document.querySelector("#txt2img_prompt_row #txt2img_prompt textarea") ||
            document.querySelector("textarea.comfy-multiline-input"); // SeaArt

          // Advanced Fallback — but ONLY textareas that look like prompt inputs
          if (!promptTextarea) {
            const textareas = Array.from(document.querySelectorAll("textarea"));
            promptTextarea =
              textareas.find((t) => t.classList.contains("group-input")) ||
              textareas.find((t) => t.placeholder && t.placeholder.toLowerCase().includes("prompt")) ||
              textareas.find((t) => {
                const style = window.getComputedStyle(t);
                if (style.display === "none" || style.visibility === "hidden") return false;
                // Safety: skip textareas that look like search bars (small, single-line)
                const rect = t.getBoundingClientRect();
                if (rect.height < 40 && t.rows <= 1) return false;
                return true;
              });
          }

          if (!promptTextarea) {
            return { success: false, hasButton: false, reason: "no_textarea" };
          }

          // ── 2. Read what was in the textarea BEFORE we inject ──────────────
          const previousValue = promptTextarea.value || "";

          // ── 3. Inject the prompt ──────────────────────────────────────────
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

          // Give React/Vue time to update its state before verifying
          await new Promise((r) => setTimeout(r, 400));

          // ── 4. Verify the prompt actually updated ─────────────────────────
          if (promptTextarea.value.trim() !== text.trim()) {
            // The framework (e.g., TensorArt's React state) might have overwritten our injection.
            // Try a more aggressive fallback using focus and blur.
            promptTextarea.focus();
            try {
              const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
              nativeSetter.call(promptTextarea, text);
            } catch (e) {
              promptTextarea.value = text;
            }
            promptTextarea.dispatchEvent(new Event("input", { bubbles: true }));
            promptTextarea.dispatchEvent(new Event("change", { bubbles: true }));
            promptTextarea.blur();
            
            await new Promise((r) => setTimeout(r, 400));
            
            // Final verification — if it STILL doesn't match, DO NOT click Generate
            if (promptTextarea.value.trim() !== text.trim()) {
              return { 
                success: false, 
                hasButton: false, 
                reason: "verification_failed",
                actualValue: promptTextarea.value.substring(0, 100),
                expectedValue: text.substring(0, 100)
              };
            }
          }

          // ── 5. Find the Generate button ───────────────────────────────────
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

          // ── 6. CRITICAL SAFETY CHECK: Re-read the textarea right before clicking ──
          // This is the ultimate guard against the bug where React/Vue re-renders
          // reset the textarea between our injection and the Generate click.
          const valueBeforeClick = promptTextarea.value.trim();
          if (valueBeforeClick !== text.trim()) {
            return {
              success: false,
              hasButton: !!genBtn,
              reason: "pre_click_mismatch",
              actualValue: valueBeforeClick.substring(0, 100),
              expectedValue: text.substring(0, 100)
            };
          }

          // ── 7. Click Generate ─────────────────────────────────────────────
          if (genBtn) {
            // Clean up old TensorArt toast messages so they don't falsely trigger the fast-track resolve
            document.querySelectorAll(".n-message").forEach(el => el.remove());

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
          return { 
            success: true, 
            hasButton: !!genBtn, 
            previousValue: previousValue.substring(0, 100),
            injectedValue: text.substring(0, 100)
          };
        },
        args: [promptText],
      },
      (results) => {
        if (chrome.runtime.lastError) {
          console.warn("[Queue] Injection error:", chrome.runtime.lastError.message);
          resolve({ success: false, reason: "scripting_error" });
          return;
        }
        
        // Find a successful injection result in any frame
        const successfulFrame = results?.find(r => r.result && r.result.success);
        if (successfulFrame) {
          console.log(`[Queue] ✓ Prompt injected. Previous: "${successfulFrame.result.previousValue}..." → New: "${successfulFrame.result.injectedValue}..."`);
          resolve({ 
            success: true, 
            hasButton: successfulFrame.result.hasButton,
            frameId: successfulFrame.frameId 
          });
        } else {
          // Log why it failed
          const failedFrame = results?.find(r => r.result && r.result.reason);
          const reason = failedFrame?.result?.reason || "unknown";
          console.warn(`[Queue] ✗ Injection failed: ${reason}`, failedFrame?.result);
          resolve({ success: false, reason });
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

        // TensorArt specific active task detection (using h2 elements as seen in TensorArt DOM)
        const tensorTasks = Array.from(document.querySelectorAll("h2")).filter(el => {
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

        // Pause queue if the tab is hidden
        if (isHidden) {
          if (!isPausedForVisibility) {
            console.log("[SeaArt Queue] Tab is hidden. Pausing queue to prevent lost prompts.");
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
        console.log(`[SeaArt Queue] Active tasks: ${effectiveTasks}/${seaArtLimit}`);

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

async function processNext() {
  // Guard: only one processNext flow at a time
  if (isProcessing || isWaitingForSlot || isPausedForError || promptQueue.length === 0) return;

  isProcessing = true;
  updateQueueUI();

  // Get the target generation tab — prefer finding it directly, regardless of which tab is active.
  // This allows the queue to keep running even if the user switches to another tab.
  // Supported platforms: SeaArt, TensorArt, TensorHub, Yodayo
  const PLATFORM_DOMAINS = ["seaart.ai", "tensor.art", "tensorhub.net", "yodayo.com"];
  const WORKFLOW_PATHS = ["/workflow", "/canvas", "/comfyui", "/generate", "/models"];

  chrome.tabs.query({ currentWindow: true }, async (allTabs) => {
    let activeTab = null;
    const currentActive = allTabs.find(t => t.active);

    // 1. HIGHEST priority: If the currently active tab is a supported platform, or looks like a local UI (A1111/ComfyUI)
    if (currentActive && currentActive.url && (
      PLATFORM_DOMAINS.some(d => currentActive.url.includes(d)) ||
      currentActive.url.includes("127.0.0.1") ||
      currentActive.url.includes("localhost") ||
      currentActive.url.includes("gradio.live")
    )) {
      activeTab = currentActive;
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
      !activeTab.url ||
      activeTab.url.startsWith("chrome://") ||
      activeTab.url.startsWith("devtools://") ||
      activeTab.url.startsWith("chrome-extension://")
    ) {
      console.warn("[Queue] No valid tab found, pausing queue.");
      isProcessing = false;
      updateQueueUI();
      return;
    }

    const tabId = activeTab.id;

    // Helper function to block if tab is hidden before we even try to check limit
    async function waitForVisibility() {
      return new Promise(resolve => {
        async function check() {
          const { isHidden } = await countActiveTasks(tabId);
          if (isHidden) {
            if (!isPausedForVisibility) {
              console.log("[SeaArt Queue] Tab is hidden. Pausing queue before injection.");
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
    persistQueue(); // ← Save queue state after removing item

    // ── SAFETY: Stuck-on-same-prompt detection ───────────────────────────
    // If we're about to generate the exact same prompt as the last one,
    // increment the counter. If it exceeds the max, PAUSE the queue.
    if (lastGeneratedPrompt !== null && promptText.trim() === lastGeneratedPrompt.trim()) {
      consecutiveSamePrompt++;
      console.warn(`[Queue Safety] Same prompt as last generation (${consecutiveSamePrompt}/${MAX_CONSECUTIVE_SAME}): "${promptText.substring(0, 80)}..."`);
      if (consecutiveSamePrompt > MAX_CONSECUTIVE_SAME) {
        console.error(`[Queue Safety] ⚠ PAUSING QUEUE: Same prompt generated ${consecutiveSamePrompt} times in a row. This looks like a bug.`);
        promptQueue.unshift(promptText); // Put it back
        persistQueue();
        isPausedForError = true;
        isProcessing = false;
        updateQueueUI();
        return;
      }
    } else {
      consecutiveSamePrompt = 0;
    }

    // Inject the prompt and click Generate
    const injectResult = await injectPromptToTab(tabId, promptText);

    if (!injectResult.success) {
      currentPromptRetries++;
      console.warn(`[Queue] Prompt injection failed (attempt ${currentPromptRetries}/${MAX_PROMPT_RETRIES}), reason: ${injectResult.reason}`);

      if (currentPromptRetries >= MAX_PROMPT_RETRIES) {
        // ── Max retries exceeded: skip this prompt ──────────────────────
        console.error(`[Queue] ✗ Skipping prompt after ${MAX_PROMPT_RETRIES} failed attempts: "${promptText.substring(0, 80)}..."`);
        console.error(`[Queue]   Last failure reason: ${injectResult.reason}`);
        currentPromptRetries = 0;
        // Do NOT re-queue — the prompt is lost, but this prevents infinite loops.
        // The queue continues with the next item.
        persistQueue();
        isProcessing = false;
        updateQueueUI();
        // Brief delay, then continue with next
        setTimeout(processNext, 2000);
        return;
      }

      // Re-queue for retry
      promptQueue.unshift(promptText);
      persistQueue();
      isProcessing = false;
      updateQueueUI();
      // Exponential backoff: 2s, 4s, 8s
      const backoffMs = 2000 * Math.pow(2, currentPromptRetries - 1);
      console.log(`[Queue] Retrying in ${backoffMs}ms...`);
      setTimeout(processNext, backoffMs);
      return;
    }

    // ── Injection succeeded! Reset retry counter ───────────────────────
    currentPromptRetries = 0;
    lastGeneratedPrompt = promptText;

    // If we found a Generate button and clicked it, wait for it to free up
    if (injectResult.hasButton) {
      const waitResult = await waitForGenerateButtonFree(tabId, injectResult.frameId);
      
      if (waitResult?.status === "limit_reached") {
        // Smart queue detector: if we hit the limit modal, we know for a fact the queue is full.
        // Update our internal understanding of the limit.
        console.log("[SeaArt Queue] Hit paywall/upgrade modal! Recalibrating queue knowledge.");
        if (waitResult.detectedLimit) {
          seaArtLimit = waitResult.detectedLimit;
        } else if (!seaArtLimit) {
          const postCheck = await countActiveTasks(tabId);
          seaArtLimit = Math.max(1, postCheck.detectedLimit || postCheck.activeTasks || waitResult.activeTasks || 1);
        }
        
        // Force current active tasks to equal the limit so we wait properly.
        currentActiveTasks = seaArtLimit;
        console.warn(`[SeaArt Queue] Limit reached. Calibrated: ${currentActiveTasks}/${seaArtLimit}.`);

        // ── Retry strategy (NO re-queue) ─────────────────────────────────
        // Re-queuing would create a tight loop: same prompt → inject → blocked → re-queue → pull again.
        // Instead, keep the prompt in-hand and retry ONCE after a genuine slot opens.
        // If still blocked, skip the prompt — don't loop.
        isWaitingForSlot = true;
        updateQueueUI();

        // Wait for a genuine slot to open
        console.log(`[SeaArt Queue] Waiting for slot before retrying prompt (no re-queue)...`);
        await waitUntilSystemReady(tabId);
        isWaitingForSlot = false;
        updateQueueUI();

        // Retry the same prompt directly (not through processNext/queue)
        console.log(`[SeaArt Queue] Retrying blocked prompt: "${promptText.substring(0, 60)}..."`);
        const retryResult = await injectPromptToTab(tabId, promptText);
        
        if (!retryResult.success) {
          console.warn(`[SeaArt Queue] Retry injection failed (${retryResult.reason}), skipping prompt.`);
          consecutiveSamePrompt = 0; // Reset — we're moving on
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
            isProcessing = false;
            updateQueueUI();
            processNext();
            return;
          }
        }

        // Retry succeeded! Reset safety counter and continue normally.
        consecutiveSamePrompt = 0;
        lastGeneratedPrompt = promptText; // Mark as generated so next same-prompt detection is fresh
        await new Promise((r) => setTimeout(r, GRACE_PERIOD_MS));
        isProcessing = false;
        updateQueueUI();
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

  if (event.source !== appFrame.contentWindow) return;
  try { if (event.origin !== new URL(appFrame.src).origin) return; } catch (_) { return; }
  if (event.data.type === "INJECT_PROMPT") {
    const promptText = event.data.prompt;
    if (!promptText) return;

    promptQueue.push(promptText);
    persistQueue(); // ← Save queue state after adding item

    // If queue was paused for error, resume it (user is actively adding prompts)
    if (isPausedForError) {
      console.log("[Queue] Resuming from error pause — user added new prompt.");
      isPausedForError = false;
      consecutiveSamePrompt = 0;
    }

    updateQueueUI();

    // Kick off processing if not already running
    processNext();
  }
});

// When the iframe finishes loading, send it the current queue state
// (the initial notifyIframe call in updateQueueUI fires before the iframe is ready)
appFrame.addEventListener("load", () => {
  notifyIframe({ queueLength: promptQueue.length, isProcessing, isWaitingForSlot, isPausedForError, currentActiveTasks, seaArtLimit });
});

// ─────────────────────────────────────────────────────────────────────────────
// Startup: Restore queue from storage and initialize UI
// ─────────────────────────────────────────────────────────────────────────────
restoreQueue().then(() => {
  updateQueueUI();
  // If there are restored prompts, kick off processing
  if (promptQueue.length > 0) {
    console.log(`[Queue] Starting processing for ${promptQueue.length} restored prompts.`);
    processNext();
  }
});
