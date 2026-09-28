// Client-side instrumentation hooks for Next.js.
// https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client
//
// PostHog is the single analytics + error-tracking tool (Sentry was removed).
// Unhandled exceptions are autocaptured (`capture_exceptions`); caught errors
// are reported through lib/error-reporting.ts.

import type { CaptureResult } from "posthog-js";
import { getTranslationState, initTranslationTracing } from "@/lib/error-context";

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
// double-initialization. The PostHogProvider in layout.tsx wraps children with
// PHProvider for usePostHog() hook access but does not re-init.
// Skip local dev: .env.local carries the real key, and localhost sessions were
// polluting referrers, rage clicks, exceptions and replay summaries.
const isLocalHost =
  typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/.test(window.location.hostname)

if (process.env.NEXT_PUBLIC_POSTHOG_KEY && !isLocalHost) {
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

  import("posthog-js").then(({ default: posthog }) => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: posthogApiHost,
      ui_host: "https://us.posthog.com",
      defaults: "2026-01-30",
      person_profiles: "identified_only",
      capture_pageview: false,
      capture_pageleave: true,
      capture_exceptions: true,
      before_send: filterExceptions,
      // Multi-clicking a text field is caret placement / word-line selection,
      // not frustration — it was the #1 "$rageclick" source (search input) and
      // buried real ones. Keep the SDK default (.ph-no-rageclick) as well.
      rageclick: {
        css_selector_ignorelist: ['.ph-no-rageclick', 'input', 'textarea', '[contenteditable="true"]'],
      },
      debug: false, // Disabled to prevent console spam
      // Browser-translation tracing registers super properties, so it must
      // start only once PostHog is loaded.
      loaded: () => {
        if (document.readyState === "loading") {
          window.addEventListener("DOMContentLoaded", () => initTranslationTracing(), { once: true });
        } else {
          initTranslationTracing();
        }
      },
    });
  });
}
