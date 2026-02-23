// This file configures the initialization of Sentry for edge features (middleware, edge routes).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://fb86aeb213c40ca33017f94bee860f52@o4510936288395264.ingest.us.sentry.io/4510936292130816",

  // Sample only 10% of traces to stay within free tier
  tracesSampleRate: 0.1,

  // Disable logs to save quota
  enableLogs: false,

  // Don't send PII
  sendDefaultPii: false,

  // Only capture errors in production
  enabled: process.env.NODE_ENV === "production",
});
