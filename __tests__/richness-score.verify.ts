/**
 * Verification script for the richness score (Palanca 7, lib/tag-classifier.ts
 * computeRichnessScore), docs/prompt-genericness-mitigation-plan.md §7.8.
 *
 * v2 (depth-weighted): each of clothing/pose/scenery/appearance scores by DEPTH,
 * not just presence — 0 tags = 0pts, 1-2 tags ("shallow") = 1pt, 3+ tags ("deep")
 * = 2.5pts, summed across the 4 categories for a composite 0-10 score. This
 * replaced the earlier v1 binary coverage count (0-4, "is this category
 * non-empty?") because a category with a single shallow tag scored identically
 * to one with 8 detailed tags under v1 — see the "richness-score-v2" follow-up
 * in §7.8 for the empirical case (33.8% of a real 80-post sample had a v1 score
 * of >=3/4 while at least one of those categories had only 1 tag).
 *
 * Assertions mirror the original empirical findings from the field-tested
 * experiment (scripts/richness-score-experiment.js): category coverage/depth
 * (how detailed clothing/pose/scenery/appearance actually are) is a more
 * reliable "is this prompt rich?" signal than a raw tag count — a post can have
 * many total tags (mostly artist/character/meta) and still score low on what
 * actually describes the image.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/richness-score.verify.ts
 */
import { classifyTags, computeRichnessScore, type ClassifiedTags } from '../lib/tag-classifier'

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

function empty(): ClassifiedTags {
  return { clothing: [], pose: [], scenery: [], appearance: [], other: [] }
}

// ── maxScore is always 10 (4 categories x 2.5pts "deep" each; "other" excluded) ──
assert(computeRichnessScore(empty()).maxScore === 10, 'maxScore is 10')

// ── Empty classification -> score 0, all breakdown depths "none" ──
{
  const r = computeRichnessScore(empty())
  assert(r.score === 0, 'empty classification -> score 0')
  assert(r.breakdown.clothing === 'none', 'empty -> clothing none')
  assert(r.breakdown.pose === 'none', 'empty -> pose none')
  assert(r.breakdown.scenery === 'none', 'empty -> scenery none')
  assert(r.breakdown.appearance === 'none', 'empty -> appearance none')
}

// ── All 4 categories "deep" (3+ tags) -> max score 10 regardless of "other" ──
{
  const classified: ClassifiedTags = {
    clothing: ['school uniform', 'pleated skirt', 'necktie'],
    pose: ['standing', 'looking at viewer', 'arm up'],
    scenery: ['indoors', 'window', 'night'],
    appearance: ['blue hair', 'blue eyes', 'blush'],
    other: ['artist_name_here', 'copyright_a', 'copyright_b'],
  }
  const r = computeRichnessScore(classified)
  assert(r.score === 10, 'all 4 categories deep -> score 10 (max)')
  assert(
    r.breakdown.clothing === 'deep' && r.breakdown.pose === 'deep' &&
    r.breakdown.scenery === 'deep' && r.breakdown.appearance === 'deep',
    'all breakdown flags deep'
  )
}

// ── A single shallow tag (1-2) scores less than a deep category (3+), even
//    though both are "present" — this is exactly the v1 blind spot v2 fixes ──
{
  const shallow: ClassifiedTags = {
    clothing: [],
    pose: [],
    scenery: ['outdoors'],
    appearance: [],
    other: [],
  }
  const deep: ClassifiedTags = {
    clothing: [],
    pose: [],
    scenery: ['outdoors', 'forest', 'daytime'],
    appearance: [],
    other: [],
  }
  const rShallow = computeRichnessScore(shallow)
  const rDeep = computeRichnessScore(deep)
  assert(rShallow.breakdown.scenery === 'shallow', '1 tag -> scenery shallow')
  assert(rDeep.breakdown.scenery === 'deep', '3 tags -> scenery deep')
  assert(rShallow.score < rDeep.score, 'shallow category scores less than deep category')
  assert(rShallow.score === 1, '1 shallow category alone -> score 1')
  assert(rDeep.score === 2.5, '1 deep category alone -> score 2.5')
}

// ── "other" is excluded from the score, even if huge ──
{
  const classified: ClassifiedTags = {
    clothing: [],
    pose: [],
    scenery: [],
    appearance: [],
    other: Array.from({ length: 42 }, (_, i) => `artist_tag_${i}`),
  }
  const r = computeRichnessScore(classified)
  assert(r.score === 0, '42 "other" tags alone -> score still 0')
}

// ── Real-world regression case from the field experiment (post 11788186):
//    44 total tags, but only 2 in "appearance" and the rest ("other") were
//    artist/character/meta-heavy. This is exactly the "looks rich by count,
//    isn't by coverage/depth" case the palanca targets. ──
{
  const classified: ClassifiedTags = {
    clothing: [],
    pose: [],
    scenery: [],
    appearance: ['1girl', 'blue eyes'],
    other: Array.from({ length: 42 }, (_, i) => `meta_tag_${i}`),
  }
  const r = computeRichnessScore(classified)
  assert(r.breakdown.appearance === 'shallow', 'post-11788186-like case -> appearance shallow (2 tags)')
  assert(r.score === 1, 'post-11788186-like case -> score 1 (appearance shallow only)')
}

// ── Real-world "high richness" case from the field experiment (post 11782161):
//    clothing:6, pose:4, scenery:3, appearance:8 -> all 4 categories deep ──
{
  const classified: ClassifiedTags = {
    clothing: ['a', 'b', 'c', 'd', 'e', 'f'],
    pose: ['standing', 'looking at viewer', 'arm up', 'smile'],
    scenery: ['indoors', 'window', 'night'],
    appearance: ['blue hair', 'blue eyes', 'blush', 'long hair', 'bangs', 'twintails', 'ahoge', 'smile'],
    other: [],
  }
  const r = computeRichnessScore(classified)
  assert(r.score === 10, 'post-11782161-like case -> score 10 (all 4 deep)')
}

// ── End-to-end via classifyTags: a real, minimal tag list should classify
//    into the expected categories and produce the expected richness. ──
{
  const tags = ['1girl', 'blue hair', 'school uniform', 'standing', 'looking at viewer', 'indoors', 'classroom']
  const classified = classifyTags(tags)
  const r = computeRichnessScore(classified)
  assert(classified.clothing.includes('school uniform'), 'classifyTags: "school uniform" -> clothing')
  assert(classified.pose.some(t => t.includes('standing') || t.includes('looking')), 'classifyTags: pose tags detected')
  assert(classified.scenery.includes('indoors'), 'classifyTags: "indoors" -> scenery')
  assert(r.score > 0, 'end-to-end minimal rich prompt -> score > 0')
}

// ── End-to-end: a pose/scenery-poor tag list (only appearance/character-ish
//    tags) should score low, matching the "genericness" symptom in §2 of the plan. ──
{
  const tags = ['1girl', 'blue hair', 'blue eyes', 'long hair']
  const classified = classifyTags(tags)
  const r = computeRichnessScore(classified)
  assert(r.score <= 2.5, 'appearance-only tag list -> score <= 2.5 (at most 1 deep category)')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
