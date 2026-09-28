// sidepanel/09-inject.js — Inject a prompt (and optional size) into the target tab and click Generate.
// Classic script: shares the global scope with the other sidepanel/*.js
// files, loaded in numeric order by sidepanel.html. Load-time code may only
// use names declared in this file or an earlier one.

// ─────────────────────────────────────────────────────────────────────────────
// Core: inject prompt into the active tab
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Injects `promptText` into the target page's prompt field and clicks Generate.
 *
 * If a `promptLocator` is provided (resolved from the tab's SiteProfile — see
 * resolvePromptLocatorForTab), it is tried FIRST inside the injected function;
 * only if it fails to resolve to a live element does the legacy hardcoded
 * selector cascade (SeaArt/TensorArt/A1111) run as a fallback. This keeps
 * existing platforms working unchanged while letting user-configured sites
 * use their persisted locator across reloads.
 *
 * `generateLocator` does the same for the Generate button: tried
 * first, falling back to the legacy hardcoded button cascade when absent/stale.
 *
 * `sizeConfig` ("Match image resolution" feature) is optional:
 * `{ width?, height?, widthLocator?, heightLocator?, liteGraphApplied? }`.
 * On LiteGraph/ComfyUI sites (e.g. SeaArt), `liteGraphApplied` is already
 * `true` by the time this runs — the caller (processNext) applies that path
 * separately, BEFORE calling this function, via its own executeScript call
 * with `{ world: "MAIN" }` (see tryApplyLiteGraphSize). That's required
 * because window.app/window.graph live in the page's own JS realm, invisible
 * to the ISOLATED world this function runs in. When `liteGraphApplied` is
 * falsy, this function falls back to the DOM mechanism: if both a dimension
 * and its locator are present, the resolved numeric field is set to that
 * value right after the prompt is verified/blurred and BEFORE the Generate
 * button is resolved/clicked — mirroring requirement "modify them before
 * sending to generate". Any missing piece (no dimension, no locator, or the
 * locator fails to resolve) is skipped silently: this is a best-effort
 * enhancement, never a reason to abort sending the prompt itself.
 */
