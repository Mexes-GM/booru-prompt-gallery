'use server'

import { headers } from 'next/headers'
import { getClientIp } from '@/lib/client-ip'
import { getSuggestionAuthorId, isMissingColumnError } from '@/lib/tag-suggestion-author'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/authorization'
import { revertOwnPendingSuggestion } from './suggestions'
import { filterWritableTagNames, toStorageTagName } from '@/lib/tag-write-guard'
import { TAG_CATEGORY_IDS, TAG_SUBCATEGORIES, type TagCategory } from '@/lib/tag-taxonomy'

export interface TeachQueueItem {
  tag: string
  postCount: number
  proposedCategory: TagCategory | null
  proposedSubcategory: string | null
  confidence: number | null
  categoryName?: string | null
  subcategory?: string | null
}

export interface FetchTeachQueueOptions {
  limit?: number
  excludeNames?: string[]
}

export interface PreviousTagState {
  categoryName?: string | null
  subcategory?: string | null
  confidence?: number | null
  status?: string
}

export interface SubmitTeachClassificationResult {
  success: boolean
  message?: string
  wasAutoApproved?: boolean
  suggestionId?: string | null
}

async function checkIsAdmin(): Promise<boolean> {
  try {
    await requireAdmin()
    return true
  } catch {
    return false
  }
}

/**
 * Fetches the next batch of tags in `needs_review` from `auto_suggest_tags`,
 * prioritized by popularity (`post_count DESC`).
 */
export async function fetchTeachQueue(
  options: FetchTeachQueueOptions = {}
): Promise<{ success: boolean; items: TeachQueueItem[]; error?: string }> {
  try {
    const limit = Math.min(Math.max(options.limit ?? 15, 1), 50)
    const excludeSet = new Set((options.excludeNames ?? []).map(n => n.toLowerCase().trim().replace(/ /g, '_')))

    // Query a larger batch to allow in-memory deduplication against excludeNames
    // and against tags already approved in `tags`
    const fetchLimit = limit * 2 + Math.min(excludeSet.size, 100)

    const { data, error } = await supabaseAdmin
      .from('auto_suggest_tags')
      .select('name, post_count, confidence, proposed_category, proposed_subcategory, category_name, subcategory')
      .eq('status', 'needs_review')
      .order('post_count', { ascending: false })
      .limit(fetchLimit)

    if (error) {
      console.error('[fetchTeachQueue] Supabase query failed:', error)
      return { success: false, items: [], error: error.message }
    }

    if (!data || data.length === 0) {
      return { success: true, items: [] }
    }

    // `auto_suggest_tags.status` lags behind `tags`: a tag approved through the
    // suggestions flow can still read `needs_review` here. Skip those so the
    // queue doesn't ask people to re-classify settled tags.
    const { data: approvedRows } = await supabaseAdmin
      .from('tags')
      .select('name')
      .eq('status', 'approved')
      .in('name', data.map(row => toStorageTagName(row.name ?? '')).filter(Boolean))
    const approvedNames = new Set((approvedRows ?? []).map(row => row.name))

    const items: TeachQueueItem[] = []
    for (const row of data) {
      const norm = (row.name ?? '').toLowerCase().trim()
      if (!norm || excludeSet.has(norm) || approvedNames.has(toStorageTagName(norm))) continue

      const validProposedCat = TAG_CATEGORY_IDS.includes(row.proposed_category as TagCategory)
        ? (row.proposed_category as TagCategory)
        : null

      items.push({
        tag: norm,
        postCount: row.post_count ?? 0,
        proposedCategory: validProposedCat,
        proposedSubcategory: row.proposed_subcategory ?? null,
        confidence: typeof row.confidence === 'number' ? row.confidence : null,
        categoryName: row.category_name ?? null,
        subcategory: row.subcategory ?? null,
      })

      if (items.length >= limit) break
    }

    return { success: true, items }
  } catch (err: any) {
    console.error('[fetchTeachQueue] unexpected error:', err)
    return { success: false, items: [], error: err.message ?? 'Unknown error' }
  }
}

/**
 * Handles classification submissions.
 * - If caller is ADMIN: directly applies approved classification to auto_suggest_tags and tags.
 * - If caller is REGULAR USER: creates a pending suggestion in tag_suggestions for admin review.
 */
