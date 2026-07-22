// This file exports client-side hooks for Next.js instrumentation.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { getTranslationState, initTranslationTracing } from "@/lib/sentry-tracing";

// Scrub sensitive data from URLs and request objects
function scrubSensitiveData(url: string | undefined): string | undefined {
  if (!url) return url;
  
  try {
    const urlObj = new URL(url);
    const params = new URLSearchParams(urlObj.search);
    
    // List of sensitive query parameters to scrub
    const sensitiveKeys = [
      'api_key', 'apikey', 'api-key',
      'token', 'auth', 'password',
      'secret', 'key',
      'access_token', 'refresh_token',
      'session', 'sessionid', 'session_id',
      'user', 'username', 'email',
      'id', 'userid', 'user_id',
    ];
    
    // Scrub sensitive parameters
    for (const key of params.keys()) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        params.set(key, '***');
      }
    }
    
    urlObj.search = params.toString();
    return urlObj.toString();
  } catch {
    // If URL parsing fails, return obfuscated version
    return url.replace(/([?&])([a-zA-Z_][a-zA-Z0-9_-]*)=([^&]+)/g, '$1$2=***');
  }
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Empty string would override the release auto-injected by withSentryConfig
  // and detach events from their uploaded source maps — coerce "" to undefined.
  release: process.env.NEXT_PUBLIC_APP_VERSION || undefined,

  // Sample only 10% of traces to stay within free tier (5K events/month)
  tracesSampleRate: 0.1,

  // Session Replay — disabled (screen recording). Was: always capture a
  // replay on error, plus a 5% sample of normal sessions. Kept the comment
  // for context if re-enabling is ever needed.
  // integrations: [
  //   Sentry.replayIntegration({
  //     maskAllText: false,   // we must see the UI text to confirm browser translation
  //     blockAllMedia: true,  // don't record gallery images (bandwidth + rating-safe)
  //   }),
  // ],
  // replaysSessionSampleRate: 0.05,
  // replaysOnErrorSampleRate: 1.0,

  // Sentry Logs stay off to save quota + bundle; we rely on breadcrumbs, which
  // ride inside the error event for free.
  enableLogs: false,

  // Don't send PII in a gallery app
  sendDefaultPii: false,

  // Only capture errors in production
  enabled: process.env.NODE_ENV === "production" && Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),

  // Filter out noisy errors from browser extensions, translators, and known non-actionable sources
  ignoreErrors: [
    "Event `Event` (type=error) captured as promise rejection",
    // Browser extension errors
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "The play() request was interrupted by a call to pause()",
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
  ],
  beforeSend(event) {
    // Ignore events originating from file:// or chrome-extension:// protocols
    if (event.request?.url && (event.request.url.startsWith("file://") || event.request.url.startsWith("chrome-extension://"))) {
      return null;
    }
    const stacktrace = event.exception?.values?.[0]?.stacktrace;
    if (stacktrace?.frames?.some((frame) => frame.filename?.startsWith("file://"))) {
      return null;
    }

    // Ignore DOM manipulation errors (caused by browser extensions/translators)
    const errorMessage = event.exception?.values?.[0]?.value || "";
    const isDOMManipulationError =
      errorMessage.includes("removeChild") ||
      errorMessage.includes("insertBefore") ||
      errorMessage.includes("appendChild") ||
      errorMessage.includes("The node to be removed is not a child") ||
      errorMessage.includes("The node before which the new node is to be inserted is not a child");

    if (isDOMManipulationError) {
      return null;
    }

    // Scrub sensitive data from URLs
    if (event.request?.url) {
      event.request.url = scrubSensitiveData(event.request.url);
    }

    // Scrub query strings
    if (event.request?.query_string) {
      event.request.query_string = '***';
    }

    // Scrub cookies
    if (event.request?.cookies) {
      (event.request as any).cookies = '***';
    }

    // Scrub headers (Authorization, Cookie, etc.)
    if (event.request?.headers) {
      const headersToScrub = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
      for (const header of headersToScrub) {
        if (event.request.headers[header]) {
          event.request.headers[header] = '***';
        }
      }
    }

    // Tag as browser runtime for easier filtering
    if (!event.tags) {
      event.tags = {};
    }
    event.tags.runtime = 'browser';

    // ── Enrich React #185 ("Maximum update depth exceeded") with a snapshot of
    // the browser-translation state at crash time. This is the suspected root
    // cause (Google Translate mutating the DOM under React) but is not
    // reproducible server-side — attaching the live state lets us confirm it
    // from the next real occurrence. See SENTRY-FULVOUS-ANCHOR-7.
    const isRenderLoop =
      errorMessage.includes('Maximum update depth exceeded') ||
      errorMessage.includes('React error #185') ||
      errorMessage.includes('#185');

    if (isRenderLoop) {
      try {
        const translation = getTranslationState();
        event.contexts = event.contexts || {};
        (event.contexts as Record<string, unknown>).translation = translation;
        event.tags.error_type = 'render_loop';
        event.tags.page_translated = String(translation.detected);
        event.tags.likely_cause = translation.detected ? 'browser_translator' : 'render_loop';
        // Split translated vs genuine #185 into separate issues so translation
        // crashes stop masking any real render loop (and vice versa).
        event.fingerprint = ['react-185', translation.detected ? 'translated' : 'genuine'];
      } catch {
        /* non-fatal: enrichment is best-effort */
      }
    }

    return event;
  },
});

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

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

// Start browser-translation tracing (breadcrumb + tags on detection). Gated to
// production + configured DSN so it adds zero overhead in dev.
if (process.env.NODE_ENV === "production" && Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN)) {
  if (typeof window !== "undefined") {
    if (document.readyState === "loading") {
      window.addEventListener("DOMContentLoaded", () => initTranslationTracing(), { once: true });
    } else {
      initTranslationTracing();
    }
  }
}

// PostHog — initialized here (instrumentation-client.ts) for Next.js 15.3+.
// Do NOT call posthog.init() elsewhere (e.g. inside a React provider) to avoid
// double-initialization. The PostHogProvider in layout.tsx wraps children with
// PHProvider for usePostHog() hook access but does not re-init.
if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  // Reverse-proxy host. Previously "/ingest" (same-origin) was proxied to
  // PostHog by next.config.mjs rewrites — but that ran through Next.js
  // middleware + an external rewrite on every event, making analytics the
  // biggest Fluid Active CPU consumer on Vercel. The proxy now lives on the
  // Cloudflare Worker (see workers/booru-image-proxy/src/routes/posthog-ingest.ts),
  // so ingestion spends zero Vercel compute while staying first-party (ad-block
  // resistant). Falls back to PostHog directly when the Worker isn't configured
  // (local dev — where NEXT_PUBLIC_POSTHOG_KEY is normally unset anyway).
  const workerUrl = (process.env.NEXT_PUBLIC_IMAGE_PROXY_URL || '').replace(/\/$/, '')
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
      debug: false, // Disabled to prevent console spam
    });
  });
}
