/**
 * Refactored, robust prompt cleaner for Booru-style tags.
 * - Normalizes tags (lowercase, underscores -> spaces)
 * - Removes artist/meta/urls/numbers/symbol-only/noisy tags
 * - Optional optimization: combines adjectives for same noun and removes redundancies
 * - Preserves public API and output format from previous implementation
 */

import { classifyTags } from "./tag-classifier"
import { processBackgroundTags, BackgroundMode } from "./background-detector"

// --------------- Types ---------------
interface TagData {
  name: string
  category: number
  aliases?: string[]
}

// Curated list of common meta/utility tags to remove during cleaning
const FALLBACK_META_TAGS = [
  "signature", "twitter username", "artist name", "watermark", "copyright", 
  "artist", "unknown artist", "official art", "fan art", "commission", 
  "pointless censoring", "web address", "original", "sound effects", 
  "motion lines", "patreon logo", "copyright notice", "commissioner name", 
  "borrowed character", "borrowed character name", "bad id", "bad pixiv id",
  "request", "commentary", "translated", "highres", "absurdres", "translated"
];

export interface CleanPromptOptions {
  includeCharacters?: boolean
  includeCopyrights?: boolean
  optimizeTags?: boolean
  exclude?: string[]
  addedTags?: string[]
  tagOverrides?: Record<string, string>
  escapeOutput?: boolean
  metaTags?: string
  backgroundMode?: BackgroundMode
  simpleBackgroundReplacementTags?: string
  randomBackgroundPatterns?: boolean

  randomBackgroundIncludeGradients?: boolean
  detailedBackgroundsList?: string[][]
}

// --------------- Utilities ---------------
export const toSpace = (s: string) => s.replace(/_/g, " ")
export const toUnderscore = (s: string) => s.replace(/\s+/g, "_")

// Diccionario de auto-correcciones rapidas
const COMMON_TYPOS: Record<string, string> = {
  "1 girl": "1girl",
  "2 girls": "2girls",
  "3 girls": "3girls",
  "4 girls": "4girls",
  "5 girls": "5girls",
  "6 girls": "6girls",
  "1 boy": "1boy",
  "2 boys": "2boys",
  "3 boys": "3boys",
  "4 boys": "4boys",
  "5 boys": "5boys",
  "6 boys": "6boys",
}

export const normalize = (s: string) => {
  const norm = toSpace(s).toLowerCase().trim().replace(/\s{2,}/g, " ")
  
  const match = norm.match(/^([\[\(\{<]*\s*)(.*?)(\s*(?::\s*[\d.]+)?\s*[\]\)\}>]*)$/)
  if (match) {
    const prefix = match[1]
    const coreTag = match[2]
    const suffix = match[3]
    
    if (COMMON_TYPOS[coreTag]) {
      return prefix + COMMON_TYPOS[coreTag] + suffix
    }
  }
  
  return COMMON_TYPOS[norm] || norm
}
const escapeParentheses = (s: string) => s.replace(/\(/g, "\\(").replace(/\)/g, "\\)")

function withNormalizedVariants(list: string[]): Set<string> {
  const set = new Set<string>()
  for (const raw of list) {
    const space = normalize(raw)
    const under = toUnderscore(space)
    set.add(space)
    set.add(under)
  }
  return set
}

export function parseTagList(input: string): string[] {
  if (!input) return []
  const parts = input.includes(",") ? input.split(",") : input.trim().split(/\s+/)
  return parts.map((t) => t.trim()).filter(Boolean)
}

// --------------- Domain Sets ---------------
const BREAST_SIZES_SET = new Set([
  "flat chest",
  "small breasts",
  "medium breasts",
  "large breasts",
  "huge breasts",
  "gigantic breasts",
].map(normalize))

const HAIR_LENGTHS_SET = new Set([
  "bald",
  "very short hair",
  "short hair",
  "medium hair",
  "long hair",
  "very long hair",
  "absurdly long hair",
].map(normalize))

