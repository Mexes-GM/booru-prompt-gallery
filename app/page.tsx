"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Copy, Check, Loader2, RefreshCw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import Image from "next/image"

interface DanbooruPost {
  id: number
  file_url: string
  large_file_url: string
  preview_file_url: string
  tag_string: string
  tag_string_artist: string
  tag_string_character: string
  tag_string_copyright: string
  rating: string
  score: number
}

// Cache para requests de API
const API_CACHE = new Map<string, { data: DanbooruPost[]; timestamp: number }>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutos

// Pool de conexiones reutilizables
const REQUEST_POOL = {
  maxConcurrent: 3,
  activeRequests: 0,
  queue: [] as Array<() => void>,
}

// Configuración optimizada para Danbooru API
const API_CONFIG = {
  baseUrl: "https://danbooru.donmai.us",
  defaultParams: {
    limit: 20,
    only: "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,rating,score",
  },
  retryAttempts: 3,
  retryDelay: 1000,
  timeout: 10000,
}

// Convertir a Set para búsquedas más eficientes O(1)
const METATAGS_SET = new Set([
  "signature",
  "twitter username",
  "artist name",
  "artist logo",
  "pixiv request",
  "watermark",
  "virtual youtuber",
  "weibo watermark",
  "copyright",
  "character name",
  "inactive account",
  "copyright name",
  "english text",
  "patreon username",
  "artist signature",
  "logo",
  "username",
  "url",
  "website",
  "commission",
  "request",
  "patreon",
  "fanbox",
  "twitter",
  "pixiv",
  "deviantart",
  "tumblr",
  "commentary",
  "commentary request",
  "translated",
  "translation request",
  "check translation",
  "partial translation",
  "bad translation",
  "tagme",
  "revision",
  "md5 mismatch",
  "duplicate",
  "bad id",
  "bad link",
  "bad source",
  "source request",
  "artist request",
  "character request",
  "copyright request",
  "general",
  "sensitive",
  "questionable",
  "explicit",
  "banned artist",
  "third-party source",
  "official art",
  "scan",
  "traditional media",
  "sketch",
  "lineart",
  "monochrome",
  "greyscale",
  "sepia",
  "dated",
  "signed",
  "sample",
  "cropped",
  "letterboxed",
  "pillarboxed",
  "upscaled",
  "downscaled",
  "resized",
  "jpeg artifacts",
  "aliasing",
  "moiré",
  "text focus",
  "english",
  "japanese",
  "chinese",
  "korean",
  "spanish",
  "french",
  "german",
  "russian",
  "thai",
  "vietnamese",
  "portuguese",
  "highres",
  "absurdres",
  "lowres",
  "bad anatomy",
  "bad hands",
  "error",
  "missing fingers",
  "extra digits",
  "fewer digits",
  "worst quality",
  "low quality",
  "normal quality",
  "blurry",
  "bad feet",
  "missing arms",
  "missing legs",
  "extra arms",
  "extra legs",
  "mutated hands",
  "poorly drawn hands",
  "poorly drawn face",
  "mutation",
  "deformed",
  "ugly",
  "bad proportions",
  "extra limbs",
  "disfigured",
  "gross proportions",
  "malformed limbs",
  "fused fingers",
  "too many fingers",
  "long neck",
  "morbid",
  "mutilated",
  "out of frame",
  "cloned face",
  "text",
  "missing",
  "extra",
  "fewer",
  "bad",
  "worst",
  "low",
  "normal",
  "poor",
  "poorly",
  "gross",
  "malformed",
  "mutated",
  "mutilated",
  "deformed",
  "disfigured",
  "ugly",
  "morbid",
  "duplicate",
  "cloned",
  "fused",
  "blurry",
  "out of frame",
])

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

