// Client-side instrumentation hooks for Next.js.
// https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client
//
// PostHog is the single analytics + error-tracking tool (Sentry was removed).
// Unhandled exceptions are autocaptured (`capture_exceptions`); caught errors
// are reported through lib/error-reporting.ts.

import type { CaptureResult, PostHogInterface } from "posthog-js";
import { getTranslationState, initTranslationTracing } from "@/lib/error-context";
import {
  QUEUED_TIMESTAMP_PROP,
  applyQueuedMetadata,
  setPostHogClient,
  withPostHog,
} from "@/lib/posthog-queue";

// Exception messages that are non-actionable noise: browser extensions,
// translators, and transient network failures.
const IGNORED_EXCEPTION_MESSAGES = [
  "Event `Event` (type=error) captured as promise rejection",
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
  "The play() request was interrupted",
  // Google Translate / browser translator errors
  "window.google",
  "google_translate",
  // Common non-actionable browser errors
  "NetworkError when attempting to fetch resource",
  "Load failed",
  "Failed to fetch",
  "Request failed with status code 0",
  "Script error.",
  // Third-party extension noise
  "chrome-extension://",
  "moz-extension://",
  "safari-extension://",
  // DOM manipulation errors (caused by browser extensions/translators)
  "Failed to execute 'removeChild' on 'Node'",
  "Failed to execute 'insertBefore' on 'Node'",
  "Failed to execute 'appendChild' on 'Node'",
  "The node to be removed is not a child of this node",
  "The node before which the new node is to be inserted is not a child of this node",
  // Crypto-wallet extensions probing window.ethereum (202 events / 114 users
  // in Sep–Oct 2026, none from our code)
  "window.ethereum.selectedAddress",
  // posthog-js's own ingestion timeouts — telemetry about telemetry
  "PostHog request timed out",
];

const EXTENSION_PROTOCOLS = ["file://", "chrome-extension://", "moz-extension://", "safari-extension://"];

type ExceptionEntry = {
  value?: string;
  stacktrace?: { frames?: Array<{ filename?: string }> };
};

// Drops noisy exception events and enriches React #185 crashes with the
// browser-translation state. Non-exception events pass through untouched.
function filterExceptions(event: CaptureResult | null): CaptureResult | null {
  if (!event || event.event !== "$exception") return event;

  const list = event.properties?.$exception_list as ExceptionEntry[] | undefined;
  const first = list?.[0];
  const message = first?.value ?? "";

  if (IGNORED_EXCEPTION_MESSAGES.some((m) => message.includes(m))) return null;
  if (first?.stacktrace?.frames?.some((f) => EXTENSION_PROTOCOLS.some((p) => f.filename?.startsWith(p)))) {
    return null;
  }

  // React #185 ("Maximum update depth exceeded"): the suspected root cause is
  // Google Translate mutating the DOM under React. Attach the live translation
  // state so translated vs genuine render loops can be told apart.
  if (message.includes("Maximum update depth exceeded") || message.includes("#185")) {
    try {
      const translation = getTranslationState();
      event.properties = {
        ...event.properties,
        error_type: "render_loop",
        page_translated: translation.detected,
        likely_cause: translation.detected ? "browser_translator" : "render_loop",
        translation,
      };
    } catch {
      /* non-fatal: enrichment is best-effort */
    }
  }

  return event;
}

// Web Vitals debug instrumentation (perf plan P0). Flag-gated so it ships zero
// bytes to production unless NEXT_PUBLIC_PERF_DEBUG=1. Surfaces LCP element, CLS
// culprit nodes, and INP targets to the console (and window.__perfDebug()).
if (process.env.NEXT_PUBLIC_PERF_DEBUG === "1") {
  import("@/lib/web-vitals-debug")
    .then((m) => m.initWebVitalsDebug())
    .catch(() => {
      /* non-fatal: debug instrumentation is best-effort */
    });
}

// PostHog — initialized here (instrumentation-client.ts) for Next.js 15.3+.
// Do NOT call posthog.init() elsewhere (e.g. inside a React provider) to avoid
// double-initialization, and do not import posthog-js as a value anywhere else:
// the app reaches it through lib/posthog-queue.ts (track() in lib/analytics.ts,
// lib/error-reporting.ts), which queues calls until the SDK below has loaded.
// Skip local dev: .env.local carries the real key, and localhost sessions were
// polluting referrers, rage clicks, exceptions and replay summaries.
const isLocalHost =
  typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/.test(window.location.hostname)

