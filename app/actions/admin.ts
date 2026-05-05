'use server'

import { supabaseAdmin } from '@/lib/supabase-admin'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth/authorization'
import { redirect } from 'next/navigation'

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

  return {
    data: data as TagSuggestion[],
    count: count || 0,
    page,
    pageSize,
    totalPages: count ? Math.ceil(count / pageSize) : 0
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
