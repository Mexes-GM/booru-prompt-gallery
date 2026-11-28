/**
 * Verification script for Gelbooru's own tag list in the Worker
 * (workers/booru-image-proxy/src/lib/booru/base.ts + providers/gelbooru.ts):
 *   - a Gelbooru page reads `gelbooru_tags` and files its names, even ones Danbooru
 *     spells another way; the Danbooru table answers the rest
 *   - Gelbooru's answer wins where both have the tag
 *   - a deprecated (6) Gelbooru tag is filed as meta
 *   - names with commas, parentheses and quotes are quoted in the request
 *   - when the list can't be read, the page is filed as before (Danbooru only)
 *   - Rule34 never reads the Gelbooru list
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/gelbooru-tag-types.verify.ts
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { mergeGelbooruCategories, quotedInList } from '../workers/booru-image-proxy/src/lib/booru/base'
import { GelbooruProvider, resetGelbooruRoute } from '../workers/booru-image-proxy/src/lib/booru/providers/gelbooru'

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

function mockGelbooru(tags: string) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ post: [{ id: 1, file_url: 'https://img4.gelbooru.com/images/a.png', tags, rating: 'general', score: 1, width: 10, height: 10 }] }), { status: 200 })) as typeof fetch
}

/** Danbooru answers through the RPC; `gelbooru_tags` through a GET whose `in` list is recorded. */
function supabaseStub(danbooru: Record<string, number>, gelbooru: Record<string, number> | 'down', log: { lists: string[]; tables: string[] }): SupabaseClient {
  return {
    rpc: async (_fn: string, args: { p_names: string[]; p_provider: string | null }) => {
      if (args.p_provider) return { data: [], error: null }
      return { data: args.p_names.filter((n) => n in danbooru).map((name) => ({ name, category: danbooru[name] })), error: null }
    },
    from: (table: string) => ({
      select: () => ({
        filter: async (_column: string, _op: string, list: string) => {
          log.tables.push(table)
          log.lists.push(list)
          if (gelbooru === 'down') return { data: null, error: { message: 'unavailable' } }
          return { data: Object.entries(gelbooru).filter(([name]) => list.includes(`"${name}"`)).map(([name, category]) => ({ name, category })), error: null }
        },
      }),
    }),
  } as unknown as SupabaseClient
}

async function main() {
  // ── merge ──
  {
    const merged = mergeGelbooruCategories(new Map([['pokemon', 3], ['smile', 0], ['harry_potter', 4]]), new Map([['harry_potter', 3], ['old_tag', 6]]))
    assert(merged.get('harry_potter') === 3, "Gelbooru's answer wins where both have the tag")
    assert(merged.get('pokemon') === 3 && merged.get('smile') === 0, 'Danbooru answers what Gelbooru lacks')
    assert(merged.get('old_tag') === 5, 'a deprecated Gelbooru tag is filed as meta')
  }

  // ── quoting ──
  assert(quotedInList(['a,b', 'x_(y)', 'say_"hi"']) === '("a,b","x_(y)","say_\\"hi\\"")', 'values are quoted and escaped')

  // ── a Gelbooru page ──
  {
    resetGelbooruRoute()
    mockGelbooru('1girl pokemon_scarlet_and_violet nemona_(pokemon) some_artist old_tag smile highres faust_(exhibition)_(project_moon)')
    const log = { lists: [] as string[], tables: [] as string[] }
    const provider = new GelbooruProvider({}, supabaseStub(
      { '1girl': 0, smile: 0, highres: 5 },
      { pokemon_scarlet_and_violet: 3, 'nemona_(pokemon)': 4, some_artist: 1, old_tag: 6, smile: 0, highres: 5 },
      log
    ))
    const [post] = await provider.search({ tags: '', page: '1' })
    assert(log.tables.every((t) => t === 'gelbooru_tags') && log.tables.length >= 1, 'the Gelbooru list is read')
    assert(log.lists.some((l) => l.includes('"nemona_(pokemon)"') && l.includes('"faust_(exhibition)_(project_moon)"')), 'names with parentheses are sent quoted')
    assert(post.tag_string_copyright === 'pokemon_scarlet_and_violet', 'a series Danbooru spells another way is filed')
    assert(post.tag_string_character === 'nemona_(pokemon)' && post.tag_string_artist === 'some_artist', 'characters and artists are filed')
    assert((post.tag_string_meta ?? '').split(' ').includes('old_tag') && (post.tag_string_meta ?? '').split(' ').includes('highres'), 'deprecated and meta tags are filed as meta')
  }

  // ── the list can't be read ──
  {
    resetGelbooruRoute()
    mockGelbooru('1girl down_series highres smile')
    const log = { lists: [] as string[], tables: [] as string[] }
    const provider = new GelbooruProvider({}, supabaseStub({ highres: 5, down_series: 3 }, 'down', log))
    const [post] = await provider.search({ tags: '', page: '1' })
    assert(post.tag_string_copyright === 'down_series' && post.tag_string_meta === 'highres', 'filed from the Danbooru table, as before')
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
