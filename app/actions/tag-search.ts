'use server'

import { promises as fs } from 'fs'
import path from 'path'

// Cache the tags in memory to avoid reading/parsing the file on every request
// We use globalThis to persist cache across HMR (Hot Module Replacement) in development
declare global {
  var _tagsCache: any[] | null
}

let tagsCache: any[] | null = global._tagsCache || null

export type TagResult = {
  name: string
  postCount: number
  category: number
  displayName?: string
}

export async function searchTags(query: string): Promise<TagResult[]> {
  if (!query || query.trim().length < 2) {
    return []
  }

  const normalizedQuery = query.trim().toLowerCase()
  // console.time("searchTags")

  try {
    if (!tagsCache) {
      // console.log("[TagSearch] Cache MISS - Loading tags.json...")
      const filePath = path.join(process.cwd(), 'tags.json')
      const fileContents = await fs.readFile(filePath, 'utf8')
      const rawTags = JSON.parse(fileContents)
      
      // Optimization: Pre-process tags for faster search
      // 1. Lowercase search text once
      // 2. Filter out unwanted categories (Artist=1, Meta=5) immediately to reduce search space
      tagsCache = rawTags
        .filter((tag: any) => tag.category !== 1 && tag.category !== 5)
        .map((tag: any) => ({
          ...tag,
          _nameLower: tag.name.toLowerCase(),
          _search: (tag.searchText || tag.name).toLowerCase()
      }))
      
      // Save to global for persistence
      global._tagsCache = tagsCache
      // console.log(`[TagSearch] Cache loaded with ${tagsCache?.length} tags`)
    } else {
        // console.log("[TagSearch] Cache HIT")
    }

    if (!tagsCache) return []

    // 1. Exact matches first
    // 2. Starts with matches
    // 3. Contains matches
    
    const results: TagResult[] = []
    const seen = new Set<string>()

    // Optimization: Loop to find candidates
    // We limit to 50 candidates (plenty to find top 5)
    for (const tag of tagsCache) {
      if (results.length >= 50) break
      
      // Use pre-computed lowercase properties
      if (tag._search.includes(normalizedQuery)) {
         if (!seen.has(tag.name)) {
             results.push({
                 name: tag.name,
                 postCount: tag.postCount,
                 category: tag.category,
                 displayName: tag.displayName
             })
             seen.add(tag.name)
         }
      }
    }

    // Sort by:
    // 1. Exact match (name equals query)
    // 2. Starts with query
    // 3. Post count (popularity)
    const finalResults = results.sort((a, b) => {
        const aExact = a.name === normalizedQuery
        const bExact = b.name === normalizedQuery
        if (aExact && !bExact) return -1
        if (!aExact && bExact) return 1

        const aStarts = a.name.startsWith(normalizedQuery)
        const bStarts = b.name.startsWith(normalizedQuery)
        if (aStarts && !bStarts) return -1
        if (!aStarts && bStarts) return 1

        return b.postCount - a.postCount
    }).slice(0, 5)
    
    // console.timeEnd("searchTags")
    return finalResults

  } catch (error) {
    console.error('Error searching tags:', error)
    return []
  }
}
