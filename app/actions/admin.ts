'use server'

import { supabaseAdmin } from '@/lib/supabase-admin'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth/authorization'
import { redirect } from 'next/navigation'
import { TAG_CATEGORY_IDS, type TagCategory } from '@/lib/tag-taxonomy'

async function checkAdmin() {
  try {
    await requireAdmin()
    return true
  } catch {
    return false
  }
}

export type TagSuggestion = {
  id: string
  tag_id: string
  current_category: string
  suggested_category: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  tags: {
    name: string
  } | null
}

export async function getSuggestions(
  page: number = 1, 
  pageSize: number = 20,
  filters?: {
    status?: string
    currentCategory?: string
    suggestedCategory?: string
  }
) {
  // Security Check
  const isAdmin = await checkAdmin()
  if (!isAdmin) {
     throw new Error("Unauthorized")
  }

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabaseAdmin
    .from('tag_suggestions')
    .select(`
      *,
      tags (
        name
      )
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to)

  if (filters?.status) {
    query = query.eq('status', filters.status)
  }
  
  if (filters?.currentCategory) {
    query = query.eq('current_category', filters.currentCategory)
  }

  if (filters?.suggestedCategory) {
    query = query.eq('suggested_category', filters.suggestedCategory)
  }

  const { data, error, count } = await query

  if (error) {
    throw new Error(error.message)
  }

  // Get counts for each status
  const [pendingResult, approvedResult, rejectedResult] = await Promise.all([
    supabaseAdmin.from('tag_suggestions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabaseAdmin.from('tag_suggestions').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    supabaseAdmin.from('tag_suggestions').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
  ])

  return {
    data: data as TagSuggestion[],
    count: count || 0,
    page,
    pageSize,
    totalPages: count ? Math.ceil(count / pageSize) : 0,
    pendingCount: pendingResult.count || 0,
    approvedCount: approvedResult.count || 0,
    rejectedCount: rejectedResult.count || 0,
  }
}

export async function approveSuggestion(id: string) {
  const isAdmin = await checkAdmin()
  if (!isAdmin) {
    throw new Error("Unauthorized")
  }

  // Use RPC call for atomicity
  const { error } = await supabaseAdmin.rpc('approve_tag_suggestion', {
    suggestion_id: id
  })

  if (error) {
    // Fallback if RPC not created: Manual update (Not atomic but works for basic cases)
    console.error("RPC failed, trying manual update:", error)
    
    // 1. Fetch suggestion
    const { data: suggestion } = await supabaseAdmin
        .from('tag_suggestions')
        .select('tag_id, suggested_category')
        .eq('id', id)
        .single()
        
    if (!suggestion) throw new Error("Suggestion not found")

    // 2. Update tag
    const { error: tagError } = await supabaseAdmin
        .from('tags')
        .update({ category: suggestion.suggested_category })
        .eq('id', suggestion.tag_id)
    
    if (tagError) throw new Error(tagError.message)

    // 3. Update suggestion status
    const { error: updateError } = await supabaseAdmin
        .from('tag_suggestions')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('id', id)

    if (updateError) throw new Error(updateError.message)
    
    revalidatePath('/admin/suggestions')
    return { success: true }
  }

  revalidatePath('/admin/suggestions')
  return { success: true }
}

export async function rejectSuggestion(id: string) {
  const isAdmin = await checkAdmin()
  if (!isAdmin) {
    throw new Error("Unauthorized")
  }

  const { error } = await supabaseAdmin
    .from('tag_suggestions')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/admin/suggestions')
  return { success: true }
}

/**
 * Reverts an approve/reject/correct decision made via the Quick Review modal
 * (`components/quick-review-modal.tsx`) so its "Undo" button isn't purely
 * local UI state pretending a real write was rolled back. Puts the
 * suggestion back to `pending`; if it had been approved (plain or
 * corrected), also restores the tag's `category` to `current_category` —
 * the value it held before that decision, which every `tag_suggestions` row
 * already carries. Rejections have no side effect on `tags` to undo, so
 * restoring the status is enough there.
 */
export async function revertSuggestionDecision(id: string) {
  const isAdmin = await checkAdmin()
  if (!isAdmin) {
    throw new Error("Unauthorized")
  }

  const { data: suggestion, error: fetchError } = await supabaseAdmin
    .from('tag_suggestions')
    .select('tag_id, status, current_category')
    .eq('id', id)
    .single()

  if (fetchError || !suggestion) throw new Error("Suggestion not found")

  if (suggestion.status === 'approved') {
    const { error: tagError } = await supabaseAdmin
      .from('tags')
      .update({ category: suggestion.current_category })
      .eq('id', suggestion.tag_id)

    if (tagError) throw new Error(tagError.message)
  }

  const { error: updateError } = await supabaseAdmin
    .from('tag_suggestions')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('id', id)

  if (updateError) throw new Error(updateError.message)

  revalidatePath('/admin/suggestions')
  return { success: true }
}

// Sourced from lib/tag-taxonomy.ts: an admin can correct a suggestion into any
// valid category, so this is the taxonomy itself rather than a parallel list.
const CORRECTABLE_CATEGORIES = TAG_CATEGORY_IDS
export type CorrectableCategory = TagCategory

/**
 * Approves a suggestion but applies an admin-chosen category instead of the
 * community-suggested one (used by the Quick Review "Correct" action, when
 * the suggested category is close but not quite right). Unlike
 * `approveSuggestion`, this always does the manual update path — there's no
 * RPC for the corrected-category case — and overwrites `suggested_category`
 * on the row so the suggestion's history reflects what was actually applied.
 */
export async function correctAndApproveSuggestion(id: string, correctedCategory: CorrectableCategory) {
  const isAdmin = await checkAdmin()
  if (!isAdmin) {
    throw new Error("Unauthorized")
  }

  if (!CORRECTABLE_CATEGORIES.includes(correctedCategory)) {
    throw new Error("Invalid category")
  }

  const { data: suggestion } = await supabaseAdmin
    .from('tag_suggestions')
    .select('tag_id')
    .eq('id', id)
    .single()

  if (!suggestion) throw new Error("Suggestion not found")

  const { error: tagError } = await supabaseAdmin
    .from('tags')
    .update({ category: correctedCategory })
    .eq('id', suggestion.tag_id)

  if (tagError) throw new Error(tagError.message)

  const { error: updateError } = await supabaseAdmin
    .from('tag_suggestions')
    .update({
      status: 'approved',
      suggested_category: correctedCategory,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (updateError) throw new Error(updateError.message)

  revalidatePath('/admin/suggestions')
  return { success: true }
}

export async function getAILogs(page: number = 1, pageSize: number = 50) {
  const isAdmin = await checkAdmin()
  if (!isAdmin) throw new Error("Unauthorized")

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, count, error } = await supabaseAdmin
    .from('ai_audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
     if (error.code === '42P01') return { data: [], count: 0, totalPages: 0 };
     throw new Error(error.message)
  }

  return {
    data: data || [],
    count: count || 0,
    totalPages: count ? Math.ceil(count / pageSize) : 0
  }
}
