/**
 * Regression tests for prompt-aware "Detailed Random" background selection
 * (lib/background-context.ts + lib/background-locations.ts).
 *
 * The behaviour being pinned, in the order the selector applies it:
 *   1. A post's own scenery WINS. Detailed Random upgrades an existing location
 *      instead of replacing it with an unrelated one.
 *   2. With no usable location hint, a depicted sexual act never lands in a
 *      populated/exposed location — the "sex scene in a flower field" mismatch.
 *   3. Neither rule can ever empty the candidate pool. An empty pool means no
 *      background is injected at all, which is how this mode silently degraded
 *      into "Remove All" twice before.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/background-context.verify.ts
 */
import {
  deriveBackgroundContext,
  normalizeRating,
  selectDetailedPreset,
  type BackgroundContext,
} from "../lib/background-context"
import { LOCATION_EXPOSURE, exposureOf, locationIdOf } from "../lib/background-locations"
import { seededRandom } from "../lib/color-theory"
import rawPresets from "../public/detailed-backgrounds.json"

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

const dataset: string[][] = (rawPresets as { scenery?: string[] }[]).map((p) =>
  Array.isArray(p.scenery) ? p.scenery : [],
)

function ctx(
  explicitness: BackgroundContext["explicitness"],
  locationHints: string[] = [],
): BackgroundContext {
  return { explicitness, locationHints }
}

// ── 1) Explicitness derivation ──
{
  assert(
    deriveBackgroundContext({ tags: ["1girl", "hetero", "vaginal", "nude"] }).explicitness === "act",
    "explicitness: act tags win",
  )
  assert(
    deriveBackgroundContext({ tags: ["1girl", "nude", "nipples"] }).explicitness === "nudity",
    "explicitness: nudity without an act stays nudity",
  )
  assert(
    deriveBackgroundContext({ tags: ["1girl", "school uniform", "smile"] }).explicitness === "none",
    "explicitness: clean tags are none",
  )
  // Underscored tags reach this from post.tag_string.
  assert(
    deriveBackgroundContext({ tags: ["cowgirl_position"] }).explicitness === "act",
    "explicitness: underscored tags are normalized",
  )

  // PRECISION: generic words that appear on plenty of non-sexual art must not
  // drag an innocent post into indoor-only backgrounds.
  const innocuous = ["licking", "riding", "grinding", "straddling", "kissing", "sweat", "steam", "yuri"]
  for (const tag of innocuous) {
    assert(
      deriveBackgroundContext({ tags: ["1girl", tag] }).explicitness !== "act",
      `precision: '${tag}' alone must not be read as a sexual act`,
    )
  }
}

// ── 2) Rating: raises to nudity, never lowers ──
{
  assert(normalizeRating("g") === "general", "rating: danbooru 'g'")
  assert(normalizeRating("s") === "sensitive", "rating: 's' (safe/sensitive)")
  assert(normalizeRating("q") === "questionable", "rating: 'q'")
  assert(normalizeRating("e") === "explicit", "rating: 'e'")
  assert(normalizeRating("explicit") === "explicit", "rating: gelbooru long form")
  assert(normalizeRating("Questionable") === "questionable", "rating: case-insensitive")
  assert(normalizeRating(undefined) === "unknown", "rating: missing is unknown")

  assert(
    deriveBackgroundContext({ tags: ["1girl"], rating: "e" }).explicitness === "nudity",
    "rating: explicit raises a tagless post to nudity",
  )
  assert(
    deriveBackgroundContext({ tags: ["1girl", "sex"], rating: "g" }).explicitness === "act",
    "rating: a general rating cannot lower an act signal",
  )
  assert(
    deriveBackgroundContext({ tags: ["1girl"], rating: "g" }).explicitness === "none",
    "rating: general leaves a clean post alone",
  )
}

