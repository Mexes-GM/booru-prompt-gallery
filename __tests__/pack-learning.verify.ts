/**
 * Tests for the Pack Mode local learning core (lib/pack/pack-learning.ts).
 *
 * Covers:
 *   1. applyFeedback accumulates picks/shows correctly per event kind.
 *   2. Decay reduces counters monotonically with elapsed time.
 *   3. Shrinkage returns the parent's estimate when a context has shows=0,
 *      and moves toward its own data as observations grow.
 *   4. buildSamplingWeights never returns 0 for any pool value (EPSILON
 *      floor), and sums to 1.
 *   5. High temperature converges weights toward uniform; low temperature
 *      sharpens them.
 *   6. pruneModel respects both budgets and discards lowest-shows first.
 *   7. Determinism: fixed `now`, same input, same output.
 *   8. Model isolation: applyFeedback never mutates its input.
 *   9. createEmptyModel is a safe, stable fallback shape.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-learning.verify.ts
 */
import {
  createEmptyModel,
  applyFeedback,
  contextKeysFor,
  buildSamplingWeights,
  pruneModel,
  GLOBAL_CONTEXT_KEY,
  HALF_LIFE_MS,
  ADD_BONUS,
  REMOVE_PENALTY,
  type PackLearningModel,
} from "../lib/pack/pack-learning"
import type { TagCategory } from "../lib/tag-classifier"

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

const NOW = 1_700_000_000_000 // fixed epoch ms for determinism

// ── 1) applyFeedback accumulates picks/shows per event kind ──
{
  let model = createEmptyModel()
  model = applyFeedback(
    model,
    { kind: "prompts_shown", contextKey: "danbooru", values: [{ category: "scenery", value: "beach" }] },
    NOW
  )
  let stat = model.contexts["danbooru"]["scenery:beach"]
  assert(stat.shows === 1 && stat.picks === 0, `prompts_shown: shows=1, picks=0 (got shows=${stat.shows}, picks=${stat.picks})`)

  model = applyFeedback(
    model,
    { kind: "prompt_copied", contextKey: "danbooru", values: [{ category: "scenery", value: "beach" }] },
    NOW
  )
  stat = model.contexts["danbooru"]["scenery:beach"]
  assert(stat.picks === 1 && stat.shows === 1, `prompt_copied: picks=1, shows unchanged at 1 (got picks=${stat.picks}, shows=${stat.shows})`)

  model = applyFeedback(
    model,
    { kind: "value_removed", contextKey: "danbooru", values: [{ category: "scenery", value: "beach" }] },
    NOW
  )
  stat = model.contexts["danbooru"]["scenery:beach"]
  assert(
    stat.shows === 1 + REMOVE_PENALTY && stat.picks === 1,
    `value_removed: shows += REMOVE_PENALTY, picks unchanged (got shows=${stat.shows}, picks=${stat.picks})`
  )

  model = applyFeedback(
    model,
    { kind: "value_added", contextKey: "danbooru", values: [{ category: "clothing", value: "swimsuit" }] },
    NOW
  )
  const added = model.contexts["danbooru"]["clothing:swimsuit"]
  assert(
    added.picks === ADD_BONUS && added.shows === ADD_BONUS,
    `value_added: both picks and shows get ADD_BONUS (got picks=${added.picks}, shows=${added.shows})`
  )
}

