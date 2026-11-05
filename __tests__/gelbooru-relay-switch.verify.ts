/**
 * Verification script for the Gelbooru direct/relay switch
 * (workers/booru-image-proxy/src/lib/booru/providers/gelbooru.ts):
 *   - direct by default; a 429/403/5xx moves the call (and the isolate) to the relay
 *   - while blocked, calls skip direct; after DIRECT_RETRY_MS direct is tried again
 *   - a query error (400) is not treated as a block
 *   - without relay settings, failures surface as before
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/gelbooru-relay-switch.verify.ts
 */
import {
  GelbooruProvider,
  DIRECT_RETRY_MS,
  resetGelbooruRoute,
} from '../workers/booru-image-proxy/src/lib/booru/providers/gelbooru'

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

const RELAY = 'https://app.example/api/gelbooru-relay'
const POSTS = JSON.stringify({
  post: [{ id: 1, file_url: 'https://img4.gelbooru.com/images/a.png', tags: 'solo', rating: 'general', score: 1, width: 10, height: 10 }],
})

type Route = 'direct' | 'relay'
// Answers by route; records which route each call took.
function mockFetch(answer: (route: Route) => Response): Route[] {
  const log: Route[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    const route: Route = url.startsWith(RELAY) ? 'relay' : 'direct'
    log.push(route)
    return answer(route)
  }) as typeof fetch
  return log
}

const ok = () => new Response(POSTS, { status: 200 })
const status = (s: number) => new Response('blocked', { status: s })

const withRelay = { GELBOORU_RELAY_URL: RELAY, GELBOORU_RELAY_SECRET: 's' }
const search = (env: Record<string, string>) =>
  new GelbooruProvider(env, null).search({ tags: 'solo', page: '1', order: 'recent', enrich: false })

async function main() {
  const realNow = Date.now
  let now = 1_000_000
  Date.now = () => now

  // 1. Healthy direct: one direct call, no relay.
  resetGelbooruRoute()
  let log = mockFetch(() => ok())
  let posts = await search(withRelay)
  assert(posts.length === 1 && log.join() === 'direct', 'healthy direct call stays direct')

  // 2. Direct 429 → same search retried through the relay, no inline direct retry.
  resetGelbooruRoute()
  log = mockFetch((r) => (r === 'direct' ? status(429) : ok()))
  posts = await search(withRelay)
  assert(posts.length === 1, 'blocked direct call still returns posts via relay')
  assert(log.join() === 'direct,relay', `429 falls back to relay once (got ${log.join()})`)

  // 3. While blocked, the next search goes straight to the relay.
  log = mockFetch(() => ok())
  await search(withRelay)
  assert(log.join() === 'relay', 'blocked isolate skips direct')

  // 4. After DIRECT_RETRY_MS, direct is tried again and, if healthy, kept.
  now += DIRECT_RETRY_MS + 1
  log = mockFetch(() => ok())
  await search(withRelay)
  assert(log.join() === 'direct', 'direct is probed again after the retry window')
  log = mockFetch(() => ok())
  await search(withRelay)
  assert(log.join() === 'direct', 'recovered direct stays direct')

  // 5. 403 and 5xx count as a block too.
  for (const s of [403, 503]) {
    resetGelbooruRoute()
    log = mockFetch((r) => (r === 'direct' ? status(s) : ok()))
    await search(withRelay)
    assert(log.join() === 'direct,relay', `${s} falls back to relay (got ${log.join()})`)
  }

  // 6. A query error is not a block: no relay call, error surfaces.
  resetGelbooruRoute()
  log = mockFetch(() => status(400))
  let threw = false
  try { await search(withRelay) } catch { threw = true }
  assert(threw && log.join() === 'direct', '400 surfaces without using the relay')

  // 7. No relay configured: behaves as before (direct, error surfaces).
  resetGelbooruRoute()
  log = mockFetch(() => status(429))
  threw = false
  try { await search({}) } catch { threw = true }
  assert(threw && !log.includes('relay'), 'without relay settings the 429 surfaces')

  Date.now = realNow
  console.log(`gelbooru-relay-switch: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
