/**
 * Verification script for the Worker's image proxy limiter
 * (workers/booru-image-proxy/src/routes/image-proxy.ts):
 *   - cache misses are limited per client without any Upstash call
 *   - a client over its limit gets a 429 and no upstream image fetch
 *   - another client is unaffected
 *   - cache hits are not counted
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/image-proxy-limit.verify.ts
 */
import { imageProxyHandler } from '../workers/booru-image-proxy/src/routes/image-proxy'
import { WORKER_LIMITS } from '../workers/booru-image-proxy/src/lib/limits'

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

const env = { UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 't' }
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext
const imageUrl = 'https://img4.gelbooru.com/thumbnails/aa/bb/thumbnail_x.jpg'

function requestFrom(ip: string, target = imageUrl): Request {
  const url = `https://proxy.test/?url=${encodeURIComponent(target)}`
  return new Request(url, { headers: { 'Sec-Fetch-Dest': 'image', 'cf-connecting-ip': ip } })
}

async function main() {
  const seen: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input))
    return new Response('img', { status: 200, headers: { 'content-type': 'image/jpeg' } })
  }) as typeof fetch

  let hit: Response | undefined
  const cachesStub = {
    default: {
      match: async () => hit?.clone(),
      put: async () => {},
    },
  }
  ;(globalThis as unknown as { caches: unknown }).caches = cachesStub

  const max = WORKER_LIMITS.image.perIp.max

  // Cache hits never count toward the limit.
  hit = new Response('cached', { status: 200 })
  for (let i = 0; i < max + 5; i++) {
    const res = await imageProxyHandler(requestFrom('1.1.1.1'), env, ctx)
    assert(res.status === 200, `cache hit ${i} is served`)
  }
  assert(seen.length === 0, 'cache hits make no outbound call')
  hit = undefined

  // Cache misses up to the limit pass, the next one is rejected.
  let last = 0
  for (let i = 0; i < max; i++) {
    last = (await imageProxyHandler(requestFrom('2.2.2.2'), env, ctx)).status
  }
  assert(last === 200, 'the last request within the limit is served')
  const fetchesBefore = seen.length
  const over = await imageProxyHandler(requestFrom('2.2.2.2'), env, ctx)
  assert(over.status === 429, `a client over the limit gets 429 (got ${over.status})`)
  assert(over.headers.get('Retry-After') !== null, 'the 429 says when to retry')
  assert(seen.length === fetchesBefore, 'a rejected request makes no outbound call')

  // Other clients keep working, and nothing ever reached Upstash.
  const other = await imageProxyHandler(requestFrom('3.3.3.3'), env, ctx)
  assert(other.status === 200, 'another client is unaffected')
  assert(!seen.some((url) => url.includes('redis.test')), 'the limiter makes no Upstash call')

  console.log(`${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
