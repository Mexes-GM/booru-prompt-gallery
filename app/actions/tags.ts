'use server'

import { supabase } from '@/lib/supabase'

export async function getAllTagOverrides() {
  // Fetch all tags that have a specific category assigned (not just generic import if we had that)
  // In our schema, 'category' holds the classification like 'clothing', 'pose', etc.
  // We want to fetch all of them to cache on the client.
  
  const { data, error } = await supabase
    .from('tags')
    .select('name, category')
  
  if (error) {
    console.error('Error fetching tag overrides:', error)
    return {}
  }

  // Convert to a Record<string, string> for fast lookup
  const overrides: Record<string, string> = {}
  data.forEach(tag => {
    overrides[tag.name] = tag.category
  })

  return overrides
}
