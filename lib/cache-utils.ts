import type { BooruPost } from "./booru/types"

export interface CachedPost {
  provider: string
  post_id: number
  file_url: string | null
  large_file_url: string | null
  preview_file_url: string | null
  rating: string
  score: number
  image_width: number
  image_height: number
  tag_string: { general: string[]; artist: string[]; character: string[]; copyright: string[] }
  tag_string_artist: string | null
  tag_string_character: string | null
  tag_string_copyright: string | null
  tag_string_meta: string | null
  ai_metadata: Record<string, unknown> | null
  stale_at: string | null
}

/**
 * Transforma un BooruPost (del fetch de booru) a una fila lista para
 * UPSERT en la tabla `booru_posts_cache` de Supabase.
 *
 * Sección 2.3 del plan: favorites-metadata-cache.md
 */
export function booruPostToCacheRow(
  post: BooruPost,
  provider: string,
): CachedPost {
  const tagString = post.tag_string || ""
  const tags = tagString.split(/\s+/).filter(Boolean)
  const artistTags = (post.tag_string_artist || "").split(/\s+/).filter(Boolean)
  const charTags = (post.tag_string_character || "").split(/\s+/).filter(Boolean)
  const copyTags = (post.tag_string_copyright || "").split(/\s+/).filter(Boolean)
  const artistTagSet = new Set(artistTags)
  const charTagSet = new Set(charTags)
  const copyTagSet = new Set(copyTags)

  const tagJson = {
    general: tags.filter(
      (t) =>
        !artistTagSet.has(t) &&
        !charTagSet.has(t) &&
        !copyTagSet.has(t),
    ),
    artist: artistTags,
    character: charTags,
    copyright: copyTags,
  }

  return {
    provider,
    post_id: post.id,
    file_url: post.file_url || null,
    large_file_url: post.large_file_url || null,
    preview_file_url: post.preview_file_url || null,
    rating: post.rating || "q",
    score: post.score || 0,
    image_width: post.width || 0,
    image_height: post.height || 0,
    tag_string: tagJson,
    tag_string_artist: post.tag_string_artist || null,
    tag_string_character: post.tag_string_character || null,
    tag_string_copyright: post.tag_string_copyright || null,
    tag_string_meta: post.tag_string_meta || null,
    ai_metadata: post.ai_metadata as Record<string, unknown> | null ?? null,
    stale_at: null, // Danbooru inmutable; otros providers actualizan en refresh
  }
}
