// sidepanel/04-site-profiles.js — Per-site target configuration store + LiteGraph resolution helpers.
// Classic script: shares the global scope with the other sidepanel/*.js
// files, loaded in numeric order by sidepanel.html. Load-time code may only
// use names declared in this file or an earlier one.

// ─────────────────────────────────────────────────────────────────────────────
// SITE PROFILES STORE — persistent per-site target configuration
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

/**
 * Map a URL (or origin) to a human-readable platform label. Mirrors the
 * mapping in resolveTargetTab so the queue and the Target flow agree on what
 * "SeaArt"/"TensorArt"/… mean. Returns "Unknown" when nothing matches.
 */
function platformFromUrl(url) {
  const u = url || "";
  if (urlHasHost(u, "seaart.ai")) return "SeaArt";
  if (urlHasHost(u, "tensor.art")) return "TensorArt";
  if (urlHasHost(u, "tensorhub.net")) return "TensorHub";
  if (urlHasHost(u, "yodayo.com")) return "Yodayo";
  if (u.includes("127.0.0.1") || u.includes("localhost") || u.includes("gradio.live")) return "Local";
  try { return new URL(u).hostname.replace("www.", ""); } catch (_) { return "Unknown"; }
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
 * Resolve the active tab's origin + SiteProfile and post a compact
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
    const hasWidth = !!(profile && profile.widthField && profile.widthField.locator);
    const hasHeight = !!(profile && profile.heightField && profile.heightField.locator);
    const queueMode = (profile && profile.queue && profile.queue.mode) || "none";
    const hasQueueContainer = !!(profile && profile.queue && profile.queue.container && profile.queue.container.locator);
    const hasBusySignal = !!(profile && profile.queue && profile.queue.busySignal);
    const concurrencyLimit = (profile && profile.queue && typeof profile.queue.concurrencyLimit === "number") ? profile.queue.concurrencyLimit : 1;
    const unlimited = !!(profile && profile.queue && profile.queue.unlimited);

    let queueLevel = 0;
    if (queueMode === "container" && hasQueueContainer) queueLevel = 2;
    else if (queueMode === "button" || hasGenerate) queueLevel = 1;

    const post = (liteGraphResolutionAvailable) => {
      try {
        appFrame.contentWindow.postMessage({
          type: "SITE_PROFILE_STATUS",
          origin,
          builtin: !!(profile && profile.builtin),
          promptConfigured: hasPrompt,
          generateConfigured: hasGenerate,
          widthConfigured: hasWidth,
          heightConfigured: hasHeight,
          liteGraphResolutionAvailable,
          queueLevel,
          queueMode,
          hasBusySignal,
          concurrencyLimit,
          unlimited,
        }, "*");
      } catch (_) { /* iframe not ready */ }
    };

    // "Match image resolution" on LiteGraph/ComfyUI-based sites (SeaArt):
    // width/height needs NO Target step at all — see detectLiteGraphResolutionNode
    // below. Probe once per status request so the wizard can skip straight to
    // "detected automatically" instead of asking the user to click something
    // that doesn't exist in the DOM.
    if (!tab || !tab.id) { post(false); return; }
    chrome.scripting.executeScript(
      { target: { tabId: tab.id, allFrames: true }, world: "MAIN", func: detectLiteGraphResolutionNode },
      (results) => {
        if (chrome.runtime.lastError) {
          dlog(`[SiteProfile] LiteGraph detection error: ${chrome.runtime.lastError.message}`);
          post(false);
          return;
        }
        if (!Array.isArray(results)) {
          dlog(`[SiteProfile] LiteGraph detection returned non-array results:`, results);
          post(false);
          return;
        }
        
        const available = results.some((r) => r.result && r.result.found);
        dlog(`[SiteProfile] LiteGraph detection: checked ${results.length} frames, available=${available}`, 
          results.map(r => ({ found: r.result?.found, nodeTitle: r.result?.nodeTitle, frameId: r.frameId })));
        post(available);
      }
    );
  });
}

