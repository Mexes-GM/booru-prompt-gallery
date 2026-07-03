import type { BooruPost } from "@/lib/booru/types"

// Pure post-shape transformers extracted from lib/api-client.ts so they can be
// imported both by api-client.ts (search results) and hooks/use-favorite-posts.ts
// (favorites fetch) without creating an import cycle between the two.

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ai_metadata: typedPost.ai_metadata as any,
    width: (typedPost.image_width as number) || (typedPost.width as number) || 0,
    height: (typedPost.image_height as number) || (typedPost.height as number) || 0,
    _provider: 'aibooru', // Explicitly mark as Aibooru
  }
}

// Helper to transform raw E621 posts to BooruPost (direct client fetch — CORS *, no auth)
// ponytail: minimal mapping, only fields the gallery uses. Add more when needed.
export const transformE621Post = (post: unknown): BooruPost => {
  if (!post || typeof post !== 'object') {
    throw new Error('Invalid post data from E621')
  }
  const p = post as Record<string, unknown>
  const file = (p.file as Record<string, unknown>) || {}
  const sample = (p.sample as Record<string, unknown>) || {}
  const preview = (p.preview as Record<string, unknown>) || {}
  const tags = (p.tags as Record<string, string[]>) || {}
  const score = (p.score as Record<string, number>) || {}

  // Collect content tags (exclude meta/invalid categories)
  const contentCategories = ['general', 'species', 'character', 'copyright', 'artist', 'lore']
  const allTags: string[] = []
  contentCategories.forEach(cat => {
    if (tags[cat]) allTags.push(...tags[cat])
  })

  return {
    id: (p.id as number) || 0,
    file_url: (file.url as string) || '',
    large_file_url: (sample.url as string) || (file.url as string) || '',
    preview_file_url: (preview.url as string) || (file.url as string) || '',
    tag_string: allTags.join(' '),
    tag_string_artist: (tags.artist || []).join(' '),
    tag_string_character: (tags.character || []).join(' '),
    tag_string_copyright: (tags.copyright || []).join(' '),
    rating: (p.rating as string) || 'q',
    score: score.total ?? 0,
    width: (file.width as number) || 0,
    height: (file.height as number) || 0,
    _provider: 'e621',
  }
}
