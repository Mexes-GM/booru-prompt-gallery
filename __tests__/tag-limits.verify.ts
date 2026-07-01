/**
 * Verification script for provider-aware tag search limits (lib/api-client.ts).
 *
 * Every assertion here mirrors an empirically confirmed case against the real
 * Danbooru, Aibooru, e621, Gelbooru and Rule34 APIs (curl, 2026-07-01):
 *   - Danbooru: fixed limit of 2 tags. order:/random: consume a slot. rating:/tagcount: are free.
 *   - Aibooru: same engine as Danbooru (PostQuery::TagLimitError) but limit is 4, not 2.
 *   - e621: fixed limit of 40 tags. order: and exclusions consume a slot. rating: is free.
 *   - Gelbooru / Rule34: no tag-count limit at all (official docs + empirical, with real auth).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/tag-limits.verify.ts
 */
import { hasMultipleTags, getFinalQueryTags, getFinalQueryTagsWithMeta, getProviderTagLimit, isTagCountSupportedProvider, detectMisusedMetatags } from '../lib/booru/tag-limits'

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

// ── Provider limits ──
assert(getProviderTagLimit('danbooru') === 2, 'Danbooru limit is 2')
assert(getProviderTagLimit('aibooru') === 4, 'Aibooru limit is 4')
assert(getProviderTagLimit('e621') === 40, 'e621 limit is 40')
assert(getProviderTagLimit('gelbooru') === Infinity, 'Gelbooru has no limit')
assert(getProviderTagLimit('rule34') === Infinity, 'Rule34 has no limit')

// ── Danbooru: 2 normal tags OK, 3 tags over limit ──
assert(hasMultipleTags('1girl, solo', 'danbooru', 0) === false, 'Danbooru: 2 normal tags is within limit')
assert(hasMultipleTags('1girl, solo, long_hair', 'danbooru', 0) === true, 'Danbooru: 3 normal tags exceeds limit')

// Danbooru: rating:/tagcount: are free — do not count towards the 2-tag limit
assert(hasMultipleTags('1girl, solo, rating:safe', 'danbooru', 0) === false, 'Danbooru: rating: is free')
assert(hasMultipleTags('1girl, solo, tagcount:>=20', 'danbooru', 0) === false, 'Danbooru: tagcount: is free')
assert(hasMultipleTags('1girl, solo, rating:safe, tagcount:>=20', 'danbooru', 0) === false, 'Danbooru: rating + tagcount both free')

// Danbooru: exclusions count exactly like normal tags
assert(hasMultipleTags('1girl, -solo', 'danbooru', 0) === false, 'Danbooru: 1 normal + 1 exclusion is within limit')
assert(hasMultipleTags('1girl, -solo, long_hair', 'danbooru', 0) === true, 'Danbooru: 1 normal + 1 exclusion + 1 more exceeds limit')

// ── Aibooru: 4 normal tags OK, 5 over limit ──
assert(hasMultipleTags('1girl, solo, long_hair, blue_eyes', 'aibooru', 0) === false, 'Aibooru: 4 normal tags is within limit')
assert(hasMultipleTags('1girl, solo, long_hair, blue_eyes, smile', 'aibooru', 0) === true, 'Aibooru: 5 normal tags exceeds limit')
assert(hasMultipleTags('1girl, solo, long_hair, blue_eyes, rating:general', 'aibooru', 0) === false, 'Aibooru: rating: is free')

// ── e621: 40 OK, 41 over limit ──
const fake40 = Array.from({ length: 40 }, (_, i) => `faketag${i}`).join(', ')
const fake41 = Array.from({ length: 41 }, (_, i) => `faketag${i}`).join(', ')
assert(hasMultipleTags(fake40, 'e621', 0) === false, 'e621: 40 tags is within limit')
assert(hasMultipleTags(fake41, 'e621', 0) === true, 'e621: 41 tags exceeds limit')
assert(hasMultipleTags(`${fake40}, rating:s`, 'e621', 0) === false, 'e621: rating: is free even at 40+1 terms')

