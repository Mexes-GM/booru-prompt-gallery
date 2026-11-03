/**
 * Card text for the Random outfit video. Every string is the site's own output
 * for this post, read from its card with default Customize prompt options
 * (Danbooru, NSFW off), changing only the Outfit settings named on each entry.
 * See README.md to collect them again after the converter or the outfit
 * library changes.
 */
export const OUTFIT_POST = {
  provider: "danbooru",
  id: 12450891,
  rating: "general",
  artist: "miyahara_takuya",
  image: "danbooru-12450891.jpg",
} as const

/** The tags every version shares, before and after the clothing. */
const HEAD = "kotobuki hisako, 1girl, brown eyes, brown hair, fang, light blush, side ponytail, single sidelock, solo"
const TAIL = "full body, leaning forward, looking at viewer, own hands together, sitting, invisible chair, simple background, white background"

export const OUTFIT_TAGS = {
  /** Outfit: Keep original. */
  original: "blue neckerchief, brown shoes, green sailor collar, green pleated skirt, kneehighs, loafers, long sleeves, school uniform, serafuku, undershirt, white shirt, white socks",
  /** Random outfit, default styles, Main pieces. */
  first: "dress, long sleeves, long skirt, grey skirt, high heels",
  /** Party switched off, Main pieces. */
  second: "cardigan, white shirt, black pants, brown shoes, loafers",
  /** Party switched off, Full outfit. */
  secondFull: "cardigan, white shirt, long sleeves, ribbed shirt, black pants, brown shoes, loafers, brown bag, handbag",
} as const

export const cardTags = (clothing: string) => `${HEAD}, ${clothing}, ${TAIL}`

/** Outfits the chosen styles can draw from (the count above the style tiles). */
export const OUTFIT_COUNTS = { defaults: 983, withoutParty: 947 } as const

/** FLUX.2 · Krea 2 with "Keep every detail", Party off, Full outfit. */
export const OUTFIT_FLUX2 =
  "An anime-style illustration of Kotobuki Hisako from Seitokai Ni Mo Ana wa Aru!, with brown hair, side ponytail, single sidelock and brown eyes. She is leaning forward, sitting on an invisible chair and looking at the viewer, with her hands clasped together. She is blushing lightly and is shown with her fangs visible. She wears a white ribbed-knit cardigan with a deep V-neckline, long sleeves and a button-down front, fitting snugly around the bust and waist and slightly loose through the sleeves. Solid, smooth black high-waisted wide-leg trousers with a flared cut. Brown leather loafers with a closed toe, a small buckle on each side, a slightly glossy finish and a chunky heel. A rectangular brown leather handbag with short handles and a smooth texture. It is set against a plain white background. The image is a full-body shot."

/** The outfit's own sentences inside OUTFIT_FLUX2 (a substring of it). */
export const OUTFIT_SENTENCES =
  "She wears a white ribbed-knit cardigan with a deep V-neckline, long sleeves and a button-down front, fitting snugly around the bust and waist and slightly loose through the sleeves. Solid, smooth black high-waisted wide-leg trousers with a flared cut. Brown leather loafers with a closed toe, a small buckle on each side, a slightly glossy finish and a chunky heel. A rectangular brown leather handbag with short handles and a smooth texture."

/**
 * Pack Mode, Clothing set to Outfit library (safe pack, Party off, Full
 * outfit): the first outfits of a real draw, as the pool chips show them.
 */
export const PACK_POOL = {
  total: 947,
  shown: 60,
  chips: [
    "bead necklace, blue skirt, camisole, coat, handbag, miniskirt, open clothes, pearl necklace, pleated skirt, sandals, shirt, white socks",
    "handbag, sandals, sarong, shirt, sunglasses",
    "black dress, chain, handbag, high heel sandals, long dress, necklace, polka dot, polka dot dress, sleeveless, sleeveless dress",
    "brown boots, earmuffs, grey dress, handbag, high heel boots, long dress, long sleeves, pantyhose, shoulder bag, sweater, sweater dress, turtleneck",
    "black bag, black pants, black shoes, coat, collared shirt, handbag, loafers, long sleeves, open clothes, pant suit, sweater vest, white shirt",
    "front-seamed legwear, handbag, high heel sandals, lace-trimmed thighhighs, miniskirt, pearl necklace, platform heels, platform sandals, red skirt, wedge heels, white shirt, white thighhighs",
  ],
} as const
