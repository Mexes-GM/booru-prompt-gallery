// sidepanel/01-env.js — Environment (prod/fallback/dev URLs), shared helpers, boot screen + host failover.
// Classic script: shares the global scope with the other sidepanel/*.js
// files, loaded in numeric order by sidepanel.html. Load-time code may only
// use names declared in this file or an earlier one.

// ─────────────────────────────────────────────────────────────────────────────
// Environment switching logic
// ─────────────────────────────────────────────────────────────────────────────
const PROD_URL = "https://booru-prompt-gallery.vercel.app/extension";
// Secondary host, kept deployed on purpose as a quota failover for Vercel.
const FALLBACK_PROD_URL = "https://booru-prompt-gallery.netlify.app/extension";
const DEV_URL = "http://localhost:3000/extension";

const btnLocal = document.getElementById("btn-local");
const btnProd = document.getElementById("btn-prod");
const appFrame = document.getElementById("app-frame");
const configBar = document.getElementById("config-bar");

const LOCAL_STORAGE_KEY = "booru_sidebar_env";

/**
 * Safely checks whether a URL's host equals `host` or is a subdomain of it.
 *
 * Prefer this over `url.includes("example.com")` for host checks. A bare
 * substring test also matches attacker-shaped URLs such as
 * `https://evil.com/?x=example.com` or `https://example.com.evil.com`
 * (CodeQL js/incomplete-url-substring-sanitization). Relative or unparseable
 * URLs resolve against a sentinel host and therefore return false.
 */
function urlHasHost(url, host) {
  try {
    const h = new URL(url, "http://relative.invalid").hostname.toLowerCase();
    const target = host.toLowerCase();
    return h === target || h.endsWith("." + target);
  } catch (_) {
    return false;
  }
}

function urlHasAnyHost(url, hosts) {
  return hosts.some((h) => urlHasHost(url, h));
}

// Restore the last theme the app reported (if any) before the iframe loads, so
// the wrapper chrome doesn't flash the OS theme when it differs from the user's
// manual in-app choice. Falls back to prefers-color-scheme until the app reports.
try {
  const savedTheme = localStorage.getItem("booru_sidebar_theme");
  if (savedTheme === "light" || savedTheme === "dark") {
    document.documentElement.setAttribute("data-theme", savedTheme);
  }
} catch (_) {}

// `update_url` presence used to be how we auto-detected an unpacked/developer
// install: Chrome Web Store installs have it, unpacked "Load unpacked" loads
// don't. That heuristic is Chrome-only and actively wrong on Firefox — NO
// Firefox extension ever has `update_url` in its manifest, not AMO-signed
// installs and not temporary "about:debugging" loads either. Trusting it made
// DEV_MODE always true on Firefox, which silently pointed the iframe at
// http://localhost:3000/extension (see setEnvironment() below) instead of
// production for every real user on that browser.
//
// Cross-browser fix: default to production unconditionally. Dev tooling is
// opt-in only, via the explicit localStorage flag developers already set by
// hand (see README/CONTRIBUTING for the dev workflow). No `management`
// permission needed for this.
const DEV_MODE = localStorage.getItem("booru_sidebar_devmode") === "1";

// Verbose debug logging is dev-only so packaged (Web Store) installs stay quiet.
// Warnings and errors still use console.warn/console.error directly — those
// signal real problems worth surfacing in any environment.
function dlog(...args) {
  if (DEV_MODE) console.log(...args);
}

