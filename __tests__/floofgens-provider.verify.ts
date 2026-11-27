/**
 * Verification script for the Floofgens provider (floofgens.net, e621's engine,
 * which replaced the retired e6ai.net and kept its post ids):
 *   - posts in e6ai's legacy shape still parse ("director" for artists,
 *     "franchise" for copyrights)
 *   - search URLs, tag limits, rating and score floors match the e621 family
 *   - image hosts are allowed by both download proxies
 *   - data saved under "e6ai" (provider, favorites, history, cached posts)
 *     maps to Floofgens
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/floofgens-provider.verify.ts
 */
import { transformE621Post } from '../lib/booru/post-transformers'
import { createPostsKey } from '../lib/booru/posts-key'
import { getProviderTagLimit, getFinalQueryTagsWithMeta, isTagCountSupportedProvider, getScoreFloor, detectMisusedMetatags } from '../lib/booru/tag-limits'
import { ratingLetter } from '../lib/prompt/natural-format'
import { getPostUrl, getProviderSearchUrl, isAllowedImageHost } from '../lib/constants'
import { imageReferrerPolicy } from '../lib/proxy-url'
import { isAllowedImageHost as workerAllowsImageHost, refererForImageHost } from '../workers/booru-image-proxy/src/lib/constants'
import { isBooruProvider } from '../workers/booru-image-proxy/src/lib/booru/factory'
import { canonicalProvider, migrateRetiredPost } from '../lib/booru/retired-providers'
import { favKey } from '../lib/favorites-logic'
import { cachedRowToBooruPost } from '../lib/favorites/cache'

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

