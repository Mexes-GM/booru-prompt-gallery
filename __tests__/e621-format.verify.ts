/**
 * Verification script for the e621-engine post parser (lib/booru/e621-format.ts
 * and its Worker twin). The fixtures are real e621.net /posts.json responses for
 * the same three posts, captured 2026-11-26 in each format the API serves:
 *   - posts-extended.json  current format, `mode=extended` (tags grouped by category)
 *   - posts-basic.json     current format, default mode (flat tag list)
 *   - posts-v1.json        legacy format, `v1=true` (`{ posts }`, categorized tags)
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/e621-format.verify.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as app from '../lib/booru/e621-format'
import * as worker from '../workers/booru-image-proxy/src/lib/booru/providers/e621-format'
import { transformE621Posts } from '../lib/booru/post-transformers'
import { createPostsKey } from '../lib/booru/posts-key'

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

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'e621', name), 'utf8'))

const extended = fixture('posts-extended.json')
const basic = fixture('posts-basic.json')
const legacy = fixture('posts-v1.json')

const parseAll = (data: unknown) =>
  app.extractE621Posts(data).map(app.parseE621Post).filter((p): p is app.E621ParsedPost => p !== null)

// ── Both response shapes are found ──
assert(app.extractE621Posts(extended).length === 3, 'current format: bare array')
assert(app.extractE621Posts(legacy).length === 3, 'legacy format: { posts }')
const single = (extended as unknown[])[0]
assert(app.extractE621Posts(single).length === 1, 'current /posts/<id>.json: bare post')
assert(app.extractE621Posts({ post: (legacy as { posts: unknown[] }).posts[0] }).length === 1, 'legacy /posts/<id>.json: { post }')
assert(app.extractE621Posts({ success: false }).length === 0 && app.extractE621Posts(null).length === 0, 'error bodies give no posts')

// ── Current format with categories matches the legacy one ──
const fromExtended = parseAll(extended)
const fromLegacy = parseAll(legacy)
assert(fromExtended.length === 3, 'extended: all three posts parse')
assert(JSON.stringify(fromExtended) === JSON.stringify(fromLegacy), 'extended and legacy formats give the same posts')

const byId = new Map(fromExtended.map((p) => [p.id, p]))

// 6886807: has a sample, an artist, copyrights and meta tags.
const warden = byId.get(6886807)!
assert(warden.file_url.endsWith('/2c/f8/2cf8ea9e01182c16dd23fb859b599f4f.jpg'), 'file_url is the original')
assert(warden.large_file_url.includes('/data/sample/') && warden.large_file_url.endsWith('.jpg'), 'large_file_url is the jpg sample')
assert(warden.preview_file_url.includes('/data/preview/') && warden.preview_file_url.endsWith('.jpg'), 'preview_file_url is the jpg preview')
assert(warden.width === 960 && warden.height === 1200, 'size from the original file')
assert(warden.tag_string_artist === 'honggun666', `artist (${warden.tag_string_artist})`)
assert(warden.tag_string_copyright.split(' ').includes('minecraft'), 'copyright')
const wardenTags = warden.tag_string.split(' ')
assert(wardenTags.includes('warden_(minecraft)') && wardenTags.includes('simple_background'), 'species and general tags are content')
assert(wardenTags.includes('honggun666') && wardenTags.includes('minecraft'), 'artist and copyright stay in tag_string, as before')
assert(!wardenTags.includes('hi_res') && !wardenTags.includes('2026') && !wardenTags.includes('digital_media_(artwork)'), 'meta tags are left out')
assert(warden.rating === 's' && typeof warden.score === 'number', 'rating and score')
assert(warden.source.startsWith('https://'), 'first source')

// 2520012: no sample, a character.
const shinx = byId.get(2520012)!
assert(shinx.large_file_url === shinx.file_url, 'no sample: large_file_url falls back to the original')
assert(shinx.tag_string_character.split(' ').includes('ellie_(elliectric)'), `character (${shinx.tag_string_character})`)

// ── Current format without categories still parses ──
const fromBasic = parseAll(basic)
assert(fromBasic.length === 3, 'basic: all three posts parse')
const flatWarden = fromBasic.find((p) => p.id === 6886807)!
assert(flatWarden.file_url === warden.file_url && flatWarden.large_file_url === warden.large_file_url, 'basic: same files')
assert(flatWarden.tag_string.split(' ').includes('honggun666') && flatWarden.tag_string_artist === '', 'basic: every tag kept, no categories')

// ── Deleted and fileless posts are dropped ──
const clone = <T>(v: T): T => structuredClone(v)
const deleted = clone(single) as { flags: { deleted: boolean } }
deleted.flags.deleted = true
assert(app.parseE621Post(deleted) === null, 'deleted post (current) dropped')
const legacyDeleted = clone((legacy as { posts: unknown[] }).posts[0]) as { flags: { deleted: boolean } }
legacyDeleted.flags.deleted = true
assert(app.parseE621Post(legacyDeleted) === null, 'deleted post (legacy) dropped')
const noFile = clone(single) as { files: { original: { url: string | null } } }
noFile.files.original.url = null
assert(app.parseE621Post(noFile) === null, 'post without a file dropped')
assert(app.parseE621Post('nope') === null && app.parseE621Post({}) === null, 'junk dropped')

// ── App and Worker copies agree ──
for (const data of [extended, basic, legacy]) {
  const a = JSON.stringify(parseAll(data))
  const w = JSON.stringify(worker.extractE621Posts(data).map(worker.parseE621Post).filter(Boolean))
  assert(a === w, 'app and Worker parsers give the same output')
}
assert(app.E621_POSTS_MODE === worker.E621_POSTS_MODE, 'app and Worker ask for the same mode')

// ── Client transform and request URL ──
const clientPosts = transformE621Posts(extended, 'e621')
assert(clientPosts.length === 3 && clientPosts.every((p) => p._provider === 'e621'), 'client: posts tagged with their provider')
const key = createPostsKey({ tags: 'wolf', ratingFilter: 'all', order: 'recent', provider: 'e621', hasPrompt: false, scoreTier: 'off' })
const url = new URL(key(0, null) ?? '')
assert(url.searchParams.get('mode') === 'extended', `posts key asks for categorized tags (${url})`)

console.log(`e621-format: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
