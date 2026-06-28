import { z } from 'zod'
import { Env } from '../types'
import { getSupabase } from '../lib/supabase'
import { jsonResponse, getClientIp } from '../utils'

const feedbackSchema = z.object({
  type: z.enum(['bug', 'feature', 'general', 'other']),
  content: z.string().min(1).max(2000).trim(),
  contact_info: z.string().max(100).optional().nullable(),
  metadata: z.record(z.string(), z.any()).optional().default({}),
  honeypot: z.string().optional(),
  turnstile_token: z.string().max(2048).optional(),
})

const RATE_LIMIT_WINDOW = 60 * 60 * 1000
const MAX_REQUESTS = 3

const TURNSTILE_SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/**
 * Verify a Turnstile token. No-op (returns true) when TURNSTILE_SECRET_KEY is
 * not configured, so the feature can be enabled later without breaking clients.
 */
async function verifyTurnstile(
  env: Env,
  token: string | undefined,
  remoteIp: string
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY
  if (!secret) return true // not configured → skip
  if (!token) return false

  try {
    const body = new URLSearchParams()
    body.set('secret', secret)
    body.set('response', token)
    if (remoteIp && remoteIp !== 'anonymous') body.set('remoteip', remoteIp)

    const res = await fetch(TURNSTILE_SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data = (await res.json()) as { success: boolean }
    return data.success === true
  } catch (err) {
    console.error('[feedback] Turnstile verify failed:', err)
    return false // fail closed when enabled
  }
}

export async function feedbackHandler(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    const body = await request.json()
    const result = feedbackSchema.safeParse(body)

    if (!result.success) {
      return jsonResponse(
        { error: 'Invalid input', details: result.error.flatten() },
        400
      )
    }

    if (result.data.honeypot) {
      return jsonResponse({ success: true }, 200)
    }

    const { type, content, contact_info, metadata } = result.data
    const supabase = getSupabase(env)

    if (!supabase) {
      return jsonResponse({ error: 'Internal Server Error' }, 500)
    }

    // Rate limiting
    const ip = getClientIp(request)
    const userAgent = request.headers.get('user-agent') || 'unknown'

    // Cloudflare Turnstile verification (no-op when not configured)
    const turnstileOk = await verifyTurnstile(env, result.data.turnstile_token, ip)
    if (!turnstileOk) {
      return jsonResponse({ error: 'Verification failed. Please try again.' }, 403)
    }

    if (ip !== 'unknown' && ip !== '127.0.0.1') {
      const { count, error } = await supabase
        .from('rate_limits')
        .select('*', { count: 'exact', head: true })
        .eq('ip', ip)
        .eq('action', 'feedback')
        .gt('created_at', new Date(Date.now() - RATE_LIMIT_WINDOW).toISOString())

      if (!error && count !== null && count >= MAX_REQUESTS) {
        return jsonResponse(
          { error: 'Too many requests. Please try again later.' },
          429
        )
      }

      await supabase.from('rate_limits').insert({ ip, action: 'feedback' })
    }

    // Save to Supabase
    const { error: dbError } = await supabase.from('feedback').insert({
      type,
      content,
      contact_info,
      metadata: {
        ...metadata,
        ip_hash: 'REDACTED',
        user_agent: userAgent.substring(0, 200),
      },
      status: 'new',
    })

    if (dbError) {
      console.error('[feedback] Supabase error:', dbError)
      return jsonResponse({ error: 'Failed to save feedback' }, 500)
    }

    // Discord webhook (fire-and-forget)
    const discordWebhookUrl = env.DISCORD_FEEDBACK_WEBHOOK_URL
    if (discordWebhookUrl) {
      ctx.waitUntil(
        fetch(discordWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [
              {
                title: `New Feedback: ${type.toUpperCase()}`,
                color: type === 'bug' ? 15158332 : type === 'feature' ? 3066993 : 3447003,
                fields: [
                  { name: 'Content', value: content.substring(0, 1024) },
                  { name: 'Contact', value: contact_info || 'Anonymous', inline: true },
                  { name: 'Platform', value: 'Web', inline: true },
                ],
                footer: { text: 'Booru Gallery Feedback System' },
                timestamp: new Date().toISOString(),
              },
            ],
          }),
        }).catch((err) => console.error('[feedback] Discord webhook failed:', err))
      )
    }

    return jsonResponse({ success: true }, 200)
  } catch (err) {
    console.error('[feedback] error:', err)
    return jsonResponse({ error: 'Internal Server Error' }, 500)
  }
}
