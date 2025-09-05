// Convertir arrays de categorías a Sets para búsquedas más rápidas
const BREAST_SIZES_SET = new Set([
  "flat chest",
  "small breasts",
  "medium breasts",
  "large breasts",
  "huge breasts",
  "gigantic breasts",
])

const HAIR_LENGTHS_SET = new Set([
  "bald",
  "very short hair",
  "short hair",
  "medium hair",
  "long hair",
  "very long hair",
  "absurdly long hair",
])

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
])

const QUALITY_TAGS_SET = new Set([
  "masterpiece",
  "best quality",
  "high quality",
  "ultra-detailed",
  "detailed",
  "extremely detailed",
  "highly detailed",
])

const SUBJECT_TAGS_SET = new Set(["1girl", "1boy", "2girls", "2boys", "multiple girls", "multiple boys"])

const COMPOSITION_TAGS_SET = new Set(["portrait", "full body", "upper body", "close-up", "wide shot"])


import tagsData from "../tags.json"

interface TagData {
  name: string;
  category: number;
  aliases?: string[];
}

function loadTagsToRemove(category?: number): Set<string> {
  try {
    const tagsToRemove = new Set<string>()

    if (Array.isArray(tagsData)) {
      tagsData.forEach((tag: TagData) => {
        if (category === undefined || tag.category === category) {
          tagsToRemove.add(tag.name.toLowerCase())
          if (tag.aliases && Array.isArray(tag.aliases)) {
            tag.aliases.forEach((alias: string) => {
              tagsToRemove.add(alias.toLowerCase())
            })
          }
        }
      })
    }

    return tagsToRemove
  } catch {
    return new Set([
      "signature",
      "twitter username",
      "artist name",
      "watermark",
      "copyright",
      "artist",
      "unknown artist",
      "official art",
      "fan art",
      "commission",
      "pointless censoring",
      "web address",
      "original",
      "sound effects",
      "motion lines",
      "patreon logo",
      "copyright notice",
      "commissioner name",
      "borrowed character",
      "borrowed character name",

    ])
  }
}

const META_TAGS_SET = loadTagsToRemove(5)

