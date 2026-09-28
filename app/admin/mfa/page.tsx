'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import type { Factor } from '@supabase/supabase-js'

type Mode =
  | { kind: 'loading' }
  | { kind: 'enroll'; factorId: string; qrCode: string; secret: string }
  | { kind: 'verify'; factorId: string }
  | { kind: 'error'; message: string }

/**
 * Admin second-factor screen (reached via the proxy when ADMIN_REQUIRE_MFA=1
 * and the session is still aal1). First visit enrolls an authenticator app;
 * later visits just ask for the current 6-digit code.
 */
export default function AdminMfaPage() {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [mode, setMode] = useState<Mode>({ kind: 'loading' })
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function init() {
      const { data, error: listError } = await supabase.auth.mfa.listFactors()
      if (cancelled) return
      if (listError) {
        setMode({ kind: 'error', message: listError.message })
        return
      }

      const verified = (data.totp as Factor[]).find((f) => f.status === 'verified')
      if (verified) {
        setMode({ kind: 'verify', factorId: verified.id })
        return
      }

      // Drop half-finished enrollments from earlier visits so enroll() doesn't
      // collide with them.
      for (const factor of (data.all as Factor[]).filter((f) => f.status === 'unverified')) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id })
      }

      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Admin ${new Date().toISOString().slice(0, 10)}`,
      })
      if (cancelled) return
      if (enrollError || !enrolled) {
        setMode({ kind: 'error', message: enrollError?.message ?? 'Could not start enrollment' })
        return
      }
      setMode({
        kind: 'enroll',
        factorId: enrolled.id,
        qrCode: enrolled.totp.qr_code,
        secret: enrolled.totp.secret,
      })
    }

    init()
    return () => {
      cancelled = true
    }
  }, [supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode.kind !== 'enroll' && mode.kind !== 'verify') return
    setIsSubmitting(true)
    setError('')

    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: mode.factorId,
      code: code.trim(),
    })

    if (verifyError) {
      setError(verifyError.message.includes('Invalid') ? 'Invalid code, try again.' : verifyError.message)
      setIsSubmitting(false)
      return
    }

    router.refresh()
    router.push('/admin')
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Two-factor verification
          </CardTitle>
          <CardDescription>
            {mode.kind === 'enroll'
              ? 'Scan this code with an authenticator app (1Password, Google Authenticator, Aegis…), then enter the 6-digit code it shows.'
              : 'Enter the 6-digit code from your authenticator app.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode.kind === 'loading' && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {mode.kind === 'error' && (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {mode.message}
            </p>
          )}

          {mode.kind === 'enroll' && (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URL SVG from Supabase */}
              <img src={mode.qrCode} alt="Authenticator QR code" className="mx-auto h-44 w-44 rounded-md bg-white p-2" />
              <p className="break-all text-center font-mono text-xs text-muted-foreground">{mode.secret}</p>
            </div>
          )}

          {(mode.kind === 'enroll' || mode.kind === 'verify') && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="mfa-code">Code</Label>
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                  disabled={isSubmitting}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={isSubmitting || code.length !== 6}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