// ── 3) Location hints ──
{
  assert(
    deriveBackgroundContext({ tags: ["1girl", "classroom", "blackboard"] }).locationHints.join() ===
      "indoors/classroom",
    "hints: classroom tags resolve to the classroom location",
  )
  assert(
    deriveBackgroundContext({ tags: ["1girl", "solo", "smile"] }).locationHints.length === 0,
    "hints: a post with no scenery gives no hint",
  )

  // Ambiguity: "sand" is a beach or a desert, so it supports both...
  const ambiguous = deriveBackgroundContext({ tags: ["sand"] }).locationHints
  assert(
    ambiguous.length === 2 && ambiguous.includes("outdoors/beach") && ambiguous.includes("outdoors/desert"),
    "hints: an ambiguous tag supports every plausible location",
  )
  // ...but a half-vote must never outrank one unambiguous tag.
  assert(
    deriveBackgroundContext({ tags: ["sand", "beach"] }).locationHints.join() === "outdoors/beach",
    "hints: an unambiguous tag outranks an ambiguous one",
  )
}

// ── 4) Layer 0 — the post's own location wins ──
{
  const pick = (tags: string[], seed: number) =>
    selectDetailedPreset(dataset, deriveBackgroundContext({ tags }), seededRandom(seed))

  for (const seed of [1, 42, 7777, 14806740]) {
    const beachy = pick(["1girl", "beach", "ocean", "swimsuit"], seed)
    assert(locationIdOf(beachy!) === "outdoors/beach", `layer0: a beach post gets a beach preset (seed ${seed})`)

    const schooly = pick(["1girl", "classroom", "school uniform"], seed)
    assert(
      locationIdOf(schooly!) === "indoors/classroom",
      `layer0: a classroom post gets a classroom preset (seed ${seed})`,
    )
  }

  // Layer 0 OUTRANKS the exposure gate: if the image really is at a beach, an
  // explicit scene belongs at that beach, not relocated to a bedroom.
  for (const seed of [3, 99, 12345]) {
    const explicitBeach = pick(["1girl", "1boy", "beach", "sex", "vaginal"], seed)
    assert(
      locationIdOf(explicitBeach!) === "outdoors/beach",
      `layer0: a real location beats the exposure gate (seed ${seed})`,
    )
  }
}

// ── 5) Layer 1 — an act with no location hint never goes public ──
//    This is the original complaint: a sexual scene dropped into a landscape.
{
  const actTags = ["1girl", "1boy", "hetero", "sex", "vaginal", "nude", "cum"]
  const context = deriveBackgroundContext({ tags: actTags })
  assert(context.explicitness === "act", "layer1: the sample scene is detected as an act")
  assert(context.locationHints.length === 0, "layer1: the sample scene carries no location hint")

  const offenders: string[] = []
  for (let seed = 0; seed < 500; seed++) {
    const preset = selectDetailedPreset(dataset, context, seededRandom(seed))
    const id = locationIdOf(preset!)
    if (exposureOf(id) === "public") offenders.push(`${seed}:${id}`)
  }
  assert(
    offenders.length === 0,
    `layer1: 500 seeds never yield a public location (offenders: ${offenders.slice(0, 5).join(", ")})`,
  )

  // Variety must survive the narrowing — the gate must not collapse to one place.
  const distinct = new Set(
    Array.from({ length: 500 }, (_, seed) =>
      locationIdOf(selectDetailedPreset(dataset, context, seededRandom(seed))!),
    ),
  )
  assert(distinct.size >= 8, `layer1: the secluded pool keeps variety (got ${distinct.size} locations)`)

  // A clean post is NOT restricted.
  const cleanCtx = deriveBackgroundContext({ tags: ["1girl", "solo", "smile"] })
  const cleanLocations = new Set(
    Array.from({ length: 300 }, (_, seed) =>
      locationIdOf(selectDetailedPreset(dataset, cleanCtx, seededRandom(seed))!),
    ),
  )
  assert(
    [...cleanLocations].some((id) => exposureOf(id) === "public"),
    "layer1: a non-explicit post can still get a public location",
  )

  // Nudity alone is deliberately NOT gated — it happens outdoors all the time.
  const nudeCtx = deriveBackgroundContext({ tags: ["1girl", "nude", "nipples"] })
  const nudeLocations = new Set(
    Array.from({ length: 300 }, (_, seed) =>
      locationIdOf(selectDetailedPreset(dataset, nudeCtx, seededRandom(seed))!),
    ),
  )
  assert(
    [...nudeLocations].some((id) => exposureOf(id) === "public"),
    "layer1: nudity without an act is not restricted",
  )
}

