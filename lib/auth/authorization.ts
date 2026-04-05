import { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type UserRole = 'user' | 'admin' | 'moderator'

export interface ProfileRecord {
  id: string
  email: string | null
  username: string | null
  avatar_url: string | null
  role: UserRole
  preferences: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) {
    throw new UnauthorizedError('No active session found')
  }
  return user
}

export async function getUserProfile(userId: string): Promise<ProfileRecord | null> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  
  return profile as ProfileRecord | null
}

export async function requireAdmin(): Promise<User> {
  const user = await requireAuth()
  
  const profile = await getUserProfile(user.id)
  
  if (!profile || profile.role !== 'admin') {
    throw new ForbiddenError('Admin access required')
  }
  
  return user
}

export async function requireRole(allowedRoles: UserRole[]): Promise<User> {
  const user = await requireAuth()
  
  const profile = await getUserProfile(user.id)
  
  if (!profile || !allowedRoles.includes(profile.role)) {
    throw new ForbiddenError(`Role ${profile?.role ?? 'none'} not authorized`)
  }
  
  return user
}

export async function isAdmin(userId: string): Promise<boolean> {
  const profile = await getUserProfile(userId)
  return profile?.role === 'admin'
}

export async function hasRole(userId: string, role: UserRole): Promise<boolean> {
  const profile = await getUserProfile(userId)
  return profile?.role === role
}