/**
 * Injected probe: true if this frame exposes a LiteGraph-style graph
 * (window.app.graph / window.graph) with at least one node carrying BOTH a
 * "width" and a "height" widget — the same detection trySetLiteGraphSize
 * (injectPromptToTab) uses at inject time. Used only to drive the wizard's
 * "Resolution" step UI (skip manual targeting when this is true); never
 * mutates anything.
 *
 * MUST be injected with { world: "MAIN" } — window.app/window.graph are
 * variables the PAGE's own script defines in its own JS realm. chrome.
 * scripting's default ISOLATED world shares the DOM with the page but NOT
 * its global scope, so these are invisible there even though the exact same
 * code, typed into the page's own DevTools console, sees them fine. This was
 * the root cause of the LiteGraph path silently reporting "no_graph" on
 * SeaArt despite the graph clearly existing (confirmed interactively).
 *
 * General lesson (see docs/extension-configurable-targets-plan.md §6 for the
 * full writeup): whenever a feature needs to read/write a page's own global
 * state (any framework's window.X), pass world:"MAIN" explicitly. Also watch
 * for "named access on the Window object" — window.X can silently resolve to
 * an unrelated <div id="X"> instead of a real variable; verify shape, not
 * just `typeof`.
 */
function detectLiteGraphResolutionNode() {
  try {
    // Try wrappedJSObject first for Firefox compatibility, then fall back to direct access
    const windowObj = (typeof wrappedJSObject !== 'undefined' && wrappedJSObject) ? wrappedJSObject : window;
    const g = windowObj.app && windowObj.app.graph ? windowObj.app.graph : windowObj.graph;
    if (!g) return { found: false };
    const nodes = g._nodes || Object.values(g.nodes || {});
    if (!Array.isArray(nodes)) return { found: false };
    const node = nodes.find((n) => {
      const names = (n.widgets || []).map((w) => w.name);
      return names.includes("width") && names.includes("height");
    });
    return { found: !!node, nodeTitle: node ? (node.title || node.type || null) : null };
  } catch (e) {
    console.error('[BooruTarget] detectLiteGraphResolutionNode error:', e);
    return { found: false };
  }
}

/**
 * Injected function that actually writes width/height into a LiteGraph
 * node's data model. MUST run with { world: "MAIN" } — same reasoning as
 * detectLiteGraphResolutionNode's doc comment above.
 *
 * `devMode` gates the verbose trace log (mirrors armTargetingInPage's
 * pattern) so packaged installs stay quiet; the page's own console is not
 * ours to spam by default.
 */
function trySetLiteGraphSizeInPage(width, height, devMode) {
  const LG = (...a) => { if (devMode) console.log("%c[BooruMatchRes]", "color:#8b5cf6;font-weight:bold", ...a); };
  try {
    // Try wrappedJSObject first for Firefox compatibility, then fall back to direct access
    const windowObj = (typeof wrappedJSObject !== 'undefined' && wrappedJSObject) ? wrappedJSObject : window;
    const g = windowObj.app && windowObj.app.graph ? windowObj.app.graph : windowObj.graph;
    if (!g) {
      LG('no_graph: window.app.graph and window.graph both missing');
      return { success: false, reason: "no_graph" };
    }

    const nodes = g._nodes || Object.values(g.nodes || {});
    if (!Array.isArray(nodes) || nodes.length === 0) {
      LG(`no_nodes: nodes array is ${!Array.isArray(nodes) ? 'not an array' : 'empty'}`);
      return { success: false, reason: "no_nodes" };
    }

    const node = nodes.find((n) => {
      const names = (n.widgets || []).map((w) => w.name);
      return names.includes("width") && names.includes("height");
    });
    if (!node) {
      LG(`no_matching_node: searched ${nodes.length} nodes, none had both width and height widgets`);
      return { success: false, reason: "no_matching_node" };
    }

    const wWidget = node.widgets.find((w) => w.name === "width");
    const hWidget = node.widgets.find((w) => w.name === "height");
    if (!wWidget || !hWidget) {
      LG('widgets_missing: node has names but widgets lookup failed');
      return { success: false, reason: "widgets_missing" };
    }

    const clamp = (val, opts) => {
      const min = (opts && typeof opts.min === "number") ? opts.min : -Infinity;
      const max = (opts && typeof opts.max === "number") ? opts.max : Infinity;
      return Math.min(max, Math.max(min, val));
    };

    const targetWidth = clamp(width, wWidget.options);
    const targetHeight = clamp(height, hWidget.options);

    wWidget.value = targetWidth;
    hWidget.value = targetHeight;
    if (typeof wWidget.callback === "function") { try { wWidget.callback(wWidget.value); } catch (_) { /* ignore */ } }
    if (typeof hWidget.callback === "function") { try { hWidget.callback(hWidget.value); } catch (_) { /* ignore */ } }
    if (node.setDirtyCanvas) { try { node.setDirtyCanvas(true, true); } catch (_) { /* cosmetic */ } }

    LG(`applied node id=${node.id} title="${node.title || node.type}" → width=${wWidget.value} height=${hWidget.value} (requested ${width}x${height})`);
    return { success: true, appliedWidth: wWidget.value, appliedHeight: hWidget.value };
  } catch (e) {
    LG("threw exception:", e && e.message);
    return { success: false, reason: "exception", errorMessage: e && e.message };
  }
}

