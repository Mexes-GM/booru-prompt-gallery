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
  release: process.env.NEXT_PUBLIC_APP_VERSION,

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
      event.request.cookies = '***';
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
    
    // Tag server errors with runtime info
    if (event.tags) {
      event.tags.runtime = "nodejs";
    } else {
      event.tags = { runtime: "nodejs" };
    }
    return event;
  },
});