// Mapeo de redundancias - el valor reemplaza a la clave
const REDUNDANCY_MAP: Record<string, string> = {
  // Tamaños de pechos
  breasts: "medium breasts",
  chest: "medium breasts",
  boobs: "medium breasts",

  // Tamaños específicos de pechos
  "small breasts": "small breasts",
  "medium breasts": "medium breasts",
  "large breasts": "large breasts",
  "huge breasts": "huge breasts",

  // Pelo
  hair: "hair",
  "long hair": "long hair",
  "short hair": "short hair",
  "medium hair": "medium hair",
  "very long hair": "very long hair",

  // Ojos
  eyes: "eyes",
  "blue eyes": "blue eyes",
  "brown eyes": "brown eyes",
  "green eyes": "green eyes",
  "red eyes": "red eyes",
  "purple eyes": "purple eyes",
  "yellow eyes": "yellow eyes",
  "pink eyes": "pink eyes",
  "orange eyes": "orange eyes",

  // Ropa
  clothing: "",
  clothes: "",
  outfit: "",

  // Poses generales vs específicas
  sitting: "sitting",
  standing: "standing",
  lying: "lying",
  pose: "",

  // Expresiones
  smile: "smile",
  smiling: "smile",
  happy: "smile",
  sad: "sad",
  angry: "angry",
  surprised: "surprised",
  expression: "",

  // Anatomía redundante
  face: "",
  head: "",
  body: "",
  skin: "",

  // Términos genéricos
  girl: "1girl",
  boy: "1boy",
  woman: "1girl",
  man: "1boy",
  person: "",
  people: "",
  human: "",

  // Calidad redundante
  good: "",
  nice: "",
  cute: "cute",
  kawaii: "cute",
  adorable: "cute",
  pretty: "beautiful",
  gorgeous: "beautiful",
  stunning: "beautiful",
}

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

function cleanPrompt(tagString: string, artistTags: string, characterTags: string, copyrightTags: string): string {
  // Pre-procesar arrays una sola vez
  const allTags = tagString.split(" ").filter((tag) => tag.length > 0)
  const artistTagsSet = new Set(artistTags.split(" "))
  const characterTagsSet = new Set(characterTags.split(" "))
  const copyrightTagsSet = new Set(copyrightTags.split(" "))

  // Compilar regex una sola vez para mejor rendimiento
  const numberRegex = /^\d+$/
  const urlRegex = /:/

  // Primera pasada: filtrado optimizado con Sets
  const filteredTags = allTags.filter((tag) => {
    if (tag.length <= 1) return false
    if (artistTagsSet.has(tag)) return false // Solo eliminar tags de artista
    // NO eliminar characterTagsSet ni copyrightTagsSet
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

    const lowerTag = tag.toLowerCase()
    return !METATAGS_SET.has(lowerTag)
  })

  // Formatear tags una sola vez
  const formattedTags = filteredTags.map((tag) => tag.replace(/_/g, " ").toLowerCase().trim())

  // Procesar redundancias
  const processedTags = processRedundancy(formattedTags)

  // Separar tags de calidad del resto usando Set
  const qualityTags: string[] = []
  const contentTags: string[] = []

  for (const tag of processedTags) {
    if (QUALITY_TAGS_SET.has(tag)) {
      qualityTags.push(tag)
    } else {
      contentTags.push(tag)
    }
  }

  // Ordenar tags de contenido con Sets pre-compilados
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

  // Combinar: contenido + calidad al final
  const finalTags = [...sortedContentTags, ...qualityTags]

  // Si no hay tags de calidad pero había "masterpiece" en los tags originales, agregarlo
  if (qualityTags.length === 0 && allTags.some((tag) => tag.toLowerCase() === "masterpiece")) {
    finalTags.push("masterpiece")
  }

  // Después de procesar los tags, agregar:
  console.log("🏷️ Tags de calidad encontrados:", qualityTags)
  console.log("📝 Tags finales:", finalTags)

  // Combinar: contenido + calidad al final
  return finalTags.join(", ")
}

// Función para validar y limpiar queries de búsqueda
const validateAndCleanQuery = (query: string): string => {
  if (!query || query.trim() === "") {
    return "rating:safe score:>5"
  }

  // Limpiar caracteres problemáticos
  let cleanedQuery = query
    .replace(/[<>]/g, "") // Remover < >
    .replace(/\s+/g, " ") // Normalizar espacios
    .trim()

  // Validar longitud máxima (Danbooru tiene límites)
  if (cleanedQuery.length > 1000) {
    cleanedQuery = cleanedQuery.substring(0, 1000)
  }

  // Validar número de tags (máximo ~40 tags)
  const tags = cleanedQuery.split(" ").filter((tag) => tag.length > 0)
  if (tags.length > 40) {
    cleanedQuery = tags.slice(0, 40).join(" ")
  }

  return cleanedQuery
}