// ── Gelbooru / Rule34: never flagged regardless of tag count ──
const fake60 = Array.from({ length: 60 }, (_, i) => `faketag${i}`).join(', ')
assert(hasMultipleTags(fake60, 'gelbooru', 0) === false, 'Gelbooru: 60 tags never exceeds limit')
assert(hasMultipleTags(fake60, 'rule34', 0) === false, 'Rule34: 60 tags never exceeds limit')

// ── getFinalQueryTags: order:/random: consume a slot on limited providers ──
// Danbooru with order=popular (adds order:rank) should only allow 1 user tag, not 2.
const danbooruPopular = getFinalQueryTags('1girl, solo', 'all', 'popular', undefined, 'danbooru')
assert(danbooruPopular.includes('order:rank'), 'Danbooru popular: order:rank is added')
assert(danbooruPopular.filter(t => t === '1girl' || t === 'solo').length === 1, 'Danbooru popular: only 1 of 2 user tags kept (order consumes a slot)')

// Danbooru with order=recent (no order tag) should allow both user tags.
const danbooruRecent = getFinalQueryTags('1girl, solo', 'all', 'recent', undefined, 'danbooru')
assert(!danbooruRecent.includes('order:rank') && !danbooruRecent.some(t => /^random:/.test(t)), 'Danbooru recent: no order/random tag added')
assert(danbooruRecent.filter(t => t === '1girl' || t === 'solo').length === 2, 'Danbooru recent: both user tags kept')

// Aibooru with order=popular should allow 3 of 4 user tags (order consumes 1 of 4 slots).
const aibooruPopular = getFinalQueryTags('1girl, solo, long_hair, blue_eyes', 'all', 'popular', undefined, 'aibooru')
assert(aibooruPopular.filter(t => ['1girl', 'solo', 'long_hair', 'blue_eyes'].includes(t)).length === 3, 'Aibooru popular: 3 of 4 user tags kept (order consumes a slot)')

// e621 with order=popular and 40 user tags should only keep 39 (order consumes 1 of 40 slots).
const e621Tags = Array.from({ length: 40 }, (_, i) => `faketag${i}`).join(', ')
const e621Popular = getFinalQueryTags(e621Tags, 'all', 'popular', undefined, 'e621')
const keptFakeTags = e621Popular.filter(t => /^faketag\d+$/.test(t))
assert(keptFakeTags.length === 39, `e621 popular: 39 of 40 user tags kept (order consumes a slot), got ${keptFakeTags.length}`)

// Gelbooru: no trimming regardless of order/tag count.
const gelbooruTags = Array.from({ length: 50 }, (_, i) => `faketag${i}`).join(', ')
const gelbooruPopular = getFinalQueryTags(gelbooruTags, 'all', 'popular', undefined, 'gelbooru')
const gelbooruKept = gelbooruPopular.filter(t => /^faketag\d+$/.test(t))
assert(gelbooruKept.length === 50, `Gelbooru popular: all 50 user tags kept, got ${gelbooruKept.length}`)

// ── getFinalQueryTagsWithMeta: per-tag classification + slot usage summary ──
// Danbooru popular with 2 user tags: order:rank consumes 1 slot, 1 of 2 user tags kept, 1 dropped.
const danbooruMeta = getFinalQueryTagsWithMeta('1girl, solo', 'all', 'popular', undefined, 'danbooru')
assert(danbooruMeta.slotLimit === 2, 'Meta: Danbooru slotLimit is 2')
assert(danbooruMeta.slotsUsed === 2, `Meta: Danbooru popular slotsUsed is 2 (order:rank + 1 user tag), got ${danbooruMeta.slotsUsed}`)
assert(danbooruMeta.droppedUserTags.length === 1 && danbooruMeta.droppedUserTags[0] === 'solo', 'Meta: Danbooru popular drops the 2nd user tag')
assert(danbooruMeta.tags.some(t => t.value === 'order:rank' && t.countsTowardsLimit && !t.dropped), 'Meta: order:rank marked as counted, not dropped')
assert(danbooruMeta.tags.some(t => t.value === '1girl' && t.countsTowardsLimit && !t.dropped), 'Meta: kept user tag marked as counted, not dropped')
assert(danbooruMeta.tags.some(t => t.value === 'solo' && t.countsTowardsLimit && t.dropped), 'Meta: dropped user tag marked as dropped')

