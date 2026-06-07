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
})

const RATE_LIMIT_WINDOW = 60 * 60 * 1000
const MAX_REQUESTS = 3

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
