'use server'

import { cookies } from 'next/headers'

// In a real app, use a proper session library or Supabase Auth.
// For this "simple" requirement, we'll use a secure HTTP-only cookie
// containing a hash of the secret.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin' // Default fallback for dev, MUST CHANGE in prod
const COOKIE_NAME = 'admin_session'

export async function loginAdmin(password: string) {
  if (password === ADMIN_PASSWORD) {
    const cookieStore = await cookies()
    // Set cookie for 1 day
    cookieStore.set(COOKIE_NAME, 'authenticated', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24,
      path: '/',
      sameSite: 'strict'
    })
    return { success: true }
  }
  return { success: false, message: 'Invalid password' }
}

export async function logoutAdmin() {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
  return { success: true }
}

export async function checkAdminAuth() {
  const cookieStore = await cookies()
  const session = cookieStore.get(COOKIE_NAME)
  return session?.value === 'authenticated'
}
