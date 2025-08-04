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

const REDUNDANCY_MAP: Record<string, string> = {
  breasts: "medium breasts",
  chest: "medium breasts",
  boobs: "medium breasts",
  hair: "hair",
  eyes: "eyes",
  clothing: "",
  clothes: "",
  outfit: "",
  sitting: "sitting",
  standing: "standing",
  lying: "lying",
  pose: "",
  smile: "smile",
  smiling: "smile",
  happy: "smile",
  sad: "sad",
  angry: "angry",
  surprised: "surprised",
  expression: "",
  face: "",
  head: "",
  body: "",
  skin: "",
  person: "",
  people: "",
  human: "",
  good: "",
  nice: "",
  cute: "cute",
  kawaii: "cute",
  adorable: "cute",
  pretty: "beautiful",
  gorgeous: "beautiful",
  stunning: "beautiful",
  girl: "1girl",
  boy: "1boy",
  woman: "1girl",
  man: "1boy",
}

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
  "official_art",
  "commission",
  "bad_id",
  "bad_pixiv_id",
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

function processRedundancy(tags: string[]): string[] {
  const processedTags: string[] = []
  const seenCategories = new Set<string>()

  // Sistema robusto de eliminación de redundancia por especificidad
  function removeRedundantTags(tagList: string[]): string[] {
    const result: string[] = []
    const tagSet = new Set<string>()

    // Ordenar por longitud (más específicos primero)
    const sortedTags = [...tagList].sort((a, b) => b.length - a.length)

    for (const tag of sortedTags) {
      if (tagSet.has(tag)) continue // Evitar duplicados

      let isRedundant = false

      // Verificar si este tag es redundante con alguno ya agregado
      for (const existingTag of result) {
        // Si el tag actual está completamente contenido en uno más específico, es redundante
        if (existingTag.includes(tag) && existingTag !== tag) {
          // Verificar que sea una redundancia real usando split una sola vez
          const tagWords = tag.split(" ")
          const existingWords = existingTag.split(" ")

          // Solo es redundante si todas las palabras del tag están en el existente
          const allWordsIncluded = tagWords.every((word) => existingWords.includes(word))

          if (allWordsIncluded) {
            isRedundant = true
            break
          }
        }
      }

      if (!isRedundant) {
        result.push(tag)
        tagSet.add(tag)
      }
    }

    return result
  }

  // Procesar tags de pechos usando Set
  const breastTags = tags.filter((tag) => BREAST_SIZES_SET.has(tag))
  if (breastTags.length > 0) {
    const breastHierarchy = [
      "gigantic breasts",
      "huge breasts",
      "large breasts",
      "medium breasts",
      "small breasts",
      "flat chest",
    ]
    const bestBreast = breastHierarchy.find((size) => breastTags.includes(size))
    if (bestBreast) {
      processedTags.push(bestBreast)
      seenCategories.add("breasts")
    }
  }

  // Procesar tags de pelo usando Set
  const hairTags = tags.filter((tag) => HAIR_LENGTHS_SET.has(tag))
  if (hairTags.length > 0) {
    const uniqueHairTags = [...new Set(hairTags)]
    processedTags.push(...uniqueHairTags)
    seenCategories.add("hair_length")
  }

  // Procesar color de ojos usando Set
  const eyeTags = tags.filter((tag) => EYE_COLORS_SET.has(tag))
  if (eyeTags.length > 0) {
    const uniqueEyeTags = [...new Set(eyeTags)]
    processedTags.push(...uniqueEyeTags)
    seenCategories.add("eye_color")
  }

  // Procesar el resto de tags con filtrado optimizado
  const remainingTags = tags.filter((tag) => {
    if (BREAST_SIZES_SET.has(tag) && seenCategories.has("breasts")) return false
    if (HAIR_LENGTHS_SET.has(tag) && seenCategories.has("hair_length")) return false
    if (EYE_COLORS_SET.has(tag) && seenCategories.has("eye_color")) return false
    return true
  })

  const mappedTags = remainingTags.map((tag) => REDUNDANCY_MAP[tag] ?? tag).filter((tag) => tag.length > 0)

  // Aplicar sistema robusto de eliminación de redundancia
  const cleanedTags = removeRedundantTags([...processedTags, ...mappedTags])

  return cleanedTags
}

export function cleanPrompt(
  tagString: string,
  artistTags: string,
  characterTags: string,
  copyrightTags: string,
): string {
  const allTags = tagString.split(" ").filter((tag) => tag.length > 0)
  const artistTagsSet = new Set(artistTags.split(" "))
  const characterTagsArray = characterTags.split(" ").filter((tag) => tag.length > 0)
  const copyrightTagsArray = copyrightTags.split(" ").filter((tag) => tag.length > 0)

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

  const formattedTags = filteredTags.map((tag) => tag.replace(/_/g, " ").toLowerCase().trim())
  const processedTags = processRedundancy(formattedTags)

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

  const characterAndFranchiseTags = [...characterTagsArray, ...copyrightTagsArray]
    .map((tag) => tag.replace(/_/g, " ").toLowerCase().trim())
    .filter((tag) => tag.length > 0)

  const allFinalTags = new Set<string>()
  characterAndFranchiseTags.forEach((tag) => allFinalTags.add(tag))

  const combinedTags = [...sortedContentTags, ...qualityTags]
  combinedTags.forEach((tag) => {
    if (!allFinalTags.has(tag)) {
      allFinalTags.add(tag)
    }
  })

  const finalTags = Array.from(allFinalTags)

  return finalTags.join(", ")
}
