// This file exports client-side hooks for Next.js instrumentation.
// The actual Sentry.init() is in sentry.client.config.ts (auto-loaded by Sentry build plugin).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

export { onRouterTransitionStart } from "./sentry.client.config";