// Danbooru recent (no order tag) with rating + tagcount (free) + 2 user tags: nothing dropped.
const danbooruFreeMeta = getFinalQueryTagsWithMeta('1girl, solo', 'rating:safe', 'recent', '20', 'danbooru')
assert(danbooruFreeMeta.slotsUsed === 2, `Meta: Danbooru recent slotsUsed is 2 (rating/tagcount are free), got ${danbooruFreeMeta.slotsUsed}`)
assert(danbooruFreeMeta.droppedUserTags.length === 0, 'Meta: Danbooru recent with free filters drops nothing')
assert(danbooruFreeMeta.tags.some(t => t.value === 'rating:safe' && !t.countsTowardsLimit), 'Meta: rating: marked as free')
assert(danbooruFreeMeta.tags.some(t => t.value === 'tagcount:>=20' && !t.countsTowardsLimit), 'Meta: tagcount: marked as free')

// Gelbooru: unlimited slotLimit, nothing ever dropped regardless of tag count.
const gelbooruMeta = getFinalQueryTagsWithMeta(fake60, 'all', 'popular', undefined, 'gelbooru')
assert(gelbooruMeta.slotLimit === Infinity, 'Meta: Gelbooru slotLimit is Infinity')
assert(gelbooruMeta.droppedUserTags.length === 0, 'Meta: Gelbooru never drops tags')

// ── Rating value mapping: rating:general is not valid on every provider ──
// Confirmed empirically: e621 has no "general" tier and silently ignores rating:general
// (returns posts of every rating). rating:safe is the correct equivalent there.
const danbooruGeneral = getFinalQueryTagsWithMeta('', 'rating:general', 'recent', undefined, 'danbooru')
assert(danbooruGeneral.tags.some(t => t.value === 'rating:general'), 'Danbooru: rating:general is used as-is')

const aibooruGeneral = getFinalQueryTagsWithMeta('', 'rating:general', 'recent', undefined, 'aibooru')
assert(aibooruGeneral.tags.some(t => t.value === 'rating:general'), 'Aibooru: rating:general is used as-is')

const e621General = getFinalQueryTagsWithMeta('', 'rating:general', 'recent', undefined, 'e621')
assert(e621General.tags.some(t => t.value === 'rating:safe'), 'e621: rating:general is remapped to rating:safe')
assert(!e621General.tags.some(t => t.value === 'rating:general'), 'e621: rating:general is never sent as-is')

// Gelbooru/Rule34: rating:general is confirmed to be the correct, working value there too
// (unlike the legacy rating:safe, which barely matches anything on Gelbooru today).
const gelbooruGeneral = getFinalQueryTagsWithMeta('', 'rating:general', 'recent', undefined, 'gelbooru')
assert(gelbooruGeneral.tags.some(t => t.value === 'rating:general'), 'Gelbooru: rating:general is used as-is')

const rule34General = getFinalQueryTagsWithMeta('', 'rating:general', 'recent', undefined, 'rule34')
assert(rule34General.tags.some(t => t.value === 'rating:general'), 'Rule34: rating:general is used as-is')

// Non-"general" ratings (e.g. explicit) pass through unchanged on every provider.
const e621Explicit = getFinalQueryTagsWithMeta('', 'rating:explicit', 'recent', undefined, 'e621')
assert(e621Explicit.tags.some(t => t.value === 'rating:explicit'), 'e621: non-general ratings pass through unchanged')

// ── Metatag syntax differs by provider: order:/random: vs sort:, and tagcount: support ──
// Confirmed empirically (curl, with real Gelbooru/Rule34 credentials):
// - Gelbooru/Rule34 (Gelbooru 0.2 engine): order:score matches 0 posts (unrecognized tag);
//   sort:score matches 13.7M+ posts (correct metatag). tagcount:>=20 matches 0 posts (unsupported).
// - Danbooru/Aibooru/e621: order:rank / random:N is correct; sort: is not used.
// - e621/Aibooru: tagcount:>=N works identically to Danbooru's syntax.

const gelPopular = getFinalQueryTagsWithMeta('', 'all', 'popular', undefined, 'gelbooru')
assert(gelPopular.tags.some(t => t.value === 'sort:score'), 'Gelbooru popular: uses sort:score, not order:rank')
assert(!gelPopular.tags.some(t => t.value === 'order:rank'), 'Gelbooru popular: never sends order:rank')

