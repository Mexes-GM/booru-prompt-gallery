/**
 * Synthetic taxonomy, permanence data and posts for the scene engine tests.
 * Only neutral tags: nothing explicit and no real names.
 */
import type { BooruPost } from "../../lib/booru/types"
import { createPermanence, type PermanenceData } from "../../lib/pack/scene/permanence"
import type { SceneContext } from "../../lib/pack/scene/scene"

export const OVERRIDES: Record<string, string> = {
  "1girl": "appearance:demographics",
  "1boy": "appearance:demographics",
  "2girls": "appearance:demographics",
  solo: "appearance:demographics",
  hetero: "appearance:demographics",
  nurse: "appearance:demographics",
  elf: "appearance:demographics",
  hair: "appearance:hair",
  eyes: "appearance:eyes",
  "closed eyes": "appearance:eyes",
  breasts: "appearance:anatomy",
  horns: "appearance:anatomy",
  navel: "appearance:anatomy",
  beard: "appearance:anatomy",
  "muscular male": "appearance:anatomy",
  glasses: "clothing:eyewear",
  hat: "clothing:headwear",
  "maid outfit": "clothing:outfit",
  skirt: "clothing:bottom",
  shirt: "clothing:top",
  dress: "clothing:top",
  boots: "clothing:footwear",
  scarf: "clothing:accents",
  clothes: "clothing:outfit",
  standing: "pose:posture",
  sitting: "pose:posture",
  lying: "pose:posture",
  "on bed": "pose:posture",
  "on back": "pose:posture",
  "against wall": "pose:posture",
  "on rug": "pose:posture",
  "arms up": "pose:gesture",
  "skirt lift": "pose:gesture",
  "clothes lift": "pose:gesture",
  "open shirt": "clothing:top",
  hug: "pose:interaction",
  running: "pose:kinetic",
  smile: "pose:expression",
  blush: "pose:expression",
  "open mouth": "pose:expression",
  "looking at viewer": "pose:camera",
  "from above": "pose:camera",
  "from side": "pose:camera",
  "solo focus": "pose:camera",
  bed: "scenery:props",
  wall: "scenery:props",
  bedroom: "scenery:setting",
  indoors: "scenery:setting",
  outdoors: "scenery:setting",
  beach: "scenery:setting",
  park: "scenery:setting",
  sunset: "scenery:atmosphere",
  sword: "equipment:weapon",
  cat: "creature:animal",
  highres: "other:meta",
  comic: "other:style",
  "speech bubble": "other:layout",
  "test hero": "other:character",
  "test series": "other:copyright",
  "test artist": "other:artist",
  "unknown thing": "other:unclassified",
  "rare thing": "other:unclassified",
  "photo (medium)": "other:meta",
  "real life": "other:copyright",
}

export const PERMANENCE_DATA: PermanenceData = {
  version: 1,
  state: ["wet hair", "navel", "closed eyes"],
  composition: ["couple"],
  signature: ["glasses", "hat"],
  identity: ["elf", "lion boy"],
  relative: ["size difference", "interspecies"],
}

export function makeContext(overrides: Partial<SceneContext> = {}): SceneContext {
  return {
    overrides: OVERRIDES,
    permanence: createPermanence(PERMANENCE_DATA, OVERRIDES),
    subject: "girl",
    ...overrides,
  }
}

export function makePost(
  id: number,
  tags: string,
  extra: Partial<BooruPost> = {}
): BooruPost {
  return {
    id,
    file_url: "",
    large_file_url: "",
    preview_file_url: `https://example.test/${id}.jpg`,
    tag_string: tags,
    tag_string_artist: "",
    tag_string_character: "",
    tag_string_copyright: "",
    rating: "general",
    score: 0,
    width: 800,
    height: 1200,
    ...extra,
  }
}

export function makeAssert() {
  const counts = { passed: 0, failed: 0 }
  return {
    counts,
    assert(condition: boolean, label: string) {
      if (condition) counts.passed++
      else {
        counts.failed++
        console.error(`FAIL: ${label}`)
      }
    },
    done() {
      console.log(`\n${counts.passed} passed, ${counts.failed} failed`)
      if (counts.failed > 0) process.exit(1)
    },
  }
}