const fetchPosts = async (
  pageNum = 1,
  append = false,
  customTags = "",
  setLoading: any,
  setPosts: any,
  searchTags: any,
  toast: any,
  setIsSearching: any,
) => {
  setLoading(true)

  try {
    const searchQuery = customTags || searchTags
    const baseQuery = "rating:safe score:>5"
    const finalQuery = searchQuery ? `${baseQuery} ${searchQuery}` : baseQuery

    // Crear clave de cache única
    const cacheKey = `${finalQuery}-${pageNum}`

    // Verificar cache primero
    const cached = API_CACHE.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log("📦 Usando datos del cache")
      if (append) {
        setPosts((prev: DanbooruPost[]) => [...prev, ...cached.data])
      } else {
        setPosts(cached.data)
      }
      return
    }

    // Validar y limpiar tags antes de enviar
    const cleanedQuery = validateAndCleanQuery(finalQuery)

    // Construir URL optimizada con parámetros específicos
    const params = new URLSearchParams({
      ...API_CONFIG.defaultParams,
      page: pageNum.toString(),
      tags: cleanedQuery,
    })

    const url = `${API_CONFIG.baseUrl}/posts.json?${params}`

    // Implementar retry con backoff exponencial
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= API_CONFIG.retryAttempts; attempt++) {
      try {
        // Control de concurrencia
        await waitForSlot()

        console.log(`🌐 Fetching página ${pageNum} (intento ${attempt})`)

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout)

        REQUEST_POOL.activeRequests++

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "DanbooruPromptGenerator/1.0",
          },
        })

        clearTimeout(timeoutId)
        REQUEST_POOL.activeRequests--
        processQueue()

        if (!response.ok) {
          if (response.status === 429) {
            // Rate limit - esperar más tiempo
            const retryAfter = response.headers.get("Retry-After")
            const delay = retryAfter ? Number.parseInt(retryAfter) * 1000 : API_CONFIG.retryDelay * attempt
            console.log(`⏳ Rate limited, esperando ${delay}ms`)
            await sleep(delay)
            continue
          } else if (response.status === 422) {
            // Unprocessable Entity - problema con los tags
            console.log(`❌ Error 422: Tags inválidos o query malformada`)
            const errorText = await response.text()
            console.log(`Detalles del error:`, errorText)

            // Si es una búsqueda personalizada, intentar con query base
            if (searchQuery && searchQuery !== baseQuery) {
              console.log(`🔄 Intentando con query base sin tags personalizados`)
              const fallbackParams = new URLSearchParams({
                ...API_CONFIG.defaultParams,
                page: pageNum.toString(),
                tags: baseQuery,
              })
              const fallbackUrl = `${API_CONFIG.baseUrl}/posts.json?${fallbackParams}`

              const fallbackResponse = await fetch(fallbackUrl, {
                signal: controller.signal,
                headers: {
                  Accept: "application/json",
                  "User-Agent": "DanbooruPromptGenerator/1.0",
                },
              })

              if (fallbackResponse.ok) {
                const data: DanbooruPost[] = await fallbackResponse.json()
                const validPosts = data.filter(
                  (post) => post && post.file_url && !post.file_url.includes("deleted") && post.id && post.tag_string,
                )

                if (append) {
                  setPosts((prev: DanbooruPost[]) => [...prev, ...validPosts])
                } else {
                  setPosts(validPosts)
                }

                toast({
                  title: "Búsqueda modificada",
                  description: "Se usaron tags por defecto debido a un problema con la búsqueda personalizada",
                  variant: "default",
                })

                return
              }
            }

            throw new Error(`Tags inválidos o query malformada. Verifica la sintaxis de búsqueda.`)
          } else if (response.status >= 500) {
            // Error del servidor - reintentar
            throw new Error(`Error del servidor: ${response.status}`)
          } else {
            // Otros errores HTTP
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
        }

        const data: DanbooruPost[] = await response.json()

        // Filtrar y validar datos
        const validPosts = data.filter(
          (post) => post && post.file_url && !post.file_url.includes("deleted") && post.id && post.tag_string,
        )

        // Guardar en cache solo si es exitoso
        API_CACHE.set(cacheKey, {
          data: validPosts,
          timestamp: Date.now(),
        })

        // Limpiar cache viejo
        cleanOldCache()

        console.log(`✅ Obtenidos ${validPosts.length} posts válidos`)

        if (append) {
          setPosts((prev: DanbooruPost[]) => [...prev, ...validPosts])
        } else {
          setPosts(validPosts)
        }

        return // Éxito, salir del loop de retry
      } catch (error) {
        lastError = error as Error
        REQUEST_POOL.activeRequests = Math.max(0, REQUEST_POOL.activeRequests - 1)
        processQueue()

        if (error instanceof Error && error.name === "AbortError") {
          console.log(`⏰ Timeout en intento ${attempt}`)
        } else {
          console.log(`❌ Error en intento ${attempt}:`, error)
        }

        // No reintentar en errores 422 (son permanentes)
        if (error instanceof Error && error.message.includes("Tags inválidos")) {
          break
        }

        if (attempt < API_CONFIG.retryAttempts) {
          const delay = API_CONFIG.retryDelay * Math.pow(2, attempt - 1) // Backoff exponencial
          console.log(`🔄 Reintentando en ${delay}ms...`)
          await sleep(delay)
        }
      }
    }

    // Si llegamos aquí, todos los intentos fallaron
    throw lastError || new Error("Todos los intentos de conexión fallaron")
  } catch (error) {
    console.error("💥 Error final en fetchPosts:", error)
    toast({
      title: "Error de conexión",
      description: error instanceof Error ? error.message : "No se pudieron cargar las imágenes",
      variant: "destructive",
    })
  } finally {
    setLoading(false)
    setIsSearching(false)
  }
}