const commonMetaTags = new Set([
  "highres",
  "absurdres",
  "commentary",
  "commentary_request",
  "english_commentary",
  "chinese_commentary",
  "translated",
  "translation_request",
  "sample watermark",
  "copyright notice",
  "official_art",
  "commission",
  "bad_id",
  "bad_pixiv_id",
  "bad_artstation_id",
  "bad_facebook_id",
  "bad_instagram_id",
  "bad_tiktok_id",
  "bad_reddit_id",
  "bad_github_id",
  "bad_discord_id",
  "bad_telegram_id",
  "bad_skype_id",
  "bad_other_id",
  "bad_twitter_id",
  "photoshop_(medium)",
  "symbol-only_commentary",
  "artist_request",
  "copyright_request",
  "non-web_source",
  "signature",
  "watermark",
  "artist_name",
  "twitter_username",
  "request",
  // Tags de background que simplifican
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
  // Formato con guiones bajos (formato Danbooru)
  "white_background",
  "red_background",
  "gradient_background",
  "purple_background",
  "simple_background",
  "solid_background",
  "colored_background",
  "black_background",
  "blue_background",
  "green_background",
  "yellow_background",
  "orange_background",
  "pink_background",
  "grey_background",
  "gray_background",
  "brown_background",
  "beige_background",
  "cream_background",
  "abstract_background",
  "plain_background",
  "minimal_background",
  "clean_background",
  "empty_background",
  "neutral_background",
  "pastel_background",
  "dark_background",
  "light_background",
  "vibrant_background",
  "soft_background",
  "blurred_background",
  "bokeh_background",
  // Tags de texto y marcas de agua
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
  "character name",
  "series name",
  "franchise name",
  "copyright name",
  "trademark",
  "copyright notice",
  "patreon username",
  "pixiv username",
  "deviantart username",
  "artstation username",
  "instagram username",
  "facebook username",
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
  "influencer",
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
  // Formato con guiones bajos (formato Danbooru)
  "english_text",
  "japanese_text",
  "chinese_text",
  "korean_text",
  "speech_bubble",
  "character_name",
  "series_name",
  "franchise_name",
  "copyright_name",
  "artist_logo",
  "pixiv_request",
  "patreon_username",
  "pixiv_username",
  "deviantart_username",
  "artstation_username",
  "instagram_username",
  "facebook_username",
  "tumblr_username",
  "discord_username",
  "virtual_youtuber",
  "weibo_watermark",
  "tiktok_watermark",
  "instagram_watermark",
  "facebook_watermark",
  "social_media_watermark",
  "website_watermark",
  "qr_code",
  "file_info",
  "image_info",
  "photo_info",
  "camera_info",
  // Tags adicionales y variaciones
  "artist_logo",
  "pixiv_request",
  "twitter_request",
  "artist_name",
  "copyright_text",
  "watermark_text",
  "logo_text",
  "brand_name",
  "company_name",
  "studio_name",
  "production_name",
  "fanbox_username",
  "gumroad_username",
  "ko_fi_username",
  "subscribestar_username",
  "fanbox_watermark",
  "gumroad_watermark",
  "ko_fi_watermark",
  "subscribestar_watermark",
  "transparent_background",
  "white_background_only",
  "solid_color_background",
  "single_color_background",
  "minimalist_background",
  "empty_space",
  "negative_space",
  "simple_color_background",
  // Tags de censura
  "censored",
  "censorship",
  "bar",
  "mosaic",
  "blur",
  "pixelated",
  "censor",
  "uncensored",
  "decensor",
  "uncensored_version",
  "censored_version",
  "black_bar",
  "white_bar",
  "mosaic_censorship",
  "pixel_censorship",
  "light_censorship",
  "heavy_censorship",
  "partial_censorship",
  "full_censorship",
  "genital_censor",
  "nipple_censor",
  "penis_censor",
  "vagina_censor",
  "pussy_censor",
  "ass_censor",
  "butt_censor",
  "breast_censor",
  "nipple_bar",
  "genital_bar",
  "penis_bar",
  "vagina_bar",
  "pussy_bar",
  "ass_bar",
  "butt_bar",
  "breast_bar",
  "nipple_blur",
  "genital_blur",
  "penis_blur",
  "vagina_blur",
  "pussy_blur",
  "ass_blur",
  "butt_blur",
  "breast_blur",
  "nipple_mosaic",
  "genital_mosaic",
  "penis_mosaic",
  "vagina_mosaic",
  "pussy_mosaic",
  "ass_mosaic",
  "butt_mosaic",
  "breast_mosaic",
  // Formato con guiones bajos
  "censored",
  "censorship",
  "black_bar",
  "white_bar",
  "mosaic_censorship",
  "pixel_censorship",
  "light_censorship",
  "heavy_censorship",
  "partial_censorship",
  "full_censorship",
  "genital_censor",
  "nipple_censor",
  "penis_censor",
  "vagina_censor",
  "pussy_censor",
  "ass_censor",
  "butt_censor",
  "breast_censor",
  "nipple_bar",
  "genital_bar",
  "penis_bar",
  "vagina_bar",
  "pussy_bar",
  "ass_bar",
  "butt_bar",
  "breast_bar",
  "nipple_blur",
  "genital_blur",
  "penis_blur",
  "vagina_blur",
  "pussy_blur",
  "ass_blur",
  "butt_blur",
  "breast_blur",
  "nipple_mosaic",
  "genital_mosaic",
  "penis_mosaic",
  "vagina_mosaic",
  "pussy_mosaic",
  "ass_mosaic",
  "butt_mosaic",
  "breast_mosaic",
  // Variaciones adicionales con guiones bajos
  "censored",
  "censorship",
  "black_bar",
  "white_bar",
  "mosaic_censorship",
  "pixel_censorship",
  "light_censorship",
  "heavy_censorship",
  "partial_censorship",
  "full_censorship",
  "genital_censor",
  "nipple_censor",
  "penis_censor",
  "vagina_censor",
  "pussy_censor",
  "ass_censor",
  "butt_censor",
  "breast_censor",
  "nipple_bar",
  "genital_bar",
  "penis_bar",
  "vagina_bar",
  "pussy_bar",
  "ass_bar",
  "butt_bar",
  "breast_bar",
  "nipple_blur",
  "genital_blur",
  "penis_blur",
  "vagina_blur",
  "pussy_blur",
  "ass_blur",
  "butt_blur",
  "breast_blur",
  "nipple_mosaic",
  "genital_mosaic",
  "penis_mosaic",
  "vagina_mosaic",
  "pussy_mosaic",
  "ass_mosaic",
  "butt_mosaic",
  "breast_mosaic",
  "uncensored",
  "decensored",
  "decensor",
  "uncensored_version",
  "censored_version",
  "pixelated",
  "bar_censor",
  "mosaic_censor",
  "blur_censor",
  "mosaic censoring",
  "mosaic_censoring",
  "mosaic_censorship",
  "censoring",
  "dated",
  "original",
  ])

