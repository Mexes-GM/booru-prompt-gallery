/**
 * Exports the tag taxonomy (`auto_suggest_tags`) as a Hugging Face dataset:
 * Parquet (what the HF viewer and `datasets` read) + CSV (for webui/ComfyUI
 * users) + a generated dataset card with live stats.
 *
 * Only public vocabulary leaves the database: tag name, aliases, Danbooru
 * category and post count, plus our 7-category / 33-slot classification.
 * Internal ids, timestamps, review proposals and anything user-linked
 * (tag_suggestions) are never read.
 *
 * Usage:
 *   bun scripts/export-hf-dataset.ts                 # -> dist/hf-dataset/
 *   bun scripts/export-hf-dataset.ts --out=some/dir
 *
 * Upload (after reviewing the output):
 *   hf upload Mexes/booru-tag-taxonomy dist/hf-dataset . --repo-type=dataset
 *
 * `npm run dataset:export` also draws the card charts (export-hf-charts.mjs).
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env.development.local', quiet: true });
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { parquetWriteFile } from 'hyparquet-writer';
import { CONFIDENCE_THRESHOLD } from '../lib/jev-classifier';
import { TAG_CATEGORY_IDS, TAG_CATEGORIES, TAG_SUBCATEGORIES } from '../lib/tag-taxonomy';

const PAGE_SIZE = 1000;
const HF_REPO = 'Mexes/booru-tag-taxonomy';
const OUT_DIR = path.resolve(
  process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? 'dist/hf-dataset'
);

/** Danbooru's own tag type numbering, as stored in `auto_suggest_tags.category`. */
const DANBOORU_CATEGORY_NAMES: Record<number, string> = {
  0: 'general',
  3: 'copyright',
  4: 'character',
  5: 'meta',
};

/**
 * Danbooru artist tags are left out: their slot comes from the Danbooru type, so they add nothing to the
 * classification, and a list of artist names mainly serves style imitation.
 */
const DANBOORU_ARTIST = 1;

/**
 * Terms boorus use to tag sexualized minors. Tags containing one of these words are not exported, and
 * aliases containing one are stripped from the tags that remain. Matching is per word, so `child`,
 * `baby` or `child_carry` stay. NSFW tags in general are kept.
 */
const EXCLUDED_TERMS = new Set(['loli', 'lolicon', 'rori', 'shota', 'shotacon', 'toddlercon', 'toddlersex']);
/** Tags excluded by name that the word match misses (`kodomo_doushi` is aliased as `child_on_child`). */
const EXCLUDED_TAGS = new Set(['kodomo_doushi']);
/** Proper names that contain an excluded word ("Shota" as a given name). */
const NAME_EXCEPTIONS = new Set(['aizawa_shota']);

function hasExcludedTerm(name: string): boolean {
  return name.toLowerCase().split(/[^a-z0-9]+/).some((word) => EXCLUDED_TERMS.has(word));
}

function isExcluded(r: SourceRow): boolean {
  if (r.category === DANBOORU_ARTIST || EXCLUDED_TAGS.has(r.name)) return true;
  return hasExcludedTerm(r.name) && !NAME_EXCEPTIONS.has(r.name);
}

interface SourceRow {
  name: string;
  category: number;
  category_name: string | null;
  subcategory: string | null;
  confidence: number | null;
  status: string;
  post_count: number | null;
  aliases: string[] | null;
}

interface ExportRow {
  tag: string;
  danbooru_category: string;
  category: string;
  subcategory: string;
  slot: string;
  confidence: number | null;
  status: string;
  post_count: number;
  aliases: string[];
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function fetchAll(): Promise<SourceRow[]> {
  const rows: SourceRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('auto_suggest_tags')
      .select('name, category, category_name, subcategory, confidence, status, post_count, aliases')
      .neq('category', DANBOORU_ARTIST)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`auto_suggest_tags fetch failed at ${from}: ${error.message}`);
    rows.push(...(data as SourceRow[]));
    if (!data || data.length < PAGE_SIZE) break;
    if (rows.length % 20000 === 0) console.log(`  ${rows.length} rows...`);
  }
  return rows;
}