// Starts session replay once the page has loaded and the main thread is idle.
// It is switched on through the SDK itself, so it reuses the same anonymous id,
// session and queue as the events captured before.
function startDeferredFeatures(ph: PostHogInterface) {
  const start = () => {
    ph.startSessionRecording();
  };
  const whenIdle = () => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(start, { timeout: 5000 });
    } else {
      setTimeout(start, 2000);
    }
  };
  if (document.readyState === "complete") whenIdle();
  else window.addEventListener("load", whenIdle, { once: true });
}

// Runs `load` once the page has loaded and the main thread is idle, so the SDK
// (~295 KB) never competes with the app's own scripts before the first paint.
// A tap, a key press or the tab going to the background loads it straight
// away: later clicks are then autocaptured, and the queued events get a chance
// to be sent before the tab is closed or frozen. The timer covers a `load`
// event held back by a slow image.
function loadAfterFirstPaint(load: () => void) {
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onHidden = () => {
    if (document.visibilityState === "hidden") start();
  };
  const start = () => {
    if (started) return;
    started = true;
    clearTimeout(timer);
    window.removeEventListener("pointerdown", start, true);
    window.removeEventListener("keydown", start, true);
    document.removeEventListener("visibilitychange", onHidden);
    load();
  };
  const whenIdle = () => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(start, { timeout: 2000 });
    } else {
      setTimeout(start, 1);
    }
  };
  if (document.readyState === "complete") whenIdle();
  else window.addEventListener("load", whenIdle, { once: true });
  timer = setTimeout(whenIdle, 10000);
  window.addEventListener("pointerdown", start, { capture: true, passive: true });
  window.addEventListener("keydown", start, { capture: true, passive: true });
  document.addEventListener("visibilitychange", onHidden);
}

// What the SDK would have recorded had it loaded with the page: the landing
// URL, and when the tab was first visible (the SDK holds the initial $pageview
// of a background tab until it is shown).
const landing =
  typeof window !== "undefined"
    ? {
        href: window.location.href,
        pathname: window.location.pathname,
        visibleAt: document.visibilityState === "visible" ? Date.now() : null as number | null,
      }
    : null;
let initialPageviewSeen = false;

// before_send step that runs ahead of filterExceptions. Exceptions reported
// before PostHog loaded carry their original time and the uuid already shown to
// the user (lib/error-reporting.ts); move both onto the event. The SDK's
// initial $pageview is captured at init, which now happens after the first
// paint, so it gets back the time the page was first shown.
function restoreQueuedTiming(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  applyQueuedMetadata(event);
  if (event.event === "$pageview" && !initialPageviewSeen) {
    initialPageviewSeen = true;
    if (landing?.visibleAt && event.properties?.$pathname === landing.pathname) {
      event.timestamp = new Date(landing.visibleAt);
    }
  }
  return event;
}

// Unhandled errors before the SDK's exception autocapture runs would otherwise
// be missed. It starts well after the first paint: the SDK loads after `load`,
// and then fetches the autocapture script before it wraps window.onerror and
// window.onunhandledrejection. Until those handlers are wrapped, these listeners
// report errors as unhandled exceptions, built the way the autocapture builds
// them, with their original time.
let pageOnError: typeof window.onerror = null;
let pageOnRejection: typeof window.onunhandledrejection = null;
function stopEarlyExceptionCapture() {
  window.removeEventListener("error", onEarlyError);
  window.removeEventListener("unhandledrejection", onEarlyRejection);
}
function captureEarlyException(input: unknown) {
  if (window.onerror !== pageOnError || window.onunhandledrejection !== pageOnRejection) {
    // The SDK's handlers are in place and report this one themselves.
    stopEarlyExceptionCapture();
    return;
  }
  const at = Date.now();
  withPostHog((ph) => {
    if (!ph.exceptions) return;
    const props = ph.exceptions.buildProperties(input, { handled: false });
    ph.exceptions.sendExceptionEvent({ ...props, [QUEUED_TIMESTAMP_PROP]: at });
  });
}
const onEarlyError = (e: ErrorEvent) => captureEarlyException(e.error ?? e);
const onEarlyRejection = (e: PromiseRejectionEvent) => captureEarlyException(e);

