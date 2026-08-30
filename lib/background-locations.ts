/**
 * Location metadata for the "Detailed Random" scenery dataset
 * (public/detailed-backgrounds.json).
 *
 * The dataset's 237 presets are variants of 30 canonical locations, and every
 * preset encodes its location in its first two scenery tags
 * ("indoors, bedroom, night, ..."). Everything a context-aware pick needs to
 * know about a location — how secluded it is — is therefore a property of those
 * 30 anchors, not of the 237 variants. Hence a 30-row table here instead of
 * metadata duplicated across every preset, and the dataset JSON stays untouched.
 *
 * Deliberately dependency-free: this module sits underneath
 * background-context.ts -> background-detector.ts -> cleanPrompt.ts, so
 * importing `normalize` from cleanPrompt would close an import cycle. The local
 * normalizer below matches cleanPrompt's for the shapes that reach here
 * (lowercase, underscores as spaces, collapsed whitespace).
 */

/** `"indoors, bedroom, ..."` -> `"indoors/bedroom"`. */
export type LocationId = string

/**
 * How secluded a location is — the axis that decides whether a background is
 * plausible for an explicit scene.
 *
 *  - `private`: enclosed, intimate, nobody else present by default.
 *  - `semi`: plausibly secluded — an empty classroom, a back alley, deep woods.
 *  - `public`: populated or fully exposed. A sex scene here reads as absurd,
 *    which is exactly the mismatch this table exists to prevent.
 */
export type Exposure = "private" | "semi" | "public"

export const LOCATION_EXPOSURE: Record<LocationId, Exposure> = {
  // ── Indoors ──
  "indoors/bedroom": "private",
  "indoors/bathroom": "private",
  "indoors/onsen": "private",
  "indoors/attic": "private",
  "indoors/love hotel room": "private",
  "indoors/dorm room": "private",
  "indoors/walk-in closet studio": "private",
  "indoors/living room": "semi",
  "indoors/kitchen": "semi",
  "indoors/classroom": "semi",
  "indoors/dungeon": "semi",
  "indoors/throne room": "semi",
  "indoors/space station interior": "semi",
  "indoors/changing room": "semi",
  "indoors/laundry room": "semi",
  "indoors/library": "public",
  "indoors/cafe interior": "public",

  // ── Outdoors ──
  "outdoors/alleyway": "semi",
  "outdoors/rooftop": "semi",
  "outdoors/forest": "semi",
  "outdoors/lakeside": "semi",
  "outdoors/ancient ruins": "semi",
  "outdoors/city street": "public",
  "outdoors/park": "public",
  "outdoors/garden": "public",
  "outdoors/beach": "public",
  "outdoors/coastal cliff": "public",
  "outdoors/mountain landscape": "public",
  "outdoors/countryside": "public",
  "outdoors/flower field": "public",
  "outdoors/snowy village": "public",
  "outdoors/medieval town": "public",
  "outdoors/castle": "public",
  "outdoors/desert": "public",
  "outdoors/futuristic city": "public",
}

/**
 * Booru scenery tag -> the dataset location(s) it points at.
 *
 * A tag may map to SEVERAL locations because booru vocabulary is genuinely
 * ambiguous ("sand" is a beach or a desert, "fountain" a park or a garden,
 * "palace" a throne room or a castle). Callers score locations by how many
 * hint tags support them, so an ambiguous tag contributes to every plausible
 * candidate instead of forcing one arbitrarily.
 *
 * Only tags that genuinely identify a PLACE belong here. Weather, time of day
 * and lighting are variant-level axes inside the dataset, not locations.
 */
