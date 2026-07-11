// ─────────────────────────────────────────────────────────────────────────────
// Environment switching logic
// ─────────────────────────────────────────────────────────────────────────────
const PROD_URL = "https://booru-prompt-gallery.vercel.app/extension";
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
const AUTODL_STORAGE_KEY = "booru_auto_download_enabled";

/** Save the current promptQueue and autoDownload settings to chrome.storage.local */
function persistQueue() {
  try {
    chrome.storage.local.set({ 
      [QUEUE_STORAGE_KEY]: [...promptQueue],
      [AUTODL_STORAGE_KEY]: autoDownloadEnabled
    });
  } catch (e) {
    console.warn("[Queue] Failed to persist queue:", e);
  }
}

/** Restore promptQueue and autoDownload settings from chrome.storage.local on startup */
function restoreQueue() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([QUEUE_STORAGE_KEY, AUTODL_STORAGE_KEY], (result) => {
        const saved = result[QUEUE_STORAGE_KEY];
        if (Array.isArray(saved) && saved.length > 0) {
          promptQueue.push(...saved);
          dlog(`[Queue] Restored ${saved.length} prompts from storage.`);
        }
        
        const savedAutoDL = result[AUTODL_STORAGE_KEY];
        if (typeof savedAutoDL === "boolean") {
          autoDownloadEnabled = savedAutoDL;
          dlog(`[Queue] Restored autoDownloadEnabled: ${autoDownloadEnabled}`);
          if (autoDownloadEnabled) {
            startAutoDownloadObserver();
          }
        }

        updateQueueUI();
        resolve();
      });
    } catch (e) {
      console.warn("[Queue] Failed to restore queue:", e);
      resolve();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SITE PROFILES STORE (Fase 1c) — persistent per-site target configuration
// ─────────────────────────────────────────────────────────────────────────────
// A "site profile" holds everything the generic engine needs to operate on one
// origin: where the prompt goes, which button generates, and how to read the
// queue. Keyed by URL origin (e.g. "https://seaart.ai") in chrome.storage.local
// under SITE_PROFILES_STORAGE_KEY. Two built-in profiles (SeaArt, TensorArt) are
// seeded on first run so existing behavior keeps working with zero config.
//
// Shape (see docs/extension-configurable-targets-plan.md §3):
//   siteProfiles: {
//     "<origin>": {
//       version: 1,
//       promptField:    { locators, frameUrl, kind } | null,
//       generateButton: { locators, frameUrl } | null,
//       queue: { mode: "none"|"button"|"container", container?, busySignal?,
//                concurrencyLimit?, pacingMs? },
//       updatedAt: <epoch ms>
//     }
//   }
// ─────────────────────────────────────────────────────────────────────────────
const SITE_PROFILES_STORAGE_KEY = "booru_site_profiles";
const SITE_PROFILES_SCHEMA_VERSION = 1;

/** In-memory cache of the store, kept in sync with chrome.storage.local. */
let siteProfiles = {};

/** Built-in defaults for the platforms the extension shipped with historically.
 *  These have no persisted locators — the legacy hardcoded selector cascades in
 *  injectPromptToTab / countActiveTasks / waitForGenerateButtonFree remain the
 *  fallback for these origins, preserving current behavior. queue.mode reflects
 *  what the existing SeaArt/TensorArt logic already does (button-state polling
 *  plus the platform-specific modal/task detection). */
const BUILTIN_SITE_PROFILES = {
  "https://www.seaart.ai": { version: 1, promptField: null, generateButton: null, queue: { mode: "button" }, builtin: true },
  "https://seaart.ai": { version: 1, promptField: null, generateButton: null, queue: { mode: "button" }, builtin: true },
  "https://www.tensor.art": { version: 1, promptField: null, generateButton: null, queue: { mode: "button" }, builtin: true },
  "https://tensor.art": { version: 1, promptField: null, generateButton: null, queue: { mode: "button" }, builtin: true },
};

/** Normalize any URL/tab URL down to its origin string, used as the profile key. */
function originFromUrl(url) {
  try { return new URL(url).origin; } catch (_) { return null; }
}

/** Load siteProfiles from chrome.storage.local into the in-memory cache. */
function loadSiteProfiles() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([SITE_PROFILES_STORAGE_KEY], (result) => {
        const saved = result[SITE_PROFILES_STORAGE_KEY];
        siteProfiles = (saved && typeof saved === "object") ? saved : {};
        // Seed built-ins for any origin not already present (never overwrite a
        // user-customized profile with the built-in default).
        let changed = false;
        for (const [origin, profile] of Object.entries(BUILTIN_SITE_PROFILES)) {
          if (!siteProfiles[origin]) { siteProfiles[origin] = { ...profile, updatedAt: Date.now() }; changed = true; }
        }
        if (changed) persistSiteProfiles();
        dlog(`[SiteProfiles] Loaded ${Object.keys(siteProfiles).length} profile(s).`);
        resolve(siteProfiles);
      });
    } catch (e) {
      console.warn("[SiteProfiles] Failed to load:", e);
      resolve(siteProfiles);
    }
  });
}

