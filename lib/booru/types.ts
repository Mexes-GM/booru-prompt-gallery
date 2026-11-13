export interface BooruPost {
  id: number
  file_url: string
  large_file_url: string
  preview_file_url: string
  tag_string: string
  tag_string_artist: string
  tag_string_character: string
  tag_string_copyright: string
  tag_string_meta?: string
  rating: string
  score: number
  source?: string
  width?: number
  height?: number
  _provider?: string // Added for internal use in Favorites UI
  /** Pack Mode: a scene the scene model wrote, not a real post (negative id, no image). See lib/pack/scene/invented.ts. */
  _invented?: boolean
  ai_metadata?: {
    prompt?: string
    negative_prompt?: string
    model?: string
    steps?: number
    cfg_scale?: number
    sampler?: string
    seed?: number
  }
}

export interface SearchOptions {
  tags: string
  page: string
  limit?: string
  order?: 'popular' | 'recent' | 'random'
  hasPrompt?: boolean
}

export interface IBooruProvider {
  search(options: SearchOptions): Promise<BooruPost[]>
}

export type BooruProvider = 'danbooru' | 'aibooru' | 'rule34' | 'e621' | 'e6ai' | 'gelbooru'

export const isAibooruPost = (post: BooruPost): boolean => {
  return 'ai_metadata' in post && post.ai_metadata !== undefined
}