export async function submitTeachClassification(
  tagName: string,
  category: TagCategory,
  subcategory: string,
  context?: {
    currentCategory?: string | null
    currentSubcategory?: string | null
    confidence?: number | null
  }
): Promise<SubmitTeachClassificationResult> {
  try {
    if (!TAG_CATEGORY_IDS.includes(category)) {
      return { success: false, message: `Invalid category: ${category}` }
    }

    const validSubcategories = TAG_SUBCATEGORIES[category] as readonly string[]
    if (!validSubcategories.includes(subcategory)) {
      return { success: false, message: `Invalid subcategory '${subcategory}' for category '${category}'` }
    }

    // Same write guard as submitTagSuggestions: artist/copyright/character/meta
    // never become rows in `tags`. On a lookup failure the guard lets it through.
    const guard = await filterWritableTagNames(supabaseAdmin, [tagName])
    if (guard.rejected.length > 0) {
      return {
        success: false,
        message: `"${tagName}" is a ${guard.rejected[0].reason} tag, not a description of the image.`,
      }
    }

    // `auto_suggest_tags.name` is underscored; `tags.name` uses the space-form
    // storage convention. Writing the underscored name into `tags` minted
    // duplicates of rows that already existed (`one_eye_closed` / `one eye closed`).
    const autoName = tagName.toLowerCase().trim().replace(/ /g, '_')
    const storageName = toStorageTagName(tagName)
    if (!storageName) {
      return { success: false, message: 'Invalid tag name' }
    }
    const isAdmin = await checkIsAdmin()

    // 1. Admin direct approval path
    if (isAdmin) {
      const { error: autoError } = await supabaseAdmin
        .from('auto_suggest_tags')
        .update({
          category_name: category,
          subcategory: subcategory,
          status: 'approved',
          confidence: 1.0,
        })
        .eq('name', autoName)

      if (autoError) {
        console.error('[submitTeachClassification] failed to update auto_suggest_tags for %s:', autoName, autoError)
        return { success: false, message: autoError.message }
      }

      const { data: existingTag } = await supabaseAdmin
        .from('tags')
        .select('id')
        .eq('name', storageName)
        .maybeSingle()

      if (existingTag?.id) {
        await supabaseAdmin
          .from('tags')
          .update({
            category,
            subcategory,
            status: 'approved',
            confidence: 1.0,
          })
          .eq('id', existingTag.id)
      } else {
        await supabaseAdmin
          .from('tags')
          .insert({
            name: storageName,
            category,
            subcategory,
            status: 'approved',
            confidence: 1.0,
          })
      }

      return { success: true, wasAutoApproved: true }
    }

    // 2. Community user path: create a pending suggestion for admin review
    const headersList = await headers()
    const ip = getClientIp(headersList, 'unknown')

    // Ensure row exists in tags to satisfy foreign key tag_suggestions.tag_id -> tags.id
    let tagId: string | null = null
    const { data: existingTag } = await supabaseAdmin
      .from('tags')
      .select('id')
      .eq('name', storageName)
      .maybeSingle()

    if (existingTag?.id) {
      tagId = existingTag.id
    } else {
      const { data: newTag, error: newTagError } = await supabaseAdmin
        .from('tags')
        .insert({
          name: storageName,
          category: (context?.currentCategory as TagCategory) || 'other',
          subcategory: context?.currentSubcategory || null,
          status: 'needs_review',
        })
        .select('id')
        .single()

      if (newTagError || !newTag) {
        console.error('[submitTeachClassification] error creating tag row:', newTagError)
        return { success: false, message: 'Failed to record suggestion' }
      }
      tagId = newTag.id
    }

    // The pending-uniqueness index doesn't include the subcategory, so a pending
    // row for the same tag + category blocks the insert even when the
    // subcategory differs. Only hand back its id (which Undo would delete) when
    // it's an exact match.
    const { data: existingPending } = await supabaseAdmin
      .from('tag_suggestions')
      .select('id, suggested_subcategory')
      .eq('tag_id', tagId)
      .eq('suggested_category', category)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle()

    if (existingPending) {
      const isExactMatch = existingPending.suggested_subcategory === subcategory
      return { success: true, suggestionId: isExactMatch ? existingPending.id : null, wasAutoApproved: false }
    }

    // Insert pending suggestion
    const row = {
      tag_id: tagId,
      current_category: (context?.currentCategory as TagCategory) || 'other',
      current_subcategory: context?.currentSubcategory || null,
      suggested_category: category,
      suggested_subcategory: subcategory,
      confidence: context?.confidence ?? null,
      status: 'pending',
      user_ip: ip,
    }
    const authorId = await getSuggestionAuthorId()
    const insertRow = (values: typeof row & { user_id?: string }) =>
      supabaseAdmin.from('tag_suggestions').insert(values).select('id').single()

    let { data: insertedSuggestion, error: insertError } = await insertRow(authorId ? { ...row, user_id: authorId } : row)
    if (authorId && isMissingColumnError(insertError)) {
      ;({ data: insertedSuggestion, error: insertError } = await insertRow(row))
    }

    // Unique violation: another pending suggestion for this tag landed first
    // (concurrent submit, or a stricter index). The tag is already queued for
    // review, so treat it as a no-op rather than an error.
    if (insertError?.code === '23505') {
      return { success: true, suggestionId: null, wasAutoApproved: false }
    }

    if (insertError) {
      console.error('[submitTeachClassification] error inserting tag suggestion:', insertError)
      return { success: false, message: insertError.message }
    }

    return {
      success: true,
      suggestionId: insertedSuggestion?.id ?? null,
      wasAutoApproved: false,
    }
  } catch (err: any) {
    console.error('[submitTeachClassification] unexpected error on tag %s:', tagName, err)
    return { success: false, message: err.message ?? 'Unknown error' }
  }
}

