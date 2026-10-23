/**
 * Output profiles. Each one turns a scene into the prompt format a model
 * family was trained on:
 *
 * - anima: tags for identity, body, outfit and background (Danbooru vocabulary
 *   is what Anima anchors on), followed by a short prose block for the
 *   subject, pose, expression and framing, which tags express poorly.
 *   Tag order follows the model card: safety, count, character, series,
 *   @artist, general tags.
 * - flux2: prose only, most important first (subject and action, appearance,
 *   outfit, setting, light, camera, style), no quality or artist tags.
 */
import type { Scene, SceneSlot } from "./scene"
import { describeScene } from "./prose"
import { capitalize, joinList } from "./english"

export interface RenderResult {
  text: string
  /** Tags written verbatim because no phrase rule placed them. */
  rawTags: string[]
}

const RATING_TAGS: Record<string, string> = { g: "safe", s: "sensitive", q: "nsfw", e: "explicit" }

/** ComfyUI/A1111 read bare parentheses as weights. */
function escapeTag(tag: string): string {
  return tag.replace(/\(/g, "\\(").replace(/\)/g, "\\)")
}

const ANIMA_TAG_SLOTS: SceneSlot[] = [
  "demographics", "anatomy", "hair", "eyes",
  "outfit", "top", "bottom", "underwear", "legwear", "footwear", "headwear", "eyewear", "accents",
  "weapon", "handheld", "setting", "props", "atmosphere", "animal", "style", "layout",
]

export function renderAnima(scene: Scene, options: { qualityTags?: string[] } = {}): RenderResult {
  const prose = describeScene(scene)
  const tags = [
    ...(options.qualityTags ?? []),
    ...(scene.rating && RATING_TAGS[scene.rating] ? [RATING_TAGS[scene.rating]] : []),
    ...scene.subjectTags,
    ...scene.characterTags,
    ...scene.series.map((s) => s.toLowerCase()),
    ...scene.artists.map((a) => `@${a}`),
    ...ANIMA_TAG_SLOTS.flatMap((s) => scene.slots[s] ?? []),
    ...scene.camera.framing,
    ...scene.camera.angle,
    ...scene.unclassified,
  ].map(escapeTag)

  // Prose: who, what they do, how it is framed. Anima wants at least two sentences.
  const sentences = [
    prose.identity ? `${capitalize(prose.identity)}.` : "",
    prose.pose,
    prose.camera,
  ].filter(Boolean)
  // Pose tags no rule could phrase stay in the tag block so nothing is lost.
  const unclassified = new Set(scene.unclassified)
  const poseRaw = prose.raw.filter((t) => !unclassified.has(t))
  const tagBlock = [...tags, ...poseRaw.map(escapeTag)].join(", ")
  return {
    text: sentences.length ? `${tagBlock}. ${sentences.join(" ")}` : tagBlock,
    rawTags: poseRaw,
  }
}

export function renderFlux2(scene: Scene, options: { medium?: string } = {}): RenderResult {
  const prose = describeScene(scene)
  const medium = options.medium ?? "An anime-style illustration"
  const opening = prose.identity ? `${medium} of ${prose.identity}.` : `${medium}.`
  const sentences = [
    opening,
    prose.pose,
    prose.body,
    prose.clothing,
    prose.held,
    prose.setting,
    prose.lighting,
    prose.camera,
    prose.style,
    prose.extras,
    prose.raw.length ? `Additional details: ${joinList(prose.raw)}.` : "",
  ].filter(Boolean)
  return { text: sentences.join(" "), rawTags: prose.raw }
}