export const LOCATION_HINT_TAGS: Record<string, LocationId[]> = {
  // ── indoors/bedroom ──
  bedroom: ["indoors/bedroom"],
  "bedroom background": ["indoors/bedroom"],
  bed: ["indoors/bedroom"],
  "on bed": ["indoors/bedroom"],
  "bed sheet": ["indoors/bedroom"],
  bedding: ["indoors/bedroom"],
  pillow: ["indoors/bedroom"],
  futon: ["indoors/bedroom"],
  nightstand: ["indoors/bedroom"],
  "canopy bed": ["indoors/bedroom"],
  dormitory: ["indoors/bedroom"],

  // ── indoors/living room ──
  "living room": ["indoors/living room"],
  sofa: ["indoors/living room"],
  couch: ["indoors/living room"],
  "on couch": ["indoors/living room"],
  "on sofa": ["indoors/living room"],
  "coffee table": ["indoors/living room"],
  television: ["indoors/living room"],
  tv: ["indoors/living room"],

  // ── indoors/kitchen ──
  kitchen: ["indoors/kitchen"],
  refrigerator: ["indoors/kitchen"],
  stove: ["indoors/kitchen"],
  cooking: ["indoors/kitchen"],
  countertop: ["indoors/kitchen"],
  "cutting board": ["indoors/kitchen"],

  // ── indoors/bathroom ──
  bathroom: ["indoors/bathroom"],
  bathtub: ["indoors/bathroom"],
  bathing: ["indoors/bathroom", "indoors/onsen"],
  shower: ["indoors/bathroom"],
  showering: ["indoors/bathroom"],
  toilet: ["indoors/bathroom"],

  // ── indoors/love hotel room ──
  "love hotel": ["indoors/love hotel room"],
  "love hotel room": ["indoors/love hotel room"],
  "heart-shaped bed": ["indoors/love hotel room"],
  "mirrored ceiling": ["indoors/love hotel room"],
  "jacuzzi": ["indoors/love hotel room"],
  "disco ball": ["indoors/love hotel room"],

  // ── indoors/dorm room ──
  "dorm room": ["indoors/dorm room"],
  "dormitory room": ["indoors/dorm room"],
  "loft bed": ["indoors/dorm room"],
  "bunk bed": ["indoors/dorm room"],
  "corkboard": ["indoors/dorm room"],

  // ── indoors/changing room ──
  "changing room": ["indoors/changing room"],
  "locker room": ["indoors/changing room"],
  "fitting room": ["indoors/changing room"],
  "dressing room": ["indoors/changing room"],
  "locker": ["indoors/changing room"],

  // ── indoors/walk-in closet studio ──
  "walk-in closet": ["indoors/walk-in closet studio"],
  "dressing closet": ["indoors/walk-in closet studio"],
  "wardrobe room": ["indoors/walk-in closet studio"],

  // ── indoors/laundry room ──
  "laundry room": ["indoors/laundry room"],
  "washing machine": ["indoors/laundry room"],
  "clothes dryer": ["indoors/laundry room"],
  "laundromat": ["indoors/laundry room"],

  // ── indoors/library ──
  library: ["indoors/library"],
  bookshelf: ["indoors/library"],
  bookshelves: ["indoors/library"],
  "stack of books": ["indoors/library"],
  "reading room": ["indoors/library"],

  // ── indoors/cafe interior ──
  cafe: ["indoors/cafe interior"],
  "coffee shop": ["indoors/cafe interior"],
  restaurant: ["indoors/cafe interior"],
  diner: ["indoors/cafe interior"],
  bar: ["indoors/cafe interior"],
  "bar (place)": ["indoors/cafe interior"],

  // ── indoors/classroom ──
  classroom: ["indoors/classroom"],
  blackboard: ["indoors/classroom"],
  chalkboard: ["indoors/classroom"],
  whiteboard: ["indoors/classroom"],
  "school desk": ["indoors/classroom"],
  school: ["indoors/classroom"],
  "lecture hall": ["indoors/classroom"],

  // ── indoors/attic ──
  attic: ["indoors/attic"],
  "storage room": ["indoors/attic"],

  // ── indoors/onsen ──
  onsen: ["indoors/onsen"],
  "hot spring": ["indoors/onsen"],
  "hot springs": ["indoors/onsen"],
  bathhouse: ["indoors/onsen"],
  sento: ["indoors/onsen"],

  // ── indoors/throne room ──
  throne: ["indoors/throne room"],
  "throne room": ["indoors/throne room"],
  "sitting on throne": ["indoors/throne room"],

  // ── indoors/dungeon ──
  dungeon: ["indoors/dungeon"],
  prison: ["indoors/dungeon"],
  "prison cell": ["indoors/dungeon"],
  catacombs: ["indoors/dungeon"],
  cave: ["indoors/dungeon"],
  cavern: ["indoors/dungeon"],

  // ── indoors/space station interior ──
  "space station": ["indoors/space station interior"],
  spaceship: ["indoors/space station interior"],
  "spacecraft interior": ["indoors/space station interior"],
  cockpit: ["indoors/space station interior"],

  // ── outdoors/city street ──
  city: ["outdoors/city street"],
  cityscape: ["outdoors/city street"],
  street: ["outdoors/city street"],
  sidewalk: ["outdoors/city street"],
  crosswalk: ["outdoors/city street"],
  road: ["outdoors/city street"],
  "on road": ["outdoors/city street"],
  skyscraper: ["outdoors/city street"],
  skyline: ["outdoors/city street"],
  storefront: ["outdoors/city street"],
  "vending machine": ["outdoors/city street"],
  "train station": ["outdoors/city street"],

  // ── outdoors/alleyway ──
  alley: ["outdoors/alleyway"],
  alleyway: ["outdoors/alleyway"],
  "back alley": ["outdoors/alleyway"],
  graffiti: ["outdoors/alleyway"],
  "alley wall": ["outdoors/alleyway"],

  // ── outdoors/rooftop ──
  rooftop: ["outdoors/rooftop"],
  roof: ["outdoors/rooftop"],
  balcony: ["outdoors/rooftop"],
  terrace: ["outdoors/rooftop"],
  "fire escape": ["outdoors/rooftop"],

  // ── outdoors/park ──
  park: ["outdoors/park"],
  playground: ["outdoors/park"],
  bench: ["outdoors/park"],
  "park bench": ["outdoors/park"],
  fountain: ["outdoors/park", "outdoors/garden"],

  // ── outdoors/garden ──
  garden: ["outdoors/garden"],
  greenhouse: ["outdoors/garden"],
  courtyard: ["outdoors/garden"],
  gazebo: ["outdoors/garden"],
  hedge: ["outdoors/garden"],
  "flower bed": ["outdoors/garden"],

  // ── outdoors/forest ──
  forest: ["outdoors/forest"],
  woods: ["outdoors/forest"],
  jungle: ["outdoors/forest"],
  "bamboo forest": ["outdoors/forest"],
  grove: ["outdoors/forest"],
  tree: ["outdoors/forest"],
  trees: ["outdoors/forest"],

  // ── outdoors/beach ──
  beach: ["outdoors/beach"],
  ocean: ["outdoors/beach"],
  sea: ["outdoors/beach"],
  shore: ["outdoors/beach"],
  seashore: ["outdoors/beach"],
  coast: ["outdoors/beach", "outdoors/coastal cliff"],
  sand: ["outdoors/beach", "outdoors/desert"],
  "sand floor": ["outdoors/beach"],
  "palm tree": ["outdoors/beach"],
  "beach umbrella": ["outdoors/beach"],
  "beach towel": ["outdoors/beach"],

  // ── outdoors/coastal cliff ──
  cliff: ["outdoors/coastal cliff"],
  cliffs: ["outdoors/coastal cliff"],
  lighthouse: ["outdoors/coastal cliff"],
  headland: ["outdoors/coastal cliff"],

  // ── outdoors/mountain landscape ──
  mountain: ["outdoors/mountain landscape"],
  mountains: ["outdoors/mountain landscape"],
  hill: ["outdoors/mountain landscape", "outdoors/countryside"],
  hills: ["outdoors/mountain landscape", "outdoors/countryside"],
  valley: ["outdoors/mountain landscape"],
  summit: ["outdoors/mountain landscape"],
  glacier: ["outdoors/mountain landscape", "outdoors/snowy village"],

  // ── outdoors/lakeside ──
  lake: ["outdoors/lakeside"],
  pond: ["outdoors/lakeside"],
  river: ["outdoors/lakeside"],
  riverbank: ["outdoors/lakeside"],
  lakeshore: ["outdoors/lakeside"],
  dock: ["outdoors/lakeside"],
  pier: ["outdoors/lakeside", "outdoors/beach"],

  // ── outdoors/countryside ──
  countryside: ["outdoors/countryside"],
  rural: ["outdoors/countryside"],
  farm: ["outdoors/countryside"],
  barn: ["outdoors/countryside"],
  "rice paddy": ["outdoors/countryside"],
  windmill: ["outdoors/countryside"],
  meadow: ["outdoors/countryside", "outdoors/flower field"],
  haystack: ["outdoors/countryside"],

  // ── outdoors/flower field ──
  "flower field": ["outdoors/flower field"],
  "field of flowers": ["outdoors/flower field"],
  "sunflower field": ["outdoors/flower field"],
  "lavender field": ["outdoors/flower field"],
  wildflowers: ["outdoors/flower field"],

  // ── outdoors/snowy village ──
  snow: ["outdoors/snowy village"],
  snowing: ["outdoors/snowy village"],
  snowscape: ["outdoors/snowy village"],
  blizzard: ["outdoors/snowy village"],
  winter: ["outdoors/snowy village"],
  icicle: ["outdoors/snowy village"],

  // ── outdoors/medieval town ──
  medieval: ["outdoors/medieval town"],
  cobblestone: ["outdoors/medieval town"],
  market: ["outdoors/medieval town"],
  marketplace: ["outdoors/medieval town"],
  plaza: ["outdoors/medieval town"],
  tavern: ["outdoors/medieval town"],

  // ── outdoors/castle ──
  castle: ["outdoors/castle"],
  fortress: ["outdoors/castle"],
  rampart: ["outdoors/castle"],
  battlement: ["outdoors/castle"],
  palace: ["outdoors/castle", "indoors/throne room"],

  // ── outdoors/ancient ruins ──
  ruins: ["outdoors/ancient ruins"],
  "ancient ruins": ["outdoors/ancient ruins"],
  monolith: ["outdoors/ancient ruins"],
  obelisk: ["outdoors/ancient ruins"],
  // The dataset has no dedicated Japanese shrine/temple location; ancient ruins
  // is the closest stone-architecture match. Worth revisiting if shrine
  // presets are ever authored.
  shrine: ["outdoors/ancient ruins"],
  temple: ["outdoors/ancient ruins"],

  // ── outdoors/desert ──
  desert: ["outdoors/desert"],
  "sand dune": ["outdoors/desert"],
  dune: ["outdoors/desert"],
  oasis: ["outdoors/desert"],
  cactus: ["outdoors/desert"],
  wasteland: ["outdoors/desert"],

  // ── outdoors/futuristic city ──
  futuristic: ["outdoors/futuristic city"],
  cyberpunk: ["outdoors/futuristic city"],
  "neon lights": ["outdoors/futuristic city"],
  hologram: ["outdoors/futuristic city"],
  "science fiction": ["outdoors/futuristic city"],
}