// ── 2) Decay reduces counters monotonically with elapsed time ──
{
  let model = createEmptyModel()
  model = applyFeedback(
    model,
    { kind: "prompts_shown", contextKey: "danbooru", values: [{ category: "pose", value: "standing" }] },
    NOW
  )
  const keys = contextKeysFor("danbooru", [])
  const w0 = buildSamplingWeights(model, keys, "pose", [{ value: "standing", count: 1 }], {}, NOW)
  const wHalfLife = buildSamplingWeights(model, keys, "pose", [{ value: "standing", count: 1 }], {}, NOW + HALF_LIFE_MS)
  const wFarFuture = buildSamplingWeights(
    model,
    keys,
    "pose",
    [{ value: "standing", count: 1 }],
    {},
    NOW + HALF_LIFE_MS * 20
  )
  // A single-value pool always normalizes to [1] regardless of score, so
  // decay is verified via the internal p_hat proxy: rebuild with a second,
  // never-touched competing value and check the touched one's share shrinks
  // toward the untouched one's as time passes (decay pulls p_hat back to the
  // neutral prior, shrinking its relative weight).
  const wNow = buildSamplingWeights(
    model,
    keys,
    "pose",
    [{ value: "standing", count: 1 }, { value: "sitting", count: 1 }],
    {},
    NOW
  )
  const wLater = buildSamplingWeights(
    model,
    keys,
    "pose",
    [{ value: "standing", count: 1 }, { value: "sitting", count: 1 }],
    {},
    NOW + HALF_LIFE_MS * 3
  )
  assert(
    Math.abs(wNow[0] - 0.5) > Math.abs(wLater[0] - 0.5),
    `decay: 'standing's weight moves back toward the uniform 0.5 baseline as it decays (now=${wNow[0].toFixed(4)}, later=${wLater[0].toFixed(4)})`
  )
  assert(w0.length === 1 && wHalfLife.length === 1 && wFarFuture.length === 1, "decay: single-value pool still returns one weight at every time point")
}

// ── 3) Shrinkage: sparse context inherits the parent; rich context leans on itself ──
{
  let model = createEmptyModel()
  // Build up strong global evidence that "beach" tends to get copied.
  for (let i = 0; i < 50; i++) {
    model = applyFeedback(model, { kind: "prompts_shown", contextKey: GLOBAL_CONTEXT_KEY, values: [{ category: "scenery", value: "beach" }] }, NOW)
    model = applyFeedback(model, { kind: "prompt_copied", contextKey: GLOBAL_CONTEXT_KEY, values: [{ category: "scenery", value: "beach" }] }, NOW)
  }
  const sparseKeys = contextKeysFor("danbooru", ["mona (genshin impact)"])
  // A character-specific context with ZERO of its own data should score
  // "beach" close to the strong global signal (inherits from parent), NOT
  // the neutral 0.5 prior.
  const [sparseWeight] = buildSamplingWeights(model, sparseKeys, "scenery", [{ value: "beach", count: 1 }], {}, NOW)
  const [neutralWeight] = buildSamplingWeights(
    createEmptyModel(),
    sparseKeys,
    "scenery",
    [{ value: "beach", count: 1 }],
    {},
    NOW
  )
  // Single-value pools always normalize to weight 1 regardless of score, so
  // compare against a competing untouched value instead to see the shrunk
  // p_hat's effect on relative weight.
  const [sparseBeach, sparseForest] = buildSamplingWeights(
    model,
    sparseKeys,
    "scenery",
    [{ value: "beach", count: 1 }, { value: "forest", count: 1 }],
    {},
    NOW
  )
  const [neutralBeach, neutralForest] = buildSamplingWeights(
    createEmptyModel(),
    sparseKeys,
    "scenery",
    [{ value: "beach", count: 1 }, { value: "forest", count: 1 }],
    {},
    NOW
  )
  assert(
    sparseBeach > neutralBeach,
    `shrinkage: a context with no own data still inherits the strong global signal for 'beach' (sparse=${sparseBeach.toFixed(4)}, neutral=${neutralBeach.toFixed(4)})`
  )
  assert(sparseWeight === 1 && neutralWeight === 1, "shrinkage: single-value pool sanity check normalizes to 1 in both cases")
  assert(sparseForest < sparseBeach, "shrinkage: the untouched competing value stays lower than the learned one")
  assert(neutralForest === neutralBeach, "shrinkage: with no learning data at all, both values score equally")
}