function setEnvironment(url) {
  bootWatch(url);
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

// ─────────────────────────────────────────────────────────────────────────────
// Boot screen + host failover
// ─────────────────────────────────────────────────────────────────────────────
// The iframe's `load` event also fires for error pages and for the maintenance
// curtain, so "loaded" is not "working". The app posts POCKET_READY once it has
// hydrated (older deployments only post REQUEST_QUEUE_STATUS, accepted too).
// If the primary host doesn't answer in time, switch to the fallback host;
// a failover is remembered for a while so the next opens go straight there.
const bootEl = document.getElementById("boot");
const bootLabel = document.getElementById("boot-label");
const bootRetry = document.getElementById("boot-retry");
const READY_AFTER_LOAD_MS = 8000;   // hydration budget once the document loaded
const READY_TOTAL_MS = 20000;       // hard ceiling (network never answers)
const FAILOVER_STORAGE_KEY = "booru_sidebar_failover_until";
const FAILOVER_STICKY_MS = 60 * 60 * 1000;
let bootTimer = null;
let bootReady = false;
let bootUrl = null;

function setBootState(state, label) {
  if (!bootEl) return;
  bootEl.dataset.state = state;
  if (label && bootLabel) bootLabel.textContent = label;
}

function bootWatch(url) {
  bootReady = false;
  bootUrl = url;
  setBootState("loading", "Loading Booru Prompt Gallery…");
  clearTimeout(bootTimer);
  bootTimer = setTimeout(() => bootTimeout("total"), READY_TOTAL_MS);
}

function bootMarkReady() {
  if (bootReady) return;
  bootReady = true;
  clearTimeout(bootTimer);
  setBootState("hidden");
}

function bootTimeout(reason) {
  if (bootReady) return;
  clearTimeout(bootTimer);
  if (!DEV_MODE && bootUrl === PROD_URL) {
    console.warn(`[Boot] Primary host did not respond (${reason}); failing over.`);
    try { localStorage.setItem(FAILOVER_STORAGE_KEY, String(Date.now() + FAILOVER_STICKY_MS)); } catch (_) {}
    setEnvironment(FALLBACK_PROD_URL);
    setBootState("loading", "Switching to the backup server…");
    return;
  }
  if (reason === "after-load") {
    // Something loaded (e.g. a maintenance page) — show it rather than an error.
    setBootState("hidden");
    return;
  }
  setBootState("error");
}

appFrame.addEventListener("load", () => {
  if (bootReady) return;
  clearTimeout(bootTimer);
  bootTimer = setTimeout(() => bootTimeout("after-load"), READY_AFTER_LOAD_MS);
});

bootRetry?.addEventListener("click", () => {
  try { localStorage.removeItem(FAILOVER_STORAGE_KEY); } catch (_) {}
  setEnvironment(DEV_MODE ? (localStorage.getItem(LOCAL_STORAGE_KEY) || DEV_URL) : PROD_URL);
});

function pickProdUrl() {
  try {
    const until = Number(localStorage.getItem(FAILOVER_STORAGE_KEY) || 0);
    if (until > Date.now()) return FALLBACK_PROD_URL;
  } catch (_) {}
  return PROD_URL;
}


/**
 * Single source of truth for "can we (or should we even try to) inject a
 * content script / call chrome.scripting.executeScript into this tab's URL".
 * Used everywhere a tab is filtered before targeting or generation.
 *
 * Cross-browser note: the six call sites this replaces only ever checked
 * `chrome://` and `devtools://`, which are Chrome/Chromium-specific special
 * schemes. On Firefox the equivalent non-injectable pages use different
 * schemes entirely — `about:` (about:newtab, about:blank, about:debugging,
 * about:config, ...) and `view-source:` — and the extension's own pages are
 * `moz-extension://`, not `chrome-extension://`. Without this, `about:newtab`
 * (the single most common tab state when a user opens the sidebar for the
 * first time on Firefox) passed every old filter as "valid", and targeting
 * would proceed straight into an executeScript call that fails on host
 * permission instead of failing fast with a clear "no tab" message.
 *
 * Returns false for falsy/empty `url` too, so callers don't need a separate
 * null check.
 */
function isInjectableTabUrl(url) {
  if (!url) return false;
  return !(
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("devtools://") ||
    url.startsWith("about:") ||
    url.startsWith("view-source:") ||
    url.startsWith("moz-extension://") ||
    url.startsWith("resource://")
  );
}
