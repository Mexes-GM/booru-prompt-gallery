/**
 * Refines general-tag classifications in `auto_suggest_tags` using two public, MIT-licensed sources:
 *
 *   - Danbooru's tag-group wiki, as exported by github.com/PBandDev/danbooru-tag-groups-scraper
 *     (tag_groups_flat.jsonl from a monthly release).
 *   - huggingface.co/datasets/Jio7/danbooru-tags-classified (one CSV per category).
 *
 * A wiki section maps to one of our slots when at least 80% of its approved tags (and 8 or more)
 * already share that slot. Then, for general tags:
 *
 *   1. needs_review, the wiki slot and Jio7's category agree      -> approved, confidence 1
 *   2. needs_review, Jio7 gives a category                        -> Jev picks among that category's
 *      slots (plus "none"); >= threshold and not contradicting the wiki -> approved; contradicting the
 *      wiki -> stays needs_review with the wiki slot as proposal
 *   3. needs_review, wiki slot only (or Jev unsure)               -> stays needs_review, wiki slot proposed
 *   4. approved, wiki says another slot                           -> Jev picks between the two; switched
 *      only when it picks the wiki slot at >= threshold
 *
 * Tags approved by hand (`tags.status = 'approved'`) are never changed.
 *
 * Usage:
 *   bun scripts/refine-tags-external.ts --groups=<tag_groups_flat.jsonl> --jio7=<dir>            # dry run
 *   bun scripts/refine-tags-external.ts --groups=<...> --jio7=<...> --apply                       # write
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env.development.local', quiet: true });
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { askJevChoiceBatch, CONFIDENCE_THRESHOLD, JEV_CRITERIA_33 } from '../lib/jev-classifier';
import { TAG_SUBCATEGORIES, type TagCategory } from '../lib/tag-taxonomy';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const GROUPS_FILE = arg('groups');
const JIO7_DIR = arg('jio7');
const APPLY = process.argv.includes('--apply');
if (!GROUPS_FILE || !JIO7_DIR) {
  console.error('Usage: bun scripts/refine-tags-external.ts --groups=<jsonl> --jio7=<dir> [--apply]');
  process.exit(1);
}

const DATA_DIR = path.join(process.cwd(), 'data');
const CHECKPOINT_FILE = path.join(DATA_DIR, 'jev-external-refine-checkpoint.json');
const PLAN_FILE = path.join(DATA_DIR, 'external-refine-plan.json');
const BACKUP_DIR = path.join(process.cwd(), 'backups');

const PURE_SHARE = 0.8;
const PURE_MIN_APPROVED = 8;
/** Lists (not tag_group pages) whose entries are general tags rather than names. */
const GENERAL_LISTS = new Set(['list_of_animals', 'list_of_weapons', 'list_of_armor', 'list_of_uniforms']);
const NONE = 'none';

/** Jio7 file -> the slots Jev may choose from. `object` spans two of our categories. */
const JIO7_SLOTS: Record<string, string[]> = {
  attire: slotsOf('clothing'),
  feature: slotsOf('appearance'),
  count: slotsOf('appearance'),
  action: slotsOf('pose'),
  expression: slotsOf('pose'),
  setting: slotsOf('scenery'),
  object: [...slotsOf('equipment'), 'scenery:props'],
  style: ['other:style', 'other:layout', 'other:meta'],
  meta: ['other:style', 'other:layout', 'other:meta'],
};

function slotsOf(cat: TagCategory): string[] {
  return TAG_SUBCATEGORIES[cat].map((sub) => `${cat}:${sub}`);
}

interface Row {
  name: string;
  category_name: string | null;
  subcategory: string | null;
  status: string;
  confidence: number | null;
  proposed_category: string | null;
  proposed_subcategory: string | null;
  post_count: number | null;
}