// ── Legacy post shape (trimmed from an e6ai.net /posts.json response) ──
const legacyPost = {
  id: 14940,
  file: { width: 2048, height: 3072, url: 'https://static1.floofgens.net/data/88/06/8806.png' },
  sample: { url: 'https://static1.floofgens.net/data/sample/88/06/8806.jpg' },
  preview: { url: 'https://static1.floofgens.net/data/preview/88/06/8806.jpg' },
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

const post = transformE621Post(legacyPost, 'floofgens')
assert(post._provider === 'floofgens', 'transform: provider is floofgens')
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
const keyFor = createPostsKey({ tags: 'wolf', ratingFilter: 'rating:general', order: 'recent', provider: 'floofgens', hasPrompt: false, scoreTier: 'off' })
const url = keyFor(1, null) ?? ''
assert(url.startsWith('https://floofgens.net/posts.json?'), `posts key: direct Floofgens URL (${url})`)
const params = new URL(url).searchParams
assert(params.get('page') === '2' && params.get('limit') === '60', 'posts key: page and limit')
assert(params.get('tags') === 'rating:safe wolf', `posts key: rating:general becomes rating:safe (${params.get('tags')})`)
assert(!!params.get('_client'), 'posts key: identifies the client')

// ── Engine limits (confirmed against floofgens.net, 2026-11; score floors measured on e6ai.net) ──
assert(getProviderTagLimit('floofgens') === 40, 'floofgens limit is 40')
assert(isTagCountSupportedProvider('floofgens'), 'tagcount supported: floofgens')
assert(getScoreFloor('floofgens', 'off') === null && getScoreFloor('floofgens', 'great') === 120, 'score floors for floofgens')
const general = getFinalQueryTagsWithMeta('', 'rating:general', 'recent', undefined, 'floofgens')
assert(general.tags.some(t => t.value === 'rating:safe') && !general.tags.some(t => t.value === 'rating:general'), 'floofgens: rating:general is remapped to rating:safe')
const warn = detectMisusedMetatags('1girl, rating:general', 'floofgens')
assert(warn.length === 1 && warn[0].suggestion === 'rating:safe' && warn[0].message.startsWith('Floofgens '), 'floofgens: rating:general suggests rating:safe')
const e621Warn = detectMisusedMetatags('1girl, rating:general', 'e621')
assert(e621Warn.length === 1 && e621Warn[0].message.startsWith('e621 '), 'e621: warning still names e621')
assert(ratingLetter('s', 'floofgens') === 'g', "floofgens' s means safe")

// ── Links and images ──
assert(getPostUrl('floofgens', 5) === 'https://floofgens.net/posts/5', 'post link')
assert(getProviderSearchUrl('floofgens', 'wolf') === 'https://floofgens.net/posts?tags=wolf', 'tag search link')
assert(isAllowedImageHost('static1.floofgens.net') && !isAllowedImageHost('floofgens.net'), 'download route: CDN allowed, API host refused')
assert(workerAllowsImageHost('static1.floofgens.net') && !workerAllowsImageHost('floofgens.net'), 'worker: CDN allowed, API host refused')
assert(refererForImageHost('static1.floofgens.net') === 'https://floofgens.net/', 'worker: floofgens referer')
assert(imageReferrerPolicy('floofgens') === undefined, 'floofgens images keep the default referrer policy, like e621')
assert(isBooruProvider('floofgens'), 'worker: floofgens is a known provider')

// ── Order: Shuffle and Popular reach the e621-family API ──
// Without an order metatag the engine returns its newest posts for every order.
;(['e621', 'floofgens'] as const).forEach(provider => {
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

// ── Data saved under the retired e6ai id ──
// Floofgens kept e6ai's post ids and file hashes (checked live 2026-11: e6ai
// post 77358's file is at the same path on static1.floofgens.net).
assert(canonicalProvider('e6ai') === 'floofgens' && canonicalProvider('E6AI') === 'floofgens', 'e6ai maps to floofgens')
assert(canonicalProvider('Gelbooru') === 'gelbooru' && canonicalProvider('floofgens') === 'floofgens', 'other ids are only lowercased')
assert(favKey('e6ai', 77358) === favKey('floofgens', 77358), 'an e6ai favorite keys as the Floofgens post')
const savedPost = {
  id: 77358,
  file_url: 'https://static1.e6ai.net/data/98/27/9827ce527e53787bb81e295b4d45e0f3.png',
  large_file_url: 'https://static1.e6ai.net/data/98/27/9827ce527e53787bb81e295b4d45e0f3.png',
  preview_file_url: 'https://static1.e6ai.net/data/preview/98/27/9827ce527e53787bb81e295b4d45e0f3.jpg',
  tag_string: 'anthro', tag_string_artist: '', tag_string_character: '', tag_string_copyright: '',
  rating: 's', score: 1, _provider: 'e6ai',
}
const moved = migrateRetiredPost(savedPost)
assert(moved._provider === 'floofgens', 'saved post: provider moved')
assert(moved.file_url === 'https://static1.floofgens.net/data/98/27/9827ce527e53787bb81e295b4d45e0f3.png', `saved post: file moved (${moved.file_url})`)
assert(moved.preview_file_url.startsWith('https://static1.floofgens.net/data/preview/'), 'saved post: preview moved')
const e621Saved = { ...savedPost, _provider: 'e621', file_url: 'https://static1.e621.net/a.png', large_file_url: 'https://static1.e621.net/a.png', preview_file_url: 'https://static1.e621.net/p.jpg' }
assert(migrateRetiredPost(e621Saved) === e621Saved, 'other posts are returned untouched')
const cachedRow = cachedRowToBooruPost({
  provider: 'e6ai', post_id: 77358, file_url: savedPost.file_url, large_file_url: null, preview_file_url: savedPost.preview_file_url,
  rating: 's', score: 1, image_width: 1, image_height: 1, tag_string: 'anthro', tag_string_artist: null,
  tag_string_character: null, tag_string_copyright: null, tag_string_meta: null, ai_metadata: null,
})
assert(cachedRow._provider === 'floofgens' && cachedRow.large_file_url.includes('static1.floofgens.net'), 'cached e6ai row reads as Floofgens')

console.log(`floofgens-provider: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
