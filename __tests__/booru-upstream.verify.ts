/**
 * Verification script for the Worker's outbound booru plumbing:
 *   - fetchUpstream retry policy (workers/booru-image-proxy/src/lib/upstream.ts)
 *   - toClientError / isUpstreamOutage mapping
 *   - recordOutcome only feeding provider-side failures to the circuit breaker
 *   - image host allow-list (API/site hosts must be refused) and media check
 *   - mapWithConcurrency bound
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/booru-upstream.verify.ts
 */
import { fetchUpstream, UpstreamError, isUpstreamOutage, toClientError } from '../workers/booru-image-proxy/src/lib/upstream'
import { isAllowedImageHost, isMediaContentType, danbooruApiHeaders } from '../workers/booru-image-proxy/src/lib/constants'
import { mapWithConcurrency } from '../workers/booru-image-proxy/src/utils'
import { recordOutcome } from '../workers/booru-image-proxy/src/lib/circuit-breaker'
import type { Redis } from '../workers/booru-image-proxy/src/lib/redis'

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

// Replace global fetch with a scripted sequence of responses; returns the call log.
function mockFetch(responses: Array<Response | Error>): { calls: number } {
  const log = { calls: 0 }
  globalThis.fetch = (async () => {
    const next = responses[Math.min(log.calls, responses.length - 1)]
    log.calls++
    if (next instanceof Error) throw next
    return next
  }) as typeof fetch
  return log
}

async function expectError(promise: Promise<unknown>): Promise<UpstreamError | null> {
  try {
    await promise
    return null
  } catch (e) {
    return e instanceof UpstreamError ? e : null
  }
}

