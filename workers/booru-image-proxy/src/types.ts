import { Ai } from '@cloudflare/workers-types'

export interface Env {
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  /** F4 (rate-limit-antiabuse plan): HS256 secret to verify Supabase access
   * tokens locally (no network call). Mirrors lib/rate-limit-identity.ts on
   * the Next.js side. Find it in Supabase Dashboard → Settings → API → JWT Secret. */
  SUPABASE_JWT_SECRET?: string
  /** F4: master flag for adaptive (authed vs. anon) rate limits. Default OFF —
   * when unset/not '1', every route keys and limits exactly as before. */
  ADAPTIVE_LIMITS?: string
  UPSTASH_REDIS_REST_URL?: string
  UPSTASH_REDIS_REST_TOKEN?: string
  DANBOORU_USERNAME?: string
  DANBOORU_API_KEY?: string
  GELBOORU_API_KEY?: string
  GELBOORU_USER_ID?: string
  /** Optional relay (the app's /api/gelbooru-relay route) that Gelbooru API
   * calls go through when Gelbooru rate-limits this worker's network. */
  GELBOORU_RELAY_URL?: string
  GELBOORU_RELAY_SECRET?: string
  RULE34_API_KEY?: string
  RULE34_USER_ID?: string
  DISCORD_FEEDBACK_WEBHOOK_URL?: string
  TURNSTILE_SECRET_KEY?: string
  /** F2: when '1', the free AI-convert tier requires a valid Turnstile token. */
  TURNSTILE_AI_GATE?: string
  APP_VERSION?: string
  AI?: Ai
}
