// Datos de ejemplo escritos a mano para la vista previa del kit de Pack. Solo contenido seguro.
import type { CharacterInfo, ExampleBrief, SceneThumb, TagSuggestion } from "@/components/prompt-gallery/pack"

/** Taxonomía mínima para que addTag mande cada tag a su hueco. */
export const OVERRIDES: Record<string, string> = {
  "tifa lockhart": "other:character",
  "yor briar": "other:character",
  frieren: "other:character",
  "makima (chainsaw man)": "other:character",
  "black hair": "appearance:hair",
  "white hair": "appearance:hair",
  "red hair": "appearance:hair",
  "long hair": "appearance:hair",
  twintails: "appearance:hair",
  "red eyes": "appearance:eyes",
  "green eyes": "appearance:eyes",
  "pointy ears": "appearance:anatomy",
  bikini: "clothing:outfit",
  maid: "clothing:outfit",
  "school uniform": "clothing:outfit",
  "winter coat": "clothing:outfit",
  "witch hat": "clothing:headwear",
  "sun hat": "clothing:headwear",
  sandals: "clothing:footwear",
  "princess carry": "pose:interaction",
  "carrying person": "pose:interaction",
  sitting: "pose:posture",
  standing: "pose:posture",
  reading: "pose:gesture",
  "peace sign": "pose:gesture",
  running: "pose:kinetic",
  smile: "pose:expression",
  blush: "pose:expression",
  "from above": "pose:camera",
  "cowboy shot": "pose:camera",
  beach: "scenery:setting",
  classroom: "scenery:setting",
  library: "scenery:setting",
  "night sky": "scenery:atmosphere",
  "cherry blossoms": "scenery:atmosphere",
  book: "equipment:handheld",
  umbrella: "equipment:handheld",
  cat: "creature:animal",
}

const KIND: Record<string, string> = {
  other: "Character",
  appearance: "Look",
  clothing: "Clothing",
  pose: "Pose",
  scenery: "Place",
  equipment: "Object",
  creature: "Creature",
}

// Recuentos inventados, solo para ver cómo se alinean.
export const SUGGESTION_POOL: TagSuggestion[] = Object.entries(OVERRIDES).map(([name, slot], i) => ({
  name,
  kind: KIND[slot.split(":")[0]],
  count: Math.round(180000 / (i + 1.7)),
}))

export function suggest(query: string): TagSuggestion[] {
  const q = query.toLowerCase().replace(/_/g, " ").trim()
  if (!q) return []
  return SUGGESTION_POOL.filter((s) => s.name.includes(q)).slice(0, 8)
}

export const CHARACTER_INFO: Record<string, CharacterInfo> = {
  "tifa lockhart": { usualLook: ["black hair", "long hair", "red eyes"] },
  "yor briar": { usualLook: ["black hair", "red eyes", "hairband"] },
  frieren: { usualLook: ["white hair", "twintails", "green eyes", "pointy ears"] },
  "makima (chainsaw man)": { name: "Makima", usualLook: ["red hair", "braided ponytail", "ringed eyes"] },
}

export const OFFICIAL_OUTFITS = ["Advent Children", "Remake", "Sporty dress"]

/** Escenas de ejemplo: ids estables y números de post creíbles. */
export function makeScenes(count: number, offset = 0): SceneThumb[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + offset
    return { id: `scene-${n}`, postId: 4_800_000 + ((n * 7919) % 900_000) }
  })
}

export const SAMPLE_PROMPTS: string[][] = [
  ["1girl", "1boy", "tifa lockhart", "black hair", "long hair", "red eyes", "bikini", "princess carry", "beach", "ocean", "smile", "day"],
  ["1girl", "1boy", "tifa lockhart", "black hair", "red eyes", "bikini", "princess carry", "pool", "looking at viewer", "from side"],
  ["1girl", "1boy", "tifa lockhart", "long hair", "bikini", "princess carry", "sunset", "outdoors", "blush", "cowboy shot"],
  ["1girl", "1boy", "tifa lockhart", "black hair", "bikini", "princess carry", "night sky", "fireworks", "open mouth"],
  ["1girl", "1boy", "tifa lockhart", "red eyes", "bikini", "princess carry", "shore", "palm tree", "smile", "from above"],
]

export const SAMPLE_NATURAL =
  "A young woman with long black hair and red eyes, Tifa Lockhart, wears a bikini while a man carries her in his arms on a sunny beach, smiling at the viewer."

export const EXAMPLES: ExampleBrief[] = [
  { id: "frieren", parts: ["Frieren", "witch hat", "reading", "library"] },
  { id: "yor", parts: ["Yor Briar", "sun hat", "beach"] },
  { id: "makima", parts: ["Makima", "school uniform", "sitting", "classroom"] },
  { id: "tifa", parts: ["Tifa Lockhart", "bikini", "princess carry", "with 1 boy"] },
]

/** Las fichas de ejemplo como texto pegado, para repartirlas con briefFromPrompt. */
export const EXAMPLE_PROMPTS: Record<string, string> = {
  frieren: "frieren, witch hat, reading, library",
  yor: "yor briar, sun hat, beach",
  makima: "makima (chainsaw man), school uniform, sitting, classroom",
  tifa: "tifa lockhart, bikini, princess carry",
}
