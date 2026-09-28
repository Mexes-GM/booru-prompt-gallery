// sidepanel/06-locator.js — Locator engine: build + resolve persistent element descriptors.
// Classic script: shares the global scope with the other sidepanel/*.js
// files, loaded in numeric order by sidepanel.html. Load-time code may only
// use names declared in this file or an earlier one.

// ─────────────────────────────────────────────────────────────────────────────
// LOCATOR ENGINE — build + resolve persistent element descriptors
// ─────────────────────────────────────────────────────────────────────────────
// Problem this replaces: the old Target flow only marked the chosen element with
// a CSS class (`.booru-target-textarea`), which lives purely in the DOM and is
// lost on reload/navigation. A "locator" is a small serializable descriptor that
// can be persisted to chrome.storage.local (see the SiteProfiles store below)
// and re-resolved against a live DOM later, even across page reloads and inside
// Shadow DOM subtrees.
//
// Both functions below are designed to be passed whole to
// chrome.scripting.executeScript(...).func — they must be self-contained (no
// closures over outer scope) because they run inside the target page.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injected into the page. Given a live element, produces a serializable
 * "locator" descriptor: an ordered list of candidate selector strategies
 * (most → least robust) plus metadata used for fuzzy re-resolution and
 * self-healing diagnostics.
 *
 * Candidate strategies (in the order we prefer to try them):
 *   1. stable-attribute — #id, [data-testid], [name], [aria-label], [placeholder]
 *   2. shadow-path       — array of selectors, one per Shadow DOM boundary crossed
 *                          (only present when the element lives inside a shadow root)
 *   3. structural-path   — nth-of-type CSS path from a nearby stable ancestor
 *                          (or document.body) down to the element
 *
 * Returns null if `el` is not a valid Element.
 */
function buildElementLocator(el) {
  if (!el || el.nodeType !== 1) return null;

  const esc = (s) => {
    try { return CSS.escape(String(s)); } catch (_) { return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }
  };

  const candidates = [];

  // ── 1. Stable-attribute candidates ────────────────────────────────────────
  if (el.id) candidates.push({ type: "stable-attribute", selector: `#${esc(el.id)}` });
  for (const attr of ["data-testid", "data-test-id", "data-qa", "data-id", "name"]) {
    const v = el.getAttribute && el.getAttribute(attr);
    if (v) candidates.push({ type: "stable-attribute", selector: `${el.tagName.toLowerCase()}[${attr}="${esc(v)}"]` });
  }
  const ariaLabel = el.getAttribute && el.getAttribute("aria-label");
  if (ariaLabel) candidates.push({ type: "stable-attribute", selector: `${el.tagName.toLowerCase()}[aria-label="${esc(ariaLabel)}"]` });
  const placeholder = el.getAttribute && el.getAttribute("placeholder");
  if (placeholder) candidates.push({ type: "stable-attribute", selector: `${el.tagName.toLowerCase()}[placeholder="${esc(placeholder)}"]` });

  // ── 2. Shadow-path candidate (array of selectors, one per boundary) ────────
  // Walk up via parentNode||host so we cross shadow boundaries; record a
  // structural selector segment for each root encountered.
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
      const isShadow = rootNode instanceof ShadowRoot;
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
  if (shadowHops.length > 1) {
    candidates.push({ type: "shadow-path", selectors: shadowHops });
  }

  // ── 3. Plain structural-path fallback (nth-of-type from <body>) ───────────
  const structural = buildStructuralSelector(el, document.body);
  if (structural) candidates.push({ type: "structural-path", selector: structural });

  if (candidates.length === 0) return null;

  // ── Metadata for diagnostics + fuzzy re-resolution / self-healing ─────────
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  let kind = "other";
  if (el.tagName === "TEXTAREA") kind = "textarea";
  else if (el.tagName === "INPUT") kind = "input";
  else if (el.isContentEditable) kind = "contenteditable";
  else if (el.tagName === "BUTTON" || el.getAttribute("role") === "button" || el.tagName === "A") kind = "clickable";

  return {
    v: 1,
    candidates,
    meta: {
      tag: el.tagName,
      kind,
      className: typeof el.className === "string" ? el.className.slice(0, 160) : "",
      text: (el.textContent || "").trim().slice(0, 60),
      placeholder: placeholder || "",
      ariaLabel: ariaLabel || "",
      frameUrl: location.href.slice(0, 200),
      isTop: window === window.top,
      rectWH: [Math.round(rect.width), Math.round(rect.height)],
      visible: cs.display !== "none" && cs.visibility !== "hidden",
    },
  };
}