const EYE_COLORS_SET = new Set([
  "blue eyes",
  "brown eyes",
  "green eyes",
  "red eyes",
  "purple eyes",
  "yellow eyes",
  "pink eyes",
  "orange eyes",
  "black eyes",
  "white eyes",
  "gray eyes",
  "grey eyes",
].map(normalize))

export const QUALITY_TAGS_SET = new Set([
  "masterpiece",
  "best quality",
  "high quality",
  "ultra-detailed",
  "detailed",
  "extremely detailed",
  "highly detailed",
  "amazing quality",
  "newest",
  "beautiful lighting",
  "soft reflections",
  "amazing composition",
  "flat color",
].map(normalize))

const SUBJECT_TAGS_SET = new Set(
  ["1girl", "1boy", "2girls", "2boys", "multiple girls", "multiple boys"].map(normalize),
)

const COMPOSITION_TAGS_SET = new Set(
  ["portrait", "full body", "upper body", "close-up", "wide shot"].map(normalize),
)

// --------------- Meta tags (curated list) ---------------
function loadTagsToRemove(category?: number): Set<string> {
  // Category 5 is usually "Meta" in booru systems
  const tagsToRemove = new Set<string>()
  
  // We use a curated list instead of the 21MB JSON to keep the build light and stable
  for (const tag of FALLBACK_META_TAGS) {
    tagsToRemove.add(normalize(tag))
  }
  
  return tagsToRemove
}

