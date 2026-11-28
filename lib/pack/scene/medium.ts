/**
 * Posts that are photographs of real people rather than drawn pictures.
 *
 * Boorus mark them themselves: the medium tag `photo (medium)` (a meta tag) and the
 * `real life` series tag that photo sets are filed under. Scenes taken from them
 * describe a real person, not a drawn character.
 */
import type { BooruPost } from '../../booru/types'

const PHOTO_TAGS = new Set(['photo (medium)', 'real life', 'cosplay photo'])

const tagsOf = (field: string | undefined): string[] =>
  field ? field.split(/\s+/).filter(Boolean).map((tag) => tag.toLowerCase().replace(/_/g, ' ')) : []

/** True when a medium tag of the post says it is a photograph. */
export function isPhotoPost(post: BooruPost): boolean {
  return [post.tag_string, post.tag_string_meta, post.tag_string_copyright].some((field) =>
    tagsOf(field).some((tag) => PHOTO_TAGS.has(tag))
  )
}
