/**
 * Prompt-aware selection for the "Detailed Random" background mode.
 *
 * The mode used to pick uniformly at random from all 237 presets, so the
 * background ignored the image entirely: an explicit scene could land in a
 * flower field, and a post already set in a classroom got its classroom thrown
 * away for a random desert. This module derives what the post's own tags say
 * about the scene and narrows the candidate presets accordingly.
 *
 * Two rules, in this precedence order, tunable via `MatchStrictness`:
 *
 *   1. Location hints WIN, at `balanced` and `strict`. Original scenery tags
 *      are ground truth about where the image actually is, so they beat every
 *      heuristic: a post tagged `beach` gets a beach preset even when it's
 *      explicit. This turns the mode from "replace the background" into
 *      "upgrade the background" — the booru's thin `indoors, window` becomes
 *      a 13-tag coherent scene. `free` disables this too — it's the
 *      "ignore the post, maximum variety" escape hatch, not merely a weaker
 *      gate.
 *   2. Only when there's no usable hint does the exposure gate apply: keep
 *      the scene out of exposed locations. `balanced` (default) gates a
 *      depicted act out of `public` locations; `strict` also gates bare
 *      nudity, and narrows further to only `private` locations; `free`
 *      disables the gate and picks uniformly.
 *
 * Selection stays deterministic — same post, same settings, same background —
 * and can never end up with an empty candidate pool (see selectDetailedPreset).
 */
import { exposureOf, locationHintsFrom, locationIdOf, type Exposure, type LocationId } from "./background-locations"

/**
 * How explicit the scene is, in terms of what it implies about the SETTING.
 *
 *  - `none`: nothing sexual.
 *  - `nudity`: nudity or exposure without a depicted act. Deliberately does NOT
 *    gate anything — nudity happens on beaches, in onsen and in open nature, so
 *    restricting it would throw away perfectly plausible backgrounds. Tracked
 *    because the affinity-weighting layer will want the distinction.
 *  - `act`: a sexual act is depicted. This is the only tier that gates.
 */
export type Explicitness = "none" | "nudity" | "act"

/**
 * Tags that imply a depicted sexual act, and therefore a setting where one
 * plausibly happens.
 *
 * Curated for PRECISION over recall: a false positive drags an innocent post
 * into indoor-only backgrounds, which is a worse failure than missing one
 * explicit post. Hence no generically-usable words — `licking`, `riding`,
 * `grinding` and `straddling` all appear on plenty of non-sexual art and are
 * intentionally absent.
 */
export const SEXUAL_ACT_TAGS: ReadonlySet<string> = new Set([
  // Intercourse and positions
  "sex", "sexual intercourse", "vaginal", "anal", "hetero",
  "sex from behind", "standing sex", "suspended congress", "doggystyle",
  "missionary", "cowgirl position", "reverse cowgirl position", "girl on top",
  "mating press", "prone bone", "spitroast", "double penetration",
  "penetration", "imminent penetration", "insertion",
  // Oral and manual
  "oral", "fellatio", "cunnilingus", "irrumatio", "deepthroat",
  "handjob", "footjob", "thighjob", "paizuri",
  "masturbation", "fingering", "nipple sucking", "breast sucking",
  "tribadism", "scissoring",
  // Aftermath
  "cum", "cum inside", "cum in pussy", "cum in mouth", "cum on body",
  "cum on breasts", "cum on face", "creampie", "ejaculation", "facial",
  "after sex", "afterglow",
  // Group
  "threesome", "group sex", "gangbang", "orgy",
])

/**
 * Nudity / exposure without a depicted act. See `Explicitness` for why this
 * tier is tracked but not gated.
 */
export const NUDITY_TAGS: ReadonlySet<string> = new Set([
  "nude", "naked", "completely nude", "nude female", "nude male",
  "topless", "bottomless", "bare breasts", "nipples", "areolae",
  "pussy", "penis", "uncensored", "no panties", "convenient censoring",
])

/**
 * User-facing control over how strictly the location-based gate applies.
 * Location hints (Layer 0) win at `balanced` and `strict` — a real scenery
 * tag is ground truth, not a heuristic, so those two levels never override
 * it. `free` disables location hints too (see below).
 *
 *  - `free`: ignore the post's own context ENTIRELY, hints included, and pick
 *    uniformly. The original behaviour, and the "maximum variety, don't try
 *    to be clever" escape hatch for users who want the occasional jarring
 *    contrast on purpose.
 *  - `balanced` (default): gate ONLY a depicted act (not bare nudity, which
 *    happens outdoors all the time) out of fully `public` locations. `semi`
 *    locations (an empty classroom, a back alley) stay eligible — enough
 *    seclusion for most tastes without narrowing down to just 4 locations.
 *  - `strict`: gate BOTH nudity and acts, and only `private` locations count
 *    as secluded (`semi` no longer does). For anyone who finds even
 *    "balanced" too permissive.
 *
 * All three still obey the never-empty-pool guarantee: if a level's gate
 * would leave nothing, selectDetailedPreset widens back to whatever the
 * dataset actually offers rather than injecting no background.
 */