// Representative list; variants (space/underscore) are auto-generated.
const CURATED_META_LIST = withNormalizedVariants([
  // resolution/commentary
  "highres",
  "absurdres",
  "commentary",
  "commentary request",
  "english commentary",
  "chinese commentary",
  "korean commentary",
  "mixed-language commentary",
  "partial commentary",
  "translated",
  "translation request",
  // common meme tag
  "one-hour drawing challenge",
  "one hour drawing challenge",
  // web/url/logo/ids
  "web address",
  "+web address+",
  "patreon logo",
  "copyright notice",
  "official art",
  "commission",
  "bad id",
  "bad pixiv id",
  "bad artstation id",
  "bad facebook id",
  "bad instagram id",
  "bad tiktok id",
  "bad reddit id",
  "bad github id",
  "bad discord id",
  "bad telegram id",
  "bad skype id",
  "bad other id",
  "bad twitter id",
  "photoshop (medium)",
  "symbol-only commentary",
  "artist request",
  "copyright request",
  "non-web source",
  "signature",
  "watermark",
  "artist name",
  "twitter username",
  "request",
  // backgrounds - disabled
  /*
  "white background",
  "red background",
  "gradient background",
  "purple background",
  "simple background",
  "solid background",
  "colored background",
  "black background",
  "blue background",
  "green background",
  "yellow background",
  "orange background",
  "pink background",
  "grey background",
  "gray background",
  "brown background",
  "beige background",
  "cream background",
  "abstract background",
  "plain background",
  "minimal background",
  "clean background",
  "empty background",
  "neutral background",
  "pastel background",
  "dark background",
  "light background",
  "vibrant background",
  "soft background",
  "blurred background",
  "bokeh background",
  "gradient",
  "solid color",
  "monochrome",
  "two-tone background",
  "geometric background",
  "pattern background",
  "texture background",
  */
  // text/logos/usernames
  "english text",
  "japanese text",
  "chinese text",
  "korean text",
  "text",
  "speech bubble",
  "dialogue",
  "subtitle",
  "caption",
  "logo",
  "brand logo",
  "company logo",
  "game logo",
  "anime logo",
  "manga logo",
  "instagram logo",
  "pixiv logo",
  "twitter logo",
  "ko fi logo",
  "ko-fi logo",
  "character name",
  "series name",
  "franchise name",
  "copyright name",
  "trademark",
  "patreon username",
  "pixiv username",
  "deviantart username",
  "artstation username",
  "instagram username",
  "facebook username",
  "bluesky username",
  "tumblr username",
  "discord username",
  "username",
  "handle",
  "inactive account",
  "deleted account",
  "banned account",
  "virtual youtuber",
  "vtuber",
  "streamer",
  "content creator",
  // social platform watermarks
  "weibo watermark",
  "tiktok watermark",
  "instagram watermark",
  "facebook watermark",
  "social media watermark",
  "website watermark",
  "url",
  "link",
  "qr code",
  "barcode",
  "metadata",
  "file info",
  "image info",
  "photo info",
  "camera info",
  "timestamp",
  "date",
  "time",
  // additional variants
  "artist logo",
 "pixiv request",
  "twitter request",
  "source request",
  "character request",
  "pool request",
  "post request",
  "source edit",
  "artist edit",
  "character edit",
  "copyright edit",
  "banned artist",
  "duplicate",
  "replaced",
  "repost",
  "inaccurate tag",
  "poorly drawn",
  "bad anatomy",
  "bad hands",
  "bad proportions",
  "bad perspective",
  "bad source",
  "missing tag",
  "partially translated",
  "check translation",
  "tagme",
  "tag request",
  "tag update",
  "needs tags",
  "needs source",
  "needs id",
  "needs commentary",
  "needs translation",
  "unneeded tag",
  "wrong tag",
  "deletion request",
  "hard translated",
  "partially hard translated",
  "third-party edit",
  "revision",
  "sample",
  "resized",
  "upscaled",
  "downscaled",
  "lossy-lossless",
  "jpeg artifacts",
  "compression artifacts",
  "alternate source",
  "secondary source",
  "copyright text",
  "watermark text",
  "logo text",
  "brand name",
  "company name",
  "studio name",
  "production name",
  "fanbox username",
  "gumroad username",
  "ko fi username",
  "ko-fi username",
  "subscribestar username",
  "fanbox watermark",
  "gumroad watermark",
  "ko fi watermark",
  "subscribestar watermark",
  "transparent background",
  "white background only",
  "solid color background",
  "single color background",
  "minimalist background",
  "empty space",
  "negative space",
  "simple color background",
  // censorship and variants
  "censored",
  "censorship",
  "bar",
  "mosaic",
  "blur",
  "pixelated",
  "censor",
  "uncensored",
  "decensor",
  "uncensored version",
  "censored version",
  "black bar",
  "white bar",
  "mosaic censorship",
  "pixel censorship",
  "light censorship",
  "heavy censorship",
  "partial censorship",
  "full censorship",
  "genital censor",
  "nipple censor",
  "penis censor",
  "vagina censor",
  "pussy censor",
  "ass censor",
  "butt censor",
  "breast censor",
  "nipple bar",
  "genital bar",
  "penis bar",
  "vagina bar",
  "pussy bar",
  "ass bar",
  "butt bar",
  "breast bar",
  "nipple blur",
  "genital blur",
  "penis blur",
  "vagina blur",
  "pussy blur",
  "ass blur",
  "butt blur",
  "breast blur",
  "nipple mosaic",
  "genital mosaic",
  "penis mosaic",
  "vagina mosaic",
  "pussy mosaic",
  "ass mosaic",
  "butt mosaic",
  "breast mosaic",
  "bar censor",
  "mosaic censor",
  "blur censor",
  "mosaic censoring",
  "censoring",
  "dated",
  "original",
  // Additional meta tags from Danbooru API (May 2026) — category 5 tags not previously covered
  "lowres",
  "variant set",
  "game asset",
  "partial commentary",
  "untranslatable commentary",
  "paid reward available",
  "traditional media",
  "md5 mismatch",
  "skeb commission",
  "large variant set",
  "third-party source",
  "animated", // meta tag for animated GIF/PNG, NOT the general tag
  "incredible absurdres",
  "nominated",
  "unlisted",
  "screencap",
  "video",
  "webm",
  "image",
  "flash",
  "uncompressed file",
  "colorized",
  "pre-rendered 3d",
])

