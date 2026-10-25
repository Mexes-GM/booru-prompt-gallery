/**
 * Verification script for Rule34's own tag types in the Worker
 * (workers/booru-image-proxy/src/lib/booru/providers/rule34.ts + base.ts):
 *   - posts are requested with `fields=tag_info`, and `tag_info` never reaches
 *     the posts handed on
 *   - Rule34's artist/character/copyright types file the tags neither category
 *     table knows; its `metadata` type is not trusted
 *   - a name Danbooru and Rule34 file under different kinds (character vs
 *     copyright) takes Rule34's; other disagreements keep the table's answer
 *   - the types still apply when the tables cannot be read
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/rule34-tag-types.verify.ts
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { mergeProviderTypes } from '../workers/booru-image-proxy/src/lib/booru/base'
import { Rule34Provider, rememberRule34Types, rule34TypesFor } from '../workers/booru-image-proxy/src/lib/booru/providers/rule34'
import type { BooruPost } from '../workers/booru-image-proxy/src/lib/booru/types'

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

const post = (tags: string): BooruPost =>
  ({ id: 1, file_url: '', large_file_url: '', preview_file_url: '', tag_string: tags, tag_string_artist: '', tag_string_character: '', tag_string_copyright: '', rating: 'e', score: 0 })

// Every Rule34 request answers with one post carrying `tag_info`; the URL is recorded.
function mockRule34(tagInfo: { tag: string; type: string }[]): { urls: string[] } {
  const log = { urls: [] as string[] }
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    log.urls.push(String(input))
    const body = [{
      id: 7, file_url: 'https://wimg.rule34.xxx/images/1/a.jpg', sample_url: '', preview_url: '', rating: 'explicit', score: 3, width: 10, height: 10,
      tags: tagInfo.map((t) => t.tag.replace(/&#039;/g, "'")).join(' '),
      tag_info: tagInfo.map((t) => ({ ...t, count: 10 })),
    }]
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
  return log
}

// A Supabase stub whose `lookup_tag_categories` RPC answers from `danbooru` (provider table empty), or fails.
function supabaseStub(danbooru: Record<string, number> | 'down'): SupabaseClient {
  return {
    rpc: async (_fn: string, args: { p_names: string[]; p_provider: string | null }) => {
      if (danbooru === 'down') return { data: null, error: { code: 'XX000', message: 'database unavailable' } }
      if (args.p_provider) return { data: [], error: null }
      return { data: args.p_names.filter((n) => n in danbooru).map((name) => ({ name, category: danbooru[name] })), error: null }
    },
  } as unknown as SupabaseClient
}

async function main() {
  // ── mergeProviderTypes ──
  {
    const categories = new Map([['harry_potter', 4], ['pokemon', 3], ['signature', 0], ['ai_generated', 5]])
    mergeProviderTypes(categories, new Map([['harry_potter', 3], ['pokemon', 4], ['signature', 1], ['ai_generated', 1], ['zynox', 1]]))
    assert(categories.get('zynox') === 1, 'a tag no table knows takes the provider type')
    assert(categories.get('harry_potter') === 3 && categories.get('pokemon') === 4, 'character vs copyright: the provider decides what its own tag names')
    assert(categories.get('signature') === 0, "a table's general category is kept")
    assert(categories.get('ai_generated') === 5, "a table's meta category is kept")
  }

  // ── rememberRule34Types / rule34TypesFor ──
  {
    const t0 = 1_000_000
    rememberRule34Types([{ tag_info: [
      { tag: 'probe_artist', type: 'artist' },
      { tag: 'probe_girl_(series)', type: 'character' },
      { tag: 'probe_freddy&#039;s', type: 'copyright' },
      { tag: 'probe_pinup', type: 'metadata' },
      { tag: 'probe_smile', type: 'tag' },
    ] }], t0)
    const types = rule34TypesFor([post("probe_artist probe_girl_(series) probe_freddy's probe_pinup probe_smile")], t0 + 1000)
    assert(types.get('probe_artist') === 1 && types.get('probe_girl_(series)') === 4, 'artist and character types are remembered')
    assert(types.get("probe_freddy's") === 3, 'tag names served with HTML entities match the decoded tag')
    assert(!types.has('probe_pinup') && !types.has('probe_smile'), 'metadata and general types are not used')
    assert(rule34TypesFor([post('probe_artist')], t0 + 2 * 60 * 60 * 1000).size === 0, 'types expire after an hour')
    rememberRule34Types([{ tag_info: [{ tag: 'probe_artist', type: 'tag' }] }], t0 + 2000)
    assert(!rule34TypesFor([post('probe_artist')], t0 + 3000).has('probe_artist'), 'a tag Rule34 types as content again is forgotten')
  }

  // ── search: request, no tag_info in the output, names filed without a database ──
  {
    const log = mockRule34([
      { tag: 'search_artist', type: 'artist' },
      { tag: 'sugar_(search_game)', type: 'character' },
      { tag: 'search_game', type: 'copyright' },
      { tag: 'search_meta', type: 'metadata' },
      { tag: 'smile', type: 'tag' },
    ])
    const provider = new Rule34Provider({ RULE34_API_KEY: 'k', RULE34_USER_ID: 'u' } as never, null)
    const [result] = await provider.search({ tags: 'smile', page: '1' })
    assert(new URL(log.urls[0]).searchParams.get('fields') === 'tag_info', 'posts are requested with fields=tag_info')
    assert(!('tag_info' in result), 'tag_info is not handed on with the post')
    assert(result.tag_string_artist === 'search_artist', 'the artist field comes from Rule34 types')
    assert(result.tag_string_character === 'sugar_(search_game)', 'the character field comes from Rule34 types')
    assert(result.tag_string_copyright === 'search_game', 'the copyright field comes from Rule34 types')
    assert(!result.tag_string_meta, 'Rule34 metadata types do not fill the meta field')
  }

  // ── enrich: the table wins, except character vs copyright; types survive a failed lookup ──
  {
    mockRule34([{ tag: 'harry_potter', type: 'copyright' }, { tag: 'enrich_artist', type: 'artist' }, { tag: 'enrich_smile', type: 'character' }])
    const withTable = new Rule34Provider({ RULE34_API_KEY: 'k', RULE34_USER_ID: 'u' } as never, supabaseStub({ harry_potter: 4, enrich_smile: 0 }))
    const [result] = await withTable.search({ tags: '', page: '1' })
    assert(result.tag_string_copyright === 'harry_potter' && !result.tag_string_character, "Rule34's harry_potter is the series, not Danbooru's character")
    assert(result.tag_string_artist === 'enrich_artist', 'an artist the tables lack is filed')

    mockRule34([{ tag: 'down_artist', type: 'artist' }])
    const down = new Rule34Provider({ RULE34_API_KEY: 'k', RULE34_USER_ID: 'u' } as never, supabaseStub('down'))
    const [fallback] = await down.search({ tags: '', page: '1' })
    assert(fallback.tag_string_artist === 'down_artist', 'Rule34 types still apply when the tables cannot be read')
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
