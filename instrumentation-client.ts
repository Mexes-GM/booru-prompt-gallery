// This file exports client-side hooks for Next.js instrumentation.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

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

  // Disable logs and replay to save quota + reduce bundle size
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
