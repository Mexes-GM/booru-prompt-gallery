'use server'

import { supabaseAdmin } from '@/lib/supabase-admin'
import { headers } from 'next/headers'
import { z } from 'zod'
import { waitUntil } from '@vercel/functions'
import { processTagSuggestionWithAI } from '@/lib/ai-service'
import { TagCategory } from '@/lib/tag-classifier'

// Schema Validation
const TagReclassificationSchema = z.object({
  tagName: z.string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_\-\s:();.!?'"~<>&’/\[\]*+@#%=,]+$/, "Invalid tag format")
    .refine((val) => {
      // Prevent XSS: Check for HTML tags
      // Allows "<3", ">_<" but blocks "<script", "<div>", etc.
      // Regex matches "<" followed optionally by "/" and then an alphanumeric char (start of a tag name)
      return !/<\s*\/?[a-zA-Z]/i.test(val);
    }, "Tag cannot contain HTML elements"),
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

async function checkRateLimit(ip: string): Promise<{ allowed: boolean, error?: boolean }> {
  // 1. Profile User Reputation
  // Retrieve approved/rejected counts for this IP
  const { data: reputation, error: repError } = await supabaseAdmin.rpc('get_ip_reputation', { check_ip: ip })

  // Default Limits (Neutral)
  let maxRequests = 50
  let timeWindowMinutes = 30

  if (!repError && reputation && reputation.length > 0) {
    const stats = reputation[0]
    const approved = Number(stats.approved_count) || 0
    const rejected = Number(stats.rejected_count) || 0

    // Calculate Score: Approvals are +2, Rejections are -5 (heavier penalty)
    const score = (approved * 2) - (rejected * 5)

    if (score > 20) {
      // Trusted User: High limit
      maxRequests = 200
      timeWindowMinutes = 30
    } else if (score < -10) {
      // Suspicious/Bad User: Strict limit
      maxRequests = 5
      timeWindowMinutes = 60
    }

    // console.log(`[RateLimit] IP: ${ip}, Score: ${score}, Max: ${maxRequests}`)
  }

  // 2. Count recent requests
  const timeWindow = new Date(Date.now() - timeWindowMinutes * 60 * 1000).toISOString()

  const { count, error } = await supabaseAdmin
    .from('rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('ip', ip)
    .eq('action', 'submit_suggestion')
    .gte('created_at', timeWindow)

  if (error) {
    console.error('Rate limit check error:', error)
    // Fail closed for security, but indicate it's a system error
    return { allowed: false, error: true }
  }

  if (count !== null && count >= maxRequests) {
    return { allowed: false }
  }

  // 3. Log this request
  const { error: insertError } = await supabaseAdmin.from('rate_limits').insert({
    ip,
    action: 'submit_suggestion'
  })

  // If we can't write to the rate limit table, we should probably fail closed or open.
  // Here we fail open because we already checked the count.
  if (insertError) {
    console.warn('Rate limit insert error (allowing request):', insertError)
  }

  return { allowed: true }
}

export async function submitTagSuggestions(suggestions: TagReclassification[]): Promise<SubmitSuggestionResult> {
  // 1. Input Validation
  const validation = SuggestionsPayloadSchema.safeParse(suggestions)
  if (!validation.success) {
    return { success: false, message: "Invalid data format", errors: validation.error.issues }
  }

  const validatedSuggestions = validation.data

  // 2. Rate Limiting
  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for') || 'unknown'

  if (ip !== 'unknown') {
    const { allowed, error: sysError } = await checkRateLimit(ip)
    if (sysError) {
      return { success: false, message: "System is busy. Please try again later." }
    }
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
        status: 'pending',
        user_ip: ip
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
  const { data: insertedSuggestions, error: insertError } = await supabaseAdmin
    .from('tag_suggestions')
    .insert(finalSuggestionsToInsert)
    .select('id, suggested_category, tags (name)')

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

  // Auto-Classification Step
  if (insertedSuggestions && insertedSuggestions.length > 0) {
    // Process sequentially to respect OpenRouter Free Tier Rate Limits (approx 8-10 RPM)
    // We do NOT await the entire batch to finish before returning to the user,
    // but we use waitUntil to ensure the serverless function stays alive.

    waitUntil((async () => {
      for (const suggestion of insertedSuggestions) {
        // Safe check for tag name presence
        const tagsData = suggestion.tags as any;
        const tagName = Array.isArray(tagsData) ? tagsData[0]?.name : tagsData?.name;
        if (!tagName) continue;

        // Optimized processing via AI Service
        try {
          // Delay for Rate Limits (OpenRouter Free)
          // Increased to 2000ms (2s) to prevent "Too Many Requests" during batch processing
          await new Promise(resolve => setTimeout(resolve, 2000));

          await processTagSuggestionWithAI({
            suggestionId: suggestion.id,
            tagName: tagName,
            suggestedCategory: suggestion.suggested_category as TagCategory
          });

        } catch (e) {
          console.error(`[Action] Background AI processing failed for ${tagName}:`, e);
        }
      }
    })());
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