export const META_TAGS_SET = new Set<string>([
  ...loadTagsToRemove(5),
  ...CURATED_META_LIST,
])

// --------------- Optimizations ---------------
function optimizeTags(tags: string[]): string[] {
  let working = [...tags]

  // Detectar múltiples sujetos (desactivar combinación de adjetivos en prendas)
  const subjectTagsInPrompt = working.filter((t) => SUBJECT_TAGS_SET.has(t))
  const subjectSet = new Set(subjectTagsInPrompt)
  const hasPluralSubject =
    subjectSet.has("2girls") ||
    subjectSet.has("2boys") ||
    subjectSet.has("multiple girls") ||
    subjectSet.has("multiple boys")
  const multipleDistinctSubjects = subjectSet.size > 1
  const disableCombination = hasPluralSubject || multipleDistinctSubjects

  // 1) Mantener solo la talla de pechos más específica
  const breastHierarchy = [
    "gigantic breasts",
    "huge breasts",
    "large breasts",
    "medium breasts",
    "small breasts",
    "flat chest",
  ].map(normalize)
  const presentBreasts = breastHierarchy.filter((b) => working.includes(b))
  if (presentBreasts.length > 1) {
    const bestBreast = presentBreasts[0]
    working = working.filter((t) => !BREAST_SIZES_SET.has(t) || t === bestBreast)
  }

  // 2) Dedupe hair length (keep first)
  const seenHair = new Set<string>()
  working = working.filter((t) => {
    if (!HAIR_LENGTHS_SET.has(t)) return true
    if (seenHair.has(t)) return false
    seenHair.add(t)
    return true
  })

  // 3) Dedupe eye colors (keep first)
  const seenEyes = new Set<string>()
  working = working.filter((t) => {
    if (!EYE_COLORS_SET.has(t)) return true
    if (seenEyes.has(t)) return false
    seenEyes.add(t)
    return true
  })

  // 4) Combinar adjetivos para el mismo sustantivo (si aplica)
  if (!disableCombination) {
    working = combineSharedNounTags(working)
  }

  // 5) Eliminar redundancias por inclusión
  working = removeRedundantByInclusion(working)

  return working
}

function combineSharedNounTags(original: string[]): string[] {
  const MERGE_NOUNS = new Set(
    [
      "skirt",
      "dress",
      "shirt",
      "jacket",
      "coat",
      "cape",
      "hat",
      "hood",
      "boots",
      "socks",
      "stockings",
      "gloves",
      "pants",
      "shorts",
      "leggings",
      "tights",
      "apron",
      "kimono",
      "yukata",
      "armor",
      "bikini",
      "swimsuit",
      "underwear",
      "panties",
      "bra",
      // Rasgo físico selectivo
      "hair", // (long hair + white hair -> long white hair)
    ].map(normalize),
  )

  interface GroupInfo {
    indices: number[]
    adjectives: string[]
  }

  const groups: Record<string, GroupInfo> = {}

  original.forEach((tag, idx) => {
    const parts = tag.split(" ")
    if (parts.length !== 2) return
    const [adj, noun] = parts
    if (!MERGE_NOUNS.has(normalize(noun))) return

    if (!groups[noun]) groups[noun] = { indices: [], adjectives: [] }
    groups[noun].indices.push(idx)
    if (!groups[noun].adjectives.includes(adj)) groups[noun].adjectives.push(adj)
  })

  const toSkip = new Set<number>()
  const insertionMap = new Map<number, string>()

  Object.entries(groups).forEach(([noun, info]) => {
    if (info.indices.length <= 1) return
    const combined = `${info.adjectives.join(" ")} ${noun}`.trim()
    const alreadyExists = original.some((t) => t === combined)
    if (alreadyExists) {
      info.indices.forEach((i) => toSkip.add(i))
      const combinedIndex = original.indexOf(combined)
      if (combinedIndex >= 0) toSkip.delete(combinedIndex)
    } else {
      insertionMap.set(info.indices[0], combined)
      info.indices.forEach((i) => toSkip.add(i))
    }
  })

  if (insertionMap.size === 0) return original

  const result: string[] = []
  original.forEach((tag, idx) => {
    if (insertionMap.has(idx)) result.push(insertionMap.get(idx)!)
    else if (!toSkip.has(idx)) result.push(tag)
  })
  return result
}

