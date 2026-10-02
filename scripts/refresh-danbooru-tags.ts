/**
 * Brings `auto_suggest_tags` up to date with Danbooru without renaming anything.
 *
 * Illustrious and Anima were trained on the tag names Danbooru used at the time, so a row is never
 * renamed or removed, even when Danbooru has since aliased it to a new name (`china_dress` -> `qipao`)
 * or deprecated it (`black_footwear`). Instead:
 *
 *   1. Renamed rows get the new Danbooru name, and its other aliases, as aliases.
 *   2. Every row gets the Danbooru aliases it is missing.
 *   3. Tags Danbooru has gained since the import (>= MIN_POST_COUNT posts, not deprecated, not already
 *      covered by a row or an alias) are added. Character, copyright, meta and artist tags get their
 *      slot by rule; general tags are classified with Jev (classifyBatchWithJev).
 *   4. post_count is refreshed for every row. A renamed row takes the count of the tag it now
 *      resolves to. Counts are never lowered, so emptied or deprecated tags keep their last count.
 *
 * A row aliased to a tag that is also a row (hairpin -> hairclip) is a duplicate, not a rename, and is
 * left with its own count and aliases.
 *
 * Danbooru responses are cached in data/danbooru-refresh-cache.json (pass --refetch to download
 * again) and Jev answers in data/jev-danbooru-refresh-checkpoint.json, so a run can be resumed.
 *
 * Usage:
 *   bun scripts/refresh-danbooru-tags.ts            # dry run, writes data/danbooru-refresh-plan.json
 *   bun scripts/refresh-danbooru-tags.ts --apply    # classify new general tags with Jev, back up, write
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env.development.local', quiet: true });
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { classifyBatchWithJev, type JevClassificationResult } from '../lib/jev-classifier';

// Supabase's pooler certificate does not verify through pg; same as classify-pending-danbooru-tags.ts.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const APPLY = process.argv.includes('--apply');
const REFETCH = process.argv.includes('--refetch');

/** Same floor as the original import (danbooru_2024-12-22_pt25). */
const MIN_POST_COUNT = 25;
const DANBOORU = 'https://danbooru.donmai.us';
const USER_AGENT = 'booru-prompt-gallery tag refresh';
const REQUEST_GAP_MS = 350;

const CACHE_FILE = path.join('data', 'danbooru-refresh-cache.json');
const CHECKPOINT_FILE = path.join('data', 'jev-danbooru-refresh-checkpoint.json');
const PLAN_FILE = path.join('data', 'danbooru-refresh-plan.json');

/** Slot of non-general tags, by Danbooru category; same values the existing rows carry. */
const RULE_SLOTS: Record<number, [string, string]> = {
  1: ['other', 'artist'],
  3: ['other', 'copyright'],
  4: ['other', 'character'],
  5: ['other', 'meta'],
};

interface LiveTag {
  name: string;
  category: number;
  post_count: number;
  is_deprecated: boolean;
}

interface LiveAlias {
  antecedent_name: string;
  consequent_name: string;
}

interface DanbooruCache {
  fetched_at: string;
  tags: LiveTag[];
  aliases: LiveAlias[];
  /** Exact counts looked up by name for rows the bulk listing did not cover. */
  lookups: Record<string, number>;
}

interface DbRow {
  name: string;
  category: number;
  post_count: number;
  aliases: string[] | null;
}

interface NewTag {
  name: string;
  category: number;
  post_count: number;
  aliases: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (n: number) => n.toLocaleString('en-US');

async function danbooru<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const url = `${DANBOORU}/${endpoint}.json?${new URLSearchParams(params)}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) {
      await sleep(REQUEST_GAP_MS);
      return res.json() as Promise<T>;
    }
    if (attempt >= 6) throw new Error(`${endpoint} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await sleep(2000 * attempt);
  }
}

