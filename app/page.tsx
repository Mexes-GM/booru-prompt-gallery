"use client"

import type React from "react"
import { useState, useEffect, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Copy, Check, Loader2, RefreshCw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import Image from "next/image"
import { useInfinitePosts } from "@/lib/api-client"

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

// Client-side cache for immediate access
const LOCAL_CACHE = new Map<string, { data: DanbooruPost[]; timestamp: number }>()
const LOCAL_CACHE_DURATION = 2 * 60 * 1000 // 2 minutes

// API configuration and caching
const API_CONFIG = {
  baseUrl: "https://danbooru.donmai.us",
  timeout: 10000,
  retryAttempts: 3,
  retryDelay: 1000,
  maxConcurrent: 5,
  defaultParams: {
    limit: "20",
    tags: "",
  },
}

// Request pooling for rate limiting
const REQUEST_POOL = {
  activeRequests: 0,
  maxConcurrent: API_CONFIG.maxConcurrent,
  queue: [] as Array<() => void>,
}

// Global cache for API responses
const API_CACHE = new Map<string, { data: DanbooruPost[]; timestamp: number }>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

function loadTagsToRemove(category?: number): Set<string> {
  try {
    const tagsData = require('./../tags.json')
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
      "signature", "twitter username", "artist name", "watermark", "copyright",
      "artist", "unknown artist", "official art", "fan art", "commission"
    ])
  }
}

const ARTIST_TAGS_SET = loadTagsToRemove(1)
const META_TAGS_SET = loadTagsToRemove(5)

const commonMetaTags = new Set([
  "highres", "absurdres", "commentary", "commentary_request", "english_commentary",
  "chinese_commentary", "translated", "translation_request", "official_art",
  "commission", "bad_id", "bad_pixiv_id", "bad_twitter_id", "photoshop_(medium)",
  "symbol-only_commentary", "artist_request", "copyright_request", "non-web_source",
  "signature", "watermark", "artist_name", "twitter_username", "request"
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
  "blue eyes", "brown eyes", "green eyes", "red eyes", "purple eyes",
  "yellow eyes", "pink eyes", "orange eyes", "black eyes", "white eyes",
  "gray eyes", "grey eyes"
])

const QUALITY_TAGS_SET = new Set([
  "masterpiece", "best quality", "high quality", "ultra-detailed",
  "detailed", "extremely detailed", "highly detailed"
])

const SUBJECT_TAGS_SET = new Set(["1girl", "1boy", "2girls", "2boys", "multiple girls", "multiple boys"])

const COMPOSITION_TAGS_SET = new Set(["portrait", "full body", "upper body", "close-up", "wide shot"])

const REDUNDANCY_MAP: Record<string, string> = {
  breasts: "medium breasts", chest: "medium breasts", boobs: "medium breasts",
  hair: "hair", eyes: "eyes", clothing: "", clothes: "", outfit: "",
  sitting: "sitting", standing: "standing", lying: "lying", pose: "",
  smile: "smile", smiling: "smile", happy: "smile", sad: "sad", angry: "angry", surprised: "surprised", expression: "",
  face: "", head: "", body: "", skin: "", person: "", people: "", human: "",
  good: "", nice: "", cute: "cute", kawaii: "cute", adorable: "cute",
  pretty: "beautiful", gorgeous: "beautiful", stunning: "beautiful",
  girl: "1girl", boy: "1boy", woman: "1girl", man: "1boy"
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
  const allTags = tagString.split(" ").filter((tag) => tag.length > 0)
  const artistTagsSet = new Set(artistTags.split(" "))
  const characterTagsArray = characterTags.split(" ").filter(tag => tag.length > 0)
  const copyrightTagsArray = copyrightTags.split(" ").filter(tag => tag.length > 0)
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
    if (tag.includes("(") || tag.includes(")") || tag.includes("{") || tag.includes("}") || tag.includes("[") || tag.includes("]"))
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
    .map(tag => tag.replace(/_/g, " ").toLowerCase().trim())
    .filter(tag => tag.length > 0)

  const allFinalTags = new Set<string>()
  characterAndFranchiseTags.forEach(tag => allFinalTags.add(tag))
  
  const combinedTags = [...sortedContentTags, ...qualityTags]
  combinedTags.forEach(tag => {
    if (!allFinalTags.has(tag)) {
      allFinalTags.add(tag)
    }
  })

  const finalTags = Array.from(allFinalTags)

  if (qualityTags.length === 0 && allTags.some((tag) => tag.toLowerCase() === "masterpiece")) {
    finalTags.push("masterpiece")
  }

  return finalTags.join(", ")
}