function injectPromptToTab(tabId, promptText, promptLocator, generateLocator, sizeConfig) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId, allFrames: true },
        func: async (text, promptLocator, generateLocator, sizeConfig) => {
          // ── 1. Find the prompt field ───────────────────────────────────────
          // Priority order: persisted locator > user-targeted legacy
          // class > platform-specific > generic fallback.
          let promptTextarea = null;

          if (promptLocator && Array.isArray(promptLocator.candidates)) {
            // Self-contained resolver copy (see resolveElementLocator in the
            // outer scope) — func-injection only serializes this function's
            // own source, so the shared helper can't be referenced directly.
            const tryQuery = (root, selector) => { try { return root.querySelector(selector); } catch (_) { return null; } };
            for (const cand of promptLocator.candidates) {
              try {
                if (cand.type === "stable-attribute") {
                  const found = tryQuery(document, cand.selector);
                  if (found) {
                    // ── Uniqueness check ─────────────────────────────────────
                    // On SeaArt/ComfyUI all textareas share placeholder="text"
                    // and the same class. A selector like
                    // textarea[placeholder="text"] matches every one of them;
                    // querySelector returns the first DOM match, which is almost
                    // always the wrong field. Only accept a stable-attribute
                    // candidate if it uniquely identifies a SINGLE element in
                    // this frame; otherwise fall through to the next candidate
                    // (structural-path or coordinates) which uses position to
                    // disambiguate.
                    try {
                      const allMatches = document.querySelectorAll(cand.selector);
                      if (allMatches.length === 1) { promptTextarea = found; break; }
                      // Multiple matches → ambiguous; try next candidate.
                    } catch (_) {
                      // querySelectorAll failed — treat as unique and proceed
                      promptTextarea = found; break;
                    }
                  }
                } else if (cand.type === "structural-path") {
                  // ── Change C: validate className before accepting ────────────
                  // If the DOM order changed (e.g. different ComfyUI workflow),
                  // nth-of-type(N) may resolve to a completely different element.
                  // Confirm the found element has the same className that was
                  // snapshotted at selection time before trusting this locator.
                  const found = tryQuery(document, cand.selector);
                  if (found) {
                    const savedClass = promptLocator.meta && promptLocator.meta.className;
                    const foundClass = typeof found.className === "string" ? found.className.slice(0, 160) : "";
                    // Accept if: no className was saved (legacy locator), OR
                    // classes match exactly, OR the found element's class at
                    // least starts with the saved value (handles minor additions).
                    if (!savedClass || foundClass === savedClass || (savedClass && foundClass.startsWith(savedClass.split(" ")[0]))) {
                      promptTextarea = found; break;
                    }
                    // Class mismatch → DOM order shifted; fall through to next candidate.
                  }
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
                  if (el) { promptTextarea = el; break; }
                } else if (cand.type === "coordinates") {
                  // ── Change B: find element closest to saved viewport coords ─
                  // Useful on SeaArt/ComfyUI where textareas share the same class
                  // and differ only by canvas position. Queries by className first
                  // (more specific), falling back to all textareas.
                  const firstClass = cand.className && cand.className.trim().split(/\s+/)[0];
                  const pool = firstClass
                    ? Array.from(document.querySelectorAll(`.${CSS.escape(firstClass)}`))
                    : Array.from(document.querySelectorAll("textarea, input"));
                  const tol = cand.tolerance || 120;
                  let closest = null, closestDist = Infinity;
                  for (const el of pool) {
                    const r = el.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) continue;
                    // Use widget rect for comparison when available (more stable
                    // anchor point than the textarea rect, which sits inside the
                    // canvas node and can shift with internal re-layout).
                    const ref = cand.widgetRect || cand.rect;
                    const widget = el.closest && el.closest(".dom-widget");
                    const wr = widget ? widget.getBoundingClientRect() : null;
                    const compRect = (cand.widgetRect && wr) ? wr : r;
                    const dx = compRect.x - ref.x;
                    const dy = compRect.y - ref.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < tol && dist < closestDist) {
                      closestDist = dist;
                      closest = el;
                    }
                  }
                  if (closest) { promptTextarea = closest; break; }
                }
              } catch (_) { /* try next candidate */ }
            }
            // Fuzzy fallback: same kind + matching placeholder/aria/text metadata
            if (!promptTextarea && promptLocator.meta) {
              const { kind, placeholder, ariaLabel, text: metaText, className } = promptLocator.meta;
              const selectorByKind = {
                textarea: "textarea",
                input: "input",
                contenteditable: "[contenteditable='true'], [contenteditable='']",
                other: "textarea, input, [contenteditable='true'], [contenteditable='']",
              };
              const querySelectorAllDeep = (selector, root = document) => {
                const list = [];
                const seen = new Set();
                const find = (node) => {
                  if (!node) return;
                  if (node.querySelectorAll) for (const m of node.querySelectorAll(selector)) { if (!seen.has(m)) { seen.add(m); list.push(m); } }
                  if (node.shadowRoot) find(node.shadowRoot);
                  if (node.children) for (const child of node.children) find(child);
                };
                find(root);
                return list;
              };
              const pool = querySelectorAllDeep(selectorByKind[kind] || selectorByKind.other);
              // Pre-compute how many elements share each attribute value so we
              // can discount attributes that are non-unique (e.g. placeholder=
              // "text" on every ComfyUI textarea). A shared value gives every
              // candidate the same score → querySelector picks the first → wrong.
              const phCount  = placeholder ? pool.filter(e => e.getAttribute && e.getAttribute("placeholder") === placeholder).length : 0;
              const alCount  = ariaLabel   ? pool.filter(e => e.getAttribute && e.getAttribute("aria-label")   === ariaLabel).length   : 0;
              let best = null, bestScore = 0;
              for (const cand of pool) {
                let score = 0;
                // Only award points for placeholder/ariaLabel when the value is
                // unique (matches exactly 1 element in the pool). If every
                // candidate shares the value it contributes zero disambiguating
                // power, so we skip it to let position-based scoring win.
                if (placeholder && phCount === 1 && cand.getAttribute && cand.getAttribute("placeholder") === placeholder) score += 3;
                if (ariaLabel   && alCount === 1 && cand.getAttribute && cand.getAttribute("aria-label")   === ariaLabel)   score += 3;
                if (metaText && (cand.textContent || "").trim().slice(0, 60) === metaText) score += 2;
                if (className && typeof cand.className === "string" && cand.className.slice(0, 160) === className) score += 1;
                if (score > bestScore) { bestScore = score; best = cand; }
              }
              if (best && bestScore >= 2) promptTextarea = best;
            }
          }

          const usedPersistedLocator = !!promptTextarea;

          if (!promptTextarea) {
            promptTextarea =
              document.querySelector(".booru-target-textarea") ||
              document.querySelector("#txt2img_prompt textarea") ||
              document.querySelector("#txt2img_prompt_row textarea") ||
              document.querySelector("textarea[placeholder*='Prompt (press Ctrl+Enter to generate)']") ||
              document.querySelector("#txt2img_prompt_row #txt2img_prompt textarea") ||
              document.querySelector("textarea.comfy-multiline-input"); // SeaArt
          }

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

          // ── 1b. Generalized field-kind injection helpers ─────────
          // Supports <textarea>, <input>, and contenteditable elements. Each
          // kind has its own read/write pair so the rest of the function can
          // stay kind-agnostic.
          const isTextareaLike = promptTextarea.tagName === "TEXTAREA";
          const isInputLike = promptTextarea.tagName === "INPUT";
          const isContentEditableLike = !isTextareaLike && !isInputLike && !!promptTextarea.isContentEditable;

          const readFieldValue = () => {
            if (isTextareaLike || isInputLike) return promptTextarea.value || "";
            if (isContentEditableLike) return promptTextarea.textContent || "";
            return promptTextarea.value || promptTextarea.textContent || "";
          };

          const writeFieldValue = (value) => {
            if (isTextareaLike) {
              try {
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
                nativeSetter.call(promptTextarea, value);
              } catch (e) { promptTextarea.value = value; }
            } else if (isInputLike) {
              try {
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                nativeSetter.call(promptTextarea, value);
              } catch (e) { promptTextarea.value = value; }
            } else if (isContentEditableLike) {
              // contenteditable has no .value — use execCommand when available
              // (keeps native undo stack + fires input events framework-side),
              // falling back to a manual textContent + beforeinput/input dispatch.
              promptTextarea.focus();
              try {
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(promptTextarea);
                sel.removeAllRanges();
                sel.addRange(range);
              } catch (e) { /* selection API not available in this frame */ }
              let usedExecCommand = false;
              try {
                usedExecCommand = document.execCommand && document.execCommand("insertText", false, value);
              } catch (e) { usedExecCommand = false; }
              if (!usedExecCommand) {
                promptTextarea.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: value }));
                promptTextarea.textContent = value;
              }
            } else {
              promptTextarea.value = value;
            }
          };

          /**
           * Real-typing fallback for textarea/input fields whose
           * framework binding doesn't react to synthetic `input`/`change`
           * events dispatched on a value set via the native setter — a
           * confirmed real-world case on comfy.civitai.com's Vue-wrapped
           * ComfyUI widget: the DOM textarea's .value updates and STAYS
           * updated (verified with actualValueAfterClick), yet the generation
           * that fires uses a stale/generic prompt, meaning the page's own
           * internal state (whatever LiteGraph/Vue reads at generate-time)
           * never got the update. execCommand("insertText") on a focused,
           * fully-selected textarea/input routes through the browser's real
           * text-editing pipeline (same code path as an actual keystroke or
           * paste) rather than a purely synthetic DOM mutation, which is the
           * most framework-agnostic way to trigger whatever internal sync
           * logic the page uses — without needing to know its implementation.
           */
          const writeFieldValueViaRealTyping = (value) => {
            if (!isTextareaLike && !isInputLike) return false;
            try {
              promptTextarea.focus();
              promptTextarea.select();
              const ok = document.execCommand && document.execCommand("insertText", false, value);
              return !!ok;
            } catch (e) {
              return false;
            }
          };

          const dispatchInputEvents = () => {
            // Some frameworks — notably Vue 3 widgets used
            // by LiteGraph.js-based node editors like ComfyUI — distinguish a
            // real user input from a generic `new Event("input")`: the DOM
            // textarea can be a pure visual overlay over a canvas-rendered
            // node graph, where the "real" value lives in the graph's widget
            // state and is only synced via specific listeners (often expecting
            // an InputEvent with inputType, or even keyboard events). Firing a
            // richer, more realistic event sequence maximizes the chance any
            // of these sync strategies picks up the change. This does NOT fix
            // canvas-only widgets that need direct graph API calls, but covers
            // every DOM-listener-based case we've seen so far.
            try {
              promptTextarea.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: promptTextarea.value }));
            } catch (_) { /* InputEvent construction can fail on some engines */ }
            try {
              promptTextarea.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: false, inputType: "insertText", data: promptTextarea.value }));
            } catch (_) {
              promptTextarea.dispatchEvent(new Event("input", { bubbles: true }));
            }
            promptTextarea.dispatchEvent(new Event("change", { bubbles: true }));
            // Some Vue widgets sync on keyup/blur rather than input/change.
            promptTextarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "a" }));
            promptTextarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: "a" }));
          };

          // Detect whether this element (or a close
          // ancestor) is Vue-managed — Vue 3 stamps internal instance refs on
          // the DOM node (__vueParentComponent / __vnode), and scoped styles
          // via data-v-* attributes are a reliable tell even when those
          // internal refs are minified/renamed. Returned in the diagnostics
          // so we can confirm/rule out "this is a Vue-controlled widget whose
          // real state lives outside the DOM value we just wrote" without
          // guessing from outside the page.
          //
          // CROSS-BROWSER NOTE: reading `el.__vueParentComponent` directly
          // only works because Chrome's default ISOLATED world already can't
          // see page-defined expandos on DOM nodes — this check has always
          // been a no-op there too (see the comment on the isolated-world
          // limitation elsewhere in this function). On Firefox the same
          // Xray-vision isolation applies: a content script's `el` is an Xray
          // wrapper around the page's real node, and expando properties the
          // page's own script attached (like Vue's internal refs) are hidden
          // from that wrapper by design. `el.wrappedJSObject` is Firefox's
          // (and only Firefox's) escape hatch to reach the underlying
          // unwrapped object where those expandos are actually visible; it's
          // undefined on Chrome, so the `?.` fallback keeps this portable
          // without needing an engine check. Diagnostic-only either way — it
          // never gates whether the write succeeded, just what gets reported.
          const detectFramework = () => {
            let el = promptTextarea;
            let hasVueMarker = false;
            let hasDataV = false;
            let depth = 0;
            while (el && depth < 6) {
              const unwrapped = el.wrappedJSObject || el;
              if (unwrapped.__vueParentComponent || unwrapped.__vnode || unwrapped._vnode) hasVueMarker = true;
              if (el.attributes) {
                for (const attr of el.attributes) {
                  if (attr.name.startsWith("data-v-")) { hasDataV = true; break; }
                }
              }
              el = el.parentElement;
              depth++;
            }
            return { hasVueMarker, hasDataV };
          };
          const frameworkInfo = detectFramework();

          // ComfyUI's stock UI exposes `window.app`/
          // `window.graph` (LiteGraph.js globals) that expose the REAL node
          // widget value directly, bypassing whatever DOM sync strategy the
          // page's own Vue wrapper uses for its textarea overlay. Civitai's
          // comfy.civitai.com wraps the engine in custom Vue/PrimeVue chrome,
          // so these globals may or may not be exposed the same way — probing
          // for them here settles that empirically instead of guessing.
          const comfyGlobals = {
            hasWindowApp: typeof window.app !== "undefined",
            hasWindowGraph: typeof window.graph !== "undefined",
            appHasGraph: typeof window.app !== "undefined" && !!window.app?.graph,
            graphNodeCount: (() => {
              try {
                const g = window.graph || window.app?.graph;
                return g && Array.isArray(g._nodes) ? g._nodes.length : (g && g.nodes ? Object.keys(g.nodes).length : null);
              } catch (_) { return null; }
            })(),
          };

          const valuesMatch = () => readFieldValue().trim() === text.trim();

          // ── 2. Read what was in the field BEFORE we inject ─────────────────
          const previousValue = readFieldValue();

          // ── 3. Inject the prompt ──────────────────────────────────────────
          // Try real-typing (execCommand insertText through the
          // browser's native editing pipeline) FIRST for textarea/input — it
          // is the most framework-agnostic way to trigger internal sync logic
          // a page's own JS relies on (Vue widgets, LiteGraph-style DOM
          // overlays, etc). Falls back to the native-setter + synthetic-event
          // approach if execCommand is unavailable/fails in this frame, or
          // for contenteditable (handled separately in writeFieldValue).
          let usedRealTyping = false;
          if ((isTextareaLike || isInputLike) && writeFieldValueViaRealTyping(text)) {
            usedRealTyping = true;
          } else {
            writeFieldValue(text);
            dispatchInputEvents();
          }

          // Give React/Vue time to update its state before verifying
          await new Promise((r) => setTimeout(r, 400));

          // Diagnostics returned alongside the result so the sidepanel-side
          // dlog can show exactly what happened without guessing — element
          // kind, whether the FIRST write attempt already matched, and (if
          // not) whether the aggressive focus/blur retry fixed it.
          const fieldKind = isTextareaLike ? "textarea" : isInputLike ? "input" : isContentEditableLike ? "contenteditable" : "unknown";
          let firstAttemptMatched = valuesMatch();
          let usedAggressiveRetry = false;

          // ── 4. Verify the DOM value is correct BEFORE any blur ─────────────
          // Retry the write (NOT another blur) if the field doesn't have the
          // right value yet — this must fully converge before we ever blur.
          if (!valuesMatch()) {
            usedAggressiveRetry = true;
            // The framework (e.g., TensorArt's React state) might have overwritten our injection.
            promptTextarea.focus();
            if (!((isTextareaLike || isInputLike) && writeFieldValueViaRealTyping(text))) {
              writeFieldValue(text);
              dispatchInputEvents();
            }

            await new Promise((r) => setTimeout(r, 400));

            // Final verification — if it STILL doesn't match, DO NOT proceed
            // to blur/click at all: blurring a field with the wrong value
            // risks the page's own widget-sync logic committing that WRONG
            // value permanently (confirmed behavior on comfy.civitai.com).
            if (!valuesMatch()) {
              return { 
                success: false, 
                hasButton: false, 
                reason: "verification_failed",
                actualValue: readFieldValue().substring(0, 300),
                expectedValue: text.substring(0, 300),
                fieldKind,
                usedPersistedLocator,
                firstAttemptMatched,
                usedAggressiveRetry,
                usedRealTyping,
              };
            }
          }

          // LiteGraph-style DOM-widget overlays (confirmed on
          // comfy.civitai.com) often only sync the DOM element's value into
          // the actual graph-node state — the value that gets serialized and
          // sent to the backend on generate — on BLUR, not on input/change.
          // We saw the DOM textarea.value stay correct through every step
          // while the REAL generation still used a stale/generic prompt: the
          // value never went through the widget's blur-triggered sync
          // because nothing ever blurred it (a human always does this
          // implicitly by clicking the Generate button elsewhere on the
          // page). Fire it EXACTLY ONCE, only after the DOM value is already
          // fully verified correct above — never as part of a retry loop,
          // since some widgets' blur-sync APPENDS the DOM value to their
          // existing internal state instead of replacing it (also confirmed
          // on comfy.civitai.com): triggering blur more than once per prompt
          // compounds into visibly duplicated/concatenated text.
          if (isTextareaLike || isInputLike) {
            promptTextarea.blur();
            await new Promise((r) => setTimeout(r, 250));
          }

          // ── 4b. "Match image resolution": set width/height fields ─────────
          // Runs after the prompt is verified + blurred, before the Generate
          // button is resolved/clicked (requirement: modify size before
          // sending). Each dimension is independent — missing/unresolvable
          // locators are skipped, never abort the whole injection.
          let widthSet = false;
          let heightSet = false;
          let sizeMethod = "none";
          if (sizeConfig) {
            // ── LiteGraph/ComfyUI path ─────────────────────────────────────────
            // Sites like SeaArt render their node graph on a <canvas> via
            // LiteGraph.js — the width/height "fields" are NOT DOM elements at
            // all (no input, no contenteditable, nothing an inspector can even
            // select in their closed state; clicking them opens a transient
            // `.graphdialog` that's identical for every numeric widget and
            // gets destroyed on confirm). The reliable approach is to skip the
            // view entirely and write straight into the graph's own data
            // model. IMPORTANT: window.app/window.graph are variables the
            // PAGE's own script defines in the MAIN world — chrome.scripting's
            // default ISOLATED world (which the rest of this function runs
            // in, since it interacts with shared DOM) cannot see them at all.
            // So that step runs SEPARATELY, in processNext, via its own
            // executeScript({ world: "MAIN" }) call BEFORE injectPromptToTab —
            // sizeConfig.liteGraphApplied carries whether that already
            // succeeded, so this ISOLATED-world function only needs to fall
            // back to the DOM mechanism when it didn't.
            if (sizeConfig.liteGraphApplied) {
              widthSet = true;
              heightSet = true;
              sizeMethod = "litegraph";
            }

            const tryResolveNumericField = (locator) => {
              if (!locator || !Array.isArray(locator.candidates)) return null;
              const tryQuery = (root, selector) => { try { return root.querySelector(selector); } catch (_) { return null; } };
              let field = null;
              for (const cand of locator.candidates) {
                try {
                  if (cand.type === "stable-attribute" || cand.type === "structural-path") {
                    const found = tryQuery(document, cand.selector);
                    if (found) { field = found; break; }
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
                    if (el) { field = el; break; }
                  }
                } catch (_) { /* try next candidate */ }
              }
              // Fuzzy fallback: same kind ("input"/"contenteditable") + matching
              // placeholder/aria-label metadata, mirroring the prompt field's
              // fallback above.
              if (!field && locator.meta) {
                const { kind: fieldKind2, placeholder, ariaLabel } = locator.meta;
                const selector = fieldKind2 === "contenteditable" ? "[contenteditable='true'], [contenteditable='']" : "input";
                const pool = Array.from(document.querySelectorAll(selector));
                let best = null, bestScore = 0;
                for (const cand of pool) {
                  let score = 0;
                  if (placeholder && cand.getAttribute && cand.getAttribute("placeholder") === placeholder) score += 3;
                  if (ariaLabel && cand.getAttribute && cand.getAttribute("aria-label") === ariaLabel) score += 3;
                  if (score > bestScore) { bestScore = score; best = cand; }
                }
                if (best && bestScore >= 3) field = best;
              }
              return field;
            };

            const writeNumericField = (field, value) => {
              if (!field) return false;
              try {
                if (field.tagName === "INPUT") {
                  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                  field.focus();
                  nativeSetter.call(field, String(value));
                  field.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: false, inputType: "insertText", data: String(value) }));
                  field.dispatchEvent(new Event("change", { bubbles: true }));
                  field.blur();
                } else if (field.isContentEditable) {
                  field.focus();
                  try {
                    const sel = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(field);
                    sel.removeAllRanges();
                    sel.addRange(range);
                  } catch (_) { /* selection API unavailable in this frame */ }
                  if (!(document.execCommand && document.execCommand("insertText", false, String(value)))) {
                    field.textContent = String(value);
                    field.dispatchEvent(new Event("input", { bubbles: true }));
                  }
                  field.blur();
                } else {
                  return false;
                }
                return true;
              } catch (_) {
                return false;
              }
            };

            if (sizeMethod !== "litegraph") {
              // ── DOM fallback (non-LiteGraph sites) ────────────────────────
              // Only runs when the LiteGraph path above didn't apply (no graph
              // exposed, or no matching node) — i.e. a "normal" site whose
              // width/height are plain <input>/contenteditable fields, using
              // the user's Target-configured locators.
              if (typeof sizeConfig.width === "number" && sizeConfig.widthLocator) {
                const widthField = tryResolveNumericField(sizeConfig.widthLocator);
                widthSet = writeNumericField(widthField, sizeConfig.width);
              }
              if (typeof sizeConfig.height === "number" && sizeConfig.heightLocator) {
                const heightField = tryResolveNumericField(sizeConfig.heightLocator);
                heightSet = writeNumericField(heightField, sizeConfig.height);
              }
              if (widthSet || heightSet) sizeMethod = "dom";
            }
            if (widthSet || heightSet) {
              // Let the page's own state (React/Vue) settle before Generate.
              await new Promise((r) => setTimeout(r, 200));
            }
          }

          // ── 5. Find the Generate button ──────────────────────────
          // Priority: persisted generateButton locator for this origin > legacy
          // hardcoded selector cascade (SeaArt/TensorArt/A1111) > text search.
          let genBtn = null;
          let usedPersistedGenerateLocator = false;

          if (generateLocator && Array.isArray(generateLocator.candidates)) {
            const tryQuery = (root, selector) => { try { return root.querySelector(selector); } catch (_) { return null; } };
            for (const cand of generateLocator.candidates) {
              try {
                if (cand.type === "stable-attribute" || cand.type === "structural-path") {
                  const found = tryQuery(document, cand.selector);
                  if (found) { genBtn = found; break; }
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
                  if (el) { genBtn = el; break; }
                }
              } catch (_) { /* try next candidate */ }
            }
            if (!genBtn && generateLocator.meta) {
              const { ariaLabel, text: metaText, className } = generateLocator.meta;
              const querySelectorAllDeep = (selector, root = document) => {
                const list = [];
                const seen = new Set();
                const find = (node) => {
                  if (!node) return;
                  if (node.querySelectorAll) for (const m of node.querySelectorAll(selector)) { if (!seen.has(m)) { seen.add(m); list.push(m); } }
                  if (node.shadowRoot) find(node.shadowRoot);
                  if (node.children) for (const child of node.children) find(child);
                };
                find(root);
                return list;
              };
              const pool = querySelectorAllDeep("button, [role='button'], a, input[type='submit'], input[type='button']");
              let best = null, bestScore = 0;
              for (const cand of pool) {
                let score = 0;
                if (ariaLabel && cand.getAttribute && cand.getAttribute("aria-label") === ariaLabel) score += 3;
                if (metaText && (cand.textContent || "").trim().slice(0, 60) === metaText) score += 2;
                if (className && typeof cand.className === "string" && cand.className.slice(0, 160) === className) score += 1;
                if (score > bestScore) { bestScore = score; best = cand; }
              }
              if (best && bestScore >= 2) genBtn = best;
            }
            usedPersistedGenerateLocator = !!genBtn;
          }

          if (!genBtn) {
            genBtn =
              document.querySelector("#txt2img_generate") ||
              document.querySelector('button[data-gtm-event="Complete Generation Image"]') ||
              document.querySelector('button[data-gtm-event*="Generation"]') ||
              document.querySelector(".work-flow-bottom-btn-main-text") ||
              document.querySelector(".work-flow-bottom-btn");
          }

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

          // ── 6. SAFETY CHECK: Re-read the field right before clicking ──────
          // This guards against the bug where React/Vue re-renders reset the
          // field between our injection and the Generate click. NOTE:
          // this is now only a DIAGNOSTIC warning, not a hard abort — the
          // deliberate blur() above (step 5) can legitimately cause some
          // widgets (confirmed on comfy.civitai.com's LiteGraph-style DOM
          // overlay) to reformat/resync the DOM value as part of committing
          // it to their internal graph-node state. Aborting here would throw
          // away a successful injection just because the page's own sync
          // logic touched the DOM afterward — the pre-blur verification above
          // is what actually matters (it confirms OUR write succeeded).
          const valueBeforeClick = readFieldValue().trim();
          if (valueBeforeClick !== text.trim()) {
            console.warn("[Queue] pre-click value differs from what we wrote (likely the page's own blur-sync reformatting it) — proceeding anyway since the pre-blur write was verified.", { valueBeforeClick: valueBeforeClick.slice(0, 100), expected: text.slice(0, 100) });
          }

          // ── 7. Click Generate ─────────────────────────────────────────────
          // ── Avoid multi-frame double-submit ──
          // injectPromptToTab's executeScript runs with allFrames:true, so
          // THIS function body (including the click below) executes once per
          // frame in the tab. When the prompt field was found via a heuristic
          // fallback (no persisted locator for THIS origin/frame — the common
          // ambiguous case), more than one frame can independently resolve a
          // textarea-looking element AND a "Generate"-looking button and BOTH
          // click it, firing two generations for one queued prompt.
          // A persisted locator is frame-specific by construction (built from
          // a click the USER made in one exact frame via startTargeting), so
          // when one resolved, this is provably the one correct frame and no
          // extra gating is needed. Only the double-heuristic case is at risk:
          // skip the click there unless this is the top frame — the top frame
          // is where a plain single-page app's own Generate button lives in
          // the overwhelming majority of unconfigured sites, so this keeps the
          // common case working while removing the extra iframe's click.
          const isAmbiguousHeuristicFrame = !usedPersistedLocator && !usedPersistedGenerateLocator && window !== window.top;
          if (genBtn && isAmbiguousHeuristicFrame) {
            return {
              success: true,
              hasButton: true,
              reason: "skipped_click_ambiguous_subframe",
              usedPersistedLocator,
              usedPersistedGenerateLocator,
              previousValue: previousValue.substring(0, 100),
              injectedValue: text.substring(0, 100),
              actualValueAfterClick: readFieldValue().trim().substring(0, 100),
              fieldKind,
              firstAttemptMatched,
              usedAggressiveRetry,
              frameworkInfo,
              comfyGlobals,
              usedRealTyping,
              widthSet,
              heightSet,
              sizeMethod,
              skippedClick: true,
            };
          }
          if (genBtn) {
            // Clean up old TensorArt toast messages so they don't falsely trigger the fast-track resolve
            document.querySelectorAll(".n-message").forEach(el => el.remove());

            // ── Dismiss STALE TensorArt rejection dialogs BEFORE submitting ───
            // (Bug: "same prompt generated twice, mostly when the tab is out of
            // focus".) A "Generation queue is full" / "Generate failed" dialog
            // (.n-dialog) from a PREVIOUS prompt can still be in the DOM when we
            // submit this one — its close-click was likely throttled/deferred by
            // Chrome's background timer throttling while the tab was unfocused.
            // If it lingers, waitForGenerateButtonFree sees it (it checks
            // hitLimit BEFORE the success signal) and mis-reads THIS accepted
            // submission as "queue full", firing the limit_reached retry path
            // which re-injects and re-clicks the EXACT same prompt → the
            // duplicate generation. Clearing stale rejection dialogs here means
            // any dialog seen afterwards genuinely belongs to THIS submission,
            // so the retry only fires on a real rejection. Only rejection
            // dialogs are touched (matched by text); other dialogs are left be.
            document.querySelectorAll(".n-dialog").forEach((dlg) => {
              const t = dlg.textContent || "";
              if (t.includes("Generation queue is full") || t.includes("Generate failed")) {
                const close = dlg.querySelector(".n-dialog__close, .n-base-close");
                if (close) { try { close.click(); } catch (_) {} }
                try { dlg.remove(); } catch (_) {}
              }
            });

            // ── Click exactly ONE element ─────────────────────────────────────
            // genBtn.click() ALREADY dispatches a real, bubbling "click". The
            // old code then ALSO called innerText.click() on a descendant "just
            // in case we selected the parent div" — but that second real click
            // bubbles right back up to genBtn, so frameworks (Vue/React) that
            // listen on the button see TWO clicks and fire the generate handler
            // twice per prompt. That is the same double-submit class this queue
            // fought before (the synthetic-events list below already excludes
            // "click" for exactly this reason). Instead, pick the INNERMOST
            // known target (the button's text node when present, else the
            // button) and click it once: a click on the inner node still bubbles
            // UP to the wrapper's handler, so a single click covers both
            // "handler on the button" and "handler on the wrapper" — never twice.
            // Wait for button to become clickable if it's currently in cooldown or disabled (e.g. SeaArt 2-3s cooldown)
            const isButtonBusy = (el) => {
              if (!el) return false;
              const b = el.closest("button") || el.closest(".work-flow-bottom-btn") || el;
              if (b.disabled || b.getAttribute("aria-disabled") === "true") return true;
              if (b.classList.contains("is-disabled") || b.classList.contains("disabled")) return true;
              const cs = window.getComputedStyle(b);
              if (cs.pointerEvents === "none" || cs.cursor === "not-allowed") return true;
              if (parseFloat(cs.opacity) < 0.6) return true;
              const t = (b.textContent || "").trim().toLowerCase();
              if (t.includes("generating") || t.includes("generando") || t.includes("processing") || t.includes("procesando")) return true;
              return false;
            };

            const waitStart = Date.now();
            while (isButtonBusy(genBtn) && Date.now() - waitStart < 6000) {
              await new Promise((r) => setTimeout(r, 300));
            }

            // ── Don't click into a still-busy button ──
            // A click on a disabled/cooldown button is a no-op on the page, yet
            // would report { success: true } and silently drop the prompt when
            // the site's cooldown outlasts 6s. Bail out with a distinct reason
            // so processNext can re-queue instead.
            if (isButtonBusy(genBtn)) {
              console.warn("[Queue] Generate button still busy after 6s wait — aborting click for this attempt (will retry via processNext backoff, not a silent no-op click).");
              return {
                success: false,
                hasButton: true,
                reason: "generate_button_busy_timeout",
                fieldKind,
                usedPersistedLocator,
                firstAttemptMatched,
                usedAggressiveRetry,
                usedRealTyping,
              };
            }

            const innerText = genBtn.querySelector(".work-flow-bottom-btn-main-text");
            const clickTarget = innerText || genBtn;

            // ── Real pointer-event order ──
            // A real interaction fires pointerdown → mousedown → pointerup →
            // mouseup → click. Frameworks that activate on mouseup/pointerup
            // would see a second activation if these events came after
            // click(), so the down/up pair is dispatched first.
            const pointerEventsBeforeClick = ["pointerdown", "mousedown", "pointerup", "mouseup"];
            for (const type of pointerEventsBeforeClick) {
              clickTarget.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
            }
            clickTarget.click();
          }
          return { 
            success: true, 
            hasButton: !!genBtn, 
            usedPersistedLocator,
            usedPersistedGenerateLocator,
            previousValue: previousValue.substring(0, 100),
            injectedValue: text.substring(0, 100),
            // actualValueAfterClick is read AFTER genBtn.click()
            // fires — if a framework's own state management resets/overwrites the
            // field on click (a real risk with Vue-controlled inputs), this proves
            // it independent of any earlier verification step.
            actualValueAfterClick: readFieldValue().trim().substring(0, 100),
            fieldKind,
            firstAttemptMatched,
            usedAggressiveRetry,
            frameworkInfo,
            comfyGlobals,
            usedRealTyping,
            widthSet,
            heightSet,
            sizeMethod,
          };
        },
        args: [promptText, promptLocator || null, generateLocator || null, sizeConfig || null],
      },
      (results) => {
        if (chrome.runtime.lastError) {
          console.warn("[Queue] Injection error:", chrome.runtime.lastError.message);
          resolve({ success: false, reason: "scripting_error" });
          return;
        }
        
        // Find a successful injection result in any frame — prefer a frame
        // that actually clicked Generate over one that deliberately skipped
        // the click (skippedClick, see the ambiguous-subframe guard above),
        // since only the former represents a real submission.
        const successfulFrame =
          results?.find(r => r.result && r.result.success && !r.result.skippedClick) ||
          results?.find(r => r.result && r.result.success);
        if (successfulFrame) {
          const r = successfulFrame.result;
          dlog(`[Queue] ✓ Prompt injected (field: ${r.usedPersistedLocator ? "persisted locator" : "legacy heuristic"}[${r.fieldKind}], button: ${r.usedPersistedGenerateLocator ? "persisted locator" : "legacy heuristic"}, size: widthSet=${r.widthSet} heightSet=${r.heightSet} method=${r.sizeMethod}). usedRealTyping=${r.usedRealTyping} firstAttemptMatched=${r.firstAttemptMatched} usedAggressiveRetry=${r.usedAggressiveRetry} frameworkInfo=${JSON.stringify(r.frameworkInfo)} comfyGlobals=${JSON.stringify(r.comfyGlobals)}. Previous: "${r.previousValue}..." → Injected: "${r.injectedValue}..." → ActualAfterClick: "${r.actualValueAfterClick}..."`);
          if (r.actualValueAfterClick && r.injectedValue && !r.actualValueAfterClick.startsWith(r.injectedValue.slice(0, 40))) {
            console.warn(`[Queue] ⚠ Field value AFTER clicking Generate does not match what we injected — the page's own framework likely reset/overwrote it on click. This means Generate may have fired with the WRONG (old/empty) prompt.`, { injected: r.injectedValue, actualAfterClick: r.actualValueAfterClick });
          }
          resolve({ 
            success: true, 
            hasButton: r.hasButton && !r.skippedClick,
            frameId: successfulFrame.frameId,
            widthSet: r.widthSet,
            heightSet: r.heightSet,
            sizeMethod: r.sizeMethod,
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
