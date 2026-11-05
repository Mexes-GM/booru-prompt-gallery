import { timingSafeEqual } from 'node:crypto'

// Node runtime on purpose: the point of this route is to reach Gelbooru from
// a different network than the Cloudflare Worker, which Gelbooru answers with
// 429 on every request. The worker keeps caching, tag enrichment and rate
// limits; this route only forwards the API call.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GELBOORU_API = 'https://gelbooru.com/index.php'
const ALLOWED_PARAMS = ['s', 'pid', 'limit', 'tags', 'api_key', 'user_id', 'names', 'name_pattern', 'orderby', 'order'] as const
const ALLOWED_S = new Set(['post', 'tag'])
const TIMEOUT_MS = 15_000

function secretMatches(provided: string | null): boolean {
  const expected = process.env.GELBOORU_RELAY_SECRET
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  })
}

export async function GET(request: Request) {
  if (!secretMatches(request.headers.get('x-relay-secret'))) {
    return json({ error: 'Not found' }, 404)
  }

  const incoming = new URL(request.url).searchParams
  const s = incoming.get('s') ?? 'post'
  if (!ALLOWED_S.has(s)) return json({ error: 'Unsupported request' }, 400)

  const upstream = new URL(GELBOORU_API)
  upstream.searchParams.set('page', 'dapi')
  upstream.searchParams.set('q', 'index')
  upstream.searchParams.set('json', '1')
  for (const key of ALLOWED_PARAMS) {
    const value = incoming.get(key)
    if (value !== null) upstream.searchParams.set(key, value)
  }
  upstream.searchParams.set('s', s)

  try {
    const response = await fetch(upstream, {
      headers: {
        Accept: 'application/json',
        'User-Agent': request.headers.get('user-agent') ?? 'BooruPromptGallery/1.0',
        Referer: 'https://gelbooru.com/',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      // Keep the status (the worker maps 429/5xx itself) but not the body,
      // which can be an HTML challenge page.
      const retryAfter = response.headers.get('retry-after')
      return json(
        { error: `Gelbooru responded ${response.status}` },
        response.status,
        retryAfter ? { 'Retry-After': retryAfter } : {}
      )
    }
    return new Response(await response.text(), {
      status: 200,
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return json({ error: timedOut ? 'Gelbooru timed out' : 'Gelbooru unreachable' }, timedOut ? 504 : 502)
  }
}