const gelRandom = getFinalQueryTagsWithMeta('', 'all', 'random', undefined, 'gelbooru')
assert(gelRandom.tags.some(t => t.value === 'sort:random'), 'Gelbooru random: uses sort:random, not random:N')
assert(!gelRandom.tags.some(t => /^random:/.test(t.value)), 'Gelbooru random: never sends random:N')

const r34Popular = getFinalQueryTagsWithMeta('', 'all', 'popular', undefined, 'rule34')
assert(r34Popular.tags.some(t => t.value === 'sort:score'), 'Rule34 popular: uses sort:score, not order:rank')

const dbPopular = getFinalQueryTagsWithMeta('', 'all', 'popular', undefined, 'danbooru')
assert(dbPopular.tags.some(t => t.value === 'order:rank'), 'Danbooru popular: uses order:rank, not sort:score')

const e621PopularOrder = getFinalQueryTagsWithMeta('', 'all', 'popular', undefined, 'e621')
assert(e621PopularOrder.tags.some(t => t.value === 'order:rank'), 'e621 popular: uses order:rank (confirmed valid), not sort:score')

// tagcount: support per provider — Danbooru/Aibooru/e621 yes, Gelbooru/Rule34 no.
assert(isTagCountSupportedProvider('danbooru') === true, 'tagcount supported: danbooru')
assert(isTagCountSupportedProvider('aibooru') === true, 'tagcount supported: aibooru')
assert(isTagCountSupportedProvider('e621') === true, 'tagcount supported: e621')
assert(isTagCountSupportedProvider('gelbooru') === false, 'tagcount NOT supported: gelbooru')
assert(isTagCountSupportedProvider('rule34') === false, 'tagcount NOT supported: rule34')

const e621WithTagcount = getFinalQueryTagsWithMeta('', 'all', 'recent', '20', 'e621')
assert(e621WithTagcount.tags.some(t => t.value === 'tagcount:>=20'), 'e621: tagcount filter is applied')

const aibooruWithTagcount = getFinalQueryTagsWithMeta('', 'all', 'recent', '20', 'aibooru')
assert(aibooruWithTagcount.tags.some(t => t.value === 'tagcount:>=20'), 'Aibooru: tagcount filter is applied')

const gelbooruWithTagcount = getFinalQueryTagsWithMeta('', 'all', 'recent', '20', 'gelbooru')
assert(!gelbooruWithTagcount.tags.some(t => /^tagcount:/.test(t.value)), 'Gelbooru: tagcount filter is never applied (unsupported)')

const rule34WithTagcount = getFinalQueryTagsWithMeta('', 'all', 'recent', '20', 'rule34')
assert(!rule34WithTagcount.tags.some(t => /^tagcount:/.test(t.value)), 'Rule34: tagcount filter is never applied (unsupported)')

// ── detectMisusedMetatags: warns advanced users who type raw metatags by hand ──
// Only triggers on tags present in the raw user input string — never on tags the app itself
// generates (order:rank from the sort dropdown, rating:general from the toggle, etc).

// order: typed on Gelbooru/Rule34 — unrecognized, suggest sort:
const gelOrderWarn = detectMisusedMetatags('1girl, order:score', 'gelbooru')
assert(gelOrderWarn.length === 1 && gelOrderWarn[0].tag === 'order:score', 'Gelbooru: order:score is flagged')
assert(gelOrderWarn[0].suggestion === 'sort:score', 'Gelbooru: order:score suggests sort:score')

const r34OrderWarn = detectMisusedMetatags('1girl, order:score', 'rule34')
assert(r34OrderWarn.length === 1 && r34OrderWarn[0].suggestion === 'sort:score', 'Rule34: order:score suggests sort:score')

// random:N typed on Gelbooru/Rule34 — unrecognized, suggest sort:random
const gelRandomWarn = detectMisusedMetatags('1girl, random:50', 'gelbooru')
assert(gelRandomWarn.length === 1 && gelRandomWarn[0].suggestion === 'sort:random', 'Gelbooru: random:50 suggests sort:random')

