'use server'

import { supabaseAdmin } from '@/lib/supabase-admin'
import { headers } from 'next/headers'
import { z } from 'zod'

// Schema Validation
const TagReclassificationSchema = z.object({
  tagName: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_\-\s:();.!?'"~<>&’/\[\]*+@#%=,]+$/, "Invalid tag format"),
  currentCategory: z.enum(['clothing', 'pose', 'scenery', 'appearance', 'other']),
  suggestedCategory: z.enum(['clothing', 'pose', 'scenery', 'appearance', 'other'])
})

const SuggestionsPayloadSchema = z.array(TagReclassificationSchema).min(1).max(50)

export type SubmitSuggestionResult = {
  success: boolean
  message: string
  errors?: any[]
}

export type TagReclassification = z.infer<typeof TagReclassificationSchema>

async function checkRateLimit(ip: string): Promise<boolean> {
  // Simple Rate Limit: 50 requests per 30 minutes per IP
  // Clean up old records first (lazy cleanup)
  // In production, use a scheduled job or Redis
  
  // 1. Count recent requests
  const timeWindow = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  
  const { count, error } = await supabaseAdmin
    .from('rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('ip', ip)
    .eq('action', 'submit_suggestion')
    .gte('created_at', timeWindow)
    
  if (error) {
    console.error('Rate limit check error:', error)
    return false // Fail open or closed? Closed for security.
  }

  if (count !== null && count >= 50) {
    return false
  }

  // 2. Log this request
  await supabaseAdmin.from('rate_limits').insert({
    ip,
    action: 'submit_suggestion'
  })

  return true
}

export async function submitTagSuggestions(suggestions: TagReclassification[]): Promise<SubmitSuggestionResult> {
  // 1. Input Validation
  const validation = SuggestionsPayloadSchema.safeParse(suggestions)
  if (!validation.success) {
    return { success: false, message: "Invalid data format", errors: validation.error.errors }
  }
  
  const validatedSuggestions = validation.data

  // 2. Rate Limiting
  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for') || 'unknown'
  
  if (ip !== 'unknown') {
    const allowed = await checkRateLimit(ip)
    if (!allowed) {
      return { success: false, message: "Too many requests. Please try again later." }
    }
  }

  // First, we need to get the tag IDs for these tag names
  // We can do this in a batch
  const tagNames = validatedSuggestions.map(s => s.tagName)
  const { data: tags, error: tagError } = await supabaseAdmin
    .from('tags')
    .select('id, name')
    .in('name', tagNames)

  if (tagError) {
    console.error("Error fetching tags:", tagError)
    return { success: false, message: "Failed to validate tags" }
  }

  const tagMap = new Map(tags?.map(t => [t.name, t.id]))
  
  // Handle missing tags: Insert them into the 'tags' table
  const missingTagNames = validatedSuggestions
    .map(s => s.tagName)
    .filter(name => !tagMap.has(name))
  
  if (missingTagNames.length > 0) {
    const newTags = missingTagNames.map(name => {
        // Find the "current" category from the suggestion payload to initialize the tag
        // This is the category BEFORE the user moved it, so it's likely 'other' or whatever the classifier thought.
        // We use this as the initial state in the DB.
        const suggestion = validatedSuggestions.find(s => s.tagName === name)
        return {
            name: name,
            category: suggestion?.currentCategory || 'other'
        }
    })

    // Upsert to be safe (though we checked map, race conditions exist)
    const { data: insertedTags, error: insertError } = await supabaseAdmin
        .from('tags')
        .upsert(newTags, { onConflict: 'name' })
        .select('id, name')

    if (insertError) {
        console.error("Error inserting missing tags:", insertError)
        // If we fail to create tags, we can't create suggestions for them. 
        // We continue with what we have.
    } else if (insertedTags) {
        insertedTags.forEach(t => tagMap.set(t.name, t.id))
    }
  }

  const suggestionsToInsert = []
  
  for (const suggestion of validatedSuggestions) {
    const tagId = tagMap.get(suggestion.tagName)
    if (tagId) {
      suggestionsToInsert.push({
        tag_id: tagId,
        current_category: suggestion.currentCategory,
        suggested_category: suggestion.suggestedCategory,
        status: 'pending'
      })
    }
  }

  if (suggestionsToInsert.length === 0) {
    return { success: false, message: "No valid tags found to suggest" }
  }

  // Pre-filter: Check for existing pending suggestions to avoid "upsert" issues with partial index
  // (Since upsert/onConflict doesn't work well with partial indexes in Supabase/Postgres)
  const tagIds = suggestionsToInsert.map(s => s.tag_id)
  const { data: existingSuggestions } = await supabaseAdmin
    .from('tag_suggestions')
    .select('tag_id, suggested_category')
    .in('tag_id', tagIds)
    .eq('status', 'pending')

  // Filter out duplicates
  const finalSuggestionsToInsert = suggestionsToInsert.filter(newItem => {
    const isDuplicate = existingSuggestions?.some(existing => 
        existing.tag_id === newItem.tag_id && 
        existing.suggested_category === newItem.suggested_category
    )
    return !isDuplicate
  })

  if (finalSuggestionsToInsert.length === 0) {
     // If all were duplicates, we still return success to the user
     return { 
        success: true, 
        message: `Successfully submitted suggestions.`
      }
  }

  // Use standard insert since we filtered manually
  const { error: insertError } = await supabaseAdmin
    .from('tag_suggestions')
    .insert(finalSuggestionsToInsert)

  if (insertError) {
    // If we still hit a race condition, log it but don't crash hard if possible
    console.error("Error inserting suggestions:", insertError)
    // Check for unique violation (code 23505)
    if (insertError.code === '23505') {
         return { 
            success: true, 
            message: `Successfully submitted suggestions.`
          }
    }
    return { success: false, message: "Failed to submit suggestions" }
  }

  return { 
    success: true, 
    message: `Successfully submitted suggestions.`
  }
}

export async function getExistingSuggestions(tagNames: string[]): Promise<Record<string, string>> {
  if (!tagNames.length) return {}

  // 1. Get Tag IDs
  const { data: tags, error: tagError } = await supabaseAdmin
    .from('tags')
    .select('id, name')
    .in('name', tagNames)

  if (tagError || !tags) {
    console.error("Error fetching tags:", tagError)
    return {}
  }

  const tagIdMap = new Map(tags.map(t => [t.id, t.name]))
  const tagIds = tags.map(t => t.id)

  if (!tagIds.length) return {}

  // 2. Get Pending Suggestions
  // We prioritize the most recent suggestion if there are multiple
  const { data: suggestions, error: suggestionError } = await supabaseAdmin
    .from('tag_suggestions')
    .select('tag_id, suggested_category')
    .in('tag_id', tagIds)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (suggestionError || !suggestions) {
    console.error("Error fetching suggestions:", suggestionError)
    return {}
  }

  // 3. Map back to tag names
  const result: Record<string, string> = {}
  
  suggestions.forEach(s => {
    const tagName = tagIdMap.get(s.tag_id)
    if (tagName && !result[tagName]) {
      result[tagName] = s.suggested_category
    }
  })

  return result
}
