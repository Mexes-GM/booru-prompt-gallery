import Script from "next/script"

/**
 * Cloudflare Web Analytics — privacy-friendly, cookieless, free.
 *
 * Unlike `@vercel/analytics`, which only collects data when the app is
 * hosted on Vercel, this beacon works on ANY host (Netlify, Vercel,
 * Cloudflare Pages, etc.). Since production lives on Netlify, this is the
 * component that actually records pageviews.
 *
 * Setup (one-time):
 *   1. Cloudflare dashboard → Analytics & Logs → Web Analytics → "Add a site".
 *   2. Copy the beacon token (the value inside `data-cf-beacon='{"token":"..."}'`).
 *   3. Set NEXT_PUBLIC_CF_BEACON_TOKEN in your deployment environment.
 *
 * No-op when the token is absent (e.g. local development), so it never
 * loads third-party scripts during dev.
 */
export function CloudflareAnalytics() {
  const token = process.env.NEXT_PUBLIC_CF_BEACON_TOKEN

  if (!token) return null

  return (
    <Script
      id="cloudflare-web-analytics"
      src="https://static.cloudflareinsights.com/beacon.min.js"
      strategy="afterInteractive"
      defer
      data-cf-beacon={JSON.stringify({ token })}
    />
  )
}