/**
 * Reverts a previously classified tag during an Undo action.
 * If wasAutoApproved: reverts production tables to needs_review.
 * If user pending suggestion: removes the pending suggestion row.
 */
export async function revertTeachClassification(
  tagName: string,
  options?: {
    suggestionId?: string | null
    wasAutoApproved?: boolean
    previousState?: PreviousTagState
  }
): Promise<{ success: boolean; message?: string }> {
  try {
    if (options?.wasAutoApproved) {
      // Server actions are publicly callable: without this, anyone could pass
      // wasAutoApproved + an arbitrary previousState and rewrite production tags.
      if (!(await checkIsAdmin())) {
        return { success: false, message: 'Unauthorized' }
      }
      const autoName = tagName.toLowerCase().trim().replace(/ /g, '_')

      const { error: autoError } = await supabaseAdmin
        .from('auto_suggest_tags')
        .update({
          category_name: options.previousState?.categoryName ?? 'other',
          subcategory: options.previousState?.subcategory ?? null,
          status: options.previousState?.status ?? 'needs_review',
          confidence: options.previousState?.confidence ?? null,
        })
        .eq('name', autoName)

      if (autoError) {
        console.error('[revertTeachClassification] failed to revert auto_suggest_tags for %s:', autoName, autoError)
        return { success: false, message: autoError.message }
      }

      const { data: existingTag } = await supabaseAdmin
        .from('tags')
        .select('id')
        .eq('name', toStorageTagName(tagName))
        .maybeSingle()

      if (existingTag?.id) {
        await supabaseAdmin
          .from('tags')
          .update({
            category: (options.previousState?.categoryName as TagCategory) ?? 'other',
            subcategory: options.previousState?.subcategory ?? null,
            status: options.previousState?.status ?? 'needs_review',
            confidence: options.previousState?.confidence ?? null,
          })
          .eq('id', existingTag.id)
      }

      return { success: true }
    }

    // Community suggestion rollback: delete the pending suggestion, scoped to
    // the submitter's IP / user id so a leaked id can't delete someone else's.
    if (options?.suggestionId) {
      return await revertOwnPendingSuggestion(options.suggestionId)
    }

    return { success: true }
  } catch (err: any) {
    console.error('[revertTeachClassification] unexpected error on tag %s:', tagName, err)
    return { success: false, message: err.message ?? 'Unknown error' }
  }
}
