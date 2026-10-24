/**
 * Everything the video shows as card text is a real converter output: each
 * string was read from the site's own card for this post (default Customize
 * prompt options, dark theme), one prompt format at a time. See README.md to
 * collect them again after the converter changes.
 */
export const POST = {
  provider: "danbooru",
  id: 5513008,
  rating: "general",
  artist: "maiii_(smaii_i)",
  image: "danbooru-5513008.jpg",
  /** Counts from the card's "Copy only" menu. */
  categoryCounts: { scenery: 2, pose: 5, clothing: 8, appearance: 8 },
} as const

export const PROMPTS = {
  tags: "aerith gainsborough, tifa lockhart, 2girls, back, black hair, brown hair, low-tied long hair, multiple girls, blue dress, bracelet, hair ribbon, jewelry, pink dress, pink ribbon, sleeveless dress, sundress, from behind, full body, looking at another, open mouth, standing, flower field, grass",
  anima: "safe, 2girls, multiple girls, aerith gainsborough, tifa lockhart, final fantasy vii remake, back, blue dress, sleeveless dress, sundress, jewelry, flower field, grass, full body, from behind. Aerith Gainsborough and Tifa Lockhart from Final Fantasy VII Remake. Aerith Gainsborough has brown hair, and wears a pink dress, a hair ribbon, a bracelet and a pink ribbon. Tifa Lockhart has black hair and low-tied long hair. They are standing and looking at another person, with their mouth open. The image is a full-body shot, seen from behind.",
  flux2: "An anime-style illustration of Aerith Gainsborough and Tifa Lockhart from Final Fantasy VII Remake. Aerith Gainsborough has brown hair, and wears a pink dress, a hair ribbon, a bracelet and a pink ribbon. Tifa Lockhart has black hair and low-tied long hair. They are standing and looking at another person, with their mouth open. Their back is visible. They wear a blue dress, a sleeveless dress, a sundress and jewelry. The background features a flower field and grass.",
  flux2Full: "An anime-style illustration of Aerith Gainsborough and Tifa Lockhart from Final Fantasy VII Remake. Aerith Gainsborough has brown hair, and wears a pink dress, a hair ribbon, a bracelet and a pink ribbon. Tifa Lockhart has black hair and low-tied long hair. They are standing and looking at another person, with their mouth open. Their back is visible. They wear a blue dress, a sleeveless dress, a sundress and jewelry. The background features a flower field and grass. The image is a full-body shot, seen from behind.",
} as const

/** The two sentences that describe one character each (substrings of PROMPTS.flux2). */
export const CHARACTER_SENTENCES = [
  { name: "Aerith Gainsborough", sentence: "Aerith Gainsborough has brown hair, and wears a pink dress, a hair ribbon, a bracelet and a pink ribbon." },
  { name: "Tifa Lockhart", sentence: "Tifa Lockhart has black hair and low-tied long hair." },
] as const

export const wordCount = (text: string) => text.trim().split(/\s+/).length