// sort: typed on Danbooru/Aibooru/e621 — unrecognized there, suggest order:
const dbSortWarn = detectMisusedMetatags('1girl, sort:score', 'danbooru')
assert(dbSortWarn.length === 1 && dbSortWarn[0].suggestion === 'order:score', 'Danbooru: sort:score suggests order:score')

const aibooruSortWarn = detectMisusedMetatags('1girl, sort:score', 'aibooru')
assert(aibooruSortWarn.length === 1 && aibooruSortWarn[0].suggestion === 'order:score', 'Aibooru: sort:score suggests order:score')

const e621SortWarn = detectMisusedMetatags('1girl, sort:score', 'e621')
assert(e621SortWarn.length === 1 && e621SortWarn[0].suggestion === 'order:score', 'e621: sort:score suggests order:score')

const dbSortRandomWarn = detectMisusedMetatags('1girl, sort:random', 'danbooru')
assert(dbSortRandomWarn.length === 1 && dbSortRandomWarn[0].suggestion === 'random:N', 'Danbooru: sort:random suggests random:N (special case)')

// tagcount: typed on Gelbooru/Rule34 — no equivalent exists, warns without a suggestion
const gelTagcountWarn = detectMisusedMetatags('1girl, tagcount:>=20', 'gelbooru')
assert(gelTagcountWarn.length === 1 && gelTagcountWarn[0].tag === 'tagcount:>=20', 'Gelbooru: tagcount:>=20 is flagged')
assert(gelTagcountWarn[0].suggestion === undefined, 'Gelbooru: tagcount: warning has no suggestion (no equivalent exists)')

const r34TagcountWarn = detectMisusedMetatags('1girl, tagcount:>=20', 'rule34')
assert(r34TagcountWarn.length === 1, 'Rule34: tagcount:>=20 is flagged')

// tagcount: typed on Danbooru/Aibooru/e621 — supported, never flagged
const dbTagcountOk = detectMisusedMetatags('1girl, tagcount:>=20', 'danbooru')
assert(dbTagcountOk.length === 0, 'Danbooru: tagcount:>=20 is never flagged (supported)')

// rating:general typed on e621 — silently ignored there, suggest rating:safe
const e621RatingGeneralWarn = detectMisusedMetatags('1girl, rating:general', 'e621')
assert(e621RatingGeneralWarn.length === 1 && e621RatingGeneralWarn[0].suggestion === 'rating:safe', 'e621: rating:general suggests rating:safe')

// rating:general typed on Danbooru/Aibooru/Gelbooru/Rule34 — valid everywhere, never flagged
;(['danbooru', 'aibooru', 'gelbooru', 'rule34'] as const).forEach(p => {
  const warn = detectMisusedMetatags('1girl, rating:general', p)
  assert(warn.length === 0, `${p}: rating:general is never flagged (valid there)`)
})

// rating:safe typed on Danbooru/Aibooru — technically valid but means "sensitive", not "general"
const dbRatingSafeWarn = detectMisusedMetatags('1girl, rating:safe', 'danbooru')
assert(dbRatingSafeWarn.length === 1 && dbRatingSafeWarn[0].suggestion === 'rating:general', 'Danbooru: rating:safe warns and suggests rating:general')

const aibooruRatingSafeWarn = detectMisusedMetatags('1girl, rating:safe', 'aibooru')
assert(aibooruRatingSafeWarn.length === 1, 'Aibooru: rating:safe warns')

// rating:safe typed on e621/Gelbooru/Rule34 — correct/expected there, never flagged
;(['e621', 'gelbooru', 'rule34'] as const).forEach(p => {
  const warn = detectMisusedMetatags('1girl, rating:safe', p)
  assert(warn.length === 0, `${p}: rating:safe is never flagged (correct there)`)
})

// Normal tags and free filters never trigger any warning, on any provider.
const noWarnings = detectMisusedMetatags('1girl, solo, blue_eyes, -nude', 'gelbooru')
assert(noWarnings.length === 0, 'Normal tags + exclusion never trigger a warning')

// Empty input never triggers a warning.
assert(detectMisusedMetatags('', 'gelbooru').length === 0, 'Empty input never triggers a warning')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
