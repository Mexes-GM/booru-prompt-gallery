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

// Timeout (ms) to wait for the Generate button to free up before giving up on an item
const GENERATE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
// Polling interval (ms) to check if the Generate button is free
const POLL_INTERVAL_MS = 1500;
// Grace period (ms) after button becomes clickable before we inject the next prompt
// (gives TensorArt a moment to fully settle its UI state)
const GRACE_PERIOD_MS = 800;

// ─────────────────────────────────────────────────────────────────────────────
// Queue Status UI helpers
// ─────────────────────────────────────────────────────────────────────────────
const queueStatusDot  = document.getElementById("queue-status-dot");
const queueStatusText = document.getElementById("queue-status-text");
const queueBadge      = document.getElementById("queue-badge");
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

  // Clear button
  queueClearBtn.style.display = count > 0 ? "inline-flex" : "none";

  // Status dot + text
  if (isProcessing) {
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
  queueBar.style.display = (isProcessing || count > 0) ? "flex" : "none";

  // Notify the iframe about queue state
  notifyIframe({ queueLength: count, isProcessing });
}

function notifyIframe(payload) {
  try {
    appFrame.contentWindow.postMessage({ type: "QUEUE_STATUS", ...payload }, "*");
  } catch (_) {
    // iframe may not be ready yet
  }
}

// Clear button handler
queueClearBtn.addEventListener("click", () => {
  promptQueue.length = 0;
  updateQueueUI();
});

// ─────────────────────────────────────────────────────────────────────────────
// Core: wait for the Generate button to be clickable again
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Polls the active tab until the Generate button is no longer busy,
 * or until GENERATE_TIMEOUT_MS elapses. Returns a Promise<boolean>:
 *   true  = button became free
 *   false = timed out
 */
function waitForGenerateButtonFree(tabId, frameId) {
  return new Promise((resolve) => {
    const deadline = Date.now() + GENERATE_TIMEOUT_MS;

    // First, give TensorArt a brief moment to actually start generating
    // (the button might not be disabled immediately on click)
    setTimeout(poll, 2000);

    function poll() {
      if (Date.now() > deadline) {
        console.warn("[Queue] Timed out waiting for Generate button to free up.");
        resolve(false);
        return;
      }

      const target = { tabId };
      if (typeof frameId === "number") {
        target.frameIds = [frameId];
      } else {
        target.allFrames = false;
      }

      chrome.scripting.executeScript(
        {
          target,
          func: () => {
            // Selector patterns for TensorArt / TensorHub / A1111 generate buttons
            const btn =
              document.querySelector('button[data-gtm-event="Complete Generation Image"]') ||
              document.querySelector('button[data-gtm-event*="Generation"]') ||
              document.querySelector("#txt2img_generate") ||
              (() => {
                const buttons = Array.from(document.querySelectorAll("button"));
                return buttons.find((b) => {
                  const text = b.textContent?.trim().toLowerCase();
                  return (
                    text &&
                    (text === "generate" ||
                      text === "generar" ||
                      text.includes("generate image") ||
                      text.includes("generar imagen"))
                  );
                });
              })();

            if (!btn) return { found: false, busy: false };

            const isDisabled = btn.disabled || btn.getAttribute("aria-disabled") === "true";
            const hasSpinner = !!btn.querySelector(".animate-spin, .loading, [class*='spinner'], [class*='loading']");
            const computedStyle = window.getComputedStyle(btn);
            const hasLowOpacity = parseFloat(computedStyle.opacity) < 0.6;
            const text = btn.textContent?.trim().toLowerCase() || "";
            const isGeneratingText =
              text.includes("generating") ||
              text.includes("generando") ||
              text.includes("processing") ||
              text.includes("procesando");

            const busy = isDisabled || hasSpinner || hasLowOpacity || isGeneratingText;
            return { found: true, busy };
          },
        },
        (results) => {
          if (chrome.runtime.lastError) {
            // Tab may have navigated away or closed
            console.warn("[Queue] Tab scripting error:", chrome.runtime.lastError.message);
            resolve(false);
            return;
          }

          const result = results?.[0]?.result;
          if (!result) {
            resolve(false);
            return;
          }

          if (!result.found) {
            // Button not found — site may have changed, just proceed
            resolve(true);
            return;
          }

          if (!result.busy) {
            // Button is free!
            resolve(true);
          } else {
            // Still busy, poll again
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
        func: (text) => {
          // 1. Selector patterns for A1111 / WebUI Forge and TensorArt / TensorHub
          let promptTextarea =
            document.querySelector("#txt2img_prompt textarea") ||
            document.querySelector("#txt2img_prompt_row textarea") ||
            document.querySelector("textarea[placeholder*='Prompt (press Ctrl+Enter to generate)']") ||
            document.querySelector("#txt2img_prompt_row #txt2img_prompt textarea");

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

          // 2. Selector patterns for generate button
          let generateButton =
            document.querySelector("#txt2img_generate") ||
            document.querySelector('button[data-gtm-event="Complete Generation Image"]') ||
            document.querySelector('button[data-gtm-event*="Generation"]');

          if (!generateButton) {
            const buttons = Array.from(document.querySelectorAll("button"));
            generateButton = buttons.find((b) => {
              const text = b.textContent?.trim().toLowerCase();
              return (
                text &&
                (text === "generate" ||
                  text === "generar" ||
                  text.includes("generate image") ||
                  text.includes("generar imagen"))
              );
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

            if (generateButton) {
              generateButton.click();
            }
            return { success: true, hasButton: !!generateButton };
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
async function processNext() {
  if (isProcessing || promptQueue.length === 0) return;

  isProcessing = true;
  updateQueueUI();

  const promptText = promptQueue.shift();

  // Get the active tab
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
    const activeTab = tabs[0];

    if (
      !activeTab ||
      !activeTab.id ||
      !activeTab.url ||
      activeTab.url.startsWith("chrome://") ||
      activeTab.url.startsWith("chrome-extension://")
    ) {
      console.warn("[Queue] No valid active tab found, skipping item.");
      isProcessing = false;
      updateQueueUI();
      processNext();
      return;
    }

    const tabId = activeTab.id;

    // Inject the prompt and click Generate
    const injectResult = await injectPromptToTab(tabId, promptText);

    if (!injectResult.success) {
      console.warn("[Queue] Prompt injection failed, skipping item.");
      isProcessing = false;
      updateQueueUI();
      processNext();
      return;
    }

    // If we found a Generate button and clicked it, wait for it to free up
    if (injectResult.hasButton) {
      const freed = await waitForGenerateButtonFree(tabId, injectResult.frameId);
      if (!freed) {
        console.warn("[Queue] Generate button did not free up within timeout, moving on.");
      }
      // Grace period before next injection
      await new Promise((r) => setTimeout(r, GRACE_PERIOD_MS));
    } else {
      // No Generate button found (e.g. A1111 direct), just wait a short grace period
      await new Promise((r) => setTimeout(r, 2000));
    }

    isProcessing = false;
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
  notifyIframe({ queueLength: promptQueue.length, isProcessing });
});

// Initial UI state
updateQueueUI();