/** Matches cleanPrompt's `normalize` for the tag shapes that reach this module. */
function normalizeTagLocal(tag: string): string {
  return tag.replace(/_/g, " ").toLowerCase().trim().replace(/\s{2,}/g, " ")
}

/**
 * Derives a preset's location id from its scenery tags.
 *
 * Every authored preset starts with `indoors`/`outdoors` followed by the
 * location, so that prefix is the anchor. Returns null for a preset that
 * doesn't follow the convention — callers must treat an unknown location as
 * ineligible for gating purposes but still reachable through their fallback,
 * so a future dataset edit can never empty the candidate pool.
 */
export function locationIdOf(scenery: readonly string[]): LocationId | null {
  if (scenery.length < 2) return null
  const setting = normalizeTagLocal(scenery[0])
  if (setting !== "indoors" && setting !== "outdoors") return null
  return `${setting}/${normalizeTagLocal(scenery[1])}`
}

/** Exposure of a location id, or `public` when the id is unknown. */
export function exposureOf(id: LocationId | null): Exposure {
  if (!id) return "public"
  return LOCATION_EXPOSURE[id] ?? "public"
}

/**
 * Scores dataset locations by how many of the given tags point at them, and
 * returns the best-supported ones (all locations tied at the top score).
 *
 * Ties are returned rather than broken here so the caller still gets to pick
 * pseudo-randomly among equally plausible locations — that's what keeps
 * variety alive once the pool is narrowed.
 */
export function locationHintsFrom(tags: readonly string[]): LocationId[] {
  const scores = new Map<LocationId, number>()

  for (const tag of tags) {
    const ids = LOCATION_HINT_TAGS[normalizeTagLocal(tag)]
    if (!ids) continue
    // An ambiguous tag splits its weight so two half-votes never outrank one
    // unambiguous tag: "sand" alone shouldn't beat an explicit "beach".
    const weight = 1 / ids.length
    for (const id of ids) scores.set(id, (scores.get(id) ?? 0) + weight)
  }

  if (scores.size === 0) return []
  const best = Math.max(...scores.values())
  return [...scores.entries()].filter(([, score]) => score === best).map(([id]) => id)
}
