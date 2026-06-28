// This file configures the initialization of Sentry for edge features (middleware, edge routes).
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
  // Coerce "" to undefined so the withSentryConfig-injected release is used.
  release: process.env.NEXT_PUBLIC_APP_VERSION || undefined,

  // Sample only 10% of traces to stay within free tier
  tracesSampleRate: 0.1,

  // Disable logs to save quota
  enableLogs: false,

  // Don't send PII
  sendDefaultPii: false,

  // Only capture errors in production
  enabled: process.env.NODE_ENV === "production" && Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),

  // Filter out noisy errors
  ignoreErrors: [
    "NetworkError when attempting to fetch resource",
    "Load failed",
    "Failed to fetch",
    "Request failed with status code 0",
    // Expected, user-caused auth outcomes (non-actionable) — parity with server
    "PKCE code verifier not found",
    "code verifier",
    "Email link is invalid or has expired",
    "invalid flow state",
    "For security purposes, you can only request this after",
    "both auth code and code verifier should be non-empty",
  ],
  beforeSend(event) {
    // Drop expected, non-actionable auth events (parity with server config).
    const msg = (
      event.message ||
      event.exception?.values?.[0]?.value ||
      ""
    ).toLowerCase()
    if (
      msg.includes("pkce") ||
      msg.includes("code verifier") ||
      msg.includes("email link is invalid or has expired") ||
      msg.includes("invalid flow state") ||
      msg.includes("for security purposes") ||
      msg.includes("only request this after")
    ) {
      return null
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
    
    // Tag edge errors with runtime info
    if (event.tags) {
      event.tags.runtime = "edge";
    } else {
      event.tags = { runtime: "edge" };
    }
    return event;
  },
});
