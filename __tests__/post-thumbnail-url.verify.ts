/**
 * Verification script for getPostThumbnailUrl in lib/proxy-url.ts, used by the
 * Merge and Pack footers:
 *   - Gelbooru and Danbooru thumbnails always go through their proxies
 *   - the route depends only on the image host, so it can't differ between a
 *     post with `_provider` (History, Favorites) and one without (search)
 *   - other hosts stay direct
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/post-thumbnail-url.verify.ts
 */
export {}

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

const WORKER = 'https://worker.test'
const CDN = 'https://danbooru-test.cloudfront.net'
const GELBOORU = 'https://img4.gelbooru.com/thumbnails/33/75/thumbnail_a.jpg'
const DANBOORU_PATH = '/180x180/1b/fd/a.jpg'
const DANBOORU = `https://cdn.donmai.us${DANBOORU_PATH}`
const viaWorker = (url: string) => `${WORKER}?url=${encodeURIComponent(url)}`

// proxy-url reads its env vars at import time, so each case loads a fresh copy.
function load(env: { cdn?: string; worker?: string }): typeof import('../lib/proxy-url') {
  process.env.NEXT_PUBLIC_CDN_PROXY_URL = env.cdn ?? ''
  process.env.NEXT_PUBLIC_IMAGE_PROXY_URL = env.worker ?? ''
  delete require.cache[require.resolve('../lib/proxy-url')]
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- needs a fresh module, not the cached import
  return require('../lib/proxy-url')
}

{
  const p = load({ cdn: CDN, worker: WORKER })
  assert(p.getPostThumbnailUrl(GELBOORU) === viaWorker(GELBOORU), 'Gelbooru goes through the Worker')
  assert(p.getPostThumbnailUrl(GELBOORU) === p.getGelbooruProxyUrl(GELBOORU), 'same route as the gallery cards')
  assert(p.getPostThumbnailUrl(DANBOORU) === `${CDN}${DANBOORU_PATH}`, 'Danbooru goes through CloudFront')
  for (const direct of [
    'https://api-cdn.rule34.xxx/thumbnails/1/thumbnail_a.jpg',
    'https://cdn.aibooru.download/preview/a.jpg',
    'https://static1.e621.net/data/preview/a.jpg',
    'https://static1.e6ai.net/data/preview/a.jpg',
  ]) {
    assert(p.getPostThumbnailUrl(direct) === direct, `direct host stays direct: ${direct}`)
  }
  const lookalike = 'https://img4.gelbooru.com.evil.test/a.jpg'
  assert(p.getPostThumbnailUrl(lookalike) === lookalike, 'host match is exact')
  assert(p.getPostThumbnailUrl('') === '', 'empty input is returned as is')
}

{
  const p = load({ worker: WORKER })
  assert(
    p.getPostThumbnailUrl(DANBOORU) === `/api/download?url=${encodeURIComponent(DANBOORU)}&inline=1`,
    'Danbooru falls back to the download route without CloudFront'
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
