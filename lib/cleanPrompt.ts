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

function loadTagsToRemove(category?: number): Set<string> {
  try {
    const tagsData = require("../tags.json")
    const tagsToRemove = new Set<string>()

    if (Array.isArray(tagsData)) {
      tagsData.forEach((tag: any) => {
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
  } catch (error) {
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

const ARTIST_TAGS_SET = loadTagsToRemove(1)
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

  // Aplicar mapeo de redundancia básico con cache
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
  const characterTagsSet = new Set(characterTagsArray)
  const copyrightTagsSet = new Set(copyrightTagsArray)

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

  // Always add "masterpiece" tag at the end
  if (!finalTags.includes("masterpiece")) {
    finalTags.push("masterpiece")
  }

  return finalTags.join(", ")
}