// ── 6) The pool can never be emptied ──
{
  assert(selectDetailedPreset([], ctx("act"), seededRandom(1)) === null, "fallback: an empty dataset yields null")

  // A hint for a location the dataset doesn't have must fall through, not fail.
  const unknownHint = selectDetailedPreset(dataset, ctx("none", ["outdoors/space elevator"]), seededRandom(5))
  assert(unknownHint !== null && unknownHint.length > 0, "fallback: an unknown location hint still returns a preset")

  // A dataset with ONLY public locations must still serve an act context.
  const publicOnly = dataset.filter((p) => exposureOf(locationIdOf(p)) === "public")
  const forced = selectDetailedPreset(publicOnly, ctx("act"), seededRandom(9))
  assert(
    forced !== null && forced.length > 0,
    "fallback: a public-only dataset still returns a preset for an act context",
  )

  // Exhaustive: no combination returns null on a non-empty dataset.
  const combos: BackgroundContext[] = [
    ctx("none"), ctx("nudity"), ctx("act"),
    ctx("act", ["indoors/bedroom"]), ctx("none", ["outdoors/beach"]), ctx("act", ["nope/nope"]),
  ]
  const nulls = combos.filter((c) => selectDetailedPreset(dataset, c, seededRandom(11)) === null)
  assert(nulls.length === 0, "fallback: no context combination returns null")

  // No context at all = the old uniform behaviour, still valid.
  assert(selectDetailedPreset(dataset, undefined, seededRandom(13)) !== null, "fallback: undefined context works")
}

// ── 7) Determinism — the pure and display pipelines must agree ──
{
  const context = deriveBackgroundContext({ tags: ["1girl", "1boy", "sex"] })
  for (const seed of [1, 500, 14806740]) {
    const a = selectDetailedPreset(dataset, context, seededRandom(seed))
    const b = selectDetailedPreset(dataset, context, seededRandom(seed))
    assert(JSON.stringify(a) === JSON.stringify(b), `determinism: same seed + context => same preset (seed ${seed})`)
  }
}

// ── 8) The exposure table matches the dataset exactly ──
//    Guards against a dataset edit that adds a location nobody classified
//    (silently treated as public, so the gate would leak) or removes one.
{
  const datasetLocations = new Set(dataset.map((p) => locationIdOf(p)).filter((id): id is string => id !== null))
  const tableLocations = new Set(Object.keys(LOCATION_EXPOSURE))

  const unclassified = [...datasetLocations].filter((id) => !tableLocations.has(id))
  assert(unclassified.length === 0, `table: every dataset location is classified (missing: ${unclassified.join(", ")})`)

  const stale = [...tableLocations].filter((id) => !datasetLocations.has(id))
  assert(stale.length === 0, `table: no stale entries for removed locations (stale: ${stale.join(", ")})`)

  assert(
    dataset.every((p) => locationIdOf(p) !== null),
    "table: every preset follows the indoors/outdoors + location convention",
  )

  const privateCount = [...datasetLocations].filter((id) => exposureOf(id) === "private").length
  const seclusiveCount = [...datasetLocations].filter((id) => exposureOf(id) !== "public").length
  console.log(
    `table: ${datasetLocations.size} locations — ${privateCount} private, ` +
      `${seclusiveCount} usable for act scenes`,
  )
}

