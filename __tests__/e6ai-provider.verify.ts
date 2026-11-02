/**
 * Verification script for the e6ai provider (e6ai.net, e621's engine):
 *   - posts are read from e621's JSON shape, with e6ai's own category names
 *     ("director" for artists, "franchise" for copyrights)
 *   - search URLs, tag limits, rating and score floors match the e621 family
 *   - image hosts are allowed by both download proxies
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/e6ai-provider.verify.ts
 */
import { transformE621Post } from '../lib/booru/post-transformers'
import { createPostsKey } from '../lib/booru/posts-key'
import { getProviderTagLimit, getFinalQueryTagsWithMeta, isTagCountSupportedProvider, getScoreFloor, detectMisusedMetatags } from '../lib/booru/tag-limits'
import { ratingLetter } from '../lib/prompt/natural-format'
import { getPostUrl, getProviderSearchUrl, isAllowedImageHost } from '../lib/constants'
import { imageReferrerPolicy } from '../lib/proxy-url'
import { isAllowedImageHost as workerAllowsImageHost, refererForImageHost } from '../workers/booru-image-proxy/src/lib/constants'
import { isBooruProvider } from '../workers/booru-image-proxy/src/lib/booru/factory'

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

// ── Post shape (trimmed from a real e6ai.net /posts.json response) ──
const e6aiPost = {
  id: 14940,
  file: { width: 2048, height: 3072, url: 'https://static1.e6ai.net/data/88/06/8806.png' },
  sample: { url: 'https://static1.e6ai.net/data/sample/88/06/8806.jpg' },
  preview: { url: 'https://static1.e6ai.net/data/preview/88/06/8806.jpg' },
  tags: {
    general: ['anthro', 'alley'],
    director: ['terraraptor'],
    contributor: [],
    franchise: ['world_of_midria'],
    character: ['fenn_(midria)'],
    species: ['rat'],
    invalid: [],
    meta: ['hi_res', 'easyfluff_(model)'],
    lore: [],
  },
  rating: 'e',
  score: { total: 120 },
}

const post = transformE621Post(e6aiPost, 'e6ai')
assert(post._provider === 'e6ai', 'transform: provider is e6ai')
assert(post.tag_string_artist === 'terraraptor', 'transform: director is the artist')
assert(post.tag_string_copyright === 'world_of_midria', 'transform: franchise is the copyright')
assert(post.tag_string_character === 'fenn_(midria)', 'transform: character kept')
const tags = post.tag_string.split(' ')
assert(['anthro', 'rat', 'terraraptor', 'world_of_midria', 'fenn_(midria)'].every(t => tags.includes(t)), 'transform: content tags kept')
assert(!tags.includes('hi_res') && !tags.includes('easyfluff_(model)'), 'transform: meta tags left out')
assert(post.large_file_url.includes('/sample/') && post.score === 120 && post.width === 2048, 'transform: urls, score and size')

// e621 posts keep their own categories and provider.
const e621Post = transformE621Post({ id: 1, file: { url: 'https://static1.e621.net/a.png' }, tags: { artist: ['someone'], copyright: ['series'] }, rating: 's', score: { total: 1 } })
assert(e621Post._provider === 'e621' && e621Post.tag_string_artist === 'someone' && e621Post.tag_string_copyright === 'series', 'transform: e621 unchanged')

// ── Search URL ──
const keyFor = createPostsKey({ tags: 'wolf', ratingFilter: 'rating:general', order: 'recent', provider: 'e6ai', hasPrompt: false, scoreTier: 'off' })
const url = keyFor(1, null) ?? ''
assert(url.startsWith('https://e6ai.net/posts.json?'), `posts key: direct e6ai URL (${url})`)
const params = new URL(url).searchParams
assert(params.get('page') === '2' && params.get('limit') === '60', 'posts key: page and limit')
assert(params.get('tags') === 'rating:safe wolf', `posts key: rating:general becomes rating:safe (${params.get('tags')})`)
assert(!!params.get('_client'), 'posts key: identifies the client')

// ── Engine limits (confirmed against e6ai.net, 2026-11) ──
assert(getProviderTagLimit('e6ai') === 40, 'e6ai limit is 40')
assert(isTagCountSupportedProvider('e6ai'), 'tagcount supported: e6ai')
assert(getScoreFloor('e6ai', 'off') === null && getScoreFloor('e6ai', 'great') === 120, 'score floors for e6ai')
const general = getFinalQueryTagsWithMeta('', 'rating:general', 'recent', undefined, 'e6ai')
assert(general.tags.some(t => t.value === 'rating:safe') && !general.tags.some(t => t.value === 'rating:general'), 'e6ai: rating:general is remapped to rating:safe')
const warn = detectMisusedMetatags('1girl, rating:general', 'e6ai')
assert(warn.length === 1 && warn[0].suggestion === 'rating:safe' && warn[0].message.startsWith('e6AI '), 'e6ai: rating:general suggests rating:safe')
const e621Warn = detectMisusedMetatags('1girl, rating:general', 'e621')
assert(e621Warn.length === 1 && e621Warn[0].message.startsWith('e621 '), 'e621: warning still names e621')
assert(ratingLetter('s', 'e6ai') === 'g', "e6ai's s means safe")

// ── Links and images ──
assert(getPostUrl('e6ai', 5) === 'https://e6ai.net/posts/5', 'post link')
assert(getProviderSearchUrl('e6ai', 'wolf') === 'https://e6ai.net/posts?tags=wolf', 'tag search link')
assert(isAllowedImageHost('static1.e6ai.net') && !isAllowedImageHost('e6ai.net'), 'download route: CDN allowed, API host refused')
assert(workerAllowsImageHost('static1.e6ai.net') && !workerAllowsImageHost('e6ai.net'), 'worker: CDN allowed, API host refused')
assert(refererForImageHost('static1.e6ai.net') === 'https://e6ai.net/', 'worker: e6ai referer')
assert(imageReferrerPolicy('e6ai') === undefined, 'e6ai images keep the default referrer policy, like e621')
assert(isBooruProvider('e6ai'), 'worker: e6ai is a known provider')

// ── Order: Shuffle and Popular reach the e621-family API ──
// Without an order metatag the engine returns its newest posts for every order.
;(['e621', 'e6ai'] as const).forEach(provider => {
  const tagsFor = (order: string) => {
    const key = createPostsKey({ tags: 'wolf', ratingFilter: 'all', order, randomSeed: 7, provider, hasPrompt: false, scoreTier: 'off' })
    return new URL(key(0, null) ?? '').searchParams.get('tags') ?? ''
  }
  assert(tagsFor('random').split(' ').includes('order:random'), `${provider}: shuffle sends order:random (${tagsFor('random')})`)
  assert(tagsFor('popular').split(' ').includes('order:rank'), `${provider}: popular sends order:rank (${tagsFor('popular')})`)
  assert(!/order:/.test(tagsFor('recent')), `${provider}: recent sends no order (${tagsFor('recent')})`)
  const shown = getFinalQueryTagsWithMeta('wolf', 'all', 'random', undefined, provider)
  assert(shown.tags.some(t => t.value === 'order:random') && !shown.tags.some(t => t.value.startsWith('random:')), `${provider}: query panel shows order:random`)
})

console.log(`e6ai-provider: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