if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_POSTHOG_KEY && !isLocalHost) {
  pageOnError = window.onerror;
  pageOnRejection = window.onunhandledrejection;
  window.addEventListener("error", onEarlyError);
  window.addEventListener("unhandledrejection", onEarlyRejection);
  if (landing && landing.visibleAt === null) {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      landing.visibleAt = Date.now();
      document.removeEventListener("visibilitychange", onVisible);
    };
    document.addEventListener("visibilitychange", onVisible);
  }

  // Reverse-proxy host. Previously "/ingest" (same-origin) was proxied to
  // PostHog by next.config.mjs rewrites — but that ran through Next.js
  // middleware + an external rewrite on every event, making analytics the
  // biggest Fluid Active CPU consumer on Vercel. The proxy now lives on the
  // Cloudflare Worker (see workers/booru-image-proxy/src/routes/posthog-ingest.ts),
  // so ingestion spends zero Vercel compute while staying first-party (ad-block
  // resistant). Falls back to PostHog directly when the Worker isn't configured
  // (local dev — where NEXT_PUBLIC_POSTHOG_KEY is normally unset anyway).
  const workerUrl = (process.env.NEXT_PUBLIC_IMAGE_PROXY_URL || '').trim().replace(/\/$/, '')
  const posthogApiHost = workerUrl ? `${workerUrl}/ingest` : 'https://us.i.posthog.com'

  loadAfterFirstPaint(() => {
    import("posthog-js").then(({ default: posthog }) => {
      // Normally the first error after the SDK wraps the handlers removes the
      // early listeners. If exception autocapture is switched off in PostHog's
      // settings it never wraps them, so stop on a timer too.
      setTimeout(stopEarlyExceptionCapture, 10000);
      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
        api_host: posthogApiHost,
        ui_host: "https://us.posthog.com",
        defaults: "2026-01-30",
        person_profiles: "identified_only",
        // The SDK captures the initial $pageview right after init (deferred until
        // the tab is visible) and one per pathname change on pushState/
        // replaceState. A manual capture from a React effect used to run before
        // this async init, so posthog-js dropped it (~70% of sessions had no
        // $pageview). ?tags= rewrites are searches, not pageviews.
        capture_pageview: "history_change",
        capture_pageleave: true,
        // Each flush is one request through the Worker proxy, which also serves
        // the app's API. Send queued events every 5s (the SDK maximum; default 3s).
        request_queue_config: { flush_interval_ms: 5000 },
        // Heatmap data otherwise goes out every 5s while the mouse moves, which
        // keeps the queue flushing for the whole visit. It is still sent on
        // beforeunload, so slower batches lose nothing. An object here turns
        // heatmaps on even if they are later switched off in PostHog's settings.
        capture_heatmaps: { flush_interval_milliseconds: 30000 },
        capture_exceptions: true,
        // Session replay (the recorder script, ~67 KB) starts after `load` + idle
        // instead of competing with the app's own JS during the first paint (see
        // startDeferredFeatures). Surveys stay off: the app has no survey UI, and
        // the SDK does not load surveys.js when the option is flipped on later.
        disable_session_recording: true,
        disable_surveys: true,
        before_send: [restoreQueuedTiming, filterExceptions],
        // Multi-clicking a text field is caret placement / word-line selection,
        // not frustration — it was the #1 "$rageclick" source (search input) and
        // buried real ones. Keep the SDK default (.ph-no-rageclick) as well.
        rageclick: {
          css_selector_ignorelist: ['.ph-no-rageclick', 'input', 'textarea', '[contenteditable="true"]'],
        },
        debug: false, // Disabled to prevent console spam
        // Browser-translation tracing registers super properties, so it must
        // start only once PostHog is loaded.
        loaded: (ph) => {
          startDeferredFeatures(ph);
          // Calls made before init (app_open, early exceptions, identify...) were
          // queued by lib/posthog-queue.ts; replay them now, in order, with their
          // original timestamps. The translation super properties go first so
          // the queued events carry them too.
          setPostHogClient(posthog, () => {
            if (document.readyState === "loading") {
              window.addEventListener("DOMContentLoaded", () => initTranslationTracing(), { once: true });
            } else {
              initTranslationTracing();
            }
            // A client-side navigation before the SDK loaded: its initial
            // $pageview is for the current path, so record the landing page too.
            if (landing && window.location.pathname !== landing.pathname) {
              ph.capture(
                "$pageview",
                { $current_url: landing.href, $pathname: landing.pathname },
                { timestamp: new Date(landing.visibleAt ?? Date.now()) },
              );
            }
          });
        },
      });
    });
  });
}