function toExportRow(r: SourceRow): ExportRow {
  const category = r.category_name ?? 'other';
  const subcategory = r.subcategory ?? 'unclassified';
  return {
    tag: r.name,
    danbooru_category: DANBOORU_CATEGORY_NAMES[r.category] ?? String(r.category),
    category,
    subcategory,
    slot: `${category}:${subcategory}`,
    // Stored as float4 in Postgres; round off the binary noise (0.9900000095 -> 0.99).
    confidence: r.confidence === null ? null : Math.round(r.confidence * 100) / 100,
    status: r.status,
    post_count: r.post_count ?? 0,
    aliases: (r.aliases ?? []).filter((a) => a && !hasExcludedTerm(a)),
  };
}

function writeParquet(rows: ExportRow[], file: string) {
  // Types live in the explicit schema below (the writer rejects both at once).
  parquetWriteFile({
    filename: file,
    columnData: [
      { name: 'tag', data: rows.map((r) => r.tag) },
      { name: 'danbooru_category', data: rows.map((r) => r.danbooru_category) },
      { name: 'category', data: rows.map((r) => r.category) },
      { name: 'subcategory', data: rows.map((r) => r.subcategory) },
      { name: 'slot', data: rows.map((r) => r.slot) },
      { name: 'confidence', data: rows.map((r) => r.confidence) },
      { name: 'status', data: rows.map((r) => r.status) },
      { name: 'post_count', data: rows.map((r) => r.post_count) },
      { name: 'aliases', data: rows.map((r) => r.aliases) },
    ],
    schema: [
      { name: 'root', num_children: 9 },
      { name: 'tag', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
      { name: 'danbooru_category', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
      { name: 'category', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
      { name: 'subcategory', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
      { name: 'slot', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
      { name: 'confidence', type: 'DOUBLE', repetition_type: 'OPTIONAL' },
      { name: 'status', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
      { name: 'post_count', type: 'INT32', repetition_type: 'REQUIRED' },
      // Standard 3-level LIST so pyarrow/datasets read it as list<string>.
      { name: 'aliases', repetition_type: 'REQUIRED', converted_type: 'LIST', num_children: 1 },
      { name: 'list', repetition_type: 'REPEATED', num_children: 1 },
      { name: 'element', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
    ],
  });
}

function csvField(value: string | number | null): string {
  if (value === null) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(rows: ExportRow[], file: string) {
  const header = 'tag,danbooru_category,category,subcategory,slot,confidence,status,post_count,aliases';
  const lines = rows.map((r) =>
    [
      r.tag,
      r.danbooru_category,
      r.category,
      r.subcategory,
      r.slot,
      r.confidence,
      r.status,
      r.post_count,
      // Same convention as Danbooru's own CSV dumps: aliases comma-joined in one field.
      r.aliases.join(','),
    ]
      .map(csvField)
      .join(',')
  );
  fs.writeFileSync(file, `${header}\n${lines.join('\n')}\n`, 'utf8');
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

const fmt = (n: number) => n.toLocaleString('en-US');

function sizeCategory(n: number): string {
  if (n < 1_000) return 'n<1K';
  if (n < 10_000) return '1K<n<10K';
  if (n < 100_000) return '10K<n<100K';
  if (n < 1_000_000) return '100K<n<1M';
  return '1M<n<10M';
}

function buildCard(rows: ExportRow[]): string {
  const general = rows.filter((r) => r.danbooru_category === 'general');
  const generalApproved = general.filter((r) => r.status === 'approved');
  const byDanbooru = countBy(rows, (r) => r.danbooru_category);
  const bySlot = countBy(generalApproved, (r) => r.slot);
  const byStatus = countBy(rows, (r) => r.status);
  const generalExact = generalApproved.filter((r) => r.confidence === 1).length;

  const slotTable = TAG_CATEGORY_IDS.map((cat) => {
    // The app describes `other` as an unsorted bucket; in the dataset it is a real category.
    const covers = cat === 'other' ? 'Who and where a tag comes from, art style, layout and image metadata' : TAG_CATEGORIES[cat].description;
    const slots = TAG_SUBCATEGORIES[cat]
      .map((sub) => `\`${sub}\` (${fmt(bySlot.get(`${cat}:${sub}`) ?? 0)})`)
      .join(', ');
    return `| \`${cat}\` | ${covers} | ${slots} |`;
  }).join('\n');

  const danbooruTable = Object.values(DANBOORU_CATEGORY_NAMES)
    .map((name) => `| \`${name}\` | ${fmt(byDanbooru.get(name) ?? 0)} |`)
    .join('\n');

  const today = new Date().toISOString().slice(0, 10);

  return `---
license: cc-by-4.0
language:
  - en
pretty_name: Booru Tag Taxonomy
size_categories:
  - ${sizeCategory(rows.length)}
task_categories:
  - text-classification
tags:
  - danbooru
  - booru
  - anime
  - tags
  - taxonomy
  - stable-diffusion
  - prompt-engineering
  - not-for-all-audiences
configs:
  - config_name: default
    data_files:
      - split: train
        path: tags.parquet
---

# Booru Tag Taxonomy

${fmt(rows.length)} Danbooru tags labelled with a category and a slot from a fixed taxonomy of 7 categories
and 33 slots, for example \`clothing:footwear\`, \`pose:expression\` or \`scenery:atmosphere\`.
The labels come from [booru-prompt-gallery](https://github.com/Mexes-GM/booru-prompt-gallery), which uses them
to colour tags, score prompts and generate prompt variations.

Danbooru marks most descriptive tags as \`general\` and does not say what part of the image they describe.
This dataset adds that. Tags that would replace each other in a prompt share a slot: \`boots\` and \`sneakers\` are
both \`clothing:footwear\`. Possible uses:

- grouping or colouring tags in prompt editors and autocomplete,
- wildcard and prompt randomizers that change one slot at a time,
- filtering or balancing captions for image model training,
- checking which parts of an image a caption describes.

Snapshot: ${today}.

## Files

| File | Format |
|---|---|
| \`tags.parquet\` | Parquet, \`aliases\` as \`list<string>\` (read by the dataset viewer and \`datasets\`) |
| \`tags.csv\` | UTF-8 CSV, \`aliases\` comma-joined in one quoted field |

\`\`\`python
from datasets import load_dataset

ds = load_dataset("${HF_REPO}", split="train")
general = ds.filter(lambda r: r["danbooru_category"] == "general" and r["status"] == "approved")
\`\`\`

## Columns

| Column | Type | Description |
|---|---|---|
| \`tag\` | string | Danbooru tag name, underscores kept (\`long_hair\`) |
| \`danbooru_category\` | string | Danbooru's tag type: \`general\`, \`artist\`, \`copyright\`, \`character\`, \`meta\` |
| \`category\` | string | One of the 7 categories below |
| \`subcategory\` | string | Slot within the category; \`unclassified\` while pending review |
| \`slot\` | string | \`category:subcategory\` in one column |
| \`confidence\` | float | Classifier confidence (0–1); \`1.0\` for rule-derived rows, hand-set rows and rows where both external sources agree |
| \`status\` | string | \`approved\` or \`needs_review\` (see below) |
| \`post_count\` | int | Danbooru post count when the tag was imported (not live; \`0\` when unknown) |
| \`aliases\` | list&lt;string&gt; | Danbooru aliases that resolve to this tag |

## Taxonomy

![Approved general tags per category](charts/categories.png)

Counts are approved \`general\` tags per slot.

| Category | Covers | Slots |
|---|---|---|
${slotTable}

Non-general Danbooru tags are assigned by type: \`copyright\` → \`other:copyright\`,
\`character\` → \`other:character\`, \`meta\` → \`other:meta\`.

## Composition

![Tags by Danbooru type](charts/composition.png)

| Danbooru type | Tags |
|---|---|
${danbooruTable}

- \`approved\`: ${fmt(byStatus.get('approved') ?? 0)} rows
- \`needs_review\`: ${fmt(byStatus.get('needs_review') ?? 0)} rows, all \`general\` tags parked in \`other:unclassified\`
  because the model's best slot scored below ${CONFIDENCE_THRESHOLD} or no slot fit. Drop them unless you plan to label them yourself.
- ${fmt(generalApproved.length)} of ${fmt(general.length)} general tags have a slot;
  ${fmt(generalExact)} of those have \`confidence = 1\`, the rest are model labels at or above ${CONFIDENCE_THRESHOLD}.

![Classifier confidence for general tags](charts/confidence.png)

## How it was built

1. Tag names, aliases, types and post counts come from Danbooru's public tag data.
2. General tags were labelled with [Jev](https://typesafe.ai), TypeSafe's classification model, using the
   taxonomy definitions as context. Labels below ${CONFIDENCE_THRESHOLD} confidence were kept as \`needs_review\`.
   Copyright, character and meta tags were assigned by rule from their Danbooru type, and general tags of
   the form \`X_(cosplay)\` (dressed as character X) are \`clothing:outfit\`.
3. Labels were cross-checked against two public sources:
   [Danbooru's tag-group wiki](https://danbooru.donmai.us/wiki_pages/tag_groups), via
   [danbooru-tag-groups-scraper](https://github.com/PBandDev/danbooru-tag-groups-scraper), and
   [Jio7/danbooru-tags-classified](https://huggingface.co/datasets/Jio7/danbooru-tags-classified).
   Pending tags were approved where both sources pointed to the same slot. Where only Jio7 gave a category,
   Jev chose again among that category's slots. Approved tags that a wiki group placed in another slot were
   asked again with only the two slots as options, and changed when Jev picked the wiki's.
4. Labels reported as wrong in the app, or fixed in its admin review queue, were corrected by hand.
   Hand corrections replace the model's label.

## Limitations

- Each tag has one slot. Some tags fit two: \`holding_sword\` is labelled \`equipment:weapon\`, although it
  also describes a gesture.
- \`post_count\` is not updated after import. Query Danbooru for current counts.
- Most rows with \`confidence < 1\` were labelled by the model and not checked by hand, so some slots are wrong.
- English Danbooru vocabulary only.

## Excluded tags

Danbooru artist tags are not included. Their slot would only repeat the Danbooru type, and the dataset is
not meant to be a list of artist names.

## Content warning

Danbooru's vocabulary includes tags for sexual and other adult content, and they are labelled like any
other tag. The dataset contains tag names only, no images.

## License and attribution

The classification (\`category\`, \`subcategory\`, \`slot\`, \`confidence\`, \`status\`) is released under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Tag names, aliases and post counts originate from
[Danbooru](https://danbooru.donmai.us). Credit both when you use it. The cross-check used
danbooru-tag-groups-scraper and Jio7/danbooru-tags-classified, both MIT-licensed.

\`\`\`bibtex
@misc{booru_tag_taxonomy,
  title  = {Booru Tag Taxonomy},
  year   = {${today.slice(0, 4)}},
  url    = {https://github.com/Mexes-GM/booru-prompt-gallery}
}
\`\`\`
`;
}

async function main() {
  console.log('Fetching auto_suggest_tags...');
  const source = await fetchAll();
  const kept = source.filter((r) => !isExcluded(r));
  console.log(`Excluded ${source.length - kept.length} tags by content filter`);
  const rows = kept
    .map(toExportRow)
    // Most popular first, so the viewer and CSV head show the useful tags.
    .sort((a, b) => b.post_count - a.post_count || a.tag.localeCompare(b.tag));

  const dupes = rows.length - new Set(rows.map((r) => r.tag)).size;
  if (dupes > 0) throw new Error(`${dupes} duplicate tag names; refusing to export`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeParquet(rows, path.join(OUT_DIR, 'tags.parquet'));
  writeCsv(rows, path.join(OUT_DIR, 'tags.csv'));
  fs.writeFileSync(path.join(OUT_DIR, 'README.md'), buildCard(rows), 'utf8');

  console.log(`Wrote ${fmt(rows.length)} tags to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