// Procesa y optimiza los tags (combina variantes y elimina redundancias)
function optimizeTags(tags: string[]): string[] {
  // Copia para preservar orden original salvo eliminaciones / combinaciones
  let working = [...tags]

  // Detectar múltiples sujetos (desactivar combinación de adjetivos en prendas)
  const subjectTagsInPrompt = working.filter((t) => SUBJECT_TAGS_SET.has(t))
  const subjectSet = new Set(subjectTagsInPrompt)
  const hasPluralSubject = subjectSet.has("2girls") || subjectSet.has("2boys") || subjectSet.has("multiple girls") || subjectSet.has("multiple boys")
  const multipleDistinctSubjects = subjectSet.size > 1
  const disableCombination = hasPluralSubject || multipleDistinctSubjects

  // Combina tags que comparten el mismo sustantivo final (white skirt + long skirt -> white long skirt)
  function combineSharedNounTags(original: string[]): string[] {
    // Nombres de prendas / rasgos donde tiene sentido combinar adjetivos
    const MERGE_NOUNS = new Set([
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
      // Rasgos físicos selectivos
      "hair", // (long hair + white hair -> long white hair)
      // OJO: evitamos "eyes" para no crear combinaciones incoherentes (blue green eyes)
    ])

    interface GroupInfo {
      indices: number[]
      adjectives: string[]
    }

    const groups: Record<string, GroupInfo> = {}

    original.forEach((tag, idx) => {
      const parts = tag.split(" ")
      // Solo considerar tags de exactamente dos palabras (adjetivo + sustantivo) para reducir combinaciones erróneas
      if (parts.length !== 2) return
      const [adj, noun] = parts
      if (!MERGE_NOUNS.has(noun)) return

      if (!groups[noun]) {
        groups[noun] = { indices: [], adjectives: [] }
      }
      groups[noun].indices.push(idx)
      if (!groups[noun].adjectives.includes(adj)) groups[noun].adjectives.push(adj)
    })

    // Construir nuevo array respetando orden original
    const toSkip = new Set<number>()
    const insertionMap = new Map<number, string>() // index inicial -> combinedTag

    Object.entries(groups).forEach(([noun, info]) => {
      if (info.indices.length <= 1) return // nada que combinar
      // Construir tag combinado
      const combined = `${info.adjectives.join(" ")} ${noun}`.trim()
      // Evitar crear tag idéntico redundante (si ya existe multi adjetivo con todos)
      const alreadyExists = original.some((t) => t === combined)
      if (alreadyExists) {
        // Simplemente eliminamos las variantes individuales duplicadas menos la más completa existente
        // Mantener primera ocurrencia del combinado (ya está) y saltar las demás individuales
        info.indices.forEach((i) => toSkip.add(i))
        // Encontrar índice del combinado y quitar de skip para conservarlo
        const combinedIndex = original.indexOf(combined)
        if (combinedIndex >= 0) toSkip.delete(combinedIndex)
      } else {
        // Insertar en posición de la primera ocurrencia
        insertionMap.set(info.indices[0], combined)
        // Saltar todas las individuales
        info.indices.forEach((i) => toSkip.add(i))
      }
    })

    if (insertionMap.size === 0) return original // No hubo cambios

    const result: string[] = []
    original.forEach((tag, idx) => {
      if (insertionMap.has(idx)) {
        result.push(insertionMap.get(idx)!)
      } else if (!toSkip.has(idx)) {
        result.push(tag)
      }
    })
    return result
  }

  // Eliminación y consolidación específicas manteniendo orden
  // 1. Breast sizes (mantener la más específica según jerarquía si hay varias)
  const breastHierarchy = [
    "gigantic breasts",
    "huge breasts",
    "large breasts",
    "medium breasts",
    "small breasts",
    "flat chest",
  ]
  const presentBreasts = breastHierarchy.filter((b) => working.includes(b))
  if (presentBreasts.length > 1) {
    const bestBreast = presentBreasts[0]
    working = working.filter((t) => !BREAST_SIZES_SET.has(t) || t === bestBreast)
  }

  // 2. Hair length: eliminar duplicados conservando primera aparición
  const seenHair = new Set<string>()
  working = working.filter((t) => {
    if (!HAIR_LENGTHS_SET.has(t)) return true
    if (seenHair.has(t)) return false
    seenHair.add(t)
    return true
  })

  // 3. Eye colors: eliminar duplicados conservando primera aparición
  const seenEyes = new Set<string>()
  working = working.filter((t) => {
    if (!EYE_COLORS_SET.has(t)) return true
    if (seenEyes.has(t)) return false
    seenEyes.add(t)
    return true
  })

  // 4. Combinar variantes con mismo sustantivo (solo si permitido)
  let intermediate = working
  if (!disableCombination) {
    intermediate = combineSharedNounTags(intermediate)
  }

  // 5. Eliminar redundancias por inclusión manteniendo orden estable
  intermediate = removeRedundantTags(intermediate)
  return intermediate
  
  // Sistema robusto de eliminación de redundancia por especificidad (estable)
  function removeRedundantTags(tagList: string[]): string[] {
    const toRemove = new Set<number>()
    const wordsCache = tagList.map((t) => t.split(" "))
    for (let i = 0; i < tagList.length; i++) {
      if (toRemove.has(i)) continue
      for (let j = 0; j < tagList.length; j++) {
        if (i === j) continue
        if (tagList[j] !== tagList[i] && tagList[j].includes(tagList[i])) {
          const wordsI = wordsCache[i]
          const wordsJ = wordsCache[j]
          const allIn = wordsI.every((w) => wordsJ.includes(w))
          if (allIn) {
            toRemove.add(i)
            break
          }
        }
      }
    }
    return tagList.filter((_, idx) => !toRemove.has(idx))
  }
}

