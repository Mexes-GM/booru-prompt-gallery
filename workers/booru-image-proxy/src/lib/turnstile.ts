import { Env } from '../types'

const TURNSTILE_SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/**
 * Verify a Cloudflare Turnstile token (worker side).
 *
 * Graceful fallback: when TURNSTILE_SECRET_KEY is NOT configured this returns
 * `true` (feature off), so gates can be added to routes without breaking any
 * existing client. Once the secret is set, a valid token becomes required and
 * verification fails closed on network/parse errors.
 *
 * Shared by /api/feedback and the AI convert gate (F2 — rate-limit-antiabuse).
 */
export async function verifyTurnstile(
  env: Env,
  token: string | undefined | null,
  remoteIp?: string | null
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY
  if (!secret) return true // not configured → skip (feature off)
  if (!token) return false

  try {
    const body = new URLSearchParams()
    body.set('secret', secret)
    body.set('response', token)
    if (remoteIp && remoteIp !== 'anonymous' && remoteIp !== 'unknown') {
      body.set('remoteip', remoteIp)
    }

    const res = await fetch(TURNSTILE_SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data = (await res.json()) as { success: boolean }
    return data.success === true
  } catch (err) {
    console.error('[turnstile] verify failed:', err)
    return false // fail closed when the feature is enabled
  }
}

/** Whether Turnstile enforcement is active on this worker (secret present). */
export function isTurnstileConfigured(env: Env): boolean {
  return Boolean(env.TURNSTILE_SECRET_KEY)
}
