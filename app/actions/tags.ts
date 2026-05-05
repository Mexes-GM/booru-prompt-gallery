'use server'

import { supabaseAdmin } from '@/lib/supabase-admin'

export async function getAllTagOverrides() {
  // Fetch all tags that have a specific category assigned
  // We need to paginate because Supabase limits rows per request (default 1000)
  
  const overrides: Record<string, string> = {}
  let page = 0
  const pageSize = 1000
  let hasMore = true
  
  while (hasMore) {
    const { data, error } = await supabaseAdmin
      .from('tags')
      .select('name, category')
      .range(page * pageSize, (page + 1) * pageSize - 1)
    
    if (error) {
      console.error('Error fetching tag overrides:', error)
      break
    }

    if (data && data.length > 0) {
      data.forEach(tag => {
        overrides[tag.name] = tag.category
      })
      
      if (data.length < pageSize) {
        hasMore = false
      } else {
        page++
      }
    } else {
      hasMore = false
    }
  }

  return overrides
}
