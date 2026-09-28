/**
 * Plain vs. detailed background coherence for Pack Mode. A generated prompt
 * shouldn't say "white background" and also put the character in a classroom,
 * next to a table, or under fireworks.
 *
 * Location-vs-location is already covered by the slot constraints
 * (scenery:setting allows one tag per prompt); this adds what they miss:
 * a plain background against scenery props, sky/weather elements, and scene
 * tags whose slot isn't known.
 */
import { getTagSlotFromOverrides } from "../tag-taxonomy"
import { isBackgroundTag } from "../background-detector"

const PLAIN_BACKGROUND_RE =
  /^(simple|plain|white|black|grey|gray|red|blue|green|yellow|purple|pink|orange|brown|aqua|beige|cyan|teal|light blue|dark|multicolored|two-tone|gradient|transparent|solid color|monochrome|halftone|polka dot|striped|checkered|patterned|dotted|heart|star \(symbol\)|sparkle|abstract) background$/

/** Sky and weather: they place the scene outdoors, which a plain backdrop can't be. */
const SKY_RE = /\b(sky|skies|cloud|clouds|cloudy|stars?|starry|moon|sun|sunset|sunrise|fireworks|aurora|rain|snowing|rainbow|horizon)\b/
const SKY_EXACT = new Set([
  "sky", "blue sky", "night sky", "starry sky", "cloudy sky", "cloud", "clouds", "fireworks",
  "moon", "full moon", "crescent moon", "sun", "sunset", "sunrise", "aurora", "rainbow", "horizon", "rain",
])

/** "white background", "simple background", "gradient background"… — a backdrop with no scene. */
export function isPlainBackgroundTag(tag: string): boolean {
  const t = tag.toLowerCase().replace(/_/g, " ").trim()
  return t === "monochrome background" || PLAIN_BACKGROUND_RE.test(t)
}

/** A tag that puts the character somewhere: a location, scenery props, sky/weather. */
export function isSceneTag(tag: string, tagOverrides?: Record<string, string>): boolean {
  const t = tag.toLowerCase().replace(/_/g, " ").trim()
  if (isPlainBackgroundTag(t)) return false
  const slot = getTagSlotFromOverrides(t, tagOverrides)?.slot
  if (slot === "scenery:setting" || slot === "scenery:props") return true
  if (slot === "scenery:atmosphere") return SKY_RE.test(t)
  // Slot unknown: only exact scene keywords — a word match would catch "star earrings" or "sun hat".
  if (!slot) return (isBackgroundTag(t) && !t.endsWith(" background")) || SKY_EXACT.has(t)
  return false
}

/** True when `candidate` would pair a plain backdrop with a scene (either way round). */
export function conflictsWithBackground(
  candidate: string,
  existingTags: readonly string[],
  tagOverrides?: Record<string, string>
): boolean {
  if (isPlainBackgroundTag(candidate)) return existingTags.some((t) => isSceneTag(t, tagOverrides))
  if (isSceneTag(candidate, tagOverrides)) return existingTags.some((t) => isPlainBackgroundTag(t))
  return false
}
