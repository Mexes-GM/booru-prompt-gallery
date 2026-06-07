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
  _provider?: string
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
