// This file configures the initialization of Sentry on the client.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://fb86aeb213c40ca33017f94bee860f52@o4510936288395264.ingest.us.sentry.io/4510936292130816",

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
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