/** Walks a Danbooru listing newest-first with `page=b<id>`, which has no page-number cap. */
async function fetchListing<T extends { id: number }>(endpoint: string, params: Record<string, string>, label: string) {
  const out: T[] = [];
  for (let before: number | null = null; ; ) {
    const page = await danbooru<T[]>(endpoint, { ...params, limit: '1000', page: before === null ? '1' : `b${before}` });
    out.push(...page);
    if (process.stdout.isTTY) process.stdout.write(`\r  ${label}: ${fmt(out.length)}`);
    if (page.length < 1000) break;
    before = Math.min(...page.map((r) => r.id));
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  else console.log(`  ${label}: ${fmt(out.length)}`);
  return out;
}

async function fetchDanbooru(): Promise<DanbooruCache> {
  if (!REFETCH && fs.existsSync(CACHE_FILE)) {
    const cache: DanbooruCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    console.log(`Using Danbooru data from ${cache.fetched_at} (${CACHE_FILE}; --refetch to download again)`);
    return cache;
  }
  console.log('Downloading Danbooru tags and aliases...');
  const tags: LiveTag[] = [];
  for (const category of [0, 1, 3, 4, 5]) {
    const page = await fetchListing<LiveTag & { id: number }>(
      'tags',
      {
        'search[category]': String(category),
        'search[post_count]': `>=${MIN_POST_COUNT}`,
        only: 'id,name,category,post_count,is_deprecated',
      },
      `category ${category}`
    );
    tags.push(...page.map(({ name, category, post_count, is_deprecated }) => ({ name, category, post_count, is_deprecated })));
  }
  const aliases = (
    await fetchListing<LiveAlias & { id: number }>(
      'tag_aliases',
      { 'search[status]': 'active', only: 'id,antecedent_name,consequent_name' },
      'aliases'
    )
  ).map(({ antecedent_name, consequent_name }) => ({ antecedent_name, consequent_name }));
  const cache = { fetched_at: new Date().toISOString(), tags, aliases, lookups: {} };
  saveCache(cache);
  return cache;
}

function saveCache(cache: DanbooruCache) {
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
}

/** Exact post counts by name, for rows below the listing floor or gone from Danbooru (count 0). */
async function lookUpCounts(cache: DanbooruCache, names: string[]) {
  const todo = names.filter((n) => !(n in cache.lookups) && !n.includes(','));
  if (todo.length === 0) return;
  console.log(`Looking up ${fmt(todo.length)} tags by name...`);
  for (let i = 0; i < todo.length; i += 100) {
    const chunk = todo.slice(i, i + 100);
    const found = await danbooru<{ name: string; post_count: number }[]>('tags', {
      'search[name_comma]': chunk.join(','),
      only: 'name,post_count',
      limit: '1000',
    });
    const counts = new Map(found.map((t) => [t.name, t.post_count]));
    for (const name of chunk) cache.lookups[name] = counts.get(name) ?? 0;
    if ((i / 100) % 20 === 19) saveCache(cache);
  }
  saveCache(cache);
}

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const cache = await fetchDanbooru();
  const live = new Map(cache.tags.map((t) => [t.name, t]));
  const resolvesTo = new Map(cache.aliases.map((a) => [a.antecedent_name, a.consequent_name]));
  const aliasesOf = new Map<string, string[]>();
  for (const a of cache.aliases) aliasesOf.set(a.consequent_name, [...(aliasesOf.get(a.consequent_name) ?? []), a.antecedent_name]);

  const rows: DbRow[] = (await pool.query('SELECT name, category, post_count, aliases FROM public.auto_suggest_tags')).rows;
  console.log(`auto_suggest_tags: ${fmt(rows.length)} rows`);

  // A row aliased to a tag that is also a row is a duplicate (hairpin -> hairclip), not a rename: it
  // keeps its own count and does not take the other row's name as an alias.
  const rowNames = new Set(rows.map((r) => r.name));
  const renameTarget = (name: string) => {
    const to = resolvesTo.get(name);
    return to && !rowNames.has(to) ? to : undefined;
  };
  // Counts the listing cannot give: rows below the floor or gone, and rename targets below it.
  const countOf = (name: string): number | undefined => live.get(name)?.post_count ?? cache.lookups[name];
  const target = (r: DbRow) => (live.has(r.name) ? r.name : renameTarget(r.name) ?? r.name);
  await lookUpCounts(cache, [...new Set(rows.map(target).filter((n) => !live.has(n)))]);

  // 1, 2, 4: aliases and counts of existing rows.
  const updates: { name: string; post_count: number; aliases: string[]; added: string[]; renamed_to?: string }[] = [];
  const covered = new Set<string>();
  for (const r of rows) {
    const current = r.aliases ?? [];
    const to = target(r);
    const renamed = to !== r.name;
    // Names that are rows themselves are never added as aliases, so a tag is not suggested twice.
    const wanted = [...(renamed ? [to] : []), ...(aliasesOf.get(to) ?? [])].filter((a) => !rowNames.has(a));
    const added = [...new Set(wanted)].filter((a) => !current.includes(a));
    const aliases = [...current, ...added];
    // Never lowered: a tag Danbooru has emptied or deprecated (black_footwear, 287k -> 0) is still
    // one the models learned, and its old count says how well.
    const postCount = Math.max(r.post_count, countOf(to) ?? 0);
    covered.add(r.name);
    for (const a of aliases) covered.add(a);
    if (added.length > 0 || postCount !== r.post_count) {
      updates.push({ name: r.name, post_count: postCount, aliases, added, ...(renamed ? { renamed_to: to } : {}) });
    }
  }

  // 3: tags Danbooru gained since the import.
  const newTags: NewTag[] = cache.tags
    .filter((t) => !t.is_deprecated && !covered.has(t.name) && !resolvesTo.has(t.name))
    .map((t) => ({
      name: t.name,
      category: t.category,
      post_count: t.post_count,
      aliases: (aliasesOf.get(t.name) ?? []).filter((a) => !rowNames.has(a)),
    }))
    .sort((a, b) => b.post_count - a.post_count);

  const renamedRows = updates.filter((u) => u.renamed_to);
  const aliasRows = updates.filter((u) => u.added.length > 0);
  const oldCount = new Map(rows.map((r) => [r.name, r.post_count]));
  const countRows = updates.filter((u) => u.post_count !== oldCount.get(u.name));
  const newByCategory = new Map<number, number>();
  for (const t of newTags) newByCategory.set(t.category, (newByCategory.get(t.category) ?? 0) + 1);

  console.log(`\nRenamed on Danbooru (kept, new name added as alias): ${fmt(renamedRows.length)}`);
  console.log(`  e.g. ${renamedRows.sort((a, b) => b.post_count - a.post_count).slice(0, 12).map((u) => `${u.name}->${u.renamed_to}`).join(', ')}`);
  console.log(`Rows gaining aliases: ${fmt(aliasRows.length)} (${fmt(aliasRows.reduce((s, u) => s + u.added.length, 0))} aliases)`);
  console.log(`Rows with a new post_count: ${fmt(countRows.length)}`);
  console.log(`New tags: ${fmt(newTags.length)} (${[...newByCategory].sort().map(([c, n]) => `category ${c}: ${fmt(n)}`).join(', ')})`);
  console.log(`  most used: ${newTags.slice(0, 20).map((t) => `${t.name}(${fmt(t.post_count)})`).join(' ')}`);

  fs.writeFileSync(PLAN_FILE, JSON.stringify({ fetched_at: cache.fetched_at, updates, new_tags: newTags }, null, 1));
  console.log(`Plan written to ${PLAN_FILE}`);

  if (!APPLY) {
    console.log('Dry run: nothing written. Re-run with --apply.');
    await pool.end();
    return;
  }

  // Jev for the new general tags (rule slots for the rest).
  const general = newTags.filter((t) => t.category === 0);
  const aliasesByName = new Map(general.map((t) => [t.name, t.aliases]));
  const checkpoint: Record<string, JevClassificationResult> = fs.existsSync(CHECKPOINT_FILE)
    ? JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'))
    : {};
  const todo = general.filter((t) => !checkpoint[t.name]);
  const batches: string[][] = [];
  for (let i = 0; i < todo.length; i += 5) batches.push(todo.slice(i, i + 5).map((t) => t.name));
  console.log(`\nJev: ${fmt(general.length - todo.length)} cached, ${fmt(batches.length)} requests`);
  let done = 0;
  const queue = [...batches];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let batch = queue.shift(); batch; batch = queue.shift()) {
        const results = await classifyBatchWithJev(batch, { aliasesFor: (tag) => aliasesByName.get(tag) ?? [] });
        for (const r of results) checkpoint[r.tag] = r;
        if (++done % 50 === 0 || done === batches.length) {
          fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint));
          console.log(`  ${done}/${batches.length}`);
        }
      }
    })
  );
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint));
  const approved = general.filter((t) => checkpoint[t.name]?.status === 'approved').length;
  console.log(`Jev approved ${fmt(approved)} of ${fmt(general.length)} new general tags; the rest go to needs_review`);

  const inserts = newTags.map((t) => {
    if (t.category !== 0) {
      const [category_name, subcategory] = RULE_SLOTS[t.category];
      return { ...t, category_name, subcategory, confidence: 1, status: 'approved', proposed_category: null, proposed_subcategory: null };
    }
    const r = checkpoint[t.name];
    return {
      ...t,
      category_name: r.category,
      subcategory: r.subcategory,
      confidence: r.confidence,
      status: r.status,
      proposed_category: r.proposed_category ?? null,
      proposed_subcategory: r.proposed_subcategory ?? null,
    };
  });

  fs.mkdirSync('backups', { recursive: true });
  const backup = path.join('backups', `auto_suggest_tags-pre-danbooru-refresh-${new Date().toISOString().slice(0, 10)}.json`);
  const updated = new Set(updates.map((u) => u.name));
  fs.writeFileSync(backup, JSON.stringify(rows.filter((r) => updated.has(r.name))));
  console.log(`Backed up ${fmt(updated.size)} rows to ${backup} (new rows can be removed by name from ${PLAN_FILE})`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < updates.length; i += 2000) {
      const chunk = updates.slice(i, i + 2000);
      await client.query(
        `UPDATE public.auto_suggest_tags AS t
         SET post_count = v.post_count, aliases = ARRAY(SELECT jsonb_array_elements_text(v.aliases))
         FROM unnest($1::text[], $2::int[], $3::jsonb[]) AS v(name, post_count, aliases)
         WHERE t.name = v.name`,
        [chunk.map((u) => u.name), chunk.map((u) => u.post_count), chunk.map((u) => JSON.stringify(u.aliases))]
      );
    }
    for (let i = 0; i < inserts.length; i += 2000) {
      const chunk = inserts.slice(i, i + 2000);
      await client.query(
        `INSERT INTO public.auto_suggest_tags
           (name, category, post_count, aliases, category_name, subcategory, confidence, status, proposed_category, proposed_subcategory)
         SELECT v.name, v.category, v.post_count, ARRAY(SELECT jsonb_array_elements_text(v.aliases)),
                v.category_name, v.subcategory, v.confidence, v.status, v.proposed_category, v.proposed_subcategory
         FROM unnest($1::text[], $2::int[], $3::int[], $4::jsonb[], $5::text[], $6::text[], $7::real[], $8::text[], $9::text[], $10::text[])
           AS v(name, category, post_count, aliases, category_name, subcategory, confidence, status, proposed_category, proposed_subcategory)
         ON CONFLICT (name) DO NOTHING`,
        [
          chunk.map((t) => t.name),
          chunk.map((t) => t.category),
          chunk.map((t) => t.post_count),
          chunk.map((t) => JSON.stringify(t.aliases)),
          chunk.map((t) => t.category_name),
          chunk.map((t) => t.subcategory),
          chunk.map((t) => t.confidence),
          chunk.map((t) => t.status),
          chunk.map((t) => t.proposed_category),
          chunk.map((t) => t.proposed_subcategory),
        ]
      );
    }
    await client.query('COMMIT');
    console.log(`Updated ${fmt(updates.length)} rows, inserted ${fmt(inserts.length)}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
