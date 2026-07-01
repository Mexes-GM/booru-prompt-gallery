// ─────────────────────────────────────────────────────────────────────────────
// Environment switching logic
// ─────────────────────────────────────────────────────────────────────────────
const PROD_URL = "https://booru-prompt-gallery.netlify.app/extension";
const DEV_URL = "http://localhost:3000/extension";

const btnLocal = document.getElementById("btn-local");
const btnProd = document.getElementById("btn-prod");
const appFrame = document.getElementById("app-frame");
const configBar = document.getElementById("config-bar");

const LOCAL_STORAGE_KEY = "booru_sidebar_env";

// Restore the last theme the app reported (if any) before the iframe loads, so
// the wrapper chrome doesn't flash the OS theme when it differs from the user's
// manual in-app choice. Falls back to prefers-color-scheme until the app reports.
try {
  const savedTheme = localStorage.getItem("booru_sidebar_theme");
  if (savedTheme === "light" || savedTheme === "dark") {
    document.documentElement.setAttribute("data-theme", savedTheme);
  }
} catch (_) {}

// Unpacked / developer extensions have no `update_url` in their manifest, while
// Web Store installs do. We use that to auto-detect a developer environment so
// the dev gets localhost + the env switcher automatically, while end users get
// production with the switcher hidden. The localStorage flag is an extra manual
// override (e.g. to force dev tooling on a packaged build).
function isUnpackedExtension() {
  try {
    return !("update_url" in chrome.runtime.getManifest());
  } catch (_) {
    return false;
  }
}
const DEV_MODE = isUnpackedExtension() || localStorage.getItem("booru_sidebar_devmode") === "1";

// Verbose debug logging is dev-only so packaged (Web Store) installs stay quiet.
// Warnings and errors still use console.warn/console.error directly — those
// signal real problems worth surfacing in any environment.
function dlog(...args) {
  if (DEV_MODE) console.log(...args);
}

function setEnvironment(url) {
  appFrame.src = url;
  if (!btnLocal || !btnProd) return;
  if (url.includes("localhost")) {
    btnLocal.classList.add("active");
    btnProd.classList.remove("active");
  } else {
    btnProd.classList.add("active");
    btnLocal.classList.remove("active");
  }
}

if (DEV_MODE) {
  // Reveal the environment switcher and restore the last-used environment.
  if (configBar) configBar.hidden = false;
  setEnvironment(localStorage.getItem(LOCAL_STORAGE_KEY) || DEV_URL);

  btnLocal?.addEventListener("click", () => {
    const url = btnLocal.getAttribute("data-url");
    localStorage.setItem(LOCAL_STORAGE_KEY, url);
    setEnvironment(url);
  });

  btnProd?.addEventListener("click", () => {
    const url = btnProd.getAttribute("data-url");
    localStorage.setItem(LOCAL_STORAGE_KEY, url);
    setEnvironment(url);
  });
} else {
  // End users always load production.
  setEnvironment(PROD_URL);
}

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
let autoDownloadEnabled = false; // Auto-download images with metadata when generation completes (SeaArt only)

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
          dlog(`[Queue] Restored ${saved.length} prompts from storage.`);
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
// NOTE: The visible queue UI (status pill, target/clear buttons, badge) is
// rendered entirely by the React iframe. This sidepanel owns only the queue
// *logic* and pushes state to the iframe via postMessage.
function updateQueueUI() {
  const count = promptQueue.length;

  // Notify the iframe about queue state
  notifyIframe({ queueLength: count, isProcessing, isWaitingForSlot, isPausedForVisibility, isPausedForError, currentActiveTasks, seaArtLimit, platform: currentPlatform });
}

function notifyIframe(payload) {
  try {
    // Post with "*" — the React app verifies event.source === window.parent.
    // Using a pinned origin fails because the iframe (localhost / netlify) and
    // this sidepanel (chrome-extension://) have different origins.
    appFrame.contentWindow.postMessage({ type: "QUEUE_STATUS", ...payload, autoDownloadEnabled }, "*");
  } catch (_) {
    // iframe may not be ready yet
  }
}

