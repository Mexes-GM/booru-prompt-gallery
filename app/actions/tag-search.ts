'use server'

import { supabase } from '@/lib/supabase'

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

  const normalizedQuery = query.trim().toLowerCase().replace(/ /g, '_')

  try {
    // Search tags in Supabase using ILIKE for case-insensitive search
    const { data, error } = await supabase
      .from('auto_suggest_tags')
      .select('name, category')
      .ilike('name', `%${normalizedQuery}%`)
      .limit(20)

    if (error) throw error
    if (!data) return []

    const results: TagResult[] = data.map(tag => ({
      name: tag.name,
      postCount: 0, // We don't have post counts in the new table yet, but it's okay for suggestions
      category: tag.category,
      displayName: tag.name
    }))

    // Sort by:
    // 1. Exact match (name equals query)
    // 2. Starts with query
    const finalResults = results.sort((a, b) => {
        const aExact = a.name.toLowerCase() === normalizedQuery
        const bExact = b.name.toLowerCase() === normalizedQuery
        if (aExact && !bExact) return -1
        if (!aExact && bExact) return 1

        const aStarts = a.name.toLowerCase().startsWith(normalizedQuery)
        const bStarts = b.name.toLowerCase().startsWith(normalizedQuery)
        if (aStarts && !bStarts) return -1
        if (!aStarts && bStarts) return 1

        return 0
    }).slice(0, 5)
    
    return finalResults

  } catch (error) {
    console.error('Error searching tags:', error)
    return []
  }
}
