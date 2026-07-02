import { NextResponse } from 'next/server'
import { SOCIAL_URLS, USER_AGENT } from '@/lib/constants'

export const runtime = 'edge'

// Status is read frequently by every visitor's badge widget, so we cache it
// hard at the CDN (60s). That means at most ~1 real upstream check per minute
// per edge region, keeping Vercel/Netlify function CPU negligible.
const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
  'CDN-Cache-Control': 'public, s-maxage=60',
  'Vercel-CDN-Cache-Control': 'public, s-maxage=60',
  'Netlify-CDN-Cache-Control': 'public, s-maxage=60',
}

type DeploymentStatus = 'up' | 'down' | 'paused' | 'unknown'

interface StatusPayload {
  source: 'uptimerobot' | 'ping' | 'none'
  checkedAt: string
  deployments: {
    vercel: { status: DeploymentStatus; url: string }
    netlify: { status: DeploymentStatus; url: string }
  }
}

const DEPLOYMENTS = {
  vercel: SOCIAL_URLS.VERCEL,
  netlify: SOCIAL_URLS.NETLIFY,
} as const

// --- UptimeRobot (authoritative source when configured) ---------------------

// UptimeRobot monitor.status codes:
//   0 = paused, 1 = not checked yet, 2 = up, 8 = seems down, 9 = down
function mapUptimeRobotStatus(code: number): DeploymentStatus {
  switch (code) {
    case 2:
      return 'up'
    case 8:
    case 9:
      return 'down'
    case 0:
      return 'paused'
    default:
      return 'unknown'
  }
}

async function fetchFromUptimeRobot(apiKey: string): Promise<StatusPayload['deployments'] | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch('https://api.uptimerobot.com/v2/getMonitors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: new URLSearchParams({ api_key: apiKey, format: 'json' }).toString(),
      signal: controller.signal,
    })
    if (!res.ok) return null

    const data: any = await res.json()
    if (data?.stat !== 'ok' || !Array.isArray(data.monitors)) return null

    // Optional friendly-name overrides; otherwise match by monitor URL host.
    const vercelName = process.env.UPTIMEROBOT_VERCEL_NAME?.toLowerCase()
    const netlifyName = process.env.UPTIMEROBOT_NETLIFY_NAME?.toLowerCase()

    let vercel: DeploymentStatus = 'unknown'
    let netlify: DeploymentStatus = 'unknown'

    for (const m of data.monitors) {
      const url = String(m?.url ?? '').toLowerCase()
      const name = String(m?.friendly_name ?? '').toLowerCase()
      const status = mapUptimeRobotStatus(Number(m?.status))

      const isNetlify = netlifyName ? name.includes(netlifyName) : url.includes('netlify')
      const isVercel = vercelName
        ? name.includes(vercelName)
        : url.includes('vercel') || url.includes('booru-prompt-gallery.com')

      if (isNetlify) netlify = status
      else if (isVercel) vercel = status
    }

    return {
      vercel: { status: vercel, url: DEPLOYMENTS.vercel },
      netlify: { status: netlify, url: DEPLOYMENTS.netlify },
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// --- Ping fallback (no config required) --------------------------------------

// Hits each deployment's /api/version — a DB-free, CDN-cached route, so this
// stays cheap. A 200 means the deployment's functions are serving; anything
// else (incl. a maintenance 503) is treated as down. This is a best-effort
// signal only; UptimeRobot (external prober) is the authoritative source.
async function pingDeployment(baseUrl: string): Promise<DeploymentStatus> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`${baseUrl}/api/version`, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    })
    return res.ok ? 'up' : 'down'
  } catch {
    return 'down'
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchByPing(): Promise<StatusPayload['deployments']> {
  const [vercel, netlify] = await Promise.all([
    pingDeployment(DEPLOYMENTS.vercel),
    pingDeployment(DEPLOYMENTS.netlify),
  ])
  return {
    vercel: { status: vercel, url: DEPLOYMENTS.vercel },
    netlify: { status: netlify, url: DEPLOYMENTS.netlify },
  }
}

export async function GET() {
  const apiKey = process.env.UPTIMEROBOT_API_KEY

  let source: StatusPayload['source'] = 'ping'
  let deployments: StatusPayload['deployments'] | null = null

  if (apiKey) {
    deployments = await fetchFromUptimeRobot(apiKey)
    if (deployments) source = 'uptimerobot'
  }

  // Fall back to live pings if UptimeRobot is unconfigured or errored.
  if (!deployments) {
    deployments = await fetchByPing()
    source = 'ping'
  }

  const payload: StatusPayload = {
    source,
    checkedAt: new Date().toISOString(),
    deployments,
  }

  return NextResponse.json(payload, { headers: CACHE_HEADERS })
}