function removeRedundantByInclusion(tagList: string[]): string[] {
  // Sort longest tags first so potential parents are processed before children
  const items = tagList.map((t) => {
    const words = t.split(" ").map(w => w.trim()).filter(Boolean);
    return {
      tag: t,
      words,
      wordsSet: new Set(words)
    };
  });
  items.sort((a, b) => b.tag.length - a.tag.length);

  const keptSet = new Set<string>();
  const keptList: typeof items = [];

  for (const item of items) {
    if (keptSet.has(item.tag)) continue;

    // Check if the current item is fully covered by any already kept parent tag
    const isCovered = keptList.some(parent => {
      // Pre-filter: parent tag must contain the child tag as a substring
      // This is a fast character-level check and ensures contiguous/semantic relation
      if (!parent.tag.includes(item.tag)) return false;

      // Word-level check: every word in child must be a word in parent
      return item.words.every(w => parent.wordsSet.has(w));
    });

    if (!isCovered) {
      keptSet.add(item.tag);
      keptList.push(item);
    }
  }

  // Preserve original relative order of the tags
  return tagList.filter(t => keptSet.has(t));
}


// --------------- Main API ---------------
export function cleanPrompt(
  tagString: string,
  artistTags: string,
  characterTags: string,
  copyrightTags: string,
  options?: CleanPromptOptions,
): string {
  const includeCharacters = options?.includeCharacters !== false
  const includeCopyrights = options?.includeCopyrights !== false
  const optimizeAll = options?.optimizeTags !== false

  const userExcludeSet = new Set(
    (options?.exclude || [])
      .map((t) => normalize(t))
      .filter((t) => t.length > 0),
  )

  // Parse inputs
  let allTags = parseTagList(tagString)
  const artistTagsSet = new Set(parseTagList(artistTags).map((t) => normalize(t)))
  const characterTagsArray = parseTagList(characterTags)
  const copyrightTagsArray = parseTagList(copyrightTags)
  
  // Use meta tags from API if provided (via options), otherwise fallback to curated list
  const apiMetaTags = options?.metaTags ? parseTagList(options.metaTags) : []
  const apiMetaTagsSet = new Set(apiMetaTags.map(t => normalize(t)))

  // Sliding-window early removal for multi-word meta sequences when input is space-separated
  try {
    const multiWordRemovalBase = new Set<string>([
      ...Array.from(META_TAGS_SET).filter((t) => t.includes(" ")),
    ])
      // explicitly ensure both variants present
      ;["web address", "web_address"].forEach((v) => multiWordRemovalBase.add(normalize(v)))

    if (multiWordRemovalBase.size > 0 && allTags.length > 1) {
      const lowered = allTags.map((t) => normalize(t))
      const newTokens: string[] = []
      let i = 0
      while (i < lowered.length) {
        let matched = false
        for (let span = 4; span >= 2; span--) {
          if (i + span > lowered.length) continue
          const slice = lowered.slice(i, i + span)
          const candidateSpace = slice.join(" ")
          const candidateUnderscore = toUnderscore(candidateSpace)
          if (multiWordRemovalBase.has(candidateSpace) || multiWordRemovalBase.has(candidateUnderscore)) {
            i += span
            matched = true
            break
          }
        }
        if (!matched) {
          newTokens.push(allTags[i])
          i++
        }
      }
      if (newTokens.length !== allTags.length) allTags = newTokens
    }
  } catch {
    // ignore
  }

  const normalizedCharacterSet = new Set(
    characterTagsArray.map((t) => normalize(t)).filter((t) => t.length > 0),
  )
  const normalizedCopyrightSet = new Set(
    copyrightTagsArray.map((t) => normalize(t)).filter((t) => t.length > 0),
  )

  // Filtering rules
  const numberRegex = /^\d+$/
  const hasUrlLike = /:/ // simple heuristic for schemes
  const invalidBracket = /[(){}\[\]]/

  const filteredTags = allTags.filter((raw) => {
    if (raw.length <= 1) return false
    const lower = raw.toLowerCase()

    if (artistTagsSet.has(lower)) return false
    if (artistTagsSet.has(normalize(lower))) return false
    if (META_TAGS_SET.has(normalize(lower))) return false
    if (apiMetaTagsSet.has(normalize(lower))) return false
    if (numberRegex.test(raw)) return false
    if (raw.includes("@") || raw.includes("#") || hasUrlLike.test(raw)) return false
    if (invalidBracket.test(raw)) return false

    return true
  })

  // Normalize and apply user exclusions
  const formatted = filteredTags
    .map((t) => normalize(t))
    .filter((t) => !userExcludeSet.has(t))

  const processed = optimizeAll ? optimizeTags(formatted) : formatted

  // Partition quality vs content
  const qualityTags: string[] = []
  const contentTags: string[] = []
  for (const t of processed) {
    if (QUALITY_TAGS_SET.has(t)) qualityTags.push(t)
    else contentTags.push(t)
  }

  // Classify content tags to respect requested order:
  // Appearance -> Clothing -> Pose -> Scenery -> Other
  const classified = classifyTags(contentTags, options?.tagOverrides)
  let sortedContentTags = [
    ...classified.appearance,
    ...classified.clothing,
    ...classified.pose,
    ...classified.scenery,
    ...classified.other,
  ]

  // Optional: Process Backgrounds based on rules
  if (options?.backgroundMode && Array.isArray(sortedContentTags)) {
    sortedContentTags = processBackgroundTags(
      sortedContentTags,
      options.backgroundMode,
      options.simpleBackgroundReplacementTags,
      options.tagOverrides,
      {
        patternsEnabled: options.randomBackgroundPatterns,
        includeGradients: options.randomBackgroundIncludeGradients,
      },
      options.detailedBackgroundsList
    )
  }

  const characterAndFranchiseTags = [
    ...(includeCharacters ? characterTagsArray : []),
    ...(includeCopyrights ? copyrightTagsArray : []),
  ]
    .map((t) => normalize(t))
    .filter(Boolean)

  const allFinal = new Set<string>()

  // 1. User Added Tags
  const addedTagsProcessed = (options?.addedTags || [])
    // .flatMap((t) => parseTagList(t)) // Don't split spaces in added tags (fixes "red eyes" -> "red, eyes")
    .map((t) => normalize(t))
    .filter((t) => !userExcludeSet.has(t))

  for (const t of addedTagsProcessed) allFinal.add(t)

  // 2. Character / Copyright
  for (const t of characterAndFranchiseTags) {
    if (!userExcludeSet.has(t)) allFinal.add(t)
  }

  // 3. Content Tags (Ordered) + Quality Tags (at end)
  const combinedPre = [...sortedContentTags, ...qualityTags]

  for (const t of combinedPre) {
    if (!includeCharacters && normalizedCharacterSet.has(t)) continue
    if (!includeCopyrights && normalizedCopyrightSet.has(t)) continue
    if (!includeCharacters && (t.startsWith("official ") || t.startsWith("alternate "))) continue
    if (userExcludeSet.has(t)) continue
    allFinal.add(t)
  }

  const shouldEscape = options?.escapeOutput !== false

  return Array.from(allFinal)
    .map((t) => (shouldEscape ? escapeParentheses(t) : t))
    .join(", ")
}