// Funciones auxiliares para optimización
const waitForSlot = (): Promise<void> => {
  return new Promise((resolve) => {
    if (REQUEST_POOL.activeRequests < REQUEST_POOL.maxConcurrent) {
      resolve()
    } else {
      REQUEST_POOL.queue.push(resolve)
    }
  })
}

const processQueue = () => {
  if (REQUEST_POOL.queue.length > 0 && REQUEST_POOL.activeRequests < REQUEST_POOL.maxConcurrent) {
    const next = REQUEST_POOL.queue.shift()
    if (next) next()
  }
}

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const cleanOldCache = () => {
  const now = Date.now()
  for (const [key, value] of API_CACHE.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      API_CACHE.delete(key)
    }
  }
}

// Prefetch de la siguiente página para mejor UX
const prefetchNextPage = async (
  page: number,
  searchTags: any,
  setPosts: any,
  setLoading: any,
  toast: any,
  setIsSearching: any,
) => {
  const nextPage = page + 1
  const searchQuery = searchTags
  const baseQuery = "rating:safe score:>5"
  const finalQuery = searchQuery ? `${baseQuery} ${searchQuery}` : baseQuery
  const cleanedQuery = validateAndCleanQuery(finalQuery)
  const cacheKey = `${cleanedQuery}-${nextPage}`

  // Solo prefetch si no está en cache
  if (!API_CACHE.has(cacheKey)) {
    try {
      const params = new URLSearchParams({
        ...API_CONFIG.defaultParams,
        page: nextPage.toString(),
        tags: cleanedQuery,
      })

      const url = `${API_CONFIG.baseUrl}/posts.json?${params}`

      await waitForSlot()
      REQUEST_POOL.activeRequests++

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "DanbooruPromptGenerator/1.0",
        },
      })

      REQUEST_POOL.activeRequests--
      processQueue()

      if (response.ok) {
        const data: DanbooruPost[] = await response.json()
        const validPosts = data.filter((post) => post && post.file_url && !post.file_url.includes("deleted"))

        API_CACHE.set(cacheKey, {
          data: validPosts,
          timestamp: Date.now(),
        })

        console.log(`🚀 Prefetch completado para página ${nextPage}`)
      } else if (response.status === 422) {
        console.log(`⚠️ Prefetch falló con error 422 - tags inválidos`)
      }
    } catch (error) {
      console.log("⚠️ Prefetch falló:", error)
    }
  }
}

