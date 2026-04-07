// This file configures the initialization of Sentry on the client.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Sample only 10% of traces to stay within free tier (5K events/month)
  tracesSampleRate: 0.1,

  // Disable logs and replay to save quota + reduce bundle size
  enableLogs: false,

  // No session replay — saves bundle size and quota
  // integrations: [Sentry.replayIntegration()], // disabled

  // Don't send PII in a gallery app
  sendDefaultPii: false,

  // Only capture errors in production
  enabled: process.env.NODE_ENV === "production",

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
    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
