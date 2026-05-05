'use server'

import { supabaseAdmin } from '@/lib/supabase-admin'
import { headers } from 'next/headers'
import { z } from 'zod'

// --- Schema Validation ---

const TagReclassificationSchema = z.object({
  tagName: z.string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_\-\s:();.!?'"~<>&'/\[\]*+@#%=,]+$/, "Invalid tag format")
    .refine((val) => {
      // Prevent XSS: blocks "<script", "<div>" etc. but allows "<3" or ">_<"
      return !/<\s*\/?[a-zA-Z]/i.test(val)
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

// --- Rate Limiting ---
// ... (rest of file)

async function checkRateLimit(ip: string): Promise<{ allowed: boolean }> {
  // Run reputation lookup and count check in parallel — they're independent
  const [reputationResult, countResult] = await Promise.allSettled([
    supabaseAdmin.rpc('get_ip_reputation', { check_ip: ip }),
    supabaseAdmin
      .from('rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip)
      .eq('action', 'submit_suggestion')
      .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
  ])

  // Determine rate limit window from reputation
  let maxRequests = 50

  if (reputationResult.status === 'fulfilled') {
    const { data: reputation, error: repError } = reputationResult.value
    if (repError) {
      console.warn('[RateLimit] get_ip_reputation RPC failed (using defaults):', repError.message)
    } else if (reputation && reputation.length > 0) {
      const { approved_count, rejected_count } = reputation[0]
      const score = (Number(approved_count) || 0) * 2 - (Number(rejected_count) || 0) * 5
      if (score > 20) maxRequests = 200
      else if (score < -10) maxRequests = 5
    }
  }

  // Check count result
  if (countResult.status === 'rejected' || countResult.value.error) {
    const err = countResult.status === 'rejected' ? countResult.reason : countResult.value.error
    console.error('[RateLimit] rate_limits table query failed (allowing request):', err?.message || err)
    return { allowed: true }
  }

  const { count } = countResult.value
  if (count !== null && count >= maxRequests) {
    return { allowed: false }
  }

  // Log request fire-and-forget (don't await — doesn't block the response)
  supabaseAdmin
    .from('rate_limits')
    .insert({ ip, action: 'submit_suggestion' })
    .then(({ error }) => {
      if (error) console.warn('[RateLimit] rate_limits insert failed (request still allowed):', error.message)
    })

  return { allowed: true }
}

// --- Server Action ---

export async function submitTagSuggestions(suggestions: TagReclassification[]): Promise<SubmitSuggestionResult> {
  // 1. Validate input
  const validation = SuggestionsPayloadSchema.safeParse(suggestions)
  if (!validation.success) {
    return { success: false, message: "Invalid data format", errors: validation.error.issues }
  }

  const validatedSuggestions = validation.data
  const tagNames = validatedSuggestions.map(s => s.tagName)

  // 2. Run rate limit check and tag ID resolution in parallel
  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for') || 'unknown'

  const [rateLimitResult, tagsResult] = await Promise.all([
    ip !== 'unknown' ? checkRateLimit(ip) : Promise.resolve({ allowed: true }),
    supabaseAdmin.from('tags').select('id, name').in('name', tagNames)
  ])

  if (!rateLimitResult.allowed) {
    return { success: false, message: "Too many requests. Please try again later." }
  }

  const { data: tags, error: tagError } = tagsResult
  if (tagError) {
    console.error("[submitTagSuggestions] Error fetching tags:", tagError)
    return { success: false, message: "Failed to validate tags" }
  }

  const tagMap = new Map(tags?.map(t => [t.name, t.id]))

  // 3. Auto-create any tags that don't exist yet (sequential — depends on tagMap)
  const missingTagNames = tagNames.filter(name => !tagMap.has(name))

  if (missingTagNames.length > 0) {
    const newTags = missingTagNames.map(name => ({
      name,
      category: validatedSuggestions.find(s => s.tagName === name)?.currentCategory ?? 'other'
    }))

    const { data: insertedTags, error: insertError } = await supabaseAdmin
      .from('tags')
      .upsert(newTags, { onConflict: 'name' })
      .select('id, name')

    if (insertError) {
      console.error("[submitTagSuggestions] Error inserting missing tags:", insertError)
    } else if (insertedTags) {
      insertedTags.forEach(t => tagMap.set(t.name, t.id))
    }
  }

  // 4. Build suggestions payload
  const suggestionsToInsert = validatedSuggestions
    .filter(s => tagMap.has(s.tagName))
    .map(s => ({
      tag_id: tagMap.get(s.tagName)!,
      current_category: s.currentCategory,
      suggested_category: s.suggestedCategory,
      status: 'pending',
      user_ip: ip
    }))

  if (suggestionsToInsert.length === 0) {
    return { success: false, message: "No valid tags found to suggest" }
  }

  // 5. Deduplicate against existing pending suggestions
  const tagIds = suggestionsToInsert.map(s => s.tag_id)
  const { data: existingSuggestions } = await supabaseAdmin
    .from('tag_suggestions')
    .select('tag_id, suggested_category')
    .in('tag_id', tagIds)
    .eq('status', 'pending')

  const finalSuggestions = suggestionsToInsert.filter(newItem =>
    !existingSuggestions?.some(existing =>
      existing.tag_id === newItem.tag_id &&
      existing.suggested_category === newItem.suggested_category
    )
  )

  if (finalSuggestions.length === 0) {
    return { success: true, message: "Successfully submitted suggestions." }
  }

  // 6. Insert suggestions
  const { data: insertedSuggestions, error: insertError } = await supabaseAdmin
    .from('tag_suggestions')
    .insert(finalSuggestions)
    .select('id, suggested_category, tags (name)')

  if (insertError) {
    console.error("[submitTagSuggestions] Error inserting suggestions:", insertError)
    if (insertError.code === '23505') {
      return { success: true, message: "Successfully submitted suggestions." }
    }
    return { success: false, message: "Failed to submit suggestions" }
  }

  return { success: true, message: "Successfully submitted suggestions." }
}

// --- Query: Existing Suggestions for Tag Names ---

export async function getExistingSuggestions(tagNames: string[]): Promise<Record<string, string>> {
  if (!tagNames.length) return {}

  const { data: tags, error: tagError } = await supabaseAdmin
    .from('tags')
    .select('id, name')
    .in('name', tagNames)

  if (tagError || !tags) {
    console.error("[getExistingSuggestions] Error fetching tags:", tagError)
    return {}
  }

  const tagIdToName = new Map(tags.map(t => [t.id, t.name]))
  const tagIds = tags.map(t => t.id)

  if (!tagIds.length) return {}

  const { data: suggestions, error: suggestionError } = await supabaseAdmin
    .from('tag_suggestions')
    .select('tag_id, suggested_category')
    .in('tag_id', tagIds)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (suggestionError || !suggestions) {
    console.error("[getExistingSuggestions] Error fetching suggestions:", suggestionError)
    return {}
  }

  // Return most-recent suggestion per tag
  const result: Record<string, string> = {}
  for (const s of suggestions) {
    const tagName = tagIdToName.get(s.tag_id)
    if (tagName && !result[tagName]) {
      result[tagName] = s.suggested_category
    }
  }

  return result
}