export default function DanbooruPromptGenerator() {
  const [posts, setPosts] = useState<DanbooruPost[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [searchTags, setSearchTags] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const { toast } = useToast()

  const copyToClipboard = async (prompt: string, postId: number) => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopiedId(postId)
      toast({
        title: "¡Copiado!",
        description: "Prompt copiado al portapapeles",
      })
      setTimeout(() => setCopiedId(null), 2000)
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo copiar el prompt",
        variant: "destructive",
      })
    }
  }

  const loadMore = () => {
    const nextPage = page + 1
    setPage(nextPage)
    fetchPosts(nextPage, true, searchTags, setLoading, setPosts, searchTags, toast, setIsSearching)

    // Prefetch de la página siguiente
    setTimeout(() => {
      prefetchNextPage(page, searchTags, setPosts, setLoading, toast, setIsSearching)
    }, 1000)
  }

  const refresh = () => {
    setPage(1)
    fetchPosts(1, false, "", setLoading, setPosts, searchTags, toast, setIsSearching)
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchTags.trim()) {
      setIsSearching(true)
      setPage(1)
      fetchPosts(1, false, searchTags.trim(), setLoading, setPosts, searchTags, toast, setIsSearching)
    }
  }

  const clearSearch = () => {
    setSearchTags("")
    setPage(1)
    fetchPosts(1, false, "", setLoading, setPosts, searchTags, toast, setIsSearching)
  }

  useEffect(() => {
    fetchPosts(1, false, "", setLoading, setPosts, searchTags, toast, setIsSearching)

    // Prefetch después de cargar la primera página
    const timer = setTimeout(() => {
      prefetchNextPage(page, searchTags, setPosts, setLoading, toast, setIsSearching)
    }, 2000)

    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Danbooru Prompt Generator</h1>
          <p className="text-gray-600 mb-6">Genera prompts de alta calidad para IA a partir de imágenes de Danbooru</p>

          {/* Search Bar */}
          <div className="max-w-2xl mx-auto mb-6">
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="flex-1">
                <input
                  type="text"
                  value={searchTags}
                  onChange={(e) => setSearchTags(e.target.value)}
                  placeholder="Buscar por tags (ej: cat girl, blue eyes, long hair)"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <Button type="submit" disabled={loading || isSearching}>
                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Buscar"}
              </Button>
              {searchTags && (
                <Button type="button" variant="outline" onClick={clearSearch}>
                  Limpiar
                </Button>
              )}
            </form>
            {searchTags && (
              <p className="text-sm text-gray-500 mt-2">
                Buscando: <span className="font-medium">{searchTags}</span>
              </p>
            )}
          </div>

          <Button onClick={refresh} disabled={loading} variant="outline">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>

        {/* Gallery Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
          {posts.map((post) => {
            const cleanedPrompt = cleanPrompt(
              post.tag_string,
              post.tag_string_artist,
              post.tag_string_character,
              post.tag_string_copyright,
            )

            return (
              <Card key={post.id} className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
                <div className="relative bg-gray-100 h-80">
                  <Image
                    src={post.large_file_url || post.file_url}
                    alt={`Danbooru post ${post.id}`}
                    fill
                    className="object-contain"
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                    priority={posts.indexOf(post) < 4}
                  />
                </div>

                <CardContent className="p-4">
                  <div className="space-y-3">
                    <div className="bg-gray-50 p-3 rounded-lg max-h-32 overflow-y-auto">
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {cleanedPrompt || "No hay tags disponibles"}
                      </p>
                    </div>

                    <Button
                      onClick={() => copyToClipboard(cleanedPrompt, post.id)}
                      className="w-full"
                      variant={copiedId === post.id ? "default" : "outline"}
                      disabled={!cleanedPrompt}
                    >
                      {copiedId === post.id ? (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          ¡Copiado!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4 mr-2" />
                          Copiar Prompt
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Load More Button */}
        {posts.length > 0 && (
          <div className="text-center">
            <Button onClick={loadMore} disabled={loading} size="lg" className="px-8">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Cargando...
                </>
              ) : (
                "Cargar Más"
              )}
            </Button>
          </div>
        )}

        {/* Loading State */}
        {loading && posts.length === 0 && (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-purple-600" />
            <p className="text-gray-600">Cargando imágenes...</p>
          </div>
        )}
      </div>
    </div>
  )
}
