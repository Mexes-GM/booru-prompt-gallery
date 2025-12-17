'use server'

import { cookies } from 'next/headers'
import crypto from 'crypto'
import { encrypt, decrypt } from '@/lib/session'

// In a real app, use a proper session library or Supabase Auth.
// We use a signed JWT stored in a HTTP-only cookie.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin' 
const COOKIE_NAME = 'admin_session'

export async function loginAdmin(password: string) {
  // Use timingSafeEqual to prevent timing attacks
  // We hash both to ensure they are the same length for the comparison
  const inputHash = crypto.createHash('sha256').update(password).digest()
  const correctHash = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest()
  
  // Basic length check first (though hashes are same length)
  if (inputHash.length !== correctHash.length) {
    return { success: false, message: 'Invalid password' }
  }

  if (crypto.timingSafeEqual(inputHash, correctHash)) {
    const cookieStore = await cookies()
    
    // Create session
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const session = await encrypt({ role: 'admin', expires })

    // Set cookie for 1 day
    cookieStore.set(COOKIE_NAME, session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      expires,
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
  const session = cookieStore.get(COOKIE_NAME)?.value
  if (!session) return false
  
  const payload = await decrypt(session)
  return payload?.role === 'admin'
}
