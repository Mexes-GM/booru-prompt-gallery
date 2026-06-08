import { Ai } from '@cloudflare/workers-types'

export interface Env {
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  UPSTASH_REDIS_REST_URL?: string
  UPSTASH_REDIS_REST_TOKEN?: string
  DANBOORU_USERNAME?: string
  DANBOORU_API_KEY?: string
  GELBOORU_API_KEY?: string
  GELBOORU_USER_ID?: string
  RULE34_API_KEY?: string
  RULE34_USER_ID?: string
  DISCORD_FEEDBACK_WEBHOOK_URL?: string
  APP_VERSION?: string
  AI?: Ai
}
