/**
 * What the contact sheet and the result rows say about a scene, without its picture:
 * the post it came from and, on the sheet, how many people are in it when that is
 * what tells the scenes apart.
 */
import { getPostUrl } from "@/lib/constants"
import type { SceneThumb } from "./contact-sheet"

export const SCENE_TEXT = {
  /** A scene the scene model wrote: there is no post behind it. */
  invented: "Invented",
  inventedScene: "Invented scene",
  /** A library outfit lending its clothes (one-part packs): no post either. */
  outfit: "Outfit",
  libraryOutfit: "Library outfit",
  post: (id: number) => `Post ${id}`,
  /** Link title and label of a post reference. */
  openPost: (id: number, site: string) => `Open post ${id} on ${site} (new tab)`,
} as const

/** The fields of a scene candidate the sheet reads. */
export interface SceneTileSource {
  postId: number
  people: { girls: number; boys: number } | null
  invented?: boolean
  outfitId?: number
}

/** "Solo", "2 people"; an open count ("multiple girls") or an unknown one is a group. */
export function peopleText(people: SceneTileSource["people"]): string {
  if (!people) return "Group"
  const n = people.girls + people.boys
  if (n <= 1) return "Solo"
  return `${n} people`
}

/** A scene that is a real post (invented scenes and library outfits have negative ids). */
export const isRealPost = (scene: { postId: number; invented?: boolean; outfitId?: number }): boolean =>
  scene.postId > 0 && !scene.invented && scene.outfitId === undefined

/**
 * The sheet's tiles. The people count is shown only when it differs between the scenes:
 * in a pack of one make-up every tile would say the same.
 */
export function sceneThumbs(scenes: readonly SceneTileSource[]): SceneThumb[] {
  const counts = scenes.map((s) => peopleText(s.people))
  const varies = new Set(counts).size > 1
  return scenes.map((s, i) => ({
    id: String(s.postId),
    postId: s.postId,
    ...(isRealPost(s)
      ? {}
      : s.invented
        ? { name: SCENE_TEXT.invented, spokenName: SCENE_TEXT.inventedScene }
        : { name: SCENE_TEXT.outfit, spokenName: SCENE_TEXT.libraryOutfit }),
    ...(varies ? { detail: counts[i] } : {}),
  }))
}

/** Where a result row's post reference links to; none for a scene with no post or an unknown site. */
export function scenePostHref(provider: string | undefined, scene: { postId: number; invented?: boolean } | undefined): string | undefined {
  if (!provider || !scene || !isRealPost(scene)) return undefined
  return getPostUrl(provider, scene.postId)
}
