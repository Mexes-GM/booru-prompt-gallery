// sidepanel/08-queue-wait.js — Waiting strategies: SeaArt/TensorArt, generic button (L1), queue container (L2).
// Classic script: shares the global scope with the other sidepanel/*.js
// files, loaded in numeric order by sidepanel.html. Load-time code may only
// use names declared in this file or an earlier one.


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

            // ── 1. Count active tasks (SeaArt & TensorArt) ────────────────
            let activeTasks = querySelectorAllDeep(".message-process-loading-span").length;
            if (activeTasks === 0) {
              const historyItems = querySelectorAllDeep(".c-workflow-history-item");
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
            const tensorTasks = querySelectorAllDeep("h2").filter(el => {
              // Ignore hidden elements (e.g. mobile versions of the sidebar)
              if (el.offsetParent === null) return false;
              const style = window.getComputedStyle(el);
              if (style.display === "none" || style.visibility === "hidden") return false;

              const txt = el.textContent?.trim() || "";
              return txt === "Generating" || txt === "Queued" || txt === "Pending" || txt === "Running";
            });
            activeTasks += tensorTasks.length;
            if (activeTasks === 0) {
              // Deep text nodes walk fallback
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
              let node;
              while (node = walker.nextNode()) {
                const txt = node.nodeValue?.trim() || "";
                if (txt.startsWith("Task is being created") || txt.startsWith("Waiting to start")) activeTasks++;
              }
            }

            // ── 2. Check for the Upgrade / paywall / queue limit modals ──────────────────
            const upgradeModalBtn = querySelectorDeep(".user-upgrade-close");
            const businessModal = querySelectorDeep(
              ".business-modal-backdrop, .user-upgrade, .hy-business-dialog"
            );
            
            // TensorArt Queue Full Modal
            const tensorModal = querySelectorDeep(".n-dialog");
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

              // Instead of parsing VIP text, the limit is the number of active tasks that triggered the modal
              detectedLimit = activeTasks || null;

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
            const errorEls = querySelectorAllDeep(
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

            if (querySelectorDeep(".n-message__icon--success-type") || 
                querySelectorAllDeep(".n-message, .n-message__content").some(el => (el.textContent || "").includes("successfully"))) {
              taskSucceeded = true;
            }

            if (querySelectorDeep(".n-spin-body, .__spin-dark-njtao5-m, .n-base-loading")) {
              globalBusy = true;
            }

            // ── 4. Check Generate button state ────────────────────────────
            const btn =
              querySelectorDeep('button[data-gtm-event="Complete Generation Image"]') ||
              querySelectorDeep('button[data-gtm-event*="Generation"]') ||
              querySelectorDeep("#txt2img_generate") ||
              querySelectorDeep(".work-flow-bottom-btn-main-text") ||
              querySelectorDeep(".work-flow-bottom-btn") ||
              (() => {
                const buttons = querySelectorAllDeep("button");
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

            const actualBtn = btn.closest("button") || btn.closest(".work-flow-bottom-btn") || btn;
            const isDisabled = actualBtn.disabled || actualBtn.getAttribute("aria-disabled") === "true" ||
              actualBtn.classList.contains("is-disabled") || actualBtn.classList.contains("disabled");
            const hasSpinner = !!actualBtn.querySelector(
              ".animate-spin, .loading, [class*='spinner'], [class*='loading']"
            );
            const computedStyle = window.getComputedStyle(actualBtn);
            const hasLowOpacity = parseFloat(computedStyle.opacity) < 0.6;
            const isPointerDisabled = computedStyle.pointerEvents === "none" || computedStyle.cursor === "not-allowed";
            const text = actualBtn.textContent?.trim().toLowerCase() || "";
            const isGeneratingText =
              text.includes("generating") || text.includes("generando") ||
              text.includes("processing") || text.includes("procesando");

            const busy = isDisabled || hasSpinner || hasLowOpacity || isPointerDisabled || isGeneratingText;
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
// GENERIC QUEUE STRATEGIES — work on ANY site, zero config
// ─────────────────────────────────────────────────────────────────────────────
// waitForGenerateButtonFree (above) is SeaArt/TensorArt-specific: it also
// watches for their paywall/upgrade modals and platform task counters. That
// full richness stays reserved for origins with a queue.mode of "button" that
// resolve to those built-in profiles. For a site the user has NOT configured
// at all (queue.mode === "none", the default skeleton from getSiteProfile),
// we use these two much simpler, universal strategies instead:
//
//   Level 0 (pacing)      — inject → click → wait a fixed delay → repeat.
//                            Never fails, works everywhere, is what the
//                            legacy code already did when seaArtLimit was
//                            null (optimistic mode). GENERATE_PACING_DEFAULT_MS
//                            is used when the profile doesn't specify pacingMs.
//   Level 1 (watch button) — poll the actual Generate button element (found by
//                            the SAME logic injectPromptToTab used to click it)
//                            for disabled/aria-disabled/spinner/opacity/generating-
//                            text cues, with a hard timeout. This is the most
//                            universal "is it busy" signal there is — most
//                            sites disable the button while generating.
// ─────────────────────────────────────────────────────────────────────────────
const GENERATE_PACING_DEFAULT_MS = 6000;
// Minimal pacing used for sites explicitly marked "unlimited" (queue.
// unlimited=true) with no Generate button resolved at all — just enough for
// the DOM to register the click before injecting the next prompt. Distinct
// from GENERATE_PACING_DEFAULT_MS, which is the conservative default for
// sites we know nothing about.
const UNLIMITED_PACING_MS = 500;
const GENERIC_BUTTON_WATCH_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes — shorter than the SeaArt-specific 5 min, since there's no modal to wait out
const GENERIC_BUTTON_POLL_INTERVAL_MS = 1000;

/**
 * Level 1: poll the Generate button (resolved the same way injectPromptToTab
 * resolves it — persisted locator first, then the legacy cascade) until it no
 * longer looks busy, or the timeout elapses. Returns { status: "free" | "timeout" | "no_button" }.
 * Deliberately has NO platform-specific modal/task-counter logic — that's what
 * makes it safe to run against a site we know nothing about.
 */
function waitForGenericButtonFree(tabId, generateLocator, unlimited) {
  return new Promise((resolve) => {
    if (unlimited) {
      dlog(`[Queue][L1] ▶ waitForGenericButtonFree tabId=${tabId} unlimited=true → skipping button-busy polling, resolving free immediately.`);
      resolve({ status: "free" });
      return;
    }
    const deadline = Date.now() + GENERIC_BUTTON_WATCH_TIMEOUT_MS;
    const startedAt = Date.now();
    let pollCount = 0;
    dlog(`[Queue][L1] ▶ waitForGenericButtonFree tabId=${tabId} hasLocator=${!!generateLocator} timeoutMs=${GENERIC_BUTTON_WATCH_TIMEOUT_MS}`);
    setTimeout(poll, 800); // let the click register before the first poll

    function poll() {
      if (Date.now() > deadline) {
        dlog(`[Queue][L1] ◀ TIMEOUT after ${pollCount} poll(s) / ${Date.now() - startedAt}ms`);
        resolve({ status: "timeout" });
        return;
      }
      pollCount++;
      chrome.scripting.executeScript(
        {
          target: { tabId, allFrames: true },
          func: (locator) => {
            const tryQuery = (root, selector) => { try { return root.querySelector(selector); } catch (_) { return null; } };
            let btn = null;
            if (locator && Array.isArray(locator.candidates)) {
              for (const cand of locator.candidates) {
                if (cand.type === "stable-attribute" || cand.type === "structural-path") {
                  btn = tryQuery(document, cand.selector);
                } else if (cand.type === "shadow-path" && Array.isArray(cand.selectors)) {
                  let root = document, el = null;
                  for (let i = 0; i < cand.selectors.length; i++) {
                    el = tryQuery(root, cand.selectors[i]);
                    if (!el) break;
                    if (i < cand.selectors.length - 1) {
                      if (!el.shadowRoot) { el = null; break; }
                      root = el.shadowRoot;
                    }
                  }
                  btn = el;
                }
                if (btn) break;
              }
            }
            if (!btn) {
              const buttons = Array.from(document.querySelectorAll("button"));
              btn = buttons.find((b) => {
                const t = b.textContent?.trim().toLowerCase();
                return t && (t === "generate" || t === "generar" || t.includes("generate image") || t.includes("generar imagen"));
              });
            }
            if (!btn) return { found: false, busy: false };

            const actualBtn = btn.closest("button") || btn.closest(".work-flow-bottom-btn") || btn;
            const isDisabled = actualBtn.disabled || actualBtn.getAttribute("aria-disabled") === "true" ||
              actualBtn.classList.contains("is-disabled") || actualBtn.classList.contains("disabled");
            const hasSpinner = !!actualBtn.querySelector(".animate-spin, .loading, [class*='spinner'], [class*='loading']");
            const computedStyle = window.getComputedStyle(actualBtn);
            const hasLowOpacity = parseFloat(computedStyle.opacity) < 0.6;
            const isPointerDisabled = computedStyle.pointerEvents === "none" || computedStyle.cursor === "not-allowed";
            const text = actualBtn.textContent?.trim().toLowerCase() || "";
            const isGeneratingText = text.includes("generating") || text.includes("generando") || text.includes("processing") || text.includes("procesando");
            return { found: true, busy: isDisabled || hasSpinner || hasLowOpacity || isPointerDisabled || isGeneratingText };
          },
          args: [generateLocator || null],
        },
        (results) => {
          if (chrome.runtime.lastError || !results || results.length === 0) {
            dlog(`[Queue][L1] ◀ poll#${pollCount} scripting error/no-results (lastError=${chrome.runtime.lastError?.message || "none"}) → no_button`);
            resolve({ status: "no_button" });
            return;
          }
          let anyFound = false, anyBusy = false;
          for (const r of results) {
            if (r.result?.found) anyFound = true;
            if (r.result?.busy) anyBusy = true;
          }
          dlog(`[Queue][L1]   poll#${pollCount} (${Date.now() - startedAt}ms elapsed): found=${anyFound} busy=${anyBusy}`);
          if (!anyFound) { dlog(`[Queue][L1] ◀ button not found on page → no_button`); resolve({ status: "no_button" }); return; }
          if (anyBusy) { setTimeout(poll, GENERIC_BUTTON_POLL_INTERVAL_MS); return; }
          dlog(`[Queue][L1] ◀ free after ${pollCount} poll(s) / ${Date.now() - startedAt}ms`);
          resolve({ status: "free" });
        }
      );
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Level 2 — queue container + configurable busy signal
// ─────────────────────────────────────────────────────────────────────────────
// Used when queue.mode === "container": the user pointed Target at the page's
// queue/history container (targetKind:"queue"), and optionally configured a
// busySignal. Three ways to decide "is the queue busy" from the container,
// tried in this priority order — ALL of them now compare a count against
// `concurrencyLimit` (configurable per-site via the wizard's Queue step, see
// the QUEUE_ACTION "set_concurrency_limit" handler below) rather than treating
// any match as an instant block. This matters for permissive/fast/parallel
// queues (e.g. TensorArt tolerates several simultaneous generations and its
// "Generating" text or progress-bar class can show up more than once without
// actually being full) as much as for strict single-slot queues:
//   1. busySignal.type === "text"  — count how many times any of the
//      comma-separated keywords (e.g. "Generating,Queued,En cola") appear in
//      the container's text. Busy while count >= concurrencyLimit.
//   2. busySignal.type === "class" — count elements under the container
//      matching busySignal.value as a CSS selector (e.g. a spinner class
//      learned via a live idle-vs-busy snapshot comparison). Busy while count
//      >= concurrencyLimit.
//   3. No busySignal configured — fall back to counting the container's
//      direct children. Busy while that count >= concurrencyLimit (default 1,
//      i.e. "any child present = busy", the original single-slot behavior).
// This intentionally does NOT try to understand arbitrary queues semantically;
// it is a thin, configurable read of whatever signal the user pointed out.
// ─────────────────────────────────────────────────────────────────────────────
const CONTAINER_QUEUE_POLL_INTERVAL_MS = 1500;
const CONTAINER_QUEUE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes, matches the platform-specific ceiling

/**
 * Level 2: poll the persisted queue container (via its locator) until it no
 * longer looks busy per the configured busySignal/concurrencyLimit, or the
 * timeout elapses. Returns { status: "free" | "timeout" | "no_container" }.
 *
 * `containerLocator`, `busySignal`, `concurrencyLimit`, `unlimited` are the
 * INITIAL config resolved right before this call — but each poll() iteration
 * re-resolves the live config from siteProfiles instead of trusting those
 * closed-over values for the whole (up to 5 minute) wait. Without this, a
 * Target Wizard change made WHILE a poll is already in flight (e.g. running
 * Capture Idle/Capture Busy, or bumping the concurrency limit) had no effect
 * until the current wait timed out — the poll kept comparing against the
 * pre-change busySignal/limit for its entire remaining lifetime.
 */
function waitForContainerQueueFree(tabId, containerLocator, busySignal, concurrencyLimit, unlimited) {
  return new Promise((resolve) => {
    if (unlimited) {
      dlog(`[Queue][L2] ▶ waitForContainerQueueFree tabId=${tabId} unlimited=true → skipping all polling, resolving free immediately.`);
      resolve({ status: "free" });
      return;
    }
    const deadline = Date.now() + CONTAINER_QUEUE_TIMEOUT_MS;
    const startedAt = Date.now();
    let pollCount = 0;
    dlog(`[Queue][L2] ▶ waitForContainerQueueFree tabId=${tabId} hasContainerLocator=${!!containerLocator} busySignal=${busySignal ? `${busySignal.type}:"${busySignal.value}"` : "none (child-count fallback)"} concurrencyLimit=${concurrencyLimit ?? "1 (default)"} timeoutMs=${CONTAINER_QUEUE_TIMEOUT_MS}`);
    setTimeout(poll, 800);

    async function poll() {
      if (Date.now() > deadline) {
        dlog(`[Queue][L2] ◀ TIMEOUT after ${pollCount} poll(s) / ${Date.now() - startedAt}ms`);
        resolve({ status: "timeout" });
        return;
      }
      pollCount++;

      // Re-resolve the live config on EVERY poll instead of trusting the
      // snapshot this wait started with — see the doc comment above for why.
      const liveConfig = await resolveQueueConfigForTab(tabId);
      if (liveConfig.unlimited) {
        dlog(`[Queue][L2] ◀ unlimited turned on mid-wait (poll#${pollCount}) → resolving free immediately.`);
        resolve({ status: "free" });
        return;
      }
      const liveContainerLocator = (await resolveQueueContainerLocatorForTab(tabId)) || containerLocator;
      const liveBusySignal = liveConfig.busySignal || null;
      const liveConcurrencyLimit = liveConfig.concurrencyLimit;

      chrome.scripting.executeScript(
        {
          target: { tabId, allFrames: true },
          func: (locator, signal, limit) => {
            const tryQuery = (root, selector) => { try { return root.querySelector(selector); } catch (_) { return null; } };
            let container = null;
            if (locator && Array.isArray(locator.candidates)) {
              for (const cand of locator.candidates) {
                if (cand.type === "stable-attribute" || cand.type === "structural-path") {
                  container = tryQuery(document, cand.selector);
                } else if (cand.type === "shadow-path" && Array.isArray(cand.selectors)) {
                  let root = document, el = null;
                  for (let i = 0; i < cand.selectors.length; i++) {
                    el = tryQuery(root, cand.selectors[i]);
                    if (!el) break;
                    if (i < cand.selectors.length - 1) {
                      if (!el.shadowRoot) { el = null; break; }
                      root = el.shadowRoot;
                    }
                  }
                  container = el;
                }
                if (container) break;
              }
            }
            if (!container) return { found: false, busy: false };

            if (signal && signal.type === "text" && signal.value) {
              const keywords = String(signal.value).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
              const text = (container.textContent || "").toLowerCase();
              // Count how many keyword occurrences show up in the container's
              // text — a rough proxy for "how many active items are listed".
              // Sites with a generous/parallel queue (e.g. TensorArt) tolerate
              // several simultaneous "Generating"/"Queued" mentions before
              // actually being full, so we compare against concurrencyLimit
              // instead of treating any single match as "busy".
              let matchCount = 0;
              for (const kw of keywords) {
                if (!kw) continue;
                matchCount += text.split(kw).length - 1;
              }
              const effectiveLimit = typeof limit === "number" && limit > 0 ? limit : 1;
              const busy = matchCount >= effectiveLimit;
              return { found: true, busy, signalType: "text", matchCount, effectiveLimit, matchedKeywords: keywords.filter(kw => text.includes(kw)) };
            }
            if (signal && signal.type === "class" && signal.value) {
              let count = 0;
              try { count = container.querySelectorAll(signal.value).length; } catch (_) { count = 0; }
              const effectiveLimit = typeof limit === "number" && limit > 0 ? limit : 1;
              const busy = count >= effectiveLimit;
              return { found: true, busy, signalType: "class", matchCount: count, effectiveLimit };
            }
            // Fallback: direct-child count vs concurrencyLimit
            const childCount = container.children ? container.children.length : 0;
            const effectiveLimit = typeof limit === "number" && limit > 0 ? limit : 1;
            return { found: true, busy: childCount >= effectiveLimit, childCount, signalType: "child-count", effectiveLimit };
          },
          args: [liveContainerLocator || null, liveBusySignal, liveConcurrencyLimit || null],
        },
        (results) => {
          if (chrome.runtime.lastError || !results || results.length === 0) {
            dlog(`[Queue][L2] ◀ poll#${pollCount} scripting error/no-results (lastError=${chrome.runtime.lastError?.message || "none"}) → no_container`);
            resolve({ status: "no_container" });
            return;
          }
          let anyFound = false, anyBusy = false;
          let detail = null;
          for (const r of results) {
            if (r.result?.found) { anyFound = true; detail = r.result; }
            if (r.result?.busy) anyBusy = true;
          }
          dlog(`[Queue][L2]   poll#${pollCount} (${Date.now() - startedAt}ms elapsed): found=${anyFound} busy=${anyBusy}`, detail || {});
          if (!anyFound) { dlog(`[Queue][L2] ◀ container not found on page → no_container`); resolve({ status: "no_container" }); return; }
          if (anyBusy) { setTimeout(poll, CONTAINER_QUEUE_POLL_INTERVAL_MS); return; }
          dlog(`[Queue][L2] ◀ free after ${pollCount} poll(s) / ${Date.now() - startedAt}ms`);
          resolve({ status: "free" });
        }
      );
    }
  });
}

/**
 * Look up the tab's origin and return its persisted queue.container
 * locator, or null when unconfigured. Mirrors resolvePromptLocatorForTab /
 * resolveGenerateLocatorForTab.
 */
function resolveQueueContainerLocatorForTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.url) { resolve(null); return; }
      const origin = originFromUrl(tab.url);
      const profile = origin ? siteProfiles[origin] : null;
      resolve((profile && profile.queue && profile.queue.container && profile.queue.container.locator) || null);
    });
  });
}

/** Snapshot state kept between the "idle" and "busy" capture steps. */
let busySignalIdleSnapshot = null;

/**
 * One step of the "learn the busy signal live" flow. Resolves the
 * active tab's queue container and snapshots the set of CSS classes present
 * on its descendants.
 *   step === "idle": just stores the snapshot for later comparison.
 *   step === "busy": diffs against the stored idle snapshot; any class that
 *     appears now but didn't before is a candidate "busy" indicator (e.g. a
 *     spinner/progress class). The most specific new class (fewest matches in
 *     the busy snapshot — likely the spinner itself, not a generic wrapper)
 *     is persisted as `queue.busySignal = { type: "class", value: selector }`.
 * Reports progress/result back to the React iframe via TARGET_STATUS so the
 * wizard can show live feedback, reusing the same channel Target uses.
 */
function captureBusySignalStep(step) {
  dlog(`[BusySignal] ▶ captureBusySignalStep step="${step}"`);
  chrome.tabs.query({ currentWindow: true }, (allTabs) => {
    const { tab, urlHidden } = resolveTargetTab(allTabs);
    if (!tab || !tab.id) {
      // If the reason is a hidden url (missing <all_urls> — should
      // normally already be granted by the time the user reaches this step,
      // since the "prompt" step forces it — but can happen if permission was
      // revoked mid-session), surface that specifically instead of a generic
      // "no tab" message that gives the user nothing actionable to do.
      dlog(`[BusySignal] ◀ no_tab${urlHidden ? " (url hidden — missing <all_urls> permission)" : ""}`);
      sendTargetStatus("error", {
        reason: urlHidden ? "permission_denied" : "no_tab",
        message: urlHidden
          ? "This page needs permission before it can be configured. Re-run the Prompt step first to grant access."
          : "No generation tab found for busy-signal capture.",
      });
      return;
    }
    resolveQueueContainerLocatorForTab(tab.id).then((containerLocator) => {
      if (!containerLocator) {
        dlog(`[BusySignal] ◀ no_container (queue container locator not persisted for this origin yet)`);
        sendTargetStatus("error", { reason: "no_container", message: "Target the queue container first before capturing a busy signal." });
        return;
      }
      dlog(`[BusySignal]   resolved container locator, scanning descendant classes on tab ${tab.id}...`);
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id, allFrames: true },
          func: (locator) => {
            const tryQuery = (root, selector) => { try { return root.querySelector(selector); } catch (_) { return null; } };
            let container = null;
            if (locator && Array.isArray(locator.candidates)) {
              for (const cand of locator.candidates) {
                if (cand.type === "stable-attribute" || cand.type === "structural-path") {
                  container = tryQuery(document, cand.selector);
                } else if (cand.type === "shadow-path" && Array.isArray(cand.selectors)) {
                  let root = document, el = null;
                  for (let i = 0; i < cand.selectors.length; i++) {
                    el = tryQuery(root, cand.selectors[i]);
                    if (!el) break;
                    if (i < cand.selectors.length - 1) {
                      if (!el.shadowRoot) { el = null; break; }
                      root = el.shadowRoot;
                    }
                  }
                  container = el;
                }
                if (container) break;
              }
            }
            if (!container) return null;
            const classes = new Set();
            const walk = (node) => {
              if (node.nodeType === 1) {
                if (typeof node.className === "string") {
                  node.className.split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
                }
                for (const child of node.children) walk(child);
              }
            };
            walk(container);
            return Array.from(classes);
          },
          args: [containerLocator],
        },
        (results) => {
          if (chrome.runtime.lastError || !results || results.length === 0) {
            dlog(`[BusySignal] ◀ capture_failed (lastError=${chrome.runtime.lastError?.message || "none"})`);
            sendTargetStatus("error", { reason: "capture_failed", message: "Could not read the queue container on the page." });
            return;
          }
          const classes = new Set();
          for (const r of results) if (Array.isArray(r.result)) for (const c of r.result) classes.add(c);

          if (step === "idle") {
            busySignalIdleSnapshot = classes;
            dlog(`[BusySignal] ◀ idle snapshot captured: ${classes.size} class(es):`, Array.from(classes));
            sendTargetStatus("busy_signal_idle_captured", { classCount: classes.size });
            return;
          }

          // step === "busy": diff against the idle snapshot
          if (!busySignalIdleSnapshot) {
            dlog(`[BusySignal] ◀ no_idle_snapshot (busy step called before idle step)`);
            sendTargetStatus("error", { reason: "no_idle_snapshot", message: "Capture the idle snapshot first, then trigger a generation and capture again." });
            return;
          }
          const newClasses = Array.from(classes).filter(c => !busySignalIdleSnapshot.has(c));
          dlog(`[BusySignal]   busy snapshot: ${classes.size} class(es) total, ${newClasses.length} new vs idle:`, newClasses);
          if (newClasses.length === 0) {
            dlog(`[BusySignal] ◀ no_new_classes (idle and busy snapshots identical)`);
            sendTargetStatus("error", {
              reason: "no_new_classes",
              message: "No new classes appeared while busy. Try a container that includes the spinner/progress element, or use the keyword-based signal instead.",
            });
            return;
          }
          // Heuristic: prefer shorter/more specific-looking class names (spinner-
          // like tokens) over layout-utility classes; fall back to the first one.
          const spinnerLike = newClasses.find(c => /spin|load|progress|busy|active|pending|queue/i.test(c));
          const chosen = spinnerLike || newClasses[0];
          const selector = `.${chosen.replace(/([^a-zA-Z0-9_-])/g, "\\$1")}`;
          dlog(`[BusySignal]   heuristic pick: "${chosen}" (spinnerLike=${!!spinnerLike}) → selector="${selector}"`);

          const origin = originFromUrl(tab.url);
          if (origin) {
            const profile = getSiteProfile(origin);
            updateSiteProfile(origin, { queue: { ...(profile.queue || {}), mode: "container", busySignal: { type: "class", value: selector } } });
            dlog(`[BusySignal] ◀ learned busySignal for "${origin}": ${selector} (from ${newClasses.length} candidate class(es)).`);
            sendSiteProfileStatus(); // keep the React status panel/wizard live
          } else {
            console.warn(`[BusySignal] Could not resolve origin for tab ${tab.id}; busySignal not persisted.`);
          }
          busySignalIdleSnapshot = null;
          sendTargetStatus("busy_signal_learned", { selector, candidateCount: newClasses.length });
        }
      );
    });
  });
}

