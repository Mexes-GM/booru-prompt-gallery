/**
 * Verification script for Gelbooru image routing in lib/proxy-url.ts:
 *   - with NEXT_PUBLIC_GELBOORU_CDN_URL set, img4.gelbooru.com goes to CloudFront
 *     and the Worker stays as the retry
 *   - with it unset, nothing changes: the Worker serves Gelbooru, with no retry
 *   - Rule34 and other hosts never reach the Gelbooru distribution
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/gelbooru-cdn.verify.ts
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

const CDN = 'https://gelbooru-test.cloudfront.net'
const WORKER = 'https://worker.test'
const THUMB_PATH = '/thumbnails/4d/97/thumbnail_4d97599e794254c8bb0d4c3747574d74.jpg'
const THUMB = `https://img4.gelbooru.com${THUMB_PATH}`
const VIDEO = 'https://img4.gelbooru.com/images/f4/60/f460f45a6858529f63c5f5fe1aa50e29.mp4'
const RULE34 = 'https://api-cdn.rule34.xxx/thumbnails/1/thumbnail_a.jpg'
const viaWorker = (url: string) => `${WORKER}?url=${encodeURIComponent(url)}`

// proxy-url reads its env vars at import time, so each case loads a fresh copy.
function load(env: { cdn?: string; worker?: string }): typeof import('../lib/proxy-url') {
  process.env.NEXT_PUBLIC_GELBOORU_CDN_URL = env.cdn ?? ''
  process.env.NEXT_PUBLIC_IMAGE_PROXY_URL = env.worker ?? ''
  delete require.cache[require.resolve('../lib/proxy-url')]
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- needs a fresh module, not the cached import
  return require('../lib/proxy-url')
}

{
  const p = load({ cdn: CDN, worker: WORKER })
  assert(p.getGelbooruProxyUrl(THUMB) === `${CDN}${THUMB_PATH}`, 'thumbnail goes to CloudFront')
  assert(p.getGelbooruProxyUrl(VIDEO).startsWith(`${CDN}/images/`), 'video goes to CloudFront')
  assert(p.getGelbooruProxyUrl(`${THUMB}?123`) === `${CDN}${THUMB_PATH}?123`, 'query string is kept')
  assert(p.getGelbooruFallbackUrl(THUMB) === viaWorker(THUMB), 'Worker is the retry')
  assert(p.getGelbooruProxyUrl(RULE34) === viaWorker(RULE34), 'Rule34 stays on the Worker')
  assert(p.getGelbooruFallbackUrl(RULE34) === undefined, 'Rule34 has no retry')
  const otherHost = 'https://video-cdn3.gelbooru.com/images/a.mp4'
  assert(p.getGelbooruProxyUrl(otherHost) === viaWorker(otherHost), 'other Gelbooru hosts stay on the Worker')
  assert(p.getGelbooruCdnUrl('https://img4.gelbooru.com.evil.test/a.jpg') === null, 'host match is exact')
  assert(p.getGelbooruCdnUrl('not a url') === null, 'relative input is ignored')
  assert(p.getGelbooruCdnUrl('') === null, 'empty input is ignored')
}

{
  const p = load({ cdn: `${CDN}/`, worker: WORKER })
  assert(p.getGelbooruProxyUrl(THUMB) === `${CDN}${THUMB_PATH}`, 'trailing slash in the env var is dropped')
}

{
  const p = load({ worker: WORKER })
  assert(p.getGelbooruCdnUrl(THUMB) === null, 'no CloudFront URL when unset')
  assert(p.getGelbooruProxyUrl(THUMB) === viaWorker(THUMB), 'Worker serves Gelbooru when unset')
  assert(p.getGelbooruFallbackUrl(THUMB) === undefined, 'no retry when the Worker was already used')
}

{
  const p = load({ cdn: CDN })
  assert(p.getGelbooruProxyUrl(THUMB) === `${CDN}${THUMB_PATH}`, 'CloudFront works without a Worker')
  assert(p.getGelbooruFallbackUrl(THUMB) === undefined, 'no retry without a Worker')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