interface Change {
  name: string;
  action: 'approve' | 'propose' | 'switch';
  slot: string;
  confidence: number | null;
  reason: string;
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const slotOf = (r: Row) => `${r.category_name ?? 'other'}:${r.subcategory ?? 'unclassified'}`;

async function fetchPaged<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

function loadWikiMembership(general: Map<string, Row>): Map<string, Set<string>> {
  const member = new Map<string, Set<string>>();
  for (const line of fs.readFileSync(GROUPS_FILE!, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.page_kind !== 'tag_group' && !GENERAL_LISTS.has(r.page_slug)) continue;
    const tag: string | undefined = r.canonical_name;
    if (!tag || !general.has(tag)) continue;
    const section = `${r.page_slug}|${r.section_title ?? ''}`;
    if (!member.has(tag)) member.set(tag, new Set());
    member.get(tag)!.add(section);
  }
  return member;
}

/** Sections whose approved tags mostly share one slot, mapped to that slot. */
function pureSections(member: Map<string, Set<string>>, general: Map<string, Row>): Map<string, string> {
  const bySection = new Map<string, string[]>();
  for (const [tag, sections] of member) {
    const row = general.get(tag)!;
    if (row.status !== 'approved') continue;
    for (const s of sections) {
      if (!bySection.has(s)) bySection.set(s, []);
      bySection.get(s)!.push(slotOf(row));
    }
  }
  const pure = new Map<string, string>();
  for (const [section, slots] of bySection) {
    if (slots.length < PURE_MIN_APPROVED) continue;
    const counts = new Map<string, number>();
    for (const s of slots) counts.set(s, (counts.get(s) ?? 0) + 1);
    const [slot, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (n / slots.length >= PURE_SHARE) pure.set(section, slot);
  }
  return pure;
}

function loadJio7(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of Object.keys(JIO7_SLOTS)) {
    const lines = fs.readFileSync(path.join(JIO7_DIR!, `${file}.csv`), 'utf8').split('\n').slice(1);
    for (const line of lines) {
      const tag = line.slice(0, line.lastIndexOf(',')).replace(/^"|"$/g, '');
      if (tag && !out.has(tag)) out.set(tag, file);
    }
  }
  return out;
}

type Checkpoint = Record<string, { choice: string | null; confidence: number }>;

/** Jev answers for (tag, options) pairs, cached by tag + option set so reruns are free. */
async function askJev(items: { tag: string; options: string[] }[], checkpoint: Checkpoint) {
  const key = (i: { tag: string; options: string[] }) => `${i.tag}|${[...i.options].sort().join(',')}`;
  const todo = items.filter((i) => !checkpoint[key(i)]);
  // Same option set per call, so group by it before batching in fives.
  const groups = new Map<string, typeof todo>();
  for (const i of todo) {
    const k = [...i.options].sort().join(',');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  }
  const batches: (typeof todo)[] = [];
  for (const g of groups.values()) for (let i = 0; i < g.length; i += 5) batches.push(g.slice(i, i + 5));

  console.log(`Jev: ${items.length - todo.length} cached, ${todo.length} to ask in ${batches.length} calls`);
  const CONCURRENCY = 2;
  let done = 0;
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    await Promise.all(
      batches.slice(i, i + CONCURRENCY).map(async (batch) => {
        const criteria: Record<string, string> = {};
        for (const o of batch[0].options) {
          criteria[o] = o === NONE ? 'None of the other options describes this visual element' : JEV_CRITERIA_33[o];
        }
        const answers = await askJevChoiceBatch(
          batch.map((b) => b.tag),
          criteria,
          (p) => `Which taxonomy slot does visual element \`${p}\` belong to?`
        );
        answers.forEach((a, idx) => (checkpoint[key(batch[idx])] = { choice: a.choice, confidence: a.confidence }));
      })
    );
    done += Math.min(CONCURRENCY, batches.length - i);
    if (done % 20 === 0 || done === batches.length) {
      fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint));
      console.log(`  ${done}/${batches.length} calls`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return (i: { tag: string; options: string[] }) => checkpoint[key(i)];
}

async function main() {
  console.log('Loading general tags...');
  const rows = await fetchPaged<Row>((from, to) =>
    supabase
      .from('auto_suggest_tags')
      .select('name, category_name, subcategory, status, confidence, proposed_category, proposed_subcategory, post_count')
      .eq('category', 0)
      .order('name')
      .range(from, to)
  );
  const general = new Map(rows.map((r) => [r.name, r]));
  const handSet = new Set(
    (
      await fetchPaged<{ name: string }>((from, to) =>
        supabase.from('tags').select('name').eq('status', 'approved').order('name').range(from, to)
      )
    ).map((r) => r.name.replace(/ /g, '_'))
  );

  const member = loadWikiMembership(general);
  const pure = pureSections(member, general);
  const wikiSlot = (tag: string): string | null => {
    const slots = new Set([...(member.get(tag) ?? [])].filter((s) => pure.has(s)).map((s) => pure.get(s)!));
    return slots.size === 1 ? [...slots][0] : null;
  };
  const jio7 = loadJio7();
  console.log(`${general.size} general tags, ${member.size} in the wiki, ${pure.size} pure sections, ${jio7.size} Jio7 tags`);

  const changes: Change[] = [];
  const pending = rows.filter((r) => r.status === 'needs_review' && !handSet.has(r.name));

  // 1. Wiki and Jio7 agree.
  const agreed = new Set<string>();
  for (const r of pending) {
    const w = wikiSlot(r.name);
    const j = jio7.get(r.name);
    if (w && j && JIO7_SLOTS[j].includes(w)) {
      changes.push({ name: r.name, action: 'approve', slot: w, confidence: 1, reason: 'wiki+jio7' });
      agreed.add(r.name);
    }
  }

  // 2. Jev restricted to Jio7's category; 4. Jev between our slot and the wiki's.
  const restricted = pending
    .filter((r) => !agreed.has(r.name) && jio7.has(r.name))
    .map((r) => {
      const options = [...JIO7_SLOTS[jio7.get(r.name)!]];
      // Our convention files holding_x under equipment, whatever Jio7 calls it.
      if (r.name.startsWith('holding_')) options.push(...slotsOf('equipment').filter((s) => !options.includes(s)));
      return { tag: r.name, options: [...options, NONE] };
    });
  const disputed = rows
    .filter((r) => r.status === 'approved' && !handSet.has(r.name))
    .map((r) => ({ r, w: wikiSlot(r.name) }))
    .filter(({ r, w }) => w && w !== slotOf(r))
    .map(({ r, w }) => ({ tag: r.name, options: [slotOf(r), w!] }));

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const checkpoint: Checkpoint = fs.existsSync(CHECKPOINT_FILE) ? JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')) : {};
  const answer = await askJev([...restricted, ...disputed], checkpoint);

  for (const item of restricted) {
    const a = answer(item);
    const w = wikiSlot(item.tag);
    const sure = a?.choice && a.choice !== NONE && a.confidence >= CONFIDENCE_THRESHOLD;
    if (sure && (!w || w === a.choice)) {
      changes.push({ name: item.tag, action: 'approve', slot: a.choice!, confidence: a.confidence, reason: w ? 'jev+wiki' : 'jev-jio7' });
    } else if (w) {
      changes.push({ name: item.tag, action: 'propose', slot: w, confidence: null, reason: sure ? 'wiki-vs-jev' : 'wiki' });
    } else if (a?.choice && a.choice !== NONE) {
      changes.push({ name: item.tag, action: 'propose', slot: a.choice, confidence: null, reason: 'jev-jio7-unsure' });
    }
  }

  // 3. Wiki-only proposals for pending tags Jio7 doesn't cover.
  for (const r of pending) {
    if (agreed.has(r.name) || jio7.has(r.name)) continue;
    const w = wikiSlot(r.name);
    if (w) changes.push({ name: r.name, action: 'propose', slot: w, confidence: null, reason: 'wiki' });
  }

  for (const item of disputed) {
    const a = answer(item);
    if (a?.choice === item.options[1] && a.confidence >= CONFIDENCE_THRESHOLD) {
      changes.push({ name: item.tag, action: 'switch', slot: a.choice, confidence: a.confidence, reason: `was ${item.options[0]}` });
    }
  }

  const summary = new Map<string, number>();
  for (const c of changes) summary.set(`${c.action} (${c.reason})`, (summary.get(`${c.action} (${c.reason})`) ?? 0) + 1);
  console.log('\nPlan:');
  for (const [k, n] of [...summary].sort()) console.log(`  ${k}: ${n}`);
  console.log(`  disputed approved tags asked: ${disputed.length}`);
  const top = (action: Change['action']) =>
    changes
      .filter((c) => c.action === action)
      .sort((a, b) => (general.get(b.name)!.post_count ?? 0) - (general.get(a.name)!.post_count ?? 0))
      .slice(0, 15)
      .map((c) => `${c.name}->${c.slot}`)
      .join(', ');
  console.log(`\nTop approvals: ${top('approve')}\nTop switches: ${top('switch')}\nTop proposals: ${top('propose')}`);
  fs.writeFileSync(PLAN_FILE, JSON.stringify(changes, null, 1));
  console.log(`\nPlan written to ${PLAN_FILE}`);

  if (!APPLY) {
    console.log('Dry run: nothing written. Re-run with --apply.');
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupFile = path.join(BACKUP_DIR, `auto_suggest_tags-pre-external-refine-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(changes.map((c) => general.get(c.name)), null, 1));
  console.log(`Backed up ${changes.length} rows to ${backupFile}`);

  let written = 0;
  const failures: string[] = [];
  const queue = [...changes];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const [category, subcategory] = c.slot.split(':');
        const update =
          c.action === 'propose'
            ? { proposed_category: category, proposed_subcategory: subcategory }
            : { category_name: category, subcategory, status: 'approved', confidence: c.confidence };
        const { error } = await supabase.from('auto_suggest_tags').update(update).eq('name', c.name);
        if (error) failures.push(`${c.name}: ${error.message}`);
        else written++;
        // `tags` is left alone: an approved row there means a person reviewed the tag.
      }
    })
  );
  console.log(`Wrote ${written}/${changes.length} rows${failures.length ? `; failures:\n${failures.join('\n')}` : ''}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