/**
 * Persist `queue.concurrencyLimit` (and optionally `queue.unlimited`) for the
 * active tab's origin — how many simultaneous generations this site's queue
 * tolerates before it's treated as "busy". Exposed in the wizard's Queue step
 * so users can raise it for permissive/parallel queues (e.g.
 * TensorArt, which rarely if ever queues) instead of being stuck with the
 * single-slot default. Used by waitForContainerQueueFree's busySignal count
 * comparisons; harmless (simply unused) for origins on Level 0/1 with no
 * queue container configured yet. `value` is coerced to a positive integer,
 * defaulting to 1 if invalid.
 *
 * `unlimited` is a separate boolean override: when true, ALL queue
 * waiting for this origin is skipped entirely (see the unlimited checks in
 * waitForContainerQueueFree, waitForGenericButtonFree, and processNext's
 * usePlatformSpecificQueueLogic/Level-0 pacing) — for sites the user knows
 * are effectively never full (fast, parallel, generous queues). It does NOT
 * clear concurrencyLimit, so toggling unlimited back off restores whatever
 * numeric limit was previously configured.
 */
function setConcurrencyLimitForActiveTab(value, unlimited) {
  const parsed = Number.parseInt(value, 10);
  const concurrencyLimit = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const unlimitedFlag = !!unlimited;
  dlog(`[Queue][concurrencyLimit] ▶ setConcurrencyLimitForActiveTab(value=${value}, unlimited=${unlimited}) → concurrencyLimit=${concurrencyLimit} unlimited=${unlimitedFlag}`);
  chrome.tabs.query({ currentWindow: true }, (allTabs) => {
    const { tab } = resolveTargetTab(allTabs);
    if (!tab || !tab.url) {
      dlog(`[Queue][concurrencyLimit] ◀ no_tab — could not resolve an origin to persist against.`);
      sendTargetStatus("error", { reason: "no_tab", message: "No generation tab found to configure concurrency for." });
      return;
    }
    const origin = originFromUrl(tab.url);
    if (!origin) {
      dlog(`[Queue][concurrencyLimit] ◀ could not resolve origin from url="${tab.url}"`);
      return;
    }
    const profile = getSiteProfile(origin);
    updateSiteProfile(origin, { queue: { ...(profile.queue || {}), concurrencyLimit, unlimited: unlimitedFlag } });
    dlog(`[Queue][concurrencyLimit] ◀ persisted concurrencyLimit=${concurrencyLimit} unlimited=${unlimitedFlag} for origin "${origin}".`);
    sendSiteProfileStatus(); // keep the React status panel/wizard live
  });
}