// ── 4) EPSILON floor: no pool value ever reaches weight 0; weights sum to 1 ──
{
  let model = createEmptyModel()
  // Hammer "common" with strong positive signal and "rare" with strong
  // negative (removed) signal, many times, to try to drive rare's weight to 0.
  for (let i = 0; i < 100; i++) {
    model = applyFeedback(model, { kind: "prompts_shown", contextKey: GLOBAL_CONTEXT_KEY, values: [{ category: "scenery", value: "common" }, { category: "scenery", value: "rare" }] }, NOW)
    model = applyFeedback(model, { kind: "prompt_copied", contextKey: GLOBAL_CONTEXT_KEY, values: [{ category: "scenery", value: "common" }] }, NOW)
    model = applyFeedback(model, { kind: "value_removed", contextKey: GLOBAL_CONTEXT_KEY, values: [{ category: "scenery", value: "rare" }] }, NOW)
  }
  const weights = buildSamplingWeights(
    model,
    [GLOBAL_CONTEXT_KEY],
    "scenery",
    [{ value: "common", count: 100 }, { value: "rare", count: 1 }],
    {},
    NOW
  )
  const sum = weights.reduce((a, b) => a + b, 0)
  assert(weights.every((w) => w > 0), `EPSILON floor: every weight is strictly positive (got [${weights.map((w) => w.toFixed(4)).join(", ")}])`)
  assert(Math.abs(sum - 1) < 1e-9, `weights sum to 1 (got ${sum})`)
  assert(weights[0] > weights[1], `'common' still outweighs heavily-penalized 'rare' (common=${weights[0].toFixed(4)}, rare=${weights[1].toFixed(4)})`)
}

// ── 5) Temperature: high flattens toward uniform, low sharpens ──
{
  let model = createEmptyModel()
  for (let i = 0; i < 30; i++) {
    model = applyFeedback(model, { kind: "prompts_shown", contextKey: GLOBAL_CONTEXT_KEY, values: [{ category: "scenery", value: "hot" }, { category: "scenery", value: "cold" }] }, NOW)
    model = applyFeedback(model, { kind: "prompt_copied", contextKey: GLOBAL_CONTEXT_KEY, values: [{ category: "scenery", value: "hot" }] }, NOW)
  }
  const values = [{ value: "hot", count: 10 }, { value: "cold", count: 10 }]
  const sharp = buildSamplingWeights(model, [GLOBAL_CONTEXT_KEY], "scenery", values, { temperature: 1 }, NOW)
  const flat = buildSamplingWeights(model, [GLOBAL_CONTEXT_KEY], "scenery", values, { temperature: 20 }, NOW)
  assert(sharp[0] > flat[0], `temperature: T=1 keeps a sharper skew than T=20 (sharp=${sharp[0].toFixed(4)}, flat=${flat[0].toFixed(4)})`)
  assert(Math.abs(flat[0] - flat[1]) < Math.abs(sharp[0] - sharp[1]), "temperature: high T narrows the gap between values")
}

