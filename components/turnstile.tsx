"use client"

import { useEffect, useRef, useCallback, useId, useLayoutEffect } from "react"

/**
 * Cloudflare Turnstile widget — free, privacy-friendly CAPTCHA alternative.
 *
 * Renders nothing (and reports "ready" immediately) when
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set, so forms keep working in local
 * dev / when Turnstile isn't configured. Server-side verification is the real
 * gate; this widget just produces a token.
 *
 * Setup:
 *   1. Cloudflare dashboard → Turnstile → add a widget, get the Site Key + Secret.
 *   2. Set NEXT_PUBLIC_TURNSTILE_SITE_KEY (client) and TURNSTILE_SECRET_KEY (server).
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string
          callback?: (token: string) => void
          "expired-callback"?: () => void
          "error-callback"?: () => void
          theme?: "auto" | "light" | "dark"
          size?: "normal" | "flexible" | "compact"
        }
      ) => string
      reset: (widgetId?: string) => void
      remove: (widgetId?: string) => void
    }
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
const SCRIPT_ID = "cf-turnstile-script"

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve()
    if (window.turnstile) return resolve()

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener("load", () => resolve())
      existing.addEventListener("error", () => reject(new Error("turnstile load failed")))
      return
    }

    const script = document.createElement("script")
    script.id = SCRIPT_ID
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("turnstile load failed"))
    document.head.appendChild(script)
  })
}

interface TurnstileProps {
  /** Receives the token when solved, or null when expired/errored. */
  onVerify: (token: string | null) => void
  className?: string
  theme?: "auto" | "light" | "dark"
}

export function Turnstile({ onVerify, className, theme = "auto" }: TurnstileProps) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const onVerifyRef = useRef(onVerify)
  useLayoutEffect(() => {
    onVerifyRef.current = onVerify
  })
  const reactId = useId()

  const isConfigured = Boolean(siteKey)

  const render = useCallback(async () => {
    if (!siteKey || !containerRef.current) return
    await loadScript()
    if (!window.turnstile || !containerRef.current) return
    // Avoid double-render in React StrictMode.
    if (widgetIdRef.current) return

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme,
      callback: (token: string) => onVerifyRef.current(token),
      "expired-callback": () => onVerifyRef.current(null),
      "error-callback": () => onVerifyRef.current(null),
    })
  }, [siteKey, theme])

  useEffect(() => {
    // When Turnstile isn't configured, behave as a no-op pass-through so the
    // form's submit logic (which waits for a token only if configured) works.
    if (!isConfigured) return

    render()

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          /* ignore */
        }
        widgetIdRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured, render, reactId])

  if (!isConfigured) return null

  return <div ref={containerRef} className={className} />
}

/** Whether Turnstile is active on the client (site key present). */
export const isTurnstileEnabled = () =>
  Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
