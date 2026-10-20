'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'

// PostHog is initialized in instrumentation-client.ts (Next.js 15.3+ pattern).
// This component only provides the React context so usePostHog() works in children.
// Pageviews are captured by the SDK itself (capture_pageview: "history_change"):
// a manual capture here ran before the async init and was silently dropped.
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return <PHProvider client={posthog}>{children}</PHProvider>
}