/**
 * Injected into the page. Given a locator descriptor (as produced by
 * buildElementLocator), attempts to re-resolve it to a live element in the
 * CURRENT frame. Tries every candidate in order, most robust first, and falls
 * back to a fuzzy heuristic match on metadata (tag + kind + placeholder/aria)
 * if every structural candidate fails (self-healing against minor DOM drift).
 *
 * Returns the resolved Element, or null if nothing matched in this frame.
 */
function resolveElementLocator(locator) {
  if (!locator || !Array.isArray(locator.candidates)) return null;

  const tryQuery = (root, selector) => {
    try { return root.querySelector(selector); } catch (_) { return null; }
  };

  for (const cand of locator.candidates) {
    try {
      if (cand.type === "stable-attribute" || cand.type === "structural-path") {
        const found = tryQuery(document, cand.selector);
        if (found) return found;
      } else if (cand.type === "shadow-path" && Array.isArray(cand.selectors)) {
        // Walk the shadow hops: each segment is resolved relative to the
        // previous root (document for the first hop, then each shadowRoot).
        let root = document;
        let el = null;
        for (let i = 0; i < cand.selectors.length; i++) {
          el = tryQuery(root, cand.selectors[i]);
          if (!el) break;
          if (i < cand.selectors.length - 1) {
            if (!el.shadowRoot) { el = null; break; }
            root = el.shadowRoot;
          }
        }
        if (el) return el;
      }
    } catch (_) { /* try next candidate */ }
  }

  // ── Fuzzy fallback (self-healing) ──────────────────────────────────────────
  // Structural paths break when the site ships a minor markup change. Retry by
  // re-scanning elements of the same kind and scoring by metadata similarity.
  if (locator.meta) {
    const { kind, placeholder, ariaLabel, text, className } = locator.meta;
    const selectorByKind = {
      textarea: "textarea",
      input: "input",
      contenteditable: "[contenteditable='true'], [contenteditable='']",
      clickable: "button, [role='button'], a, input[type='submit'], input[type='button']",
      other: "*",
    };
    const querySelectorAllDeep = (selector, root = document) => {
      const list = [];
      const seen = new Set();
      const find = (node) => {
        if (!node) return;
        if (node.querySelectorAll) {
          for (const m of node.querySelectorAll(selector)) {
            if (!seen.has(m)) {
              seen.add(m);
              list.push(m);
            }
          }
        }
        if (node.shadowRoot) find(node.shadowRoot);
        if (node.children) for (const child of node.children) find(child);
      };
      find(root);
      return list;
    };

    const pool = querySelectorAllDeep(selectorByKind[kind] || selectorByKind.other);
    let best = null;
    let bestScore = 0;
    for (const cand of pool) {
      let score = 0;
      if (placeholder && cand.getAttribute && cand.getAttribute("placeholder") === placeholder) score += 3;
      if (ariaLabel && cand.getAttribute && cand.getAttribute("aria-label") === ariaLabel) score += 3;
      if (text && (cand.textContent || "").trim().slice(0, 60) === text) score += 2;
      if (className && typeof cand.className === "string" && cand.className.slice(0, 160) === className) score += 1;
      if (score > bestScore) { bestScore = score; best = cand; }
    }
    if (best && bestScore >= 2) return best;
  }

  return null;
}
