/**
 * Re-asks Jev, with the current slot prompt in lib/jev-classifier.ts, about general tags still in
 * needs_review. A confident answer (>= CONFIDENCE_THRESHOLD, not "none") approves the tag, unless it
 * contradicts a Danbooru tag-group wiki proposal from scripts/refine-tags-external.ts; everything else
 * is left as it is, keeping its current proposal. Tags whose slot is fixed by their form (ruleSlotFor,
 * e.g. X_(cosplay) -> clothing:outfit) get that slot whatever their status. Tags approved in `tags` are
 * never touched.
 *
 * Usage:
 *   bun scripts/reclassify-needs-review.ts            # dry run, writes data/reclassify-needs-review-plan.json
 *   bun scripts/reclassify-needs-review.ts --apply    # back up the affected rows, then write
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { classifyBatchWithJev, ruleSlotFor, type JevClassificationResult } from '../lib/jev-classifier';

const APPLY = process.argv.includes('--apply');
const CHECKPOINT_FILE = path.join('data', 'jev-reclassify-needs-review-checkpoint.json');
const PLAN_FILE = path.join('data', 'reclassify-needs-review-plan.json');
const EXTERNAL_PLAN_FILE = path.join('data', 'external-refine-plan.json');

interface Row {
  name: string;
  category_name: string | null;
  subcategory: string | null;
  status: string;
  confidence: number | null;
  proposed_category: string | null;
  proposed_subcategory: string | null;
  post_count: number | null;
  aliases: string[] | null;
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function fetchAll<T>(table: string, columns: string, filter: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(supabase.from(table).select(columns)).order('name').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function main() {
  const pending = await fetchAll<Row>(
    'auto_suggest_tags',
    'name, category_name, subcategory, status, confidence, proposed_category, proposed_subcategory, post_count, aliases',
    (q) => q.eq('category', 0).eq('status', 'needs_review')
  );
  const handSet = new Set(
    (await fetchAll<{ name: string }>('tags', 'name', (q) => q.eq('status', 'approved'))).map((r) => r.name.replace(/ /g, '_'))
  );
  const wikiProposal = new Map<string, string>(
    fs.existsSync(EXTERNAL_PLAN_FILE)
      ? JSON.parse(fs.readFileSync(EXTERNAL_PLAN_FILE, 'utf8'))
          .filter((c: { action: string; reason: string }) => c.action === 'propose' && c.reason.startsWith('wiki'))
          .map((c: { name: string; slot: string }) => [c.name, c.slot])
      : []
  );
  const rows = pending.filter((r) => !handSet.has(r.name));
  const byName = new Map(rows.map((r) => [r.name, r]));
  console.log(`${pending.length} needs_review general tags, ${rows.length} after skipping hand-approved ones`);

  const checkpoint: Record<string, JevClassificationResult> = fs.existsSync(CHECKPOINT_FILE)
    ? JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'))
    : {};
  const todo = rows.filter((r) => !checkpoint[r.name]);
  const batches: Row[][] = [];
  for (let i = 0; i < todo.length; i += 5) batches.push(todo.slice(i, i + 5));
  console.log(`Jev: ${rows.length - todo.length} cached, ${batches.length} requests`);

  let done = 0;
  const queue = [...batches];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let batch = queue.shift(); batch; batch = queue.shift()) {
        const results = await classifyBatchWithJev(
          batch.map((r) => r.name),
          { aliasesFor: (tag) => byName.get(tag)?.aliases ?? [] }
        );
        for (const r of results) checkpoint[r.tag] = r;
        if (++done % 50 === 0 || done === batches.length) {
          fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint));
          console.log(`  ${done}/${batches.length}`);
        }
      }
    })
  );
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint));

  const approvals: { name: string; slot: string; confidence: number; post_count: number }[] = [];
  let blockedByWiki = 0;
  let wikiAgree = 0;
  let unsure = 0;
  let none = 0;
  for (const r of rows) {
    const ruled = ruleSlotFor(r.name);
    if (ruled) {
      approvals.push({ name: r.name, slot: ruled, confidence: 1, post_count: r.post_count ?? 0 });
      continue;
    }
    const res = checkpoint[r.name];
    if (res.status !== 'approved') {
      if (res.proposed_category) unsure++;
      else none++;
      continue;
    }
    const wiki = wikiProposal.get(r.name);
    if (wiki && wiki !== res.slot) {
      blockedByWiki++;
      continue;
    }
    if (wiki) wikiAgree++;
    approvals.push({ name: r.name, slot: res.slot, confidence: res.confidence, post_count: r.post_count ?? 0 });
  }

  // Already-approved tags whose slot the rule fixes differently.
  const ruledApproved = (
    await fetchAll<Row>(
      'auto_suggest_tags',
      'name, category_name, subcategory, status, confidence, proposed_category, proposed_subcategory, post_count, aliases',
      (q) => q.eq('category', 0).eq('status', 'approved').like('name', '%(cosplay)')
    )
  ).filter((r) => !handSet.has(r.name) && ruleSlotFor(r.name) && ruleSlotFor(r.name) !== `${r.category_name}:${r.subcategory}`);
  for (const r of ruledApproved) {
    byName.set(r.name, r);
    approvals.push({ name: r.name, slot: ruleSlotFor(r.name)!, confidence: 1, post_count: r.post_count ?? 0 });
  }
  console.log(`Rule fixes for already-approved tags: ${ruledApproved.length}`);

  const bySlot = new Map<string, number>();
  for (const a of approvals) bySlot.set(a.slot, (bySlot.get(a.slot) ?? 0) + 1);
  const postsTotal = rows.reduce((s, r) => s + (r.post_count ?? 0), 0);
  const postsApproved = approvals.reduce((s, a) => s + a.post_count, 0);
  console.log(`\nApprove: ${approvals.length} of ${rows.length} (${((approvals.length / rows.length) * 100).toFixed(1)}%),`
    + ` ${((postsApproved / postsTotal) * 100).toFixed(1)}% of their post volume`);
  console.log(`  of which agree with a wiki proposal: ${wikiAgree}; held back for contradicting one: ${blockedByWiki}`);
  console.log(`Stay in review: ${unsure} below threshold, ${none} answered none`);
  console.log(`By slot: ${[...bySlot].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}=${n}`).join(' ')}`);
  const top = [...approvals].sort((a, b) => b.post_count - a.post_count).slice(0, 30);
  console.log(`Most used: ${top.map((a) => `${a.name}->${a.slot}`).join(', ')}`);
  fs.writeFileSync(PLAN_FILE, JSON.stringify(approvals, null, 1));
  console.log(`Plan written to ${PLAN_FILE}`);

  if (!APPLY) {
    console.log('Dry run: nothing written. Re-run with --apply.');
    return;
  }

  fs.mkdirSync('backups', { recursive: true });
  const backup = path.join('backups', `auto_suggest_tags-pre-reclassify-v5-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(backup, JSON.stringify(approvals.map((a) => byName.get(a.name)), null, 1));
  console.log(`Backed up ${approvals.length} rows to ${backup}`);

  let written = 0;
  const failures: string[] = [];
  const writes = [...approvals];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let a = writes.shift(); a; a = writes.shift()) {
        const [category_name, subcategory] = a.slot.split(':');
        const { error } = await supabase
          .from('auto_suggest_tags')
          .update({ category_name, subcategory, status: 'approved', confidence: a.confidence })
          .eq('name', a.name);
        if (error) failures.push(`${a.name}: ${error.message}`);
        else written++;
      }
    })
  );
  console.log(`Wrote ${written}/${approvals.length}${failures.length ? `; failures:\n${failures.join('\n')}` : ''}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
