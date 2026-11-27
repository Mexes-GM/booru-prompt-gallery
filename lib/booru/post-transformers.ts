import type { BooruPost } from "@/lib/booru/types"
import { type E621ParsedPost, extractE621Posts, parseE621Post } from "./e621-format"

// Pure post-shape transformers extracted from lib/api-client.ts so they can be
// imported both by api-client.ts (search results) and hooks/use-booru-posts-by-ids.ts
// (favorites/history fetch) without creating an import cycle between the two.

// Helper to transform raw Danbooru posts to BooruPost (direct client fetches)
export const transformDanbooruPost = (post: unknown): BooruPost => {
  if (!post || typeof post !== 'object') {
    throw new Error('Invalid post data from Danbooru')
  }
  const typedPost = post as Record<string, unknown>
  return {
    id: (typedPost.id as number) || 0,
    file_url: (typedPost.file_url as string) || '',
    large_file_url: (typedPost.large_file_url as string) || (typedPost.file_url as string) || '',
    preview_file_url: (typedPost.preview_file_url as string) || (typedPost.file_url as string) || '',
    tag_string: (typedPost.tag_string as string) || '',
    tag_string_artist: (typedPost.tag_string_artist as string) || '',
    tag_string_character: (typedPost.tag_string_character as string) || '',
    tag_string_copyright: (typedPost.tag_string_copyright as string) || '',
    tag_string_meta: (typedPost.tag_string_meta as string) || undefined,
    rating: (typedPost.rating as string) || 'q',
    score: (typedPost.score as number) || 0,
    width: (typedPost.image_width as number) || (typedPost.width as number) || 0,
    height: (typedPost.image_height as number) || (typedPost.height as number) || 0,
    _provider: 'danbooru',
  }
}

// Helper to transform raw Aibooru posts to BooruPost
export const transformAibooruPost = (post: unknown): BooruPost => {
  // Ensure we have minimal required fields
  if (!post || typeof post !== 'object') {
    throw new Error('Invalid post data from Aibooru')
  }

  const typedPost = post as Record<string, unknown>
  return {
    id: (typedPost.id as number) || 0,
    file_url: (typedPost.file_url as string) || '',
    large_file_url: (typedPost.large_file_url as string) || (typedPost.file_url as string) || '',
    preview_file_url: (typedPost.preview_file_url as string) || (typedPost.file_url as string) || '',
    tag_string: (typedPost.tag_string as string) || '',
    tag_string_artist: (typedPost.tag_string_artist as string) || '',
    tag_string_character: (typedPost.tag_string_character as string) || '',
    tag_string_copyright: (typedPost.tag_string_copyright as string) || '',
    rating: (typedPost.rating as string) || 'q',
    score: (typedPost.score as number) || 0,
     
    ai_metadata: typedPost.ai_metadata as any,
    width: (typedPost.image_width as number) || (typedPost.width as number) || 0,
    height: (typedPost.image_height as number) || (typedPost.height as number) || 0,
    _provider: 'aibooru', // Explicitly mark as Aibooru
  }
}

// Helper to transform raw E621 posts to BooruPost (direct client fetch — CORS *, no auth)
// e621-engine posts (e621, Floofgens), in the legacy or the current API format; see
// ./e621-format.ts. ponytail: only the fields the gallery uses.
const toE621BooruPost = (post: E621ParsedPost, provider: 'e621' | 'floofgens'): BooruPost => ({
  id: post.id,
  file_url: post.file_url,
  large_file_url: post.large_file_url,
  preview_file_url: post.preview_file_url,
  tag_string: post.tag_string,
  tag_string_artist: post.tag_string_artist,
  tag_string_character: post.tag_string_character,
  tag_string_copyright: post.tag_string_copyright,
  rating: post.rating || 'q',
  score: post.score,
  width: post.width,
  height: post.height,
  _provider: provider,
})

/** One raw e621-engine post. Throws when it is deleted or has no file. */
export const transformE621Post = (post: unknown, provider: 'e621' | 'floofgens' = 'e621'): BooruPost => {
  const parsed = parseE621Post(post)
  if (!parsed) throw new Error(`Invalid post data from ${provider}`)
  return toE621BooruPost(parsed, provider)
}

/** Every usable post of an e621-engine posts response; deleted and fileless posts are dropped. */
export const transformE621Posts = (data: unknown, provider: 'e621' | 'floofgens' = 'e621'): BooruPost[] => {
  const posts: BooruPost[] = []
  for (const raw of extractE621Posts(data)) {
    const parsed = parseE621Post(raw)
    if (parsed) posts.push(toE621BooruPost(parsed, provider))
  }
  return posts
}
