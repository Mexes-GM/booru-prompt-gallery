// sidepanel/07-targeting.js — Target system: pick the prompt/generate/queue/size fields on the page.
// Classic script: shares the global scope with the other sidepanel/*.js
// files, loaded in numeric order by sidepanel.html. Load-time code may only
// use names declared in this file or an earlier one.

// ─────────────────────────────────────────────────────────────────────────────
// TARGET SYSTEM (refactored) — select the prompt input on the generation page
// ─────────────────────────────────────────────────────────────────────────────
// Flow:
//   1. User clicks Target → startTargeting()
//   2. We locate the generation tab and inject an instrumented "arming" script
//      into all frames. The script discovers candidate inputs, attaches hover +
//      click listeners, and reports diagnostics back via chrome.runtime.sendMessage.
//   3. When the user clicks an input, the injected script marks it with
//      `.booru-target-textarea` (kept for backwards-compatible live highlighting)
//      AND builds a persistent locator via buildElementLocator(), reporting both
//      back via phase:"selected".
//   4. We relay every phase to the iframe via TARGET_STATUS so the React UI can
//      show real feedback (arming / waiting / selected / none / error). The
//      resolved locator is persisted into the active SiteProfile (see the
//      SiteProfiles store) so it survives reloads/navigation.
// ─────────────────────────────────────────────────────────────────────────────

const TARGET_TIMEOUT_MS = 30000; // Auto-cancel selection mode after 30s of no click
let targetingActive = false;
let targetingTabId = null;
let targetingTimeoutId = null;

/** Relay targeting status to the React iframe + log it. */
function sendTargetStatus(state, detail) {
  try {
    // "*" — React verifies event.source === window.parent (origins differ:
    // iframe is localhost/vercel, this sidepanel is chrome-extension://).
    appFrame.contentWindow.postMessage({ type: "TARGET_STATUS", state, detail: detail || null }, "*");
  } catch (_) { /* iframe not ready */ }
  dlog(`[Target] ▶ state="${state}"`, detail || "");
}