// Allow iframe to trigger actions
window.addEventListener("message", (e) => {
  if (e.source !== appFrame.contentWindow) return;
  try { if (e.origin !== new URL(appFrame.src).origin) return; } catch (_) { return; }
  if (e.data && e.data.type === "QUEUE_ACTION") {
    if (e.data.action === "target") startTargeting();
    if (e.data.action === "clear") clearQueue();
    if (e.data.action === "set_auto_download") {
      autoDownloadEnabled = !!e.data.value;
      if (autoDownloadEnabled) startAutoDownloadObserver();
      else stopAutoDownloadObserver();
    }
  }
  // React app asking for initial state on mount
  if (e.data && e.data.type === "REQUEST_QUEUE_STATUS") {
    updateQueueUI();
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

// ─────────────────────────────────────────────────────────────────────────────
// TARGET SYSTEM (refactored) — select the prompt input on the generation page
// ─────────────────────────────────────────────────────────────────────────────
// Flow:
//   1. User clicks Target → startTargeting()
//   2. We locate the generation tab and inject an instrumented "arming" script
//      into all frames. The script discovers candidate inputs, attaches hover +
//      click listeners, and reports diagnostics back via chrome.runtime.sendMessage.
//   3. When the user clicks an input, the injected script marks it with
//      `.booru-target-textarea` and reports phase:"selected" back here.
//   4. We relay every phase to the iframe via TARGET_STATUS so the React UI can
//      show real feedback (arming / waiting / selected / none / error).
// ─────────────────────────────────────────────────────────────────────────────

const TARGET_TIMEOUT_MS = 30000; // Auto-cancel selection mode after 30s of no click
let targetingActive = false;
let targetingTabId = null;
let targetingTimeoutId = null;

/** Relay targeting status to the React iframe + log it. */
function sendTargetStatus(state, detail) {
  try {
    // "*" — React verifies event.source === window.parent (origins differ:
    // iframe is localhost/netlify, this sidepanel is chrome-extension://).
    appFrame.contentWindow.postMessage({ type: "TARGET_STATUS", state, detail: detail || null }, "*");
  } catch (_) { /* iframe not ready */ }
  dlog(`[Target] ▶ state="${state}"`, detail || "");
}

/** Resolve the generation tab + platform name from the current window's tabs. */
function resolveTargetTab(allTabs) {
  const PLATFORM_DOMAINS = ["seaart.ai", "tensor.art", "tensorhub.net", "yodayo.com"];
  const isLocalUi = (u) => u && (u.includes("127.0.0.1") || u.includes("localhost") || u.includes("gradio.live"));

  let tab =
    allTabs.find(t => t.active && t.url && (PLATFORM_DOMAINS.some(d => t.url.includes(d)) || isLocalUi(t.url))) ||
    allTabs.find(t => t.url && PLATFORM_DOMAINS.some(d => t.url.includes(d))) ||
    allTabs.find(t => t.active && t.url && !t.url.startsWith("chrome") && !t.url.startsWith("devtools"));

  if (!tab) return { tab: null, platform: "Unknown" };

  const url = tab.url || "";
  let platform = "Unknown";
  if (url.includes("seaart.ai")) platform = "SeaArt";
  else if (url.includes("tensor.art")) platform = "TensorArt";
  else if (url.includes("tensorhub.net")) platform = "TensorHub";
  else if (url.includes("yodayo.com")) platform = "Yodayo";
  else if (isLocalUi(url)) platform = "Local";
  else { try { platform = new URL(url).hostname.replace("www.", ""); } catch (e) {} }

  return { tab, platform };
}

/** Stop selection mode: clear timeout + tell the page to remove listeners. */
function stopTargeting(reason) {
  if (targetingTimeoutId) { clearTimeout(targetingTimeoutId); targetingTimeoutId = null; }
  const wasActive = targetingActive;
  targetingActive = false;
  if (wasActive && targetingTabId != null) {
    chrome.scripting.executeScript({
      target: { tabId: targetingTabId, allFrames: true },
      func: () => { if (window.__booruTargetCleanup) { try { window.__booruTargetCleanup(); } catch (e) {} } }
    }).catch(() => {});
  }
  dlog(`[Target] ■ stopped (${reason || "manual"})`);
}

/** The function injected into every frame to arm selection mode. */
function armTargetingInPage() {
  const LOG = (...a) => dlog("%c[BooruTarget]", "color:#3b82f6;font-weight:bold", ...a);

  // Tear down any prior session in this frame
  if (window.__booruTargetCleanup) { try { window.__booruTargetCleanup(); } catch (e) {} }

  // Inject highlight styles once
  const styleId = "booru-target-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .booru-selectable-target {
        outline: 3px solid #3b82f6 !important;
        outline-offset: 1px !important;
        background-color: rgba(59,130,246,0.12) !important;
      }
      .booru-target-textarea {
        outline: 2px solid #22c55e !important;
        outline-offset: 1px !important;
      }
      html.booru-targeting-cursor, html.booru-targeting-cursor * {
        cursor: crosshair !important;
      }
    `;
    document.head.appendChild(style);
  }

  const safeSend = (payload) => {
    try { chrome.runtime.sendMessage(payload); } catch (e) { LOG("sendMessage failed", e); }
  };

  const SELECTOR = "textarea, [contenteditable='true'], [contenteditable='']";

  // Resolve the targetable input from a click/hover event using the full
  // composed path (pierces shadow DOM) with an elementFromPoint fallback.
  const resolveFromEvent = (e) => {
    const path = (e.composedPath && e.composedPath()) || [];
    for (const node of path) {
      if (node && node.nodeType === 1 && node.matches && node.matches(SELECTOR)) return node;
    }
    // Fallback: hit-test at the pointer coordinates
    let el = document.elementFromPoint(e.clientX, e.clientY);
    if (el) {
      if (el.matches && el.matches(SELECTOR)) return el;
      const inner = el.querySelector && el.querySelector(SELECTOR);
      if (inner) return inner;
      const up = el.closest && el.closest(SELECTOR);
      if (up) return up;
      // SeaArt: clicking the .dom-widget wrapper → find its textarea
      const widget = el.closest && el.closest(".dom-widget");
      if (widget) { const ta = widget.querySelector("textarea, [contenteditable]"); if (ta) return ta; }
    }
    return null;
  };

  let lastHighlighted = null;
  const clearHighlight = () => {
    if (lastHighlighted) { lastHighlighted.classList.remove("booru-selectable-target"); lastHighlighted = null; }
  };

  const onMove = (e) => {
    const input = resolveFromEvent(e);
    if (input === lastHighlighted) return;
    clearHighlight();
    if (input) { input.classList.add("booru-selectable-target"); lastHighlighted = input; }
  };

  const onClickCapture = (e) => {
    const input = resolveFromEvent(e);
    if (!input) return; // clicked elsewhere — stay armed, let the page handle it

    // Intercept this click so the page doesn't act on it
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    document.querySelectorAll(".booru-target-textarea").forEach(el => el.classList.remove("booru-target-textarea"));
    input.classList.add("booru-target-textarea");
    clearHighlight();
    cleanup();

    const info = {
      tag: input.tagName,
      className: typeof input.className === "string" ? input.className.slice(0, 80) : "",
      placeholder: input.getAttribute ? (input.getAttribute("placeholder") || "") : "",
      frameUrl: location.href.slice(0, 120)
    };
    LOG("selected", info);
    safeSend({ type: "TARGET_RESULT", phase: "selected", info });
  };

  function cleanup() {
    document.removeEventListener("click", onClickCapture, true);
    document.removeEventListener("mousemove", onMove, true);
    document.documentElement.classList.remove("booru-targeting-cursor");
    clearHighlight();
    window.__booruTargetCleanup = null;
  }

  // Capture-phase listeners on the document — robust against overlays,
  // shadow DOM, scaled wrappers, and framework event handling.
  document.addEventListener("click", onClickCapture, true);
  document.addEventListener("mousemove", onMove, true);
  document.documentElement.classList.add("booru-targeting-cursor");
  window.__booruTargetCleanup = cleanup;

  // Helper to find elements recursively, including traversing open shadow roots
  const querySelectorAllDeep = (selector, root = document) => {
    const list = [];
    const find = (node) => {
      if (!node) return;
      if (node.querySelectorAll) {
        const matches = node.querySelectorAll(selector);
        for (const m of matches) {
          if (!list.includes(m)) list.push(m);
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

  // Diagnostics: how many inputs exist in this frame (visible-ish)
  const allInputs = querySelectorAllDeep(SELECTOR).filter(el => {
    const cs = window.getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  });
  const diag = {
    frameUrl: location.href.slice(0, 120),
    isTop: window === window.top,
    counts: {
      textareas: querySelectorAllDeep("textarea").length,
      editables: querySelectorAllDeep("[contenteditable]").length,
      comfyWidgets: querySelectorAllDeep(".comfy-multiline-input").length,
      candidates: allInputs.length
    }
  };
  LOG("armed (delegated capture)", diag);
  safeSend({ type: "TARGET_RESULT", phase: "armed", diag });
  return diag;
}

/** Entry point: begin selection mode. */
function startTargeting() {
  chrome.tabs.query({ currentWindow: true }, (allTabs) => {
    const { tab, platform } = resolveTargetTab(allTabs);

    if (!tab || !tab.id || (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("devtools://")))) {
      console.warn("[Target] ✗ No valid generation tab found", allTabs.map(t => t.url));
      sendTargetStatus("error", { reason: "no_tab", message: "No generation tab found. Open SeaArt/TensorArt and try again." });
      return;
    }

    currentPlatform = platform;
    targetingTabId = tab.id;
    targetingActive = true;

    const platformEl = document.getElementById("target-info-platform");
    if (platformEl) platformEl.textContent = platform;
    const pillEl = document.getElementById("target-info-pill");
    if (pillEl) pillEl.style.display = "block";
    updateQueueUI();

    dlog(`[Target] ◆ arming on tab ${tab.id} (${platform}) — ${tab.url}`);
    sendTargetStatus("arming", { platform });

    chrome.scripting.executeScript(
      { target: { tabId: tab.id, allFrames: true }, func: armTargetingInPage },
      (results) => {
        if (chrome.runtime.lastError) {
          console.error("[Target] ✗ injection error:", chrome.runtime.lastError.message);
          targetingActive = false;
          sendTargetStatus("error", { reason: "injection_failed", message: chrome.runtime.lastError.message });
          return;
        }

        // Aggregate diagnostics across all frames
        let totalCandidates = 0;
        const frames = [];
        for (const r of (results || [])) {
          const d = r.result;
          if (d && d.counts) {
            totalCandidates += d.counts.candidates || 0;
            frames.push({ frame: r.frameId, ...d.counts, isTop: d.isTop });
          }
        }
        dlog(`[Target] ◆ armed across ${results?.length || 0} frame(s), ${totalCandidates} candidate input(s):`, frames);

        if (totalCandidates === 0) {
          dlog(`[Target] ⚠ No candidate inputs pre-detected. Keeping selection mode armed as fallback.`);
        }

        // Selection is now armed — wait for the user to click an input.
        sendTargetStatus("waiting", { candidates: totalCandidates, platform });

        // ── Redundant detection: poll the page for the .booru-target-textarea
        // marker, in case the runtime.sendMessage from the injected script does
        // not reach this side panel reliably. Whichever path fires first wins;
        // stopTargeting() is idempotent.
        const pollStart = Date.now();
        const pollId = setInterval(() => {
          if (!targetingActive) { clearInterval(pollId); return; }
          if (Date.now() - pollStart > TARGET_TIMEOUT_MS) { clearInterval(pollId); return; }
          chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: () => {
              const el = document.querySelector(".booru-target-textarea");
              if (!el) return null;
              return {
                tag: el.tagName,
                className: typeof el.className === "string" ? el.className.slice(0, 80) : "",
                placeholder: el.getAttribute ? (el.getAttribute("placeholder") || "") : ""
              };
            }
          }, (pollResults) => {
            if (chrome.runtime.lastError || !targetingActive) return;
            const hit = (pollResults || []).map(r => r.result).find(Boolean);
            if (hit) {
              clearInterval(pollId);
              dlog("[Target] ◆ selection detected via polling fallback:", hit);
              stopTargeting("selected-poll");
              sendTargetStatus("selected", hit);
            }
          });
        }, 700);

        // Auto-cancel after timeout
        if (targetingTimeoutId) clearTimeout(targetingTimeoutId);
        targetingTimeoutId = setTimeout(() => {
          clearInterval(pollId);
          if (targetingActive) {
            stopTargeting("timeout");
            sendTargetStatus("cancelled", { reason: "timeout" });
          }
        }, TARGET_TIMEOUT_MS);
      }
    );
  });
}

// Listen for results sent back from the injected page script
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "TARGET_RESULT") return;
  if (msg.phase === "selected") {
    stopTargeting("selected");
    sendTargetStatus("selected", msg.info || null);
  }
  // phase:"armed" is per-frame diagnostics; aggregation happens in the
  // executeScript callback, so we just log here for debugging.
  else if (msg.phase === "armed") {
    dlog("[Target]   ↳ frame armed:", msg.diag);
  }
});

// Clear the prompt queue + reset safety state. Triggered by the React iframe
// via the QUEUE_ACTION "clear" message.
function clearQueue() {
  promptQueue.length = 0;
  // Reset safety state
  isPausedForError = false;
  consecutiveSamePrompt = 0;
  currentPromptRetries = 0;
  lastGeneratedPrompt = null;
  persistQueue();
  updateQueueUI();
}

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
            dlog(`[Queue] Task submitted successfully (fast-track resolve).`);
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
            dlog(`[Queue] Active tasks at capacity (${maxTasks}/${seaArtLimit}) but no modal — generation was accepted.`);
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
          dlog(`[Queue] ✓ Prompt injected. Previous: "${successfulFrame.result.previousValue}..." → New: "${successfulFrame.result.injectedValue}..."`);
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

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Download: a single persistent MutationObserver in the SeaArt page detects
// every newly-rendered generated image and downloads it with metadata. This is
// the same detection approach as the SeaArt metadata content script (watch the
// DOM for `.c-history-img .media-attachments-img`), so it is instant and works
// for any number of images completing in any order.
// ─────────────────────────────────────────────────────────────────────────────

/** URLs already downloaded this session (dedupe across observer notifications). */
const autoDLDownloaded = new Set();

/**
 * Installed into the SeaArt page. Marks all currently-visible generated images
 * as "seen" (so we don't re-download history), then watches for new ones and
 * reports each loaded image back via chrome.runtime.sendMessage. Idempotent.
 */
function installAutoDownloadObserverInPage() {
  if (window.__booruAutoDLActive) return { status: "already-active", seen: window.__booruAutoDLSeen?.size || 0 };
  window.__booruAutoDLActive = true;
  window.__booruAutoDLSeen = window.__booruAutoDLSeen || new Set();

  const LOG = (...a) => dlog("%c[AutoDL]", "color:#a855f7;font-weight:bold", ...a);

  const getPrompt = (img) => {
    const item = img.closest(".c-workflow-history-item");
    const el = item && item.querySelector(".c-text-content");
    return el ? el.textContent.trim() : "";
  };

  const report = (img) => {
    const src = img.currentSrc || img.src || img.getAttribute("src") || "";
    if (!src || !/^https?:/.test(src) || src.startsWith("data:") || src.startsWith("blob:")) return;
    if (img.naturalWidth <= 1) return; // not a real decoded image yet
    if (window.__booruAutoDLSeen.has(src)) return;
    window.__booruAutoDLSeen.add(src);
    const prompt = getPrompt(img);
    LOG("new image →", src.slice(0, 80), "| prompt:", prompt.slice(0, 50));
    try { chrome.runtime.sendMessage({ type: "AUTODL_NEW_IMAGE", src, prompt }); } catch (e) { LOG("send failed", e); }
  };

  const handleImg = (img) => {
    if (img.complete && img.naturalWidth > 1) report(img);
    else img.addEventListener("load", () => report(img), { once: true });
  };

  // Seed: mark every existing generated image as seen so we only grab NEW ones.
  document.querySelectorAll(".c-history-img .media-attachments-img").forEach(img => {
    const src = img.currentSrc || img.src || img.getAttribute("src") || "";
    if (src && /^https?:/.test(src)) window.__booruAutoDLSeen.add(src);
  });

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes" && m.target.matches && m.target.matches(".media-attachments-img")) {
        handleImg(m.target);
        continue;
      }
      for (const node of m.addedNodes) {
        if (!node || node.nodeType !== 1) continue;
        if (node.matches && node.matches(".media-attachments-img")) handleImg(node);
        if (node.querySelectorAll) node.querySelectorAll(".c-history-img .media-attachments-img").forEach(handleImg);
      }
    }
  });
  observer.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["src"]
  });
  window.__booruAutoDLObserver = observer;

  LOG(`observer installed (seeded ${window.__booruAutoDLSeen.size} existing image(s))`);
  return { status: "installed", seen: window.__booruAutoDLSeen.size };
}

/** Removes the observer from the SeaArt page. */
function uninstallAutoDownloadObserverInPage() {
  if (window.__booruAutoDLObserver) { try { window.__booruAutoDLObserver.disconnect(); } catch (e) {} }
  window.__booruAutoDLObserver = null;
  window.__booruAutoDLActive = false;
  return { status: "removed" };
}

/** Find the SeaArt tab id in the current window. */
function findSeaArtTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const t = tabs.find(t => t.url && t.url.includes("seaart.ai"));
      resolve(t || null);
    });
  });
}

/** Start auto-download: install the page observer on the SeaArt tab. */
async function startAutoDownloadObserver() {
  const tab = await findSeaArtTab();
  if (!tab || !tab.id) {
    console.warn("[AutoDL] No SeaArt tab found — observer not installed");
    return;
  }
  currentPlatform = "SeaArt"; // we have a confirmed SeaArt tab
  chrome.scripting.executeScript(
    { target: { tabId: tab.id, allFrames: false }, func: installAutoDownloadObserverInPage },
    (res) => {
      if (chrome.runtime.lastError) { console.warn("[AutoDL] install error:", chrome.runtime.lastError.message); return; }
      dlog("[AutoDL] observer:", res?.[0]?.result);
    }
  );
}

/** Stop auto-download: remove the page observer. */
async function stopAutoDownloadObserver() {
  const tab = await findSeaArtTab();
  if (!tab || !tab.id) return;
  chrome.scripting.executeScript(
    { target: { tabId: tab.id, allFrames: false }, func: uninstallAutoDownloadObserverInPage }
  ).catch(() => {});
}

// Receive new-image notifications from the page observer and download them.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "AUTODL_NEW_IMAGE") return;
  if (!autoDownloadEnabled) return;
  // Trust the sender tab: the observer only runs on SeaArt pages.
  const tabId = sender.tab?.id;
  const fromSeaArt = sender.tab?.url?.includes("seaart.ai");
  if (!tabId || !fromSeaArt) return;
  if (!msg.src || autoDLDownloaded.has(msg.src)) return;
  autoDLDownloaded.add(msg.src);
  dlog("[AutoDL] downloading:", msg.src.slice(0, 80));
  triggerAutoDownload(tabId, msg.src, msg.prompt || "");
});


/**
 * Downloads a completed SeaArt image with embedded EXIF/PNG metadata.
 * Reuses the same pipeline as the SeaArt metadata extension's content.js,
 * but executed via scripting.executeScript so we don't need a separate extension.
 */
async function triggerAutoDownload(tabId, imageUrl, prompt) {
  if (!autoDownloadEnabled || currentPlatform !== "SeaArt") return;

  // Step 1: Get full-res URL via background (background.js already handles this)
  let downloadUrl = imageUrl;
  try {
    const urlResponse = await chrome.runtime.sendMessage({
      action: "getFullResUrl",
      imageUrl
    });
    if (urlResponse?.success && urlResponse.url) downloadUrl = urlResponse.url;
  } catch (e) {
    console.warn("[AutoDL] Could not get full-res URL, using original:", e);
  }

  // Step 2: Fetch image bytes via background (bypasses CORS)
  let imageBase64, mimeType;
  try {
    const fetchResponse = await chrome.runtime.sendMessage({
      action: "fetchImage",
      imageUrl: downloadUrl
    });
    if (!fetchResponse?.success) throw new Error(fetchResponse?.error || "fetch failed");
    imageBase64 = fetchResponse.base64;
    mimeType = fetchResponse.mimeType || "";
  } catch (e) {
    console.error("[AutoDL] Failed to fetch image:", e);
    return;
  }

  // Step 3: Process and download via scripting.executeScript in the SeaArt tab
  chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: async (base64, mime, promptText) => {
      // ── PNG metadata injection (same logic as SeaArt metadata content.js) ──

      function crc32(data) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < data.length; i++) {
          crc ^= data[i];
          for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
      }

      function createTextChunk(keyword, text) {
        const kBytes = new TextEncoder().encode(keyword);
        const tBytes = new TextEncoder().encode(text);
        const dataLen = kBytes.length + 1 + tBytes.length;
        const chunk = new Uint8Array(4 + 4 + dataLen + 4);
        let o = 0;
        chunk[o++] = (dataLen >> 24) & 0xFF; chunk[o++] = (dataLen >> 16) & 0xFF;
        chunk[o++] = (dataLen >> 8) & 0xFF;  chunk[o++] = dataLen & 0xFF;
        chunk[o++] = 0x74; chunk[o++] = 0x45; chunk[o++] = 0x58; chunk[o++] = 0x74; // tEXt
        chunk.set(kBytes, o); o += kBytes.length;
        chunk[o++] = 0;
        chunk.set(tBytes, o); o += tBytes.length;
        const crc = crc32(chunk.subarray(4, o));
        chunk[o++] = (crc >> 24) & 0xFF; chunk[o++] = (crc >> 16) & 0xFF;
        chunk[o++] = (crc >> 8) & 0xFF;  chunk[o++] = crc & 0xFF;
        return chunk;
      }

      function injectPngChunks(b64, generationData, workflow) {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const IHDR_END = 33; // 8-byte sig + 4+4+13+4 IHDR
        const chunks = [
          createTextChunk("generation_data", JSON.stringify(generationData)),
          createTextChunk("prompt", JSON.stringify(workflow))
        ];
        const extra = chunks.reduce((s, c) => s + c.length, 0);
        const result = new Uint8Array(bytes.length + extra);
        result.set(bytes.subarray(0, IHDR_END), 0);
        let offset = IHDR_END;
        for (const c of chunks) { result.set(c, offset); offset += c.length; }
        result.set(bytes.subarray(IHDR_END), offset);

        const CHUNK = 0x8000;
        let out = "";
        for (let i = 0; i < result.length; i += CHUNK)
          out += String.fromCharCode.apply(null, result.subarray(i, i + CHUNK));
        return btoa(out);
      }

      async function blobToBase64(blob) {
        return new Promise((res, rej) => {
          const r = new FileReader();
          r.onloadend = () => res(r.result.split(",")[1]);
          r.onerror = rej;
          r.readAsDataURL(blob);
        });
      }

      async function loadImage(url) {
        return new Promise((res, rej) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = url;
        });
      }

      // Build generation_data metadata
      const generationData = {
        prompt: promptText, negativePrompt: "",
        width: 1024, height: 1024, imageCount: 1,
        samplerName: "Euler a", steps: 30, cfgScale: 4, seed: "-1",
        clipSkip: 2, sdVae: "Automatic", etaNoiseSeedDelta: 31337
      };

      // Minimal ComfyUI workflow carrying the prompt
      const workflow = {
        "10051": { class_type: "CLIPTextEncode", inputs: { text: promptText } }
      };

      // Convert base64 to PNG via canvas (handles both PNG and JPEG input)
      const dataUrl = "data:" + mime + ";base64," + base64;
      const img = await loadImage(dataUrl);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      const pngBlob = await new Promise(r => canvas.toBlob(r, "image/png"));
      const pngB64 = await blobToBase64(pngBlob);

      const finalB64 = injectPngChunks(pngB64, generationData, workflow);

      // Download
      const byteChars = atob(finalB64);
      const byteArrays = [];
      for (let i = 0; i < byteChars.length; i += 512) {
        const sl = byteChars.slice(i, i + 512);
        byteArrays.push(new Uint8Array([...sl].map(c => c.charCodeAt(0))));
      }
      const blob = new Blob(byteArrays, { type: "image/png" });
      const blobUrl = URL.createObjectURL(blob);

      const now = new Date();
      const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}-${String(now.getHours()).padStart(2,"0")}-${String(now.getMinutes()).padStart(2,"0")}-${String(now.getSeconds()).padStart(2,"0")}`;
      const slug = promptText.toLowerCase().replace(/[^a-z0-9]/g,"").substring(0,10);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `SA-${ts}-${slug}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    },
    args: [imageBase64, mimeType, prompt || ""]
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

    // Ensure the auto-download observer is running on the SeaArt page (idempotent;
    // re-installs it if the page was reloaded since it was first enabled).
    if (autoDownloadEnabled && currentPlatform === "SeaArt") {
      startAutoDownloadObserver();
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
      dlog(`[Queue] Retrying in ${backoffMs}ms...`);
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
      dlog("[Queue] Resuming from error pause — user added new prompt.");
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
    dlog(`[Queue] Starting processing for ${promptQueue.length} restored prompts.`);
    processNext();
  }
});
