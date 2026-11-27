/**
 * What a result row says about its scene, without its picture: the post it came from,
 * linked on the site the prompts came from, or that the scene was invented.
 */
import { getPostUrl } from "@/lib/constants"

export const SCENE_TEXT = {
  /** A scene the scene model wrote: there is no post behind it. */
  inventedScene: "Invented scene",
  post: (id: number) => `Post ${id}`,
  /** Link title and label of a post reference. */
  openPost: (id: number, site: string) => `Open post ${id} on ${site} (new tab)`,
} as const

/** A scene that is a real post (invented scenes and library outfits have negative ids). */
const isRealPost = (scene: { postId: number; invented?: boolean; outfitId?: number }): boolean =>
  scene.postId > 0 && !scene.invented && scene.outfitId === undefined

/** Where a result row's post reference links to; none for a scene with no post or an unknown site. */
export function scenePostHref(provider: string | undefined, scene: { postId: number; invented?: boolean } | undefined): string | undefined {
  if (!provider || !scene || !isRealPost(scene)) return undefined
  return getPostUrl(provider, scene.postId)
}