export function cleanPrompt(
  tagString: string,
  artistTags: string,
  characterTags: string,
  copyrightTags: string,
  options?: {
    includeCharacters?: boolean
    includeCopyrights?: boolean
    optimizeTags?: boolean // activa/desactiva TODA la optimización (combinar + limpiar redundancias)
    exclude?: string[] // lista de tags que el usuario desea eliminar manualmente
  },
): string {
  const includeCharacters = options?.includeCharacters !== false
  const includeCopyrights = options?.includeCopyrights !== false
  const optimizeAll = options?.optimizeTags !== false // por defecto ON
  const userExcludeSet = new Set(
    (options?.exclude || [])
      .map((t) => t.replace(/_/g, " ").toLowerCase().trim())
      .filter((t) => t.length > 0),
  )
  const allTags = tagString.split(" ").filter((tag) => tag.length > 0)
  const artistTagsSet = new Set(artistTags.split(" "))
  const characterTagsArray = characterTags.split(" ").filter((tag) => tag.length > 0)
  const copyrightTagsArray = copyrightTags.split(" ").filter((tag) => tag.length > 0)
  // Normalizados para comparación posterior
  const normalizedCharacterSet = new Set(
    characterTagsArray.map((t) => t.replace(/_/g, " ").toLowerCase().trim()).filter((t) => t.length > 0),
  )
  const normalizedCopyrightSet = new Set(
    copyrightTagsArray.map((t) => t.replace(/_/g, " ").toLowerCase().trim()).filter((t) => t.length > 0),
  )

  const numberRegex = /^\d+$/
  const urlRegex = /:/

  const filteredTags = allTags.filter((tag) => {
    if (tag.length <= 1) return false
    const lowerTag = tag.toLowerCase()

    if (artistTagsSet.has(lowerTag)) return false
    if (META_TAGS_SET.has(lowerTag)) return false
    if (commonMetaTags.has(lowerTag)) return false

    if (numberRegex.test(tag)) return false
    if (tag.includes("@") || tag.includes("#") || urlRegex.test(tag)) return false
    if (
      tag.includes("(") ||
      tag.includes(")") ||
      tag.includes("{") ||
      tag.includes("}") ||
      tag.includes("[") ||
      tag.includes("]")
    )
      return false

    return true
  })

  const formattedTags = filteredTags
    .map((tag) => tag.replace(/_/g, " ").toLowerCase().trim())
    .filter((tag) => !userExcludeSet.has(tag)) // exclusiones tempranas
  const processedTags = optimizeAll ? optimizeTags(formattedTags) : formattedTags

  const qualityTags: string[] = []
  const contentTags: string[] = []

  for (const tag of processedTags) {
    if (QUALITY_TAGS_SET.has(tag)) {
      qualityTags.push(tag)
    } else {
      contentTags.push(tag)
    }
  }

  const sortedContentTags = contentTags.sort((a, b) => {
    const aIsSubject = SUBJECT_TAGS_SET.has(a)
    const bIsSubject = SUBJECT_TAGS_SET.has(b)
    const aIsComposition = COMPOSITION_TAGS_SET.has(a)
    const bIsComposition = COMPOSITION_TAGS_SET.has(b)

    if (aIsSubject && !bIsSubject) return -1
    if (!aIsSubject && bIsSubject) return 1
    if (aIsComposition && !bIsComposition) return -1
    if (!aIsComposition && bIsComposition) return 1

    return b.length - a.length
  })

  const characterAndFranchiseTags = [
    ...(includeCharacters ? characterTagsArray : []),
    ...(includeCopyrights ? copyrightTagsArray : []),
  ]
    .map((tag) => tag.replace(/_/g, " ").toLowerCase().trim())
    .filter((tag) => tag.length > 0)

  const allFinalTags = new Set<string>()
  characterAndFranchiseTags.forEach((tag) => allFinalTags.add(tag))

  // Si el usuario desactiva characters/copyrights, debemos removerlos también de las listas procesadas
  const combinedTagsPre = [...sortedContentTags, ...qualityTags]
  const combinedTags = combinedTagsPre.filter((tag) => {
    if (!includeCharacters && normalizedCharacterSet.has(tag)) return false
    if (!includeCopyrights && normalizedCopyrightSet.has(tag)) return false
    // Tratar variantes 'official ...' como parte de character para el toggle
    if (!includeCharacters && tag.startsWith("official ")) return false
    // Tratar variantes 'alternate ...' como parte de character para el toggle
    if (!includeCharacters && tag.startsWith("alternate ")) return false
    if (userExcludeSet.has(tag)) return false // exclusión manual posterior a optimización
    return true
  })
  combinedTags.forEach((tag) => {
    if (!allFinalTags.has(tag)) {
      allFinalTags.add(tag)
    }
  })

  const finalTags = Array.from(allFinalTags)

  return finalTags.join(", ")
}
