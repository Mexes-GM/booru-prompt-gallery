import { supabaseAdmin } from '@/lib/supabase-admin'

export type AuthEventType =
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'magic_link_sent'
  | 'magic_link_failed'
  | 'admin_action'
  | 'preference_change'
  | 'unauthorized_access'

export interface AuthAuditEntry {
  user_id: string | null
  event_type: AuthEventType
  details: Record<string, unknown> | null
  ip_hash: string | null
  user_agent: string | null
  created_at: string
}

function hashIP(ip: string): string {
  let hash = 0
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return `hashed_${Math.abs(hash).toString(36)}`
}

export async function logAuthEvent(
  eventType: AuthEventType,
  options?: {
    userId?: string | null
    details?: Record<string, unknown>
    ip?: string
    userAgent?: string
  }
): Promise<void> {
  try {
    const ipHash = options?.ip ? hashIP(options.ip) : null
    const userAgent = options?.userAgent ?? null

    await supabaseAdmin.from('auth_audit_logs').insert({
      user_id: options?.userId ?? null,
      event_type: eventType,
      details: options?.details ?? null,
      ip_hash: ipHash,
      user_agent: userAgent,
      created_at: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[auth-audit] Failed to log event:', error)
  }
}