async function main() {
  // ── fetchUpstream: success on first try ──
  {
    const log = mockFetch([new Response('[]', { status: 200 })])
    const res = await fetchUpstream('https://example.test/')
    assert(res.ok && log.calls === 1, '200 returns immediately with one call')
  }

  // ── 4xx caused by the query is never retried ──
  for (const status of [400, 401, 403, 404, 410, 422]) {
    const log = mockFetch([new Response('', { status })])
    const err = await expectError(fetchUpstream('https://example.test/'))
    assert(err?.status === status && log.calls === 1, `${status} is thrown without retry`)
  }

  // ── 429 with a long Retry-After is surfaced, not retried ──
  {
    const log = mockFetch([new Response('', { status: 429, headers: { 'Retry-After': '60' } })])
    const err = await expectError(fetchUpstream('https://example.test/'))
    assert(err?.status === 429 && err.retryAfter === 60 && log.calls === 1, '429 + Retry-After 60 → no retry, retryAfter kept')
  }

  // ── 429 without Retry-After is surfaced, not retried ──
  {
    const log = mockFetch([new Response('', { status: 429 })])
    const err = await expectError(fetchUpstream('https://example.test/'))
    assert(err?.status === 429 && log.calls === 1, '429 without Retry-After → no retry')
  }

  // ── 503 is retried exactly once (retries = 1) ──
  {
    const log = mockFetch([new Response('', { status: 503 }), new Response('', { status: 503 })])
    const err = await expectError(fetchUpstream('https://example.test/'))
    assert(err?.status === 503 && log.calls === 2, '503 → one retry, then thrown')
  }

  // ── transient 502 then success ──
  {
    const log = mockFetch([new Response('', { status: 502 }), new Response('ok', { status: 200 })])
    const res = await fetchUpstream('https://example.test/')
    assert(res.ok && log.calls === 2, '502 then 200 → recovers on the retry')
  }

  // ── network error maps to 502 ──
  {
    const log = mockFetch([new TypeError('connection refused')])
    const err = await expectError(fetchUpstream('https://example.test/', { retries: 0 }))
    assert(err?.status === 502 && log.calls === 1, 'network error → UpstreamError 502')
  }

  // ── outage classification ──
  assert(isUpstreamOutage(new UpstreamError('x', 500)), '500 is an outage')
  assert(isUpstreamOutage(new UpstreamError('x', 429)), '429 is an outage')
  assert(isUpstreamOutage(new UpstreamError('x', 504)), 'timeout is an outage')
  assert(!isUpstreamOutage(new UpstreamError('x', 422)), '422 (bad query) is NOT an outage')
  assert(!isUpstreamOutage(new UpstreamError('x', 410)), '410 (deep page) is NOT an outage')

  // ── client error mapping never relays upstream text ──
  assert(toClientError(new UpstreamError('secret upstream detail', 500)).message.indexOf('secret') === -1, 'upstream message is not relayed')
  assert(toClientError(new UpstreamError('x', 422)).status === 422, '422 stays 422')
  assert(toClientError(new UpstreamError('x', 503)).status === 502, '503 → 502')
  assert(toClientError(new UpstreamError('x', 429, 7)).retryAfter === 7, '429 keeps retryAfter')
  assert(toClientError(new Error('boom')).status === 500, 'non-upstream error → 500')

  // ── circuit breaker only counts provider-side failures ──
  {
    const evals: string[] = []
    const fakeRedis = {
      eval: async (script: string) => {
        evals.push(script.includes('INCR') ? 'failure' : 'success')
        return 1
      },
    } as unknown as Redis
    await recordOutcome(fakeRedis, 'test-a', 'closed', new UpstreamError('x', 422))
    assert(evals.length === 0, '422 does not touch the breaker')
    await recordOutcome(fakeRedis, 'test-b', 'closed', new UpstreamError('x', 503))
    assert(evals[evals.length - 1] === 'failure', '503 records a failure')
    const before = evals.length
    await recordOutcome(fakeRedis, 'test-c', 'closed')
    assert(evals.length === before, 'success on a closed circuit spends no command')
    await recordOutcome(fakeRedis, 'test-d', 'half-open')
    assert(evals[evals.length - 1] === 'success', 'success on half-open closes it')
  }

  // ── image host allow-list ──
  for (const host of ['cdn.donmai.us', 'img3.gelbooru.com', 'static1.e621.net', 'cdn.aibooru.download', 'wimg.rule34.xxx', 'api-cdn.rule34.xxx']) {
    assert(isAllowedImageHost(host), `image host allowed: ${host}`)
  }
  for (const host of ['danbooru.donmai.us', 'gelbooru.com', 'e621.net', 'api.rule34.xxx', 'rule34.xxx', 'aibooru.online', 'evil.com', 'cdn.donmai.us.evil.com']) {
    assert(!isAllowedImageHost(host), `non-image host refused: ${host}`)
  }
  assert(isMediaContentType('image/jpeg'), 'image/jpeg is media')
  assert(isMediaContentType('video/mp4; codecs=avc1'), 'video/mp4 is media')
  assert(!isMediaContentType('application/json'), 'JSON is not media')
  assert(!isMediaContentType('text/html; charset=utf-8'), 'HTML is not media')
  assert(!isMediaContentType(null), 'missing Content-Type is not media')

  // ── Danbooru credentials only in the Danbooru helper ──
  {
    const withCreds = danbooruApiHeaders({ DANBOORU_USERNAME: 'u', DANBOORU_API_KEY: 'k' })
    assert(withCreds.Authorization === `Basic ${btoa('u:k')}`, 'Basic auth built from env')
    assert(withCreds['User-Agent'].includes('booru-prompt-gallery.com'), 'User-Agent carries a contact URL')
    assert(danbooruApiHeaders({}).Authorization === undefined, 'no credentials → no Authorization header')
  }

  // ── bounded concurrency ──
  {
    let inFlight = 0
    let peak = 0
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return n * 2
    })
    assert(peak <= 3, `never more than 3 in flight (peak ${peak})`)
    assert(results.join(',') === '2,4,6,8,10,12,14', 'results keep input order')
  }

  console.log(`booru-upstream: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