/** Persist the in-memory siteProfiles cache to chrome.storage.local. */
function persistSiteProfiles() {
  try {
    chrome.storage.local.set({ [SITE_PROFILES_STORAGE_KEY]: siteProfiles });
  } catch (e) {
    console.warn("[SiteProfiles] Failed to persist:", e);
  }
}

/** Get the profile for an origin, or a fresh empty skeleton if none exists yet. */
function getSiteProfile(origin) {
  if (!origin) return null;
  return siteProfiles[origin] || {
    version: SITE_PROFILES_SCHEMA_VERSION,
    promptField: null,
    generateButton: null,
    queue: { mode: "none", pacingMs: 6000 },
    updatedAt: 0,
  };
}

/** Merge `patch` into the stored profile for `origin` and persist. Creates the
 *  profile if it doesn't exist yet. Returns the resulting profile. */
function updateSiteProfile(origin, patch) {
  if (!origin) return null;
  const current = siteProfiles[origin] || {
    version: SITE_PROFILES_SCHEMA_VERSION,
    promptField: null,
    generateButton: null,
    queue: { mode: "none", pacingMs: 6000 },
  };
  const next = {
    ...current,
    ...patch,
    queue: { ...(current.queue || {}), ...(patch.queue || {}) },
    updatedAt: Date.now(),
  };
  siteProfiles[origin] = next;
  persistSiteProfiles();
  return next;
}

/**
 * (Fase 5b) Resolve the active tab's origin + SiteProfile and post a compact
 * status summary to the React iframe as SITE_PROFILE_STATUS. Drives the
 * per-site status panel and the setup wizard's step indicators.
 *
 * `queueLevel` mirrors the plan's 3-level model: 0 = pacing (no config), 1 =
 * generate-button watched, 2 = queue container configured. `builtin` flags
 * origins with a shipped default profile (SeaArt/TensorArt) so the panel can
 * show "Using built-in defaults" instead of "Not configured".
 */
function sendSiteProfileStatus() {
  chrome.tabs.query({ currentWindow: true, active: true }, (tabs) => {
    const tab = tabs && tabs[0];
    const origin = tab && tab.url ? originFromUrl(tab.url) : null;
    if (!origin) {
      sendTargetStatus("site_profile", { origin: null, configured: false });
      return;
    }
    const profile = siteProfiles[origin] || null;
    const hasPrompt = !!(profile && profile.promptField && profile.promptField.locator);
    const hasGenerate = !!(profile && profile.generateButton && profile.generateButton.locator);
    const queueMode = (profile && profile.queue && profile.queue.mode) || "none";
    const hasQueueContainer = !!(profile && profile.queue && profile.queue.container && profile.queue.container.locator);
    const hasBusySignal = !!(profile && profile.queue && profile.queue.busySignal);
    const concurrencyLimit = (profile && profile.queue && typeof profile.queue.concurrencyLimit === "number") ? profile.queue.concurrencyLimit : 1;
    const unlimited = !!(profile && profile.queue && profile.queue.unlimited);

    let queueLevel = 0;
    if (queueMode === "container" && hasQueueContainer) queueLevel = 2;
    else if (queueMode === "button" || hasGenerate) queueLevel = 1;

    try {
      appFrame.contentWindow.postMessage({
        type: "SITE_PROFILE_STATUS",
        origin,
        builtin: !!(profile && profile.builtin),
        promptConfigured: hasPrompt,
        generateConfigured: hasGenerate,
        queueLevel,
        queueMode,
        hasBusySignal,
        concurrencyLimit,
        unlimited,
      }, "*");
    } catch (_) { /* iframe not ready */ }
  });
}

/**
 * Look up the tab's origin and return its persisted promptField.locator, or
 * null when the tab has no profile / no prompt target configured yet (the
 * caller falls back to the legacy heuristic cascade in that case).
 */
function resolvePromptLocatorForTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.url) { resolve(null); return; }
      const origin = originFromUrl(tab.url);
      const profile = origin ? siteProfiles[origin] : null;
      resolve((profile && profile.promptField && profile.promptField.locator) || null);
    });
  });
}

/**
 * Same as resolvePromptLocatorForTab, but for the persisted generateButton
 * locator (Fase 2d). Returns null when unconfigured — the caller falls back
 * to the legacy hardcoded Generate-button selector cascade in that case.
 */
function resolveGenerateLocatorForTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.url) { resolve(null); return; }
      const origin = originFromUrl(tab.url);
      const profile = origin ? siteProfiles[origin] : null;
      resolve((profile && profile.generateButton && profile.generateButton.locator) || null);
    });
  });
}

/**
 * (Fase 4a/4b) Resolve the queue strategy configured for this tab's origin.
 * Returns the origin's `queue` sub-object (mode + pacingMs/etc), or the
 * Level-0 default `{ mode: "none", pacingMs: 6000 }` when the origin has no
 * profile yet. This is what lets an unconfigured site work out of the box
 * (Level 0 fixed pacing) while configured/built-in origins keep their richer
 * behavior (Level 1 button-watching, or Level 2 container once Fase 5a lands).
 */
function resolveQueueConfigForTab(tabId) {
  return new Promise((resolve) => {
    const fallback = { mode: "none", pacingMs: 6000 };
    dlog(`[Queue][resolveQueueConfigForTab] ▶ tabId=${tabId}`);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.url) {
        dlog(`[Queue][resolveQueueConfigForTab] ◀ no tab/url (lastError=${chrome.runtime.lastError?.message || "none"}) → fallback`, fallback);
        resolve(fallback);
        return;
      }
      const origin = originFromUrl(tab.url);
      const profile = origin ? siteProfiles[origin] : null;
      const result = (profile && profile.queue) || fallback;
      dlog(`[Queue][resolveQueueConfigForTab] ◀ origin="${origin}" hasProfile=${!!profile} builtin=${!!profile?.builtin} →`, result);
      resolve(result);
    });
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
    // Using a pinned origin fails because the iframe (localhost / vercel) and
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
    // e.data.targetKind: "prompt" (default) | "generate" | "queue" — Fase 2a.
    // Lets the React wizard drive which element kind Target selects next.
    if (e.data.action === "target") startTargeting(e.data.targetKind);
    if (e.data.action === "clear") clearQueue();
    if (e.data.action === "set_auto_download") {
      autoDownloadEnabled = !!e.data.value;
      persistQueue();
      if (autoDownloadEnabled) startAutoDownloadObserver();
      else stopAutoDownloadObserver();
    }
    // (Fase 5a) "Learn the busy signal live": snapshot the configured queue
    // container's descendant class list twice — once while idle, once while
    // a generation the user manually triggered is running — and diff them to
    // find the class that only appears while busy (e.g. a spinner/progress
    // element). e.data.step: "idle" | "busy". See captureBusySignalStep below.
    if (e.data.action === "capture_busy_signal") captureBusySignalStep(e.data.step);
    // Persist how many simultaneous generations this site's queue tolerates
    // before it's considered "busy" (used by waitForContainerQueueFree's
    // count-vs-limit comparisons, and as a general per-site override for
    // permissive/parallel queues like TensorArt). e.data.value: positive int.
    // e.data.unlimited (Fase 6): true short-circuits ALL queue waiting for
    // this origin (Level 0/1/2 and even the platform-specific SeaArt/TensorArt
    // path) — for sites the user knows are effectively never full.
    if (e.data.action === "set_concurrency_limit") setConcurrencyLimitForActiveTab(e.data.value, e.data.unlimited);
  }
  // React app asking for initial state on mount
  if (e.data && e.data.type === "REQUEST_QUEUE_STATUS") {
    updateQueueUI();
  }
  // (Fase 5b) React wizard/status panel asking for this origin's SiteProfile
  // summary — which of promptField/generateButton/queue.container are
  // configured, and the resolved queue level (0/1/2). Answered on the active
  // tab's origin so the panel reflects whatever page the user has open.
  if (e.data && e.data.type === "REQUEST_SITE_PROFILE_STATUS") {
    sendSiteProfileStatus();
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
// LOCATOR ENGINE (Fase 1a/1b) — build + resolve persistent element descriptors
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
      const find = (node) => {
        if (!node) return;
        if (node.querySelectorAll) {
          for (const m of node.querySelectorAll(selector)) if (!list.includes(m)) list.push(m);
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

  // ── Fase 6 bugfix ────────────────────────────────────────────────────────
  // Previously this walked the allowlist FIRST, even across background tabs:
  // "any tab on a known platform" ranked above "the tab the user is actually
  // looking at right now". That meant a SeaArt/TensorArt tab left open in the
  // background would win over the site the user just clicked Target on (e.g.
  // a ComfyUI instance on comfy.civitai.com) — Target would silently arm on
  // the WRONG tab, and the user's click on the real page's textarea would
  // never be seen (it's listening in a different tab entirely). The user's
  // active tab — where the Target button click just happened — must always
  // be tried first, regardless of whether its domain is on the allowlist.
  // The allowlist fallbacks below only matter when the active tab itself
  // isn't a valid target (chrome://, devtools://, extension pages, etc).
  const activeTab = allTabs.find(t => t.active);
  // (Fase 6 bugfix — permission catch-22) chrome.tabs.query reports url:"" for
  // ANY tab the extension doesn't yet have host permission for — it does NOT
  // distinguish "no tab" from "a real tab we just can't see the URL of yet".
  // Without this, an active tab on an unconfigured site (no host_permission
  // and activeTab doesn't apply — it only auto-grants via chrome.action
  // clicks, not side-panel button clicks) always looked identical to "no
  // active tab at all" and silently fell through to the background-tab
  // allowlist fallback below, arming Target on the WRONG page. We now treat
  // "active tab exists but its url is hidden" as its own case: startTargeting
  // detects this and requests <all_urls> BEFORE calling resolveTargetTab
  // again, breaking the catch-22 (can't request a specific origin without
  // knowing the URL; can't see the URL without a permission covering it).
  const activeTabUrlHidden = !!(activeTab && !activeTab.url && typeof activeTab.id === "number");
  const isValidActiveTab = activeTab && activeTab.url && !activeTab.url.startsWith("chrome") && !activeTab.url.startsWith("devtools") && !activeTab.url.startsWith("chrome-extension://");
  dlog(`[Target][resolveTargetTab] all tabs in currentWindow:`, allTabs.map(t => ({ id: t.id, active: t.active, url: (t.url || "").slice(0, 80) })));

  let tab =
    (isValidActiveTab ? activeTab : null) ||
    (activeTabUrlHidden ? null : allTabs.find(t => t.active && t.url && (PLATFORM_DOMAINS.some(d => t.url.includes(d)) || isLocalUi(t.url)))) ||
    (activeTabUrlHidden ? null : allTabs.find(t => t.url && PLATFORM_DOMAINS.some(d => t.url.includes(d)))) ||
    (activeTabUrlHidden ? null : allTabs.find(t => t.active && t.url && !t.url.startsWith("chrome") && !t.url.startsWith("devtools")));

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

/**
 * The function injected into every frame to arm selection mode.
 *
 * @param {"prompt"|"generate"|"queue"} targetKind (Fase 2a) Which kind of
 *   element the user is selecting. Changes what's selectable/highlighted:
 *     - "prompt"   → textarea / input / contenteditable (unchanged legacy behavior)
 *     - "generate" → clickables: button, [role=button], a, input[type=submit|button]
 *     - "queue"    → any element (the user is pointing at a queue/status container)
 *
 * Fase 2b: while armed, ArrowUp/ArrowDown adjust the highlighted candidate to
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
  // Fase 2b: the currently "armed" candidate before the user commits with a
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

  /** Fase 2b: move the adjustable candidate to its parent element. */
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

  /** Fase 2b: move the adjustable candidate back down to the last child visited. */
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

    // ── Build a persistent locator (Fase 1a) ─────────────────────────────────
    // Self-contained copy of the locator-builder logic: chrome.scripting's
    // func-injection only serializes THIS function's source, so it cannot
    // close over buildElementLocator() defined elsewhere in sidepanel.js.
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

      // ── Coordinates candidate (Fase SeaArt fix) ───────────────────────────
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
 * (Fase 3) Ensure we hold host permission for `url`'s origin, requesting it
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
 * (Fase 6 bugfix) Breaks the permission catch-22 for sites Chrome hides the
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
 *  @param {"prompt"|"generate"|"queue"} targetKind (Fase 2a) defaults to "prompt"
 *   for backwards compatibility with existing callers (e.g. the legacy
 *   QUEUE_ACTION "target" from the React iframe, which only ever targets prompts). */
function startTargeting(targetKind) {
  const kind = targetKind || "prompt";
  dlog(`[Target][startTargeting] ▶ targetKind="${kind}"`);
  chrome.tabs.query({ currentWindow: true }, async (allTabs) => {
    let { tab, platform, urlHidden, hiddenTabId } = resolveTargetTab(allTabs);
    dlog(`[Target][startTargeting]   resolveTargetTab → tabId=${tab?.id ?? "none"} platform="${platform}" url="${tab?.url || "n/a"}" urlHidden=${!!urlHidden}`);

    // ── Fase 6 bugfix: permission catch-22 ──────────────────────────────────
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

    if (!tab || !tab.id || (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("devtools://")))) {
      console.warn("[Target] ✗ No valid generation tab found", allTabs.map(t => t.url));
      sendTargetStatus("error", { reason: "no_tab", message: "No generation tab found. Open SeaArt/TensorArt and try again." });
      return;
    }

    // ── Fase 3: on-demand host permission ────────────────────────────────────
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

    // ── Persist the locator (Fase 1d / 2a / 2d) ──────────────────────────────
    // Save the resolved locator into this origin's SiteProfile so it survives
    // reloads/navigation, instead of relying solely on the in-page
    // `.booru-target-textarea` class (which is lost on reload). Which field of
    // the profile it lands in depends on targetKind: "prompt" (default, back-
    // compat) → promptField, "generate" → generateButton, "queue" → queue.container.
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
        } else {
          updateSiteProfile(origin, { promptField: fieldDescriptor });
          dlog(`[SiteProfiles] ◀ Persisted promptField locator for origin "${origin}".`);
        }
        sendSiteProfileStatus(); // (Fase 5b) keep the React status panel/wizard live
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
// GENERIC QUEUE STRATEGIES (Fase 4a/4b) — work on ANY site, zero config
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
// (Fase 6) Minimal pacing used for sites explicitly marked "unlimited" (queue.
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

            const isDisabled = btn.disabled || btn.getAttribute("aria-disabled") === "true";
            const hasSpinner = !!btn.querySelector(".animate-spin, .loading, [class*='spinner'], [class*='loading']");
            const computedStyle = window.getComputedStyle(btn);
            const hasLowOpacity = parseFloat(computedStyle.opacity) < 0.6;
            const text = btn.textContent?.trim().toLowerCase() || "";
            const isGeneratingText = text.includes("generating") || text.includes("generando") || text.includes("processing") || text.includes("procesando");
            return { found: true, busy: isDisabled || hasSpinner || hasLowOpacity || isGeneratingText };
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
// Level 2 (Fase 5a) — queue container + configurable busy signal
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

    function poll() {
      if (Date.now() > deadline) {
        dlog(`[Queue][L2] ◀ TIMEOUT after ${pollCount} poll(s) / ${Date.now() - startedAt}ms`);
        resolve({ status: "timeout" });
        return;
      }
      pollCount++;
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
          args: [containerLocator || null, busySignal || null, concurrencyLimit || null],
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
 * (Fase 5a) Look up the tab's origin and return its persisted queue.container
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

/** Snapshot state kept between the "idle" and "busy" capture steps (Fase 5a). */
let busySignalIdleSnapshot = null;

/**
 * (Fase 5a) One step of the "learn the busy signal live" flow. Resolves the
 * active tab's queue container and snapshots the set of CSS classes present
 * on its descendants.
 *   step === "idle": just stores the snapshot for later comparison.
 *   step === "busy": diffs against the stored idle snapshot; any class that
 *     appears now but didn't before is a candidate "busy" indicator (e.g. a
 *     spinner/progress class). The most specific new class (fewest matches in
 *     the busy snapshot — likely the spinner itself, not a generic wrapper)
 *     is persisted as `queue.busySignal = { type: "class", value: selector }`.
 * Reports progress/result back to the React iframe via TARGET_STATUS so the
 * wizard (Fase 5b) can show live feedback, reusing the same channel Target uses.
 */
function captureBusySignalStep(step) {
  dlog(`[BusySignal] ▶ captureBusySignalStep step="${step}"`);
  chrome.tabs.query({ currentWindow: true }, (allTabs) => {
    const { tab, urlHidden } = resolveTargetTab(allTabs);
    if (!tab || !tab.id) {
      // (Fase 6) If the reason is a hidden url (missing <all_urls> — should
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
            sendSiteProfileStatus(); // (Fase 5b) keep the React status panel/wizard live
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
 * (Fase 5b+) so users can raise it for permissive/parallel queues (e.g.
 * TensorArt, which rarely if ever queues) instead of being stuck with the
 * single-slot default. Used by waitForContainerQueueFree's busySignal count
 * comparisons; harmless (simply unused) for origins on Level 0/1 with no
 * queue container configured yet. `value` is coerced to a positive integer,
 * defaulting to 1 if invalid.
 *
 * `unlimited` (Fase 6) is a separate boolean override: when true, ALL queue
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
 * (Fase 1d) use their persisted locator across reloads.
 *
 * `generateLocator` (Fase 2d) does the same for the Generate button: tried
 * first, falling back to the legacy hardcoded button cascade when absent/stale.
 */
function injectPromptToTab(tabId, promptText, promptLocator, generateLocator) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId, allFrames: true },
        func: async (text, promptLocator, generateLocator) => {
          // ── 1. Find the prompt field ───────────────────────────────────────
          // Priority order: persisted locator (Fase 1d) > user-targeted legacy
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
                const find = (node) => {
                  if (!node) return;
                  if (node.querySelectorAll) for (const m of node.querySelectorAll(selector)) if (!list.includes(m)) list.push(m);
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

          // ── 1b. Generalized field-kind injection helpers (Fase 2c) ─────────
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
           * (Fase 6) Real-typing fallback for textarea/input fields whose
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
            // (Fase 6 debugging) Some frameworks — notably Vue 3 widgets used
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

          // (Fase 6 debugging) Detect whether this element (or a close
          // ancestor) is Vue-managed — Vue 3 stamps internal instance refs on
          // the DOM node (__vueParentComponent / __vnode), and scoped styles
          // via data-v-* attributes are a reliable tell even when those
          // internal refs are minified/renamed. Returned in the diagnostics
          // so we can confirm/rule out "this is a Vue-controlled widget whose
          // real state lives outside the DOM value we just wrote" without
          // guessing from outside the page.
          const detectFramework = () => {
            let el = promptTextarea;
            let hasVueMarker = false;
            let hasDataV = false;
            let depth = 0;
            while (el && depth < 6) {
              if (el.__vueParentComponent || el.__vnode || el._vnode) hasVueMarker = true;
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

          // (Fase 6 debugging) ComfyUI's stock UI exposes `window.app`/
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
          // (Fase 6) Try real-typing (execCommand insertText through the
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

          // (Fase 6) LiteGraph-style DOM-widget overlays (confirmed on
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

          // ── 5. Find the Generate button (Fase 2d) ──────────────────────────
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
                const find = (node) => {
                  if (!node) return;
                  if (node.querySelectorAll) for (const m of node.querySelectorAll(selector)) if (!list.includes(m)) list.push(m);
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
          // field between our injection and the Generate click. NOTE (Fase 6):
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
          if (genBtn) {
            // Clean up old TensorArt toast messages so they don't falsely trigger the fast-track resolve
            document.querySelectorAll(".n-message").forEach(el => el.remove());

            // Standard click. NOTE: genBtn.click() ALREADY dispatches a real
            // "click" event — the synthetic event list below must NOT include
            // "click" again, or frameworks that listen on both native clicks
            // and bubbled MouseEvents (Vue/React) see TWO distinct click
            // events and fire the generate handler twice per prompt. This was
            // a confirmed bug: every queued prompt sent 2 requests instead of 1.
            genBtn.click();

            // Dispatch pointer/mouse-down/up events for frameworks that rely
            // on them for hover/press visual state — deliberately excludes
            // "click" itself, which genBtn.click() above already covers.
            const events = ["pointerdown", "mousedown", "pointerup", "mouseup"];
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
            usedPersistedLocator,
            usedPersistedGenerateLocator,
            previousValue: previousValue.substring(0, 100),
            injectedValue: text.substring(0, 100),
            // (Fase 6 debugging) actualValueAfterClick is read AFTER genBtn.click()
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
          };
        },
        args: [promptText, promptLocator || null, generateLocator || null],
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
          const r = successfulFrame.result;
          dlog(`[Queue] ✓ Prompt injected (field: ${r.usedPersistedLocator ? "persisted locator" : "legacy heuristic"}[${r.fieldKind}], button: ${r.usedPersistedGenerateLocator ? "persisted locator" : "legacy heuristic"}). usedRealTyping=${r.usedRealTyping} firstAttemptMatched=${r.firstAttemptMatched} usedAggressiveRetry=${r.usedAggressiveRetry} frameworkInfo=${JSON.stringify(r.frameworkInfo)} comfyGlobals=${JSON.stringify(r.comfyGlobals)}. Previous: "${r.previousValue}..." → Injected: "${r.injectedValue}..." → ActualAfterClick: "${r.actualValueAfterClick}..."`);
          if (r.actualValueAfterClick && r.injectedValue && !r.actualValueAfterClick.startsWith(r.injectedValue.slice(0, 40))) {
            console.warn(`[Queue] ⚠ Field value AFTER clicking Generate does not match what we injected — the page's own framework likely reset/overwrote it on click. This means Generate may have fired with the WRONG (old/empty) prompt.`, { injected: r.injectedValue, actualAfterClick: r.actualValueAfterClick });
          }
          resolve({ 
            success: true, 
            hasButton: r.hasButton,
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
  // Disconnect any existing observer/interval to refresh the extension context
  if (window.__booruAutoDLObserver) { try { window.__booruAutoDLObserver.disconnect(); } catch (e) {} }
  if (window.__booruAutoDLInterval) { try { clearInterval(window.__booruAutoDLInterval); } catch (e) {} }
  window.__booruAutoDLObserver = null;
  window.__booruAutoDLInterval = null;

  window.__booruAutoDLActive = true;
  window.__booruAutoDLSeen = window.__booruAutoDLSeen || new Set();

  const LOG = (...a) => console.log("%c[AutoDL]", "color:#a855f7;font-weight:bold", ...a);

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

  const getPrompt = (img) => {
    let node = img;
    while (node) {
      if (node.matches && node.matches(".c-workflow-history-item")) {
        const el = querySelectorAllDeep(".c-text-content", node)[0];
        return el ? el.textContent.trim() : "";
      }
      node = node.parentNode || node.host;
    }
    return "";
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
  const seedSelector = ".c-history-img .media-attachments-img, .media-attachments-img, .c-workflow-history-item img";
  querySelectorAllDeep(seedSelector).forEach(img => {
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
        if (node.querySelectorAll) {
          node.querySelectorAll(".c-history-img .media-attachments-img").forEach(handleImg);
        }
      }
    }
  });
  observer.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["src"]
  });
  window.__booruAutoDLObserver = observer;

  // Primary Shadow DOM polling scanner (run every 1.5s to cover web component history elements)
  const scan = () => {
    const images = querySelectorAllDeep(".media-attachments-img, .c-history-img img, .c-workflow-history-item img");
    images.forEach(handleImg);
  };
  
  scan();
  const intervalId = setInterval(scan, 1500);
  window.__booruAutoDLInterval = intervalId;

  LOG(`observer installed (seeded ${window.__booruAutoDLSeen.size} existing image(s) + Shadow DOM polling)`);
  return { status: "installed", seen: window.__booruAutoDLSeen.size };
}

/** Removes the observer from the SeaArt page. */
function uninstallAutoDownloadObserverInPage() {
  if (window.__booruAutoDLObserver) { try { window.__booruAutoDLObserver.disconnect(); } catch (e) {} }
  if (window.__booruAutoDLInterval) { try { clearInterval(window.__booruAutoDLInterval); } catch (e) {} }
  window.__booruAutoDLObserver = null;
  window.__booruAutoDLInterval = null;
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
  }).catch((e) => {
    console.error("[AutoDL] Script execution inside webpage failed:", e);
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

    // 1b. (Fase 6 bugfix) If the active tab has a persisted SiteProfile (the
    // user explicitly configured it via the Target wizard — Fase 1c/2a/2d),
    // trust that intent and use it too, even though its domain isn't on the
    // hardcoded PLATFORM_DOMAINS allowlist. Without this, a site the user
    // configured (e.g. comfy.civitai.com) would lose to ANY background tab
    // on a known platform in steps 2/3 below, silently injecting prompts
    // into the wrong tab. This is the same class of bug fixed in
    // resolveTargetTab for the Target flow itself.
    if (!activeTab && currentActive && currentActive.url && !currentActive.url.startsWith("chrome") && !currentActive.url.startsWith("devtools") && !currentActive.url.startsWith("chrome-extension://")) {
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

    // ── Resolve this origin's queue strategy (Fase 4a/4b) ──────────────────
    // queue.mode: "none" (default skeleton, unconfigured site) → Level 0 fixed
    // pacing; "button" (built-in SeaArt/TensorArt profiles, or any site where
    // the user pointed Target at the Generate button) → the richer platform-
    // aware pre-flight/limit logic below stays reserved for KNOWN platforms
    // (currentPlatform is one we have hardcoded modal/task-counter support
    // for); everything else with mode:"button" uses the generic Level 1
    // button-watcher instead. "container" (Fase 5a) is not implemented yet and
    // currently falls back to Level 1/0 like "button"/"none" respectively.
    const queueConfig = await resolveQueueConfigForTab(tabId);
    const KNOWN_PLATFORMS = ["SeaArt", "TensorArt", "TensorHub", "Yodayo"];
    // "unlimited" (Fase 6) overrides ANY richer strategy — including the
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
    const promptText = promptQueue.shift();
    persistQueue(); // ← Save queue state after removing item

    if (!promptText || typeof promptText !== "string" || promptText.trim() === "") {
      console.warn("[Queue] Invalid or empty prompt pulled from queue, skipping:", promptText);
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

    // Resolve this tab's persisted prompt-field + generate-button locators
    // (Fase 1d / 2d), if any were configured via Target for this origin.
    // injectPromptToTab tries them first and falls back to the legacy
    // heuristic cascades when they're absent/stale.
    const promptLocator = await resolvePromptLocatorForTab(tabId);
    const generateLocator = await resolveGenerateLocatorForTab(tabId);
    // (Fase 5a) Only needed when queue.mode === "container"; cheap enough to
    // resolve unconditionally and let the post-injection branch decide.
    const queueContainerLocator = await resolveQueueContainerLocatorForTab(tabId);

    // Inject the prompt and click Generate
    const injectResult = await injectPromptToTab(tabId, promptText, promptLocator, generateLocator);

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

    // If we found a Generate button and clicked it, wait for it to free up.
    // (Fase 4a/4b) Platform-specific origins (built-in SeaArt/TensorArt
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
        const retryResult = await injectPromptToTab(tabId, promptText, promptLocator, generateLocator);
        
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
    } else if (queueConfig.mode === "container" && queueContainerLocator) {
      // ── Level 2 (Fase 5a): configured queue container + busy signal ──────
      dlog(`[Queue][L2] Branch chosen: queueConfig.mode="container" + container locator present. busySignal: ${queueConfig.busySignal ? queueConfig.busySignal.type : "child-count"})...`);
      const waitResult = await waitForContainerQueueFree(tabId, queueContainerLocator, queueConfig.busySignal, queueConfig.concurrencyLimit, queueConfig.unlimited);
      if (waitResult.status !== "free") {
        dlog(`[Queue][L2] container watch ended with status="${waitResult.status}", proceeding anyway.`);
      }
      await new Promise((r) => setTimeout(r, GRACE_PERIOD_MS));
    } else if (injectResult.hasButton) {
      // ── Level 1 (Fase 4b): generic button-watcher, any site ──────────────
      dlog(`[Queue][L1] Branch chosen: button found post-injection, queueConfig.mode="${queueConfig.mode}" (not container, or container unconfigured)...`);
      const waitResult = await waitForGenericButtonFree(tabId, generateLocator, queueConfig.unlimited);
      if (waitResult.status !== "free") {
        dlog(`[Queue][L1] button watch ended with status="${waitResult.status}", proceeding anyway.`);
      }
      await new Promise((r) => setTimeout(r, GRACE_PERIOD_MS));
    } else {
      // ── Level 0 (Fase 4a): no button found at all — fixed pacing delay ────
      // (Fase 6) "unlimited" sites skip the conservative default pacing too —
      // only a minimal delay to let the DOM register the click, since there's
      // no queue signal at all to wait on anyway.
      const pacingMs = queueConfig.unlimited
        ? UNLIMITED_PACING_MS
        : ((queueConfig && typeof queueConfig.pacingMs === "number") ? queueConfig.pacingMs : GENERATE_PACING_DEFAULT_MS);
      dlog(`[Queue][L0] Branch chosen: no Generate button resolved (injectResult.hasButton=false). Waiting ${queueConfig.unlimited ? "minimal unlimited" : "fixed"} pacing (${pacingMs}ms).`);
      await new Promise((r) => setTimeout(r, pacingMs));
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
// Startup: Restore queue + site profiles from storage and initialize UI
// ─────────────────────────────────────────────────────────────────────────────
loadSiteProfiles();

restoreQueue().then(() => {
  updateQueueUI();
  // If there are restored prompts, kick off processing
  if (promptQueue.length > 0) {
    dlog(`[Queue] Starting processing for ${promptQueue.length} restored prompts.`);
    processNext();
  }
});
