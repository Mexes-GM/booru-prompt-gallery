const sentryConfigured = Boolean(process.env.SENTRY_AUTH_TOKEN)

export async function register() {
  if (!sentryConfigured) return
  try {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      await import('./sentry.server.config')
    }
    if (process.env.NEXT_RUNTIME === 'edge') {
      await import('./sentry.edge.config')
    }
  } catch {}
}

export const onRequestError = sentryConfigured
  ? async (err: Error, request: Request, context: unknown) => {
      try {
        const Sentry = await import('@sentry/nextjs')
        Sentry.captureRequestError(err, request as any, context as any)
      } catch {}
    }
  : undefined
