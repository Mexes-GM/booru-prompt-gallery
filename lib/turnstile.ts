/**
 * Server-side Cloudflare Turnstile verification.
 *
 * Graceful fallback: when TURNSTILE_SECRET_KEY is not configured, verification
 * is skipped (returns `ok`) so the feature can be rolled out without breaking
 * existing deployments. Once the secret is set, a valid token becomes required.
 */

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify"

export interface TurnstileResult {
  ok: boolean
  /** True when verification was skipped because no secret is configured. */
  skipped: boolean
  error?: string
}

export async function verifyTurnstile(
  token: string | undefined | null,
  remoteIp?: string | null
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY

  // Not configured → skip (feature off).
  if (!secret) return { ok: true, skipped: true }

  if (!token) return { ok: false, skipped: false, error: "missing-token" }

  try {
    const body = new URLSearchParams()
    body.set("secret", secret)
    body.set("response", token)
    if (remoteIp) body.set("remoteip", remoteIp)

    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    })

    const data = (await res.json()) as {
      success: boolean
      "error-codes"?: string[]
    }

    if (!data.success) {
      return {
        ok: false,
        skipped: false,
        error: data["error-codes"]?.join(",") || "verification-failed",
      }
    }

    return { ok: true, skipped: false }
  } catch (err) {
    // Fail closed on network/parse errors when the feature is enabled.
    return {
      ok: false,
      skipped: false,
      error: err instanceof Error ? err.message : "verify-error",
    }
  }
}
