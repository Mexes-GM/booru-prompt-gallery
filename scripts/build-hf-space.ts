/**
 * Builds the Hugging Face Space (a static page) from the dataset export:
 * dist/hf-space/{index.html, tags.json, README.md}. Run `npm run dataset:export` first; the Space reads
 * the already-filtered dist/hf-dataset/tags.parquet, so it never contains tags the dataset leaves out.
 *
 * Usage:
 *   HF_DATASET_REPO=<user>/<name> bun scripts/build-hf-space.ts
 *   hf upload <user>/<space> dist/hf-space . --repo-type=space
 */
import fs from 'fs';
import path from 'path';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { TAG_CATEGORY_IDS, TAG_SUBCATEGORIES } from '../lib/tag-taxonomy';

const PARQUET = path.join('dist', 'hf-dataset', 'tags.parquet');
const OUT_DIR = path.join('dist', 'hf-space');
const PAGE = path.join('scripts', 'hf-space', 'index.html');
const DATASET = process.env.HF_DATASET_REPO ?? null;

interface Row {
  tag: string;
  slot: string;
  status: string;
  aliases: string[];
}

const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '_');

async function main() {
  if (!fs.existsSync(PARQUET)) throw new Error(`${PARQUET} not found; run npm run dataset:export first`);
  const rows = (await parquetReadObjects({
    file: await asyncBufferFromFile(PARQUET),
    columns: ['tag', 'slot', 'status', 'aliases'],
  })) as Row[];

  const slots = TAG_CATEGORY_IDS.flatMap((c) => TAG_SUBCATEGORIES[c].map((s) => `${c}:${s}`));
  const pending = slots.length;
  const slotIndex = new Map(slots.map((s, i) => [s, i]));

  // t: tag -> slot index (pending for needs_review); a: alias -> tag, skipping aliases that are tags themselves.
  const t: Record<string, number> = {};
  for (const r of rows) t[key(r.tag)] = r.status === 'approved' ? slotIndex.get(r.slot) ?? pending : pending;
  const a: Record<string, string> = {};
  for (const r of rows) {
    for (const alias of r.aliases) {
      const k = key(alias);
      if (!(k in t) && !(k in a)) a[k] = key(r.tag);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'tags.json'), JSON.stringify({ dataset: DATASET, slots, pending, t, a }));
  fs.copyFileSync(PAGE, path.join(OUT_DIR, 'index.html'));
  fs.writeFileSync(
    path.join(OUT_DIR, 'README.md'),
    `---
title: Danbooru Tag Taxonomy
emoji: 🏷️
colorFrom: blue
colorTo: green
sdk: static
pinned: false
license: cc-by-4.0
short_description: Group Danbooru prompt tags by what they describe
tags:
  - danbooru
  - anime
  - stable-diffusion
  - prompt-engineering
${DATASET ? `datasets:\n  - ${DATASET}\n` : ''}---

Paste a Danbooru-style prompt and see each tag grouped by category and slot (hair, top, expression, posture,
setting and so on). Runs entirely in the browser.
${DATASET ? `\nData: [${DATASET}](https://huggingface.co/datasets/${DATASET}).\n` : ''}`
  );

  const size = fs.statSync(path.join(OUT_DIR, 'tags.json')).size;
  console.log(`Wrote ${OUT_DIR}: ${Object.keys(t).length} tags, ${Object.keys(a).length} aliases, tags.json ${(size / 1e6).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
