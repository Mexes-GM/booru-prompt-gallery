import { DanbooruProvider } from './providers/danbooru'
import { Rule34Provider } from './providers/rule34'
import { AibooruProvider } from './providers/aibooru'
import { E621Provider, E6aiProvider } from './providers/e621'
import { GelbooruProvider } from './providers/gelbooru'
import { IBooruProvider } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ProviderEnv = Record<string, string | undefined>

export const BOORU_PROVIDERS = ['danbooru', 'rule34', 'aibooru', 'e621', 'e6ai', 'gelbooru'] as const
export type BooruProviderType = (typeof BOORU_PROVIDERS)[number]

export function isBooruProvider(value: unknown): value is BooruProviderType {
  return typeof value === 'string' && (BOORU_PROVIDERS as readonly string[]).includes(value)
}

type ProviderCredentials = {
  DANBOORU_USERNAME: string
  DANBOORU_API_KEY: string
  GELBOORU_API_KEY: string
  GELBOORU_USER_ID: string
  GELBOORU_RELAY_URL: string
  GELBOORU_RELAY_SECRET: string
  RULE34_API_KEY: string
  RULE34_USER_ID: string
}

/** The provider credentials a booru search needs — nothing else from Env. */
export function providerEnv(env: Partial<Record<keyof ProviderCredentials, string>>): ProviderEnv {
  return {
    DANBOORU_USERNAME: env.DANBOORU_USERNAME,
    DANBOORU_API_KEY: env.DANBOORU_API_KEY,
    GELBOORU_API_KEY: env.GELBOORU_API_KEY,
    GELBOORU_USER_ID: env.GELBOORU_USER_ID,
    GELBOORU_RELAY_URL: env.GELBOORU_RELAY_URL,
    GELBOORU_RELAY_SECRET: env.GELBOORU_RELAY_SECRET,
    RULE34_API_KEY: env.RULE34_API_KEY,
    RULE34_USER_ID: env.RULE34_USER_ID,
  }
}

export class BooruFactory {
  static getProvider(
    type: BooruProviderType,
    env?: ProviderEnv,
    supabase?: SupabaseClient | null
  ): IBooruProvider {
    switch (type) {
      case 'danbooru':
        return new DanbooruProvider(env)
      case 'rule34':
        return new Rule34Provider(env, supabase)
      case 'aibooru':
        return new AibooruProvider()
      case 'e621':
        return new E621Provider()
      case 'e6ai':
        return new E6aiProvider()
      case 'gelbooru':
        return new GelbooruProvider(env, supabase)
      default:
        throw new Error(`Unknown provider type: ${type}`)
    }
  }
}
