// This file configures the initialization of Sentry for edge features (middleware, edge routes).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Sample only 10% of traces to stay within free tier
  tracesSampleRate: 0.1,

  // Disable logs to save quota
  enableLogs: false,

  // Don't send PII
  sendDefaultPii: false,

  // Only capture errors in production
  enabled: process.env.NODE_ENV === "production",

  // Filter out noisy errors
  ignoreErrors: [
    "NetworkError when attempting to fetch resource",
    "Load failed",
    "Failed to fetch",
    "Request failed with status code 0",
  ],
  beforeSend(event) {
    // Tag edge errors with runtime info
    if (event.tags) {
      event.tags.runtime = "edge";
    } else {
      event.tags = { runtime: "edge" };
    }
    return event;
  },
});