export type MatchStrictness = "strict" | "balanced" | "free"

/** What a post's own tags and rating say about the scene. */
export interface BackgroundContext {
  explicitness: Explicitness
  /**
   * Dataset locations the post's scenery points at, all tied at the best
   * support score. Empty when the post gives no usable hint.
   */
  locationHints: LocationId[]
}

export type NormalizedRating = "general" | "sensitive" | "questionable" | "explicit" | "unknown"

/**
 * Normalizes the raw per-provider rating string.
 *
 * `post.rating` is whatever the provider returned and the vocabularies differ:
 * Danbooru/aibooru use `g|s|q|e`, e621 has no general tier (`s|q|e`), Gelbooru
 * and rule34 return long forms (`general`/`sensitive`/`questionable`/`explicit`,
 * `safe`). Their first letters are unambiguous across all of them, with `s`
 * meaning safe/sensitive in both worlds, so a first-character match is both
 * simpler and more robust than a per-provider table.
 */
export function normalizeRating(rating: string | undefined): NormalizedRating {
  switch (rating?.trim().toLowerCase().charAt(0)) {
    case "g": return "general"
    case "s": return "sensitive"
    case "q": return "questionable"
    case "e": return "explicit"
    default: return "unknown"
  }
}

function normalizeTagLocal(tag: string): string {
  return tag.replace(/_/g, " ").toLowerCase().trim().replace(/\s{2,}/g, " ")
}

/**
 * Derives the scene context from a post's content tags.
 *
 * `tags` must be the post's OWN tags, not the user's added ones: the context has
 * to be identical for every pipeline that renders the same card, otherwise the
 * "copy prompt" and "copy categories" buttons would pick different backgrounds
 * for the same post. Compute this once per post and pass the result down.
 *
 * `rating` can only RAISE explicitness to `nudity`, never lower it: provider
 * ratings are inconsistent enough (self-assigned on Gelbooru/rule34, no general
 * tier on e621) that trusting them to veto a tag-based signal would introduce
 * more errors than it fixes.
 */
export function deriveBackgroundContext(options: {
  tags: readonly string[]
  rating?: string
}): BackgroundContext {
  const { tags, rating } = options
  const normalized = tags.map(normalizeTagLocal)

  let explicitness: Explicitness = "none"
  if (normalized.some((t) => SEXUAL_ACT_TAGS.has(t))) {
    explicitness = "act"
  } else if (normalized.some((t) => NUDITY_TAGS.has(t))) {
    explicitness = "nudity"
  } else {
    const normalizedRating = normalizeRating(rating)
    if (normalizedRating === "explicit" || normalizedRating === "questionable") {
      explicitness = "nudity"
    }
  }

  return { explicitness, locationHints: locationHintsFrom(normalized) }
}

/**
 * Picks one preset from the dataset, narrowed by the scene context and the
 * user's chosen strictness.
 *
 * Guarantees, in order of importance:
 *   - Never returns null for a non-empty dataset. Every narrowing step falls
 *     back to the wider pool when it would leave nothing, because an empty pool
 *     means the mode silently injects no background at all — the exact failure
 *     that made Detailed Random look like "Remove All" twice before.
 *   - Deterministic: the same dataset, context, strictness and rng produce the
 *     same preset, so independent pipelines rendering the same card agree.
 *   - Consumes `rng` exactly once on every path, so callers can reason about
 *     the draw regardless of which narrowing applied.
 */
export function selectDetailedPreset(
  presets: readonly string[][],
  context: BackgroundContext | undefined,
  rng: () => number,
  strictness: MatchStrictness = "balanced",
): string[] | null {
  if (presets.length === 0) return null

  const pick = (pool: readonly string[][]) => pool[Math.floor(rng() * pool.length)]

  if (!context || strictness === "free") return pick(presets)

  // Layer 0 — the post already tells us where it is. Highest precedence,
  // regardless of strictness: real scenery beats every heuristic, so an
  // explicit beach scene stays at a beach.
  if (context.locationHints.length > 0) {
    const hinted = new Set(context.locationHints)
    const matching = presets.filter((preset) => {
      const id = locationIdOf(preset)
      return id !== null && hinted.has(id)
    })
    if (matching.length > 0) return pick(matching)
  }

  // Layer 1 — no usable hint. Keep the scene out of exposed locations. What
  // triggers the gate and how far it excludes both scale with strictness:
  // `balanced` only gates a depicted act, and only out of `public`; `strict`
  // also gates bare nudity, and only `private` counts as secluded.
  const gates = context.explicitness === "act" || (strictness === "strict" && context.explicitness === "nudity")
  if (gates) {
    const requiredMaxExposure: Exposure = strictness === "strict" ? "private" : "semi"
    const rank: Record<Exposure, number> = { private: 0, semi: 1, public: 2 }
    const secluded = presets.filter(
      (preset) => rank[exposureOf(locationIdOf(preset))] <= rank[requiredMaxExposure],
    )
    if (secluded.length > 0) return pick(secluded)
  }

  return pick(presets)
}