// ── 6) pruneModel: respects maxEntriesPerContext, drops lowest-shows first ──
{
  let model = createEmptyModel()
  for (let i = 0; i < 10; i++) {
    model = applyFeedback(
      model,
      { kind: "prompts_shown", contextKey: GLOBAL_CONTEXT_KEY, values: [{ category: "pose", value: `pose${i}` }] },
      NOW
    )
    // Give pose0 far more shows than the rest so it's unambiguously the one
    // that must survive a tight prune.
    if (i === 0) {
      for (let j = 0; j < 20; j++) {
        model = applyFeedback(model, { kind: "prompts_shown", contextKey: GLOBAL_CONTEXT_KEY, values: [{ category: "pose", value: "pose0" }] }, NOW)
      }
    }
  }
  const pruned = pruneModel(model, { maxEntriesPerContext: 3 }, NOW)
  const remaining = Object.keys(pruned.contexts[GLOBAL_CONTEXT_KEY])
  assert(remaining.length === 3, `pruneModel: caps entries at maxEntriesPerContext (got ${remaining.length})`)
  assert(remaining.includes("pose:pose0"), "pruneModel: keeps the highest-shows entry (pose0)")
}
{
  // maxContexts: GLOBAL_CONTEXT_KEY always survives even if it would
  // otherwise be the smallest (every other context's shrinkage depends on it).
  let model = createEmptyModel()
  model = applyFeedback(model, { kind: "prompts_shown", contextKey: GLOBAL_CONTEXT_KEY, values: [{ category: "pose", value: "x" }] }, NOW)
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 10; j++) {
      model = applyFeedback(model, { kind: "prompts_shown", contextKey: `ctx${i}`, values: [{ category: "pose", value: "y" }] }, NOW)
    }
  }
  const pruned = pruneModel(model, { maxContexts: 3 }, NOW)
  const contextNames = Object.keys(pruned.contexts)
  assert(contextNames.length === 3, `pruneModel: caps total contexts at maxContexts (got ${contextNames.length})`)
  assert(contextNames.includes(GLOBAL_CONTEXT_KEY), "pruneModel: GLOBAL_CONTEXT_KEY is never dropped even when it's the smallest")
}
{
  // maxBytes: a tight byte budget trims entries GLOBALLY across contexts,
  // even when maxEntriesPerContext/maxContexts are both satisfied already —
  // this is the pass that protects against a count-only cap letting the
  // serialized model exceed localStorage's shared domain quota.
  let model = createEmptyModel()
  // Two contexts, 5 entries each — well under default count caps, but with
  // a tiny maxBytes this must still shrink.
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < 5; i++) {
      // Give ctx0's entries progressively more shows so ranking is unambiguous.
      const shows = c === 0 ? 100 + i : 1
      for (let s = 0; s < shows; s++) {
        model = applyFeedback(model, { kind: "prompts_shown", contextKey: `ctx${c}`, values: [{ category: "pose", value: `pose${i}` }] }, NOW)
      }
    }
  }
  const fullSize = JSON.stringify(model).length
  const tightBudget = Math.floor(fullSize / 3)
  const pruned = pruneModel(model, { maxBytes: tightBudget }, NOW)
  const prunedSize = JSON.stringify(pruned).length
  assert(prunedSize <= tightBudget, `pruneModel: byte budget is respected (got ${prunedSize}, budget ${tightBudget}, full was ${fullSize})`)
  // ctx0's highest-shows entry (pose4, 104 shows) should survive over ctx1's
  // low-shows entries — global ranking, not per-context.
  assert(
    pruned.contexts["ctx0"]?.["pose:pose4"] !== undefined,
    "pruneModel: byte budget keeps the globally highest-shows entry (ctx0's pose4)"
  )
  // Default maxBytes (no override) never trims a model this small.
  const defaultPruned = pruneModel(model, {}, NOW)
  assert(
    JSON.stringify(defaultPruned).length === fullSize,
    "pruneModel: default maxBytes does not trim a small, well-under-budget model"
  )
}

// ── 7) Determinism: fixed `now`, same input, same output ──
{
  let modelA = createEmptyModel()
  let modelB = createEmptyModel()
  const events: Array<{ kind: "prompts_shown" | "prompt_copied"; contextKey: string; values: Array<{ category: TagCategory; value: string }> }> = [
    { kind: "prompts_shown", contextKey: "danbooru", values: [{ category: "pose", value: "standing" }, { category: "scenery", value: "beach" }] },
    { kind: "prompt_copied", contextKey: "danbooru", values: [{ category: "pose", value: "standing" }] },
  ]
  for (const e of events) {
    modelA = applyFeedback(modelA, e, NOW)
    modelB = applyFeedback(modelB, e, NOW)
  }
  assert(JSON.stringify(modelA) === JSON.stringify(modelB), "determinism: identical event sequences at the same `now` produce identical models")

  const weightsA = buildSamplingWeights(modelA, contextKeysFor("danbooru", []), "pose", [{ value: "standing", count: 5 }, { value: "sitting", count: 3 }], {}, NOW)
  const weightsB = buildSamplingWeights(modelB, contextKeysFor("danbooru", []), "pose", [{ value: "standing", count: 5 }, { value: "sitting", count: 3 }], {}, NOW)
  assert(JSON.stringify(weightsA) === JSON.stringify(weightsB), "determinism: identical models produce identical weights")
}