/** Resolve the generation tab + platform name from the current window's tabs. */
function resolveTargetTab(allTabs) {
  const PLATFORM_DOMAINS = ["seaart.ai", "tensor.art", "tensorhub.net", "yodayo.com"];
  const isLocalUi = (u) => u && (u.includes("127.0.0.1") || u.includes("localhost") || u.includes("gradio.live"));

  // The user's active tab (where the Target click just happened) is always
  // tried first, regardless of the allowlist; otherwise a SeaArt/TensorArt
  // tab left open in the background would win and Target would arm on the
  // wrong page.
  // The allowlist fallbacks below only matter when the active tab itself
  // isn't a valid target (chrome://, devtools://, extension pages, etc).
  const activeTab = allTabs.find(t => t.active);
  // Permission catch-22: chrome.tabs.query reports url:"" for
  // ANY tab the extension doesn't yet have host permission for — it does NOT
  // distinguish "no tab" from "a real tab we just can't see the URL of yet".
  // Without this, an active tab on an unconfigured site (no host_permission
  // and activeTab doesn't apply — it only auto-grants via chrome.action
  // clicks, not side-panel button clicks) would look identical to "no active
  // tab at all" and fall through to the background-tab allowlist fallback
  // below. "Active tab exists but its url is hidden" is its own case: startTargeting
  // detects this and requests <all_urls> BEFORE calling resolveTargetTab
  // again, breaking the catch-22 (can't request a specific origin without
  // knowing the URL; can't see the URL without a permission covering it).
  const activeTabUrlHidden = !!(activeTab && !activeTab.url && typeof activeTab.id === "number");
  const isValidActiveTab = isInjectableTabUrl(activeTab && activeTab.url);
  dlog(`[Target][resolveTargetTab] all tabs in currentWindow:`, allTabs.map(t => ({ id: t.id, active: t.active, url: (t.url || "").slice(0, 80) })));

  let tab =
    (isValidActiveTab ? activeTab : null) ||
    (activeTabUrlHidden ? null : allTabs.find(t => t.active && t.url && (urlHasAnyHost(t.url, PLATFORM_DOMAINS) || isLocalUi(t.url)))) ||
    (activeTabUrlHidden ? null : allTabs.find(t => t.url && urlHasAnyHost(t.url, PLATFORM_DOMAINS))) ||
    (activeTabUrlHidden ? null : allTabs.find(t => t.active && isInjectableTabUrl(t.url)));

  if (isValidActiveTab && tab === activeTab) {
    dlog(`[Target][resolveTargetTab] picked the ACTIVE tab (id=${tab.id}): "${tab.url}"`);
  } else if (activeTabUrlHidden && !tab) {
    dlog(`[Target][resolveTargetTab] ⚠ active tab id=${activeTab.id} has a HIDDEN url (no host permission yet) — signaling urlHidden so startTargeting can request <all_urls>.`);
  } else if (tab) {
    dlog(`[Target][resolveTargetTab] ⚠ active tab was not usable — fell back to tab id=${tab.id} (active=${tab.active}): "${tab.url}"`);
  }

  if (!tab && activeTabUrlHidden) {
    return { tab: null, platform: "Unknown", urlHidden: true, hiddenTabId: activeTab.id };
  }

  if (!tab) return { tab: null, platform: "Unknown" };

  const url = tab.url || "";
  let platform = "Unknown";
  if (urlHasHost(url, "seaart.ai")) platform = "SeaArt";
  else if (urlHasHost(url, "tensor.art")) platform = "TensorArt";
  else if (urlHasHost(url, "tensorhub.net")) platform = "TensorHub";
  else if (urlHasHost(url, "yodayo.com")) platform = "Yodayo";
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

/**
 * The function injected into every frame to arm selection mode.
 *
 * @param {"prompt"|"generate"|"queue"|"width"|"height"} targetKind Which kind of element the user is
 *   selecting. Changes what's selectable/highlighted:
 *     - "prompt"        → textarea / input / contenteditable (unchanged legacy behavior)
 *     - "generate"      → clickables: button, [role=button], a, input[type=submit|button]
 *     - "queue"         → any element (the user is pointing at a queue/status container)
 *     - "width"/"height" → numeric inputs (the generation site's resolution fields)
 *
 * While armed, ArrowUp/ArrowDown adjust the highlighted candidate to
 * its parent/first-matching-child — useful when the ideal click target is a
 * wrapper div (queue container) or when the nearest match is a leaf span
 * inside the real button.
 */
function armTargetingInPage(targetKind, devMode) {
  const LOG = (...a) => { if (devMode) console.log("%c[BooruTarget]", "color:#3b82f6;font-weight:bold", ...a); };
  const kind = targetKind || "prompt";

  // Tear down any prior session in this frame
  if (window.__booruTargetCleanup) { try { window.__booruTargetCleanup(); } catch (e) {} }

  // ── BUG FIX: clear any STALE legacy marker from a PREVIOUS targeting session
  // (e.g. the prompt field marked in wizard step 1) before arming a new one.
  // Without this, the polling fallback in startTargeting() (which watches for
  // `.booru-target-textarea` as a redundant detection path) can find the OLD
  // element within milliseconds of arming step 2/3, report it as "selected"
  // with no user interaction at all, and — because that path's payload lacks
  // a `frameUrl`/locator match for the new step — get misattributed to the
  // step currently active in the wizard. This is what looked like "the
  // generate button selects itself with no feedback" when moving from the
  // prompt step to the generate step.
  document.querySelectorAll(".booru-target-textarea").forEach(el => el.classList.remove("booru-target-textarea"));

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
      .booru-target-adjust-hint {
        outline: 3px dashed #f59e0b !important;
        outline-offset: 2px !important;
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

  const SELECTOR_BY_KIND = {
    prompt: "textarea, [contenteditable='true'], [contenteditable='']",
    generate: "button, [role='button'], a, input[type='submit'], input[type='button'], .work-flow-bottom-btn, .work-flow-bottom-btn-main-text, div[class*='btn'], div[class*='button']",
    queue: "*",
    // width/height: the "Match image resolution" feature targets a numeric
    // input (most sites use <input type="number"> or a plain <input> next to
    // a "Width"/"Height" label; some use a slider+input pair, in which case
    // the parent/child adjust keys — ArrowUp/ArrowDown — let the user pick the
    // actual input instead of the slider thumb).
    width: "input, [contenteditable='true'], [contenteditable=''], [role='spinbutton']",
    height: "input, [contenteditable='true'], [contenteditable=''], [role='spinbutton']",
  };
  const SELECTOR = SELECTOR_BY_KIND[kind] || SELECTOR_BY_KIND.prompt;

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
      if (kind === "queue") return el; // any element qualifies — the raw hit is fine
      if (el.matches && el.matches(SELECTOR)) return el;
      const inner = el.querySelector && el.querySelector(SELECTOR);
      if (inner) return inner;
      const up = el.closest && el.closest(SELECTOR);
      if (up) return up;
      // SeaArt: clicking the .dom-widget wrapper → find its textarea
      if (kind === "prompt") {
        const widget = el.closest && el.closest(".dom-widget");
        if (widget) { const ta = widget.querySelector("textarea, [contenteditable]"); if (ta) return ta; }
      }
    }
    // Deeper fallback: elementFromPoint only returns the TOPMOST element in
    // the stacking order. Some UIs (e.g. ComfyUI-based editors on Civitai/
    // SeaArt) render floating overlays — selection toolbars, node-action
    // panels — with pointer-events:auto and a higher z-index than the actual
    // prompt textarea underneath (a `.dom-widget` positioned inside the zoom/
    // pan canvas). If the click's own composedPath() and the single topmost
    // hit both come back empty-handed, walk the FULL element stack at these
    // coordinates (elementsFromPoint, plural) and pick the first one that's
    // either the target kind directly or a `.dom-widget` textarea/
    // contenteditable — i.e. "look through" the overlay to what's behind it.
    if (kind === "prompt" && document.elementsFromPoint) {
      const stack = document.elementsFromPoint(e.clientX, e.clientY);
      for (const cand of stack) {
        if (!cand || cand.nodeType !== 1) continue;
        if (cand.matches && cand.matches(SELECTOR)) { LOG("resolved via elementsFromPoint stack-walk (overlay pierced):", cand.tagName, cand.className); return cand; }
        const widget = cand.classList && cand.classList.contains("dom-widget") ? cand : (cand.closest && cand.closest(".dom-widget"));
        if (widget) {
          const ta = widget.querySelector("textarea, [contenteditable]");
          if (ta) { LOG("resolved via elementsFromPoint stack-walk → .dom-widget textarea (overlay pierced):", ta.tagName); return ta; }
        }
      }
    }
    return null;
  };

  let lastHighlighted = null;
  // the currently "armed" candidate before the user commits with a
  // click. ArrowUp/ArrowDown walk this up to its parent / back down to the
  // last-visited child, letting the user correct an imprecise auto-detection
  // (e.g. selected a <span> inside the real <button>, or need the wrapper
  // <div> instead of a leaf for a queue container).
  let adjustable = null;
  const childHistory = []; // stack of previously-visited descendants, for ArrowDown to retrace

  const clearHighlight = () => {
    if (lastHighlighted) { lastHighlighted.classList.remove("booru-selectable-target"); lastHighlighted = null; }
  };
  const clearAdjustHint = () => {
    if (adjustable) adjustable.classList.remove("booru-target-adjust-hint");
  };

  const onMove = (e) => {
    const input = resolveFromEvent(e);
    if (input === lastHighlighted) return;
    clearHighlight();
    if (input) {
      input.classList.add("booru-selectable-target");
      lastHighlighted = input;
      clearAdjustHint();
      adjustable = input;
      childHistory.length = 0;
    }
  };

  /** Move the adjustable candidate to its parent element. */
  const adjustToParent = () => {
    if (!adjustable || !adjustable.parentElement) return;
    childHistory.push(adjustable);
    clearHighlight();
    clearAdjustHint();
    adjustable = adjustable.parentElement;
    adjustable.classList.add("booru-target-adjust-hint");
    lastHighlighted = null; // parent may not match SELECTOR; adjust-hint styling carries it
    LOG("adjust ↑ parent:", adjustable.tagName, adjustable.className);
  };

  /** Move the adjustable candidate back down to the last child visited. */
  const adjustToChild = () => {
    if (childHistory.length === 0) return;
    clearAdjustHint();
    adjustable = childHistory.pop();
    adjustable.classList.add("booru-target-adjust-hint");
    LOG("adjust ↓ child:", adjustable.tagName, adjustable.className);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowUp") { e.preventDefault(); adjustToParent(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); adjustToChild(); }
    else if (e.key === "Escape") { e.preventDefault(); cleanup(); safeSend({ type: "TARGET_RESULT", phase: "cancelled" }); }
  };

  const onClickCapture = (e) => {
    // If the user has adjusted the candidate via keyboard, commit that
    // element regardless of whether it matches SELECTOR (parent divs for
    // queue containers legitimately won't).
    const input = adjustable || resolveFromEvent(e);
    if (!input) { LOG("click ignored — no resolvable target at", e.clientX, e.clientY); return; } // clicked elsewhere — stay armed, let the page handle it

    LOG("click captured — committing target:", input.tagName, input.className, "(via", adjustable ? "keyboard-adjusted candidate" : "resolveFromEvent", ")");

    // Intercept this click so the page doesn't act on it
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    document.querySelectorAll(".booru-target-textarea").forEach(el => el.classList.remove("booru-target-textarea"));
    input.classList.add("booru-target-textarea"); // legacy live-highlight marker (session-only)
    clearHighlight();
    clearAdjustHint();
    cleanup();

    // ── Build a persistent locator ─────────────────────────────────
    // Self-contained copy of the locator-builder logic: chrome.scripting's
    // func-injection only serializes THIS function's source, so it cannot
    // close over buildElementLocator() defined in sidepanel/06-locator.js.
    const locator = (() => {
      const escSel = (s) => { try { return CSS.escape(String(s)); } catch (_) { return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); } };
      const candidates = [];
      const el = input;
      if (el.id) candidates.push({ type: "stable-attribute", selector: `#${escSel(el.id)}` });
      for (const attr of ["data-testid", "data-test-id", "data-qa", "data-id", "name"]) {
        const v = el.getAttribute && el.getAttribute(attr);
        if (v) candidates.push({ type: "stable-attribute", selector: `${el.tagName.toLowerCase()}[${attr}="${escSel(v)}"]` });
      }
      const ariaLabelAttr = el.getAttribute && el.getAttribute("aria-label");
      // Only use aria-label/placeholder as stable candidates when they are
      // unique in the document — a shared value like placeholder="text"
      // (ComfyUI's default for all text nodes) would make querySelector pick
      // the first match rather than the element the user actually selected.
      if (ariaLabelAttr) {
        const ariaMatches = document.querySelectorAll(`${el.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabelAttr)}"]`);
        if (ariaMatches.length === 1) candidates.push({ type: "stable-attribute", selector: `${el.tagName.toLowerCase()}[aria-label="${escSel(ariaLabelAttr)}"]` });
      }
      const placeholderAttr = el.getAttribute && el.getAttribute("placeholder");
      if (placeholderAttr) {
        const phMatches = document.querySelectorAll(`${el.tagName.toLowerCase()}[placeholder="${CSS.escape(placeholderAttr)}"]`);
        if (phMatches.length === 1) candidates.push({ type: "stable-attribute", selector: `${el.tagName.toLowerCase()}[placeholder="${escSel(placeholderAttr)}"]` });
      }

      const buildStructuralSelector = (node, root) => {
        const segments = [];
        let cur = node;
        while (cur && cur !== root && cur.nodeType === 1) {
          const parent = cur.parentElement;
          if (!parent) break;
          const siblingsOfType = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
          const idx = siblingsOfType.indexOf(cur) + 1;
          segments.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${idx})`);
          cur = parent;
          if (cur === root) break;
        }
        return segments.join(" > ");
      };

      let shadowHops = [];
      {
        let node = el;
        let segmentStart = el;
        while (node) {
          const rootNode = node.getRootNode ? node.getRootNode() : document;
          const isShadow = typeof ShadowRoot !== "undefined" && rootNode instanceof ShadowRoot;
          if (!isShadow) {
            shadowHops.unshift(buildStructuralSelector(segmentStart, rootNode === document ? document.body : rootNode));
            break;
          }
          shadowHops.unshift(buildStructuralSelector(segmentStart, rootNode));
          node = rootNode.host;
          segmentStart = node;
          if (!node) break;
        }
      }
      if (shadowHops.length > 1) candidates.push({ type: "shadow-path", selectors: shadowHops });

      const structural = buildStructuralSelector(el, document.body);
      if (structural) candidates.push({ type: "structural-path", selector: structural });

      // ── Coordinates candidate (SeaArt) ───────────────────────────
      // SeaArt ComfyUI textareas have no id/name/aria-label/placeholder, so the
      // only locator generated above is structural-path (DOM position), which
      // breaks when the user loads a different workflow or moves nodes (the
      // nth-of-type index shifts). Store the element's viewport rect + className
      // as a last-resort tiebreaker: at injection time we find the textarea
      // closest to these coordinates (within `tolerance` px). Placed AFTER
      // structural-path so a still-valid structural locator wins first.
      const hasStableCandidate = candidates.some(c => c.type === "stable-attribute");
      try {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          // Also capture the parent .dom-widget's rect when present (ComfyUI
          // nodes). The widget rect is more stable than the textarea rect itself
          // because it's the node container that gets repositioned as a unit.
          const widget = el.closest && el.closest(".dom-widget");
          const wr = widget ? widget.getBoundingClientRect() : null;
          candidates.push({
            type: "coordinates",
            rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
            widgetRect: wr ? { x: Math.round(wr.x), y: Math.round(wr.y), width: Math.round(wr.width), height: Math.round(wr.height) } : null,
            className: typeof el.className === "string" ? el.className.slice(0, 200) : "",
            // Wider tolerance when no stable attr exists — the canvas may have
            // scrolled slightly between sessions.
            tolerance: hasStableCandidate ? 60 : 120,
          });
        }
      } catch (_) { /* getBoundingClientRect failed — no coordinates candidate */ }

      if (candidates.length === 0) return null;

      let elKind = "other";
      if (el.tagName === "TEXTAREA") elKind = "textarea";
      else if (el.tagName === "INPUT") elKind = "input";
      else if (el.isContentEditable) elKind = "contenteditable";
      else if (el.tagName === "BUTTON" || el.getAttribute("role") === "button" || el.tagName === "A") elKind = "clickable";
      else if (kind === "queue") elKind = "container";

      return {
        v: 1,
        candidates,
        meta: {
          tag: el.tagName,
          kind: elKind,
          className: typeof el.className === "string" ? el.className.slice(0, 160) : "",
          text: (el.textContent || "").trim().slice(0, 60),
          placeholder: placeholderAttr || "",
          ariaLabel: ariaLabelAttr || "",
          frameUrl: location.href.slice(0, 200),
          isTop: window === window.top,
        },
      };
    })();

    const info = {
      tag: input.tagName,
      className: typeof input.className === "string" ? input.className.slice(0, 80) : "",
      placeholder: input.getAttribute ? (input.getAttribute("placeholder") || "") : "",
      frameUrl: location.href.slice(0, 120),
      targetKind: kind,
      locator,
    };
    LOG("selected", info, "| locator candidates:", locator?.candidates?.length || 0, locator?.candidates?.map(c => c.type));
    safeSend({ type: "TARGET_RESULT", phase: "selected", info });
  };

  function cleanup() {
    document.removeEventListener("click", onClickCapture, true);
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.documentElement.classList.remove("booru-targeting-cursor");
    clearHighlight();
    clearAdjustHint();
    window.__booruTargetCleanup = null;
  }

  // Capture-phase listeners on the document — robust against overlays,
  // shadow DOM, scaled wrappers, and framework event handling.
  document.addEventListener("click", onClickCapture, true);
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.documentElement.classList.add("booru-targeting-cursor");
  window.__booruTargetCleanup = cleanup;

  // Helper to find elements recursively, including traversing open shadow roots
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

  // Diagnostics: how many inputs exist in this frame (visible-ish). For
  // targetKind:"queue" the selector is "*" (any element is selectable), so we
  // report container-ish candidates instead of literally every DOM node.
  const diagSelector = kind === "queue" ? "div, section, ul, ol, aside, [class*='list'], [class*='queue'], [class*='history']" : SELECTOR;
  const allInputs = querySelectorAllDeep(diagSelector).filter(el => {
    const cs = window.getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  });
  const diag = {
    frameUrl: location.href.slice(0, 120),
    isTop: window === window.top,
    targetKind: kind,
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

/**
 * Ensure we hold host permission for `url`'s origin, requesting it
 * on-demand via chrome.permissions.request if we don't. This is what lets the
 * extension work on sites outside the manifest's fixed host_permissions
 * allowlist: manifest.json declares `optional_host_permissions: ["<all_urls>"]`,
 * and we only ever request the ONE origin actually needed, when the user
 * explicitly starts targeting on it.
 *
 * KNOWN LIMITATION: chrome.permissions.request() must run during a user
 * gesture. We call it from inside the QUEUE_ACTION "target" message handler,
 * which itself fires from a postMessage sent by the React iframe's button
 * click — Chrome has historically propagated user activation through a single
 * postMessage hop, but this is not guaranteed on every version. If the
 * permission prompt is silently refused for this reason, `chrome.runtime.
 * lastError` surfaces it and we resolve false with a clear error the user can
 * retry (the retry re-establishes gesture context via the fresh click).
 *
 * Resolves true if permission is/becomes available, false if the user denies
 * it, the origin can't be parsed, or the request was rejected for lacking a
 * user gesture. Origins already covered by the manifest's fixed
 * host_permissions resolve true instantly (chrome.permissions.contains
 * already accounts for those).
 */
function ensureHostPermission(url) {
  return new Promise((resolve) => {
    const origin = originFromUrl(url);
    if (!origin) { resolve(false); return; }
    const originPattern = `${origin}/*`;
    try {
      chrome.permissions.contains({ origins: [originPattern] }, (already) => {
        if (chrome.runtime.lastError) { resolve(false); return; }
        if (already) { resolve(true); return; }
        dlog(`[Permissions] Requesting on-demand host permission for ${originPattern}...`);
        chrome.permissions.request({ origins: [originPattern] }, (granted) => {
          if (chrome.runtime.lastError) { console.warn("[Permissions] request error:", chrome.runtime.lastError.message); resolve(false); return; }
          dlog(`[Permissions] ${granted ? "Granted" : "Denied"} for ${originPattern}.`);
          resolve(!!granted);
        });
      });
    } catch (e) {
      console.warn("[Permissions] contains/request threw:", e);
      resolve(false);
    }
  });
}

/**
 * Breaks the permission catch-22 for sites Chrome hides the
 * URL of: chrome.tabs.query reports url:"" for any tab we lack a host
 * permission for, and there is no way to request a permission for an origin
 * we can't read — activeTab doesn't help either, since it only auto-grants
 * on chrome.action (toolbar icon) invocations, never on side-panel button
 * clicks. The only way out is to request the broad `<all_urls>` optional
 * permission (already declared in manifest.json) BEFORE we know the origin.
 * Once granted, every future chrome.tabs.query call reveals real URLs for
 * every site, permanently — this is a one-time prompt per install, not
 * per-site, unlike ensureHostPermission's origin-scoped requests.
 * Resolves true if permission is/becomes available, false if denied/failed.
 */
function ensureAllUrlsPermission() {
  return new Promise((resolve) => {
    try {
      chrome.permissions.contains({ origins: ["<all_urls>"] }, (already) => {
        if (chrome.runtime.lastError) { resolve(false); return; }
        if (already) { resolve(true); return; }
        dlog(`[Permissions] Tab URL is hidden (no host permission covers it) — requesting <all_urls> to break the catch-22...`);
        chrome.permissions.request({ origins: ["<all_urls>"] }, (granted) => {
          if (chrome.runtime.lastError) { console.warn("[Permissions] <all_urls> request error:", chrome.runtime.lastError.message); resolve(false); return; }
          dlog(`[Permissions] <all_urls> ${granted ? "granted" : "denied"}.`);
          resolve(!!granted);
        });
      });
    } catch (e) {
      console.warn("[Permissions] <all_urls> contains/request threw:", e);
      resolve(false);
    }
  });
}

/** Entry point: begin selection mode.
 *  @param {"prompt"|"generate"|"queue"} targetKind defaults to "prompt"
 *   for backwards compatibility with existing callers (e.g. the legacy
 *   QUEUE_ACTION "target" from the React iframe, which only ever targets prompts). */
function startTargeting(targetKind) {
  const kind = targetKind || "prompt";
  dlog(`[Target][startTargeting] ▶ targetKind="${kind}"`);
  chrome.tabs.query({ currentWindow: true }, async (allTabs) => {
    let { tab, platform, urlHidden, hiddenTabId } = resolveTargetTab(allTabs);
    dlog(`[Target][startTargeting]   resolveTargetTab → tabId=${tab?.id ?? "none"} platform="${platform}" url="${tab?.url || "n/a"}" urlHidden=${!!urlHidden}`);

    // ── Permission catch-22 ──────────────────────────────────
    // The active tab exists but chrome.tabs.query hid its url (no host
    // permission covers it yet). We can't request a permission scoped to an
    // origin we can't read, so ask for the broad <all_urls> optional
    // permission instead — a one-time prompt that, once granted, makes every
    // future query reveal real URLs everywhere. Then re-query and re-resolve
    // so the rest of this function proceeds exactly as if the URL had been
    // visible from the start.
    if (urlHidden && hiddenTabId != null) {
      sendTargetStatus("arming", { platform: "Unknown", targetKind: kind, requestingPermission: true, reason: "url_hidden" });
      dlog(`[Target][startTargeting]   tab id=${hiddenTabId} url is hidden — requesting <all_urls> before we can even see it...`);
      const gotAllUrls = await ensureAllUrlsPermission();
      dlog(`[Target][startTargeting]   <all_urls> result: ${gotAllUrls}`);
      if (!gotAllUrls) {
        console.warn(`[Target] ✗ <all_urls> permission denied — cannot configure this site.`);
        sendTargetStatus("error", {
          reason: "permission_denied",
          message: "This site needs broader page access before it can be configured. Click Target again and allow access when prompted.",
        });
        return;
      }
      // Re-query: with <all_urls> granted, the previously-hidden tab's real
      // url is now visible, so resolveTargetTab will resolve it normally.
      const refreshedTabs = await new Promise((resolve) => chrome.tabs.query({ currentWindow: true }, resolve));
      const reResolved = resolveTargetTab(refreshedTabs);
      tab = reResolved.tab;
      platform = reResolved.platform;
      dlog(`[Target][startTargeting]   re-resolved after <all_urls> grant → tabId=${tab?.id ?? "none"} platform="${platform}" url="${tab?.url || "n/a"}"`);
    }

    if (!tab || !tab.id || !isInjectableTabUrl(tab.url)) {
      console.warn("[Target] ✗ No valid generation tab found", allTabs.map(t => t.url));
      sendTargetStatus("error", { reason: "no_tab", message: "No generation tab found. Open SeaArt/TensorArt and try again." });
      return;
    }

    // ── On-demand host permission ────────────────────────────────────
    // Sites outside the manifest's fixed host_permissions need an explicit,
    // user-consented grant before chrome.scripting can touch them. Ask now,
    // while we still have the user gesture from the Target button click.
    sendTargetStatus("arming", { platform, targetKind: kind, requestingPermission: true });
    dlog(`[Target][startTargeting]   requesting host permission for ${tab.url}...`);
    const hasPermission = await ensureHostPermission(tab.url);
    dlog(`[Target][startTargeting]   host permission result: ${hasPermission}`);
    if (!hasPermission) {
      console.warn(`[Target] ✗ Host permission denied/unavailable for ${tab.url}`);
      sendTargetStatus("error", {
        reason: "permission_denied",
        message: "This page needs permission before it can be configured. Click Target again and allow access when prompted.",
      });
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

    dlog(`[Target] ◆ arming on tab ${tab.id} (${platform}, kind="${kind}") — ${tab.url}`);
    sendTargetStatus("arming", { platform, targetKind: kind });

    chrome.scripting.executeScript(
      { target: { tabId: tab.id, allFrames: true }, func: armTargetingInPage, args: [kind, DEV_MODE] },
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
        sendTargetStatus("waiting", { candidates: totalCandidates, platform, targetKind: kind });

        // ── Selection detection: SOLELY via chrome.runtime.sendMessage from
        // the injected page script (see onClickCapture -> safeSend). A prior
        // version also polled the page every 700ms for a `.booru-target-textarea`
        // marker as a "redundant detection" fallback. That polling path is what
        // caused selections to resolve with no visible user interaction: it
        // could observe a marker left over from a different wizard step (or a
        // timing artifact) and report "selected" before the user ever clicked
        // on the actual target page. Removed entirely — a single, direct path
        // means every "selected" state genuinely corresponds to a real click
        // captured by onClickCapture in the target page.
        if (targetingTimeoutId) clearTimeout(targetingTimeoutId);
        targetingTimeoutId = setTimeout(() => {
          if (targetingActive) {
            dlog("[Target] ⏱ No click received within timeout — cancelling.");
            stopTargeting("timeout");
            sendTargetStatus("cancelled", { reason: "timeout", targetKind: kind });
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
    dlog(`[Target][TARGET_RESULT] ▶ phase="selected" targetKind="${msg.info?.targetKind || "prompt"}" tag="${msg.info?.tag}" fromTabUrl="${sender?.tab?.url || "n/a"}"`);
    stopTargeting("selected");
    sendTargetStatus("selected", msg.info || null);

    // ── Persist the locator ──────────────────────────────
    // Save the resolved locator into this origin's SiteProfile so it survives
    // reloads/navigation, instead of relying solely on the in-page
    // `.booru-target-textarea` class (which is lost on reload). Which field of
    // the profile it lands in depends on targetKind: "prompt" (default, back-
    // compat) → promptField, "generate" → generateButton, "queue" → queue.container,
    // "width"/"height" (Match image resolution) → widthField/heightField.
    const locator = msg.info && msg.info.locator;
    const targetKind = (msg.info && msg.info.targetKind) || "prompt";
    if (locator) {
      const senderUrl = (sender && sender.tab && sender.tab.url) || (msg.info && msg.info.frameUrl);
      const origin = originFromUrl(senderUrl);
      dlog(`[Target][TARGET_RESULT]   locator has ${locator.candidates?.length || 0} candidate(s), kind="${locator.meta?.kind}", origin="${origin}"`);
      if (origin) {
        const fieldDescriptor = {
          locator,
          frameUrl: msg.info.frameUrl || "",
          kind: (locator.meta && locator.meta.kind) || "textarea",
        };
        if (targetKind === "generate") {
          updateSiteProfile(origin, { generateButton: fieldDescriptor });
          dlog(`[SiteProfiles] ◀ Persisted generateButton locator for origin "${origin}".`);
        } else if (targetKind === "queue") {
          const profile = getSiteProfile(origin);
          updateSiteProfile(origin, { queue: { ...(profile.queue || {}), mode: "container", container: fieldDescriptor } });
          dlog(`[SiteProfiles] ◀ Persisted queue container locator for origin "${origin}" (queue.mode → "container").`);
        } else if (targetKind === "width") {
          updateSiteProfile(origin, { widthField: fieldDescriptor });
          dlog(`[SiteProfiles] ◀ Persisted widthField locator for origin "${origin}".`);
        } else if (targetKind === "height") {
          updateSiteProfile(origin, { heightField: fieldDescriptor });
          dlog(`[SiteProfiles] ◀ Persisted heightField locator for origin "${origin}".`);
        } else {
          updateSiteProfile(origin, { promptField: fieldDescriptor });
          dlog(`[SiteProfiles] ◀ Persisted promptField locator for origin "${origin}".`);
        }
        sendSiteProfileStatus(); // keep the React status panel/wizard live
      } else {
        console.warn("[SiteProfiles] Could not resolve origin for the selected target; locator not persisted.");
      }
    } else {
      dlog(`[Target][TARGET_RESULT]   ⚠ no locator in msg.info — nothing will be persisted for this selection.`);
    }
  }
  // phase:"armed" is per-frame diagnostics; aggregation happens in the
  // executeScript callback, so we just log here for debugging.
  else if (msg.phase === "armed") {
    dlog("[Target][TARGET_RESULT]   ↳ frame armed:", msg.diag);
  } else if (msg.phase === "cancelled") {
    dlog(`[Target][TARGET_RESULT] ▶ phase="cancelled" (user pressed Escape in-page)`);
  }
});
