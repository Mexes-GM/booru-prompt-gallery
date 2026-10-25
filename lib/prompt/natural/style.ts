/**
 * How the picture is made. The medium opens a prose prompt ("A 3D render of
 * ...", "A greyscale anime-style illustration of ..."); art-style details close
 * it ("The artwork has anime coloring and a white outline."). The taxonomy's
 * style slot also holds tags that say nothing about rendering ("meme", "gyaru",
 * "polaroid photo"): those go where they belong or are left out, and an unknown
 * one stays a raw detail rather than "The artwork uses a meme style."
 */
import { capitalize, joinList, withArticle } from "./english"

// What the picture is, by the first tag that says so. The default is anime.
const MEDIA: [RegExp, string][] = [
  [/^(3d|3d \(artwork\)|3d render|blender \(medium\)|source filmmaker \(medium\)|koikatsu \(medium\)|mikumikudance \(medium\)|daz3d|daz studio|honey select)$/, "3D render"],
  [/^photo \(medium\)$/, "photograph"],
  [/^photorealistic$/, "photorealistic image"],
  [/^realistic$/, "realistic illustration"],
  [/^pixel art$/, "pixel art image"],
  [/^(sketch|rough sketch)$/, "sketch"],
  [/^lineart$/, "line drawing"],
  [/^watercolor \(medium\)$/, "watercolor painting"],
  [/^oil painting \(medium\)$/, "oil painting"],
  [/^acrylic paint \(medium\)$/, "acrylic painting"],
  [/^(pencil|graphite) \(medium\)$/, "pencil drawing"],
  [/^colored pencil \(medium\)$/, "colored pencil drawing"],
  [/^marker \(medium\)$/, "marker drawing"],
  [/^ink \(medium\)$/, "ink drawing"],
  [/^(traditional media|painting \(medium\))$/, "traditional painting"],
]
const DEFAULT_MEDIUM = "anime-style illustration"
// Comic layouts change what the picture is: "a two-panel anime-style comic".
const COMICS: Record<string, string> = { comic: "comic", "2koma": "two-panel comic", "3koma": "three-panel comic", "4koma": "four-panel comic", "multiple 4koma": "four-panel comic" }
// Greyscale implies monochrome on Danbooru; the narrower word wins.
const TONES = ["greyscale", "sepia", "monochrome"]

// Details of how it is drawn, as the object of "The artwork has ...".
const FEATURES: Record<string, string> = {
  "anime coloring": "anime coloring",
  "flat color": "flat colors",
  "cel shading": "cel shading",
  "halftone": "halftone shading",
  outline: "an outline",
  "white outline": "a white outline",
  "black outline": "a black outline",
  "drop shadow": "a drop shadow",
  "jaggy lines": "jagged lines",
  "no lineart": "no line art",
  "faux traditional media": "a hand-painted look",
  glitch: "a glitch effect",
  ornate: "ornate details",
}

/** Style-slot tags that are not about rendering, and what they are instead. */
export type Misfiled = { kind: "drop" } | { kind: "being" | "prop" | "mood"; text: string }
const MISFILED: Record<string, Misfiled> = {
  // About the post, not the picture.
  meme: { kind: "drop" },
  "animation meme": { kind: "drop" },
  parody: { kind: "drop" },
  dated: { kind: "drop" },
  "comic sans": { kind: "drop" },
  contemporary: { kind: "drop" },
  chuunibyou: { kind: "drop" },
  // Fashion: how the subject is dressed.
  gyaru: { kind: "being", text: "dressed in gyaru fashion" },
  "amesuku gyaru": { kind: "being", text: "dressed in gyaru fashion" },
  kogal: { kind: "being", text: "dressed as a kogal" },
  casual: { kind: "being", text: "dressed casually" },
  "cow print": { kind: "being", text: "wearing cow print" },
  // Things in the picture.
  "polaroid photo": { kind: "prop", text: "a polaroid photo" },
  fantasy: { kind: "mood", text: "a fantasy theme" },
}

/** "1990s (style)", "retro artstyle": an era or school to draw in. */
const ERA_RE = /^(.+?) ?(\(style\)| artstyle)$/

export interface StyleParts {
  /** "A greyscale anime-style illustration", without the subject. */
  medium: string
  /** "The artwork has anime coloring." and "It is drawn in a 1990s style.", or "". */
  sentence: string
  /** Misfiled tags placed elsewhere ("dressed in gyaru fashion"). */
  elsewhere: Exclude<Misfiled, { kind: "drop" }>[]
  /** Style tags no rule knows, kept verbatim. */
  raw: string[]
}

export function describeStyle(style: string[], layout: string[]): StyleParts {
  const has = (tag: string) => style.includes(tag)
  const base = style.map((t) => MEDIA.find(([re]) => re.test(t))?.[1]).find(Boolean)
  const comic = layout.map((t) => COMICS[t]).find(Boolean)
  const tone = TONES.find(has)
  const what = comic
    ? (base ? `${base.replace(/ (render|image|illustration|painting|drawing|photograph)$/, "")} ${comic}` : comic.replace(/comic$/, "anime-style comic"))
    : base ?? DEFAULT_MEDIUM
  const medium = capitalize(withArticle([tone, has("chibi") || has("chibi only") ? "chibi-style" : "", what].filter(Boolean).join(" ")))

  const features: string[] = []
  const eras: string[] = []
  const elsewhere: StyleParts["elsewhere"] = []
  const raw: string[] = []
  for (const tag of style) {
    if (MEDIA.some(([re]) => re.test(tag)) || TONES.includes(tag) || /^chibi( only)?$/.test(tag)) continue
    const misfiled = MISFILED[tag]
    if (misfiled) { if (misfiled.kind !== "drop") elsewhere.push(misfiled); continue }
    if (FEATURES[tag]) { features.push(FEATURES[tag]); continue }
    const era = tag.match(ERA_RE)
    if (era) { eras.push(withArticle(`${era[1]} style`)); continue }
    raw.push(tag)
  }
  const sentence = [
    features.length ? `The artwork has ${joinList(features)}.` : "",
    eras.length ? `It is drawn in ${joinList(eras)}.` : "",
  ].filter(Boolean).join(" ")
  return { medium, sentence, elsewhere, raw }
}

// Layout tags: the comic ones are the medium; the rest is what the frame holds.
const LAYOUT_WORDING: Record<string, string> = {
  "outside border": "a border around the picture",
  "reference inset": "an inset reference picture",
  "art program in frame": "an art program window",
}
const LAYOUT_STATES = new Set(["letterboxed", "pillarboxed"])

/** "The image is letterboxed, with a speech bubble and a yellow border." */
export function describeLayout(layout: string[]): string {
  const items = layout.filter((t) => !COMICS[t] && !LAYOUT_STATES.has(t))
    .map((t) => LAYOUT_WORDING[t] ?? (/ text$|lines$|^text$/.test(t) ? t : withArticle(t)))
  const states = layout.filter((t) => LAYOUT_STATES.has(t))
  if (states.length) return `The image is ${joinList(states)}${items.length ? `, with ${joinList(items)}` : ""}.`
  return items.length ? `The image includes ${joinList(items)}.` : ""
}

export const isComicLayout = (tag: string) => !!COMICS[tag]