/**
 * Runs trySetLiteGraphSizeInPage across all frames of `tabId` with
 * { world: "MAIN" }. Returns { applied, detail }. Never rejects; scripting
 * errors resolve applied:false so callers fall back to the DOM mechanism.
 */
function tryApplyLiteGraphSize(tabId, width, height) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript(
      { target: { tabId, allFrames: true }, world: "MAIN", func: trySetLiteGraphSizeInPage, args: [width, height, DEV_MODE] },
      (results) => {
        if (chrome.runtime.lastError) {
          dlog(`[Queue][MatchResolution] tryApplyLiteGraphSize MAIN-world error: ${chrome.runtime.lastError.message}`);
          resolve({ applied: false, detail: { reason: "scripting_error" } });
          return;
        }
        const successFrame = (results || []).find((r) => r.result && r.result.success);
        if (successFrame) {
          dlog(`[Queue][MatchResolution] LiteGraph size applied via MAIN world:`, successFrame.result);
          resolve({ applied: true, detail: successFrame.result });
          return;
        }
        const anyDetail = (results || []).map((r) => r.result).find(Boolean);
        dlog(`[Queue][MatchResolution] LiteGraph size NOT applied. Sample detail:`, anyDetail);
        resolve({ applied: false, detail: anyDetail || { reason: "no_result" } });
      }
    );
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
 * locator. Returns null when unconfigured — the caller falls back
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
 * "Match image resolution" feature: resolve the persisted widthField locator
 * for this tab's origin. Returns null when unconfigured — the caller (see
 * injectPromptToTab's size-setting step) then skips setting the width entirely
 * (graceful degradation: the prompt still sends, just without a resized canvas).
 */
function resolveWidthLocatorForTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.url) { resolve(null); return; }
      const origin = originFromUrl(tab.url);
      const profile = origin ? siteProfiles[origin] : null;
      resolve((profile && profile.widthField && profile.widthField.locator) || null);
    });
  });
}

/** Same as resolveWidthLocatorForTab, but for the persisted heightField locator. */
function resolveHeightLocatorForTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.url) { resolve(null); return; }
      const origin = originFromUrl(tab.url);
      const profile = origin ? siteProfiles[origin] : null;
      resolve((profile && profile.heightField && profile.heightField.locator) || null);
    });
  });
}

/**
 * Resolve the queue strategy configured for this tab's origin.
 * Returns the origin's `queue` sub-object (mode + pacingMs/etc), or the
 * Level-0 default `{ mode: "none", pacingMs: 6000 }` when the origin has no
 * profile yet. This is what lets an unconfigured site work out of the box
 * (Level 0 fixed pacing) while configured/built-in origins keep their richer
 * behavior (Level 1 button-watching, or Level 2 container once implemented).
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