// ── 9) MatchStrictness — 'free' ignores the context entirely ──
{
  const explicitAct = ctx("act")
  const distinct = new Set(
    Array.from({ length: 300 }, (_, seed) =>
      locationIdOf(selectDetailedPreset(dataset, explicitAct, seededRandom(seed), "free")!),
    ),
  )
  assert(
    [...distinct].some((id) => exposureOf(id) === "public"),
    "strictness=free: an act scene can still land in a public location",
  )

  // 'free' disables the context ENTIRELY, including location hints — it's
  // the "ignore the post, maximum variety" escape hatch, not merely a weaker
  // gate. Location hints only win at 'balanced'/'strict'.
  const beachHint = ctx("act", ["outdoors/beach"])
  const freeLocations = new Set(
    Array.from({ length: 100 }, (_, seed) => locationIdOf(selectDetailedPreset(dataset, beachHint, seededRandom(seed), "free")!)),
  )
  assert(
    freeLocations.size > 1,
    `strictness=free: even a location hint doesn't narrow the pool (got ${freeLocations.size} distinct locations)`,
  )
}

// ── 10) MatchStrictness — 'strict' also gates bare nudity, and narrows to 'private' only ──
{
  const nudityOnly = deriveBackgroundContext({ tags: ["1girl", "nude", "nipples"] })
  assert(nudityOnly.explicitness === "nudity", "strictness=strict setup: sample scene is nudity, not an act")

  // balanced does NOT restrict nudity...
  const balancedLocations = new Set(
    Array.from({ length: 300 }, (_, seed) =>
      locationIdOf(selectDetailedPreset(dataset, nudityOnly, seededRandom(seed), "balanced")!),
    ),
  )
  assert(
    [...balancedLocations].some((id) => exposureOf(id) === "public"),
    "strictness=balanced: nudity alone is NOT restricted",
  )

  // ...but strict does, and only to 'private' (not merely 'semi').
  const strictOffenders: string[] = []
  for (let seed = 0; seed < 500; seed++) {
    const id = locationIdOf(selectDetailedPreset(dataset, nudityOnly, seededRandom(seed), "strict")!)
    if (exposureOf(id) !== "private") strictOffenders.push(`${seed}:${id}`)
  }
  assert(
    strictOffenders.length === 0,
    `strictness=strict: nudity is restricted to 'private' only (offenders: ${strictOffenders.slice(0, 5).join(", ")})`,
  )

  // The same act scene that 'balanced' keeps out of 'public' only, 'strict'
  // keeps out of 'public' AND 'semi'.
  const actCtx = ctx("act")
  const strictActOffenders: string[] = []
  for (let seed = 0; seed < 500; seed++) {
    const id = locationIdOf(selectDetailedPreset(dataset, actCtx, seededRandom(seed), "strict")!)
    if (exposureOf(id) !== "private") strictActOffenders.push(`${seed}:${id}`)
  }
  assert(
    strictActOffenders.length === 0,
    `strictness=strict: an act scene is also restricted to 'private' only (offenders: ${strictActOffenders.slice(0, 5).join(", ")})`,
  )

  // Location hints still win over 'strict' — same precedence as every level.
  const explicitBeachStrict = selectDetailedPreset(dataset, ctx("act", ["outdoors/beach"]), seededRandom(1), "strict")
  assert(
    locationIdOf(explicitBeachStrict!) === "outdoors/beach",
    "strictness=strict: a real location hint still beats the gate",
  )
}

// ── 11) MatchStrictness — omitted defaults to 'balanced' (backward compatible) ──
{
  const actCtx = ctx("act")
  for (const seed of [11, 22, 33]) {
    const withDefault = selectDetailedPreset(dataset, actCtx, seededRandom(seed))
    const explicit = selectDetailedPreset(dataset, actCtx, seededRandom(seed), "balanced")
    assertEqualPresets(withDefault, explicit, `strictness omitted: matches explicit 'balanced' (seed ${seed})`)
  }
}

function assertEqualPresets(a: string[] | null, b: string[] | null, label: string) {
  assert(JSON.stringify(a) === JSON.stringify(b), label)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