// ── 8) applyFeedback never mutates its input model ──
{
  const before = createEmptyModel()
  const beforeJson = JSON.stringify(before)
  applyFeedback(before, { kind: "prompts_shown", contextKey: "danbooru", values: [{ category: "pose", value: "standing" }] }, NOW)
  assert(JSON.stringify(before) === beforeJson, "applyFeedback: does not mutate the input model")
}

// ── 8b) applyFeedback with an array contextKey applies the SAME event to
//        every listed context bucket independently ──
{
  let model = createEmptyModel()
  const hierarchy = contextKeysFor("danbooru", ["mona (genshin impact)"])
  model = applyFeedback(
    model,
    { kind: "prompts_shown", contextKey: hierarchy, values: [{ category: "scenery", value: "beach" }] },
    NOW
  )
  for (const key of hierarchy) {
    const stat = model.contexts[key]?.["scenery:beach"]
    assert(stat?.shows === 1 && stat?.picks === 0, `applyFeedback (array contextKey): '${key}' bucket got shows=1 (got ${JSON.stringify(stat)})`)
  }
  assert(
    hierarchy.includes("danbooru:mona (genshin impact)") &&
    hierarchy.includes("danbooru") &&
    hierarchy.includes(GLOBAL_CONTEXT_KEY),
    "applyFeedback (array contextKey): hierarchy covers character, provider, and global levels"
  )
  // A single-string contextKey (the pre-existing call shape) still only
  // touches that one bucket — no behavior change for existing callers.
  let single = createEmptyModel()
  single = applyFeedback(single, { kind: "prompts_shown", contextKey: "danbooru", values: [{ category: "scenery", value: "beach" }] }, NOW)
  assert(
    single.contexts[GLOBAL_CONTEXT_KEY] === undefined,
    "applyFeedback: a single-string contextKey does NOT fan out to other levels"
  )
}

// ── 9) createEmptyModel: stable, safe shape ──
{
  const model = createEmptyModel()
  assert(model.version === 1, "createEmptyModel: version is 1")
  assert(Object.keys(model.contexts).length === 0, "createEmptyModel: contexts starts empty")
  const weights = buildSamplingWeights(model, contextKeysFor("danbooru", []), "pose", [{ value: "standing", count: 1 }, { value: "sitting", count: 1 }], {}, NOW)
  assert(weights.length === 2 && Math.abs(weights[0] - weights[1]) < 1e-9, "createEmptyModel: an empty model scores all values equally")
}

// ── 10) contextKeysFor: shape and ordering ──
{
  const keys = contextKeysFor("danbooru", ["mona (genshin impact)", "klee (genshin impact)"])
  assert(
    JSON.stringify(keys) === JSON.stringify(["danbooru:mona (genshin impact)", "danbooru:klee (genshin impact)", "danbooru", GLOBAL_CONTEXT_KEY]),
    `contextKeysFor: character keys, then provider, then global, in order (got ${JSON.stringify(keys)})`
  )
  const noChar = contextKeysFor("gelbooru", [])
  assert(JSON.stringify(noChar) === JSON.stringify(["gelbooru", GLOBAL_CONTEXT_KEY]), "contextKeysFor: with no character tags, just provider then global")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