// Función para validar y limpiar queries de búsqueda
const validateAndCleanQuery = (query: string, ratingFilter: string): string => {
  if (!query || query.trim() === "") {
    return ratingFilter ? `${ratingFilter} score:>5` : "score:>5"
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
  ratingFilter: string,
) => {
  setLoading(true)

  try {
    const searchQuery = customTags || searchTags
    const baseQuery = `${ratingFilter} score:>5`
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
    const cleanedQuery = validateAndCleanQuery(finalQuery, ratingFilter)

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
          const retryAfter = response.headers.get("Retry-After")
          const delay = retryAfter ? Number.parseInt(retryAfter) * 1000 : API_CONFIG.retryDelay * attempt
          await sleep(delay)
          continue
        } else if (response.status === 422) {
          if (searchQuery && searchQuery !== baseQuery) {
            const fallbackParams = new URLSearchParams({
              ...API_CONFIG.defaultParams,
              page: pageNum.toString(),
              tags: "rating:safe score:>5",
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
                setPosts((prev: DanbooruPost[]) => {
                  const existingIds = new Set(prev.map(p => p.id))
                  const newPosts = validPosts.filter(post => !existingIds.has(post.id))
                  return [...prev, ...newPosts]
                })
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
          throw new Error(`Error del servidor: ${response.status}`)
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        }

        const data: DanbooruPost[] = await response.json()

        const validPosts = data.filter(
          (post) => post && post.file_url && !post.file_url.includes("deleted") && post.id && post.tag_string,
        )

        API_CACHE.set(cacheKey, {
          data: validPosts,
          timestamp: Date.now(),
        })

        cleanOldCache()

        if (append) {
          setPosts((prev: DanbooruPost[]) => {
            const existingIds = new Set(prev.map(p => p.id))
            const newPosts = validPosts.filter(post => !existingIds.has(post.id))
            return [...prev, ...newPosts]
          })
        } else {
          setPosts(validPosts)
        }

        return // Éxito, salir del loop de retry
      } catch (error) {
        lastError = error as Error
        REQUEST_POOL.activeRequests = Math.max(0, REQUEST_POOL.activeRequests - 1)
        processQueue()

        if (error instanceof Error && error.message.includes("Tags inválidos")) {
          break
        }

        if (attempt < API_CONFIG.retryAttempts) {
          const delay = API_CONFIG.retryDelay * Math.pow(2, attempt - 1)
          await sleep(delay)
        }
      }
    }

    throw lastError || new Error("Todos los intentos de conexión fallaron")
  } catch (error) {
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

// Optimized data fetching with SWR and edge caching
const useOptimizedPosts = (searchTags: string, ratingFilter: string) => {
  const query = searchTags ? `${ratingFilter} score:>5 ${searchTags}` : `${ratingFilter} score:>5`
  
  const {
    data,
    error,
    size,
    setSize,
    isValidating,
    mutate,
  } = useInfinitePosts(query, ratingFilter)

  const posts = data ? data.flat() : []
  const isLoading = !data && !error
  const isLoadingMore = isLoading || (size > 0 && data && typeof data[size - 1] === "undefined")
  
  const loadMore = useCallback(() => {
    if (!isLoadingMore) {
      setSize(size + 1)
    }
  }, [setSize, size, isLoadingMore])

  const refresh = useCallback(() => {
    mutate()
  }, [mutate])

  return {
    posts,
    isLoading,
    isLoadingMore,
    loadMore,
    refresh,
    error,
    size,
  }
}

export default function DanbooruPromptGenerator() {
  const [searchTags, setSearchTags] = useState("")
  const [ratingFilter, setRatingFilter] = useState("rating:safe")
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const { toast } = useToast()

  const {
    data: pages,
    error,
    isLoading,
    isValidating,
    size,
    setSize,
  } = useInfinitePosts(searchTags, ratingFilter)
  
  const posts = pages ? pages.flat() : []
  const isLoadingMore = isValidating && size > 1
  const loadMore = () => setSize(size + 1)
  const refresh = () => setSize(1)

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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchTags.trim()) {
      refresh()
    }
  }

  const clearSearch = () => {
    setSearchTags("")
    refresh()
  }

  // Handle errors
  useEffect(() => {
    if (error) {
      toast({
        title: "Error de conexión",
        description: error.message || "No se pudieron cargar las imágenes",
        variant: "destructive",
      })
    }
  }, [error, toast])

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Danbooru Prompt Generator</h1>
          <p className="text-gray-600 mb-6">Genera prompts de alta calidad para IA a partir de imágenes de Danbooru</p>

          {/* Search Bar */}
          <div className="max-w-2xl mx-auto mb-6">
            <form onSubmit={handleSearch} className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <input
                    type="text"
                    value={searchTags}
                    onChange={(e) => setSearchTags(e.target.value)}
                    placeholder="Buscar por tags (ej: cat girl, blue eyes, long hair)"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Buscar"}
                </Button>
                {searchTags && (
                  <Button type="button" variant="outline" onClick={clearSearch}>
                    Limpiar
                  </Button>
                )}
              </div>
              
              {/* Rating Filter */}
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium text-gray-700">Filtro de contenido:</label>
                <select
                  value={ratingFilter}
                  onChange={(e) => setRatingFilter(e.target.value)}
                  className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="rating:safe">Safe</option>
                  <option value="rating:questionable">Questionable</option>
                  <option value="rating:explicit">Explicit</option>
                  <option value="">Todos</option>
                </select>
              </div>
            </form>
            {searchTags && (
              <p className="text-sm text-gray-500 mt-2">
                Buscando: <span className="font-medium">{searchTags}</span> | Filtro: <span className="font-medium">{ratingFilter.replace('rating:', '') || 'Todos'}</span>
              </p>
            )}
          </div>

          <Button onClick={refresh} disabled={isLoading} variant="outline">
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
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
              <Card key={`${post.id}-${posts.indexOf(post)}`} className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
                <div className="relative bg-gray-100 h-80">
                  {(post.large_file_url || post.file_url)?.match(/\.(jpg|jpeg|png|gif|webp|avif)$/i) ? (
                    <Image
                      src={post.large_file_url || post.file_url}
                      alt={`Danbooru post ${post.id}`}
                      fill
                      className="object-contain"
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                      priority={posts.indexOf(post) < 4}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gray-200">
                      <div className="text-center">
                        <div className="text-gray-500 mb-2">📹</div>
                        <p className="text-sm text-gray-600">Video content</p>
                        <a 
                          href={post.file_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xs text-purple-600 hover:underline"
                        >
                          View original
                        </a>
                      </div>
                    </div>
                  )}
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
            <Button onClick={loadMore} disabled={isLoadingMore} size="lg" className="px-8">
              {isLoadingMore ? (
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
        {isLoading && posts.length === 0 && (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-purple-600" />
            <p className="text-gray-600">Cargando imágenes...</p>
          </div>
        )}
      </div>
    </div>
  )
}
