/**
 * Single source of truth for the tag taxonomy.
 *
 * Before this module the five categories were re-declared in 13 files: the
 * `TagCategory` union, the `ClassifiedTags` shape, the whitelist inside
 * `classifyTag`, the richness-score axes, `PACK_AXES`, two zod enums, the
 * admin's correctable list, and six per-component colour/icon/label maps. Adding
 * a category meant editing all of them by hand, and several of those maps were
 * keyed by plain `string`, so a missing entry failed silently at runtime instead
 * of at compile time.
 *
 * Everything derives from `TAG_CATEGORY_IDS` and `TAG_CATEGORIES` here. Adding a
 * category is: append the id to the tuple, add its definition to the record.
 * TypeScript then reports every remaining place that needs a real decision
 * (a colour, an icon, a keyword list) instead of letting it default silently.
 *
 * Deliberately React-free and dependency-free so server actions can import it
 * without pulling a UI bundle in. Icons live in
 * `components/tag-category-icon.ts`, keyed by the `iconName` declared here.
 *
 * NOT derivable from here: the CHECK constraints on `tags.category`,
 * `tag_suggestions.current_category` and `tag_suggestions.suggested_category`
 * (see supabase/migrations/20260827000000_tags_write_hardening.sql). SQL cannot
 * read this file, so widening the taxonomy needs a migration alongside it.
 */

/**
 * Canonical order. Drives the order tags are emitted in a built prompt
 * (`cleanPrompt`) and the order axes are listed in Pack Mode, so it is not
 * arbitrary: appearance first (who the subject is), then what they wear, what
 * they do, where they are, and finally the catch-all.
 */
export const TAG_CATEGORY_IDS = ['appearance', 'clothing', 'pose', 'scenery', 'other'] as const

export type TagCategory = (typeof TAG_CATEGORY_IDS)[number]

/** Accent colour family per category, shared by every surface that renders one. */
export type TagCategoryAccent = 'blue' | 'green' | 'purple' | 'orange' | 'neutral'

/** Icon identity per category; resolved to a component in components/tag-category-icon.ts. */
export type TagCategoryIconName = 'face' | 'shirt' | 'person' | 'mountain' | 'package'

export interface TagCategoryDefinition {
  id: TagCategory
  label: string
  /**
   * Label for surfaces that present the bucket as work to do rather than as a
   * real axis — the Teach modal calls `other` "Unclassified" because there the
   * column means "still needs categorizing". Undefined means use `label`.
   */
  alternateLabel?: string
  description: string
  accent: TagCategoryAccent
  iconName: TagCategoryIconName
  /**
   * Counts toward the richness score. `other` is excluded on purpose: it is a
   * catch-all, not a descriptive axis, so letting it earn points would reward
   * exactly the tags the score is meant to ignore. See the rationale on
   * `computeRichnessScore` — the score is empirically calibrated over these
   * axes, so changing the set invalidates that calibration.
   */
  isRichnessAxis: boolean
  /**
   * Exposed as a variation axis in Pack Mode. Same reasoning: varying `other`
   * would sample noise.
   */
  isPackAxis: boolean
}

export const TAG_CATEGORIES = {
  appearance: {
    id: 'appearance',
    label: 'Appearance',
    description: 'Physical traits like eye color, hair style, skin tone',
    accent: 'blue',
    iconName: 'face',
    isRichnessAxis: true,
    isPackAxis: true,
  },
  clothing: {
    id: 'clothing',
    label: 'Clothing',
    description: 'Attire, accessories, and footwear',
    accent: 'green',
    iconName: 'shirt',
    isRichnessAxis: true,
    isPackAxis: true,
  },
  pose: {
    id: 'pose',
    label: 'Pose',
    description: 'Body position, gestures, and angles',
    accent: 'purple',
    iconName: 'person',
    isRichnessAxis: true,
    isPackAxis: true,
  },
  scenery: {
    id: 'scenery',
    label: 'Scenery',
    description: 'Background, location, and environmental elements',
    accent: 'orange',
    iconName: 'mountain',
    isRichnessAxis: true,
    isPackAxis: true,
  },
  other: {
    id: 'other',
    label: 'Other',
    alternateLabel: 'Unclassified',
    description: 'Tags that need categorization',
    accent: 'neutral',
    iconName: 'package',
    isRichnessAxis: false,
    isPackAxis: false,
  },
  // `as const` keeps isRichnessAxis / isPackAxis as literal true|false so the
  // RichnessAxis and PackAxis unions below can be derived at the TYPE level, not
  // just at runtime. That is what makes the richness breakdown safely indexable
  // and what makes adding a category widen those unions automatically.
} as const satisfies Record<TagCategory, TagCategoryDefinition>

/** Categories that earn richness points, as a literal union derived from the flags. */
export type RichnessAxis = {
  [K in TagCategory]: (typeof TAG_CATEGORIES)[K]['isRichnessAxis'] extends true ? K : never
}[TagCategory]

/** Categories Pack Mode can vary, as a literal union derived from the flags. */
export type PackAxis = {
  [K in TagCategory]: (typeof TAG_CATEGORIES)[K]['isPackAxis'] extends true ? K : never
}[TagCategory]

/** Definitions in canonical order, for rendering lists of categories. */
export const TAG_CATEGORY_LIST: readonly TagCategoryDefinition[] = TAG_CATEGORY_IDS.map(
  (id) => TAG_CATEGORIES[id]
)

/** Axes that earn richness points, in canonical order. */
export const RICHNESS_AXES = TAG_CATEGORY_IDS.filter(
  (id): id is RichnessAxis => TAG_CATEGORIES[id].isRichnessAxis
)

/** Axes Pack Mode can vary, in canonical order. */
export const PACK_AXES = TAG_CATEGORY_IDS.filter(
  (id): id is PackAxis => TAG_CATEGORIES[id].isPackAxis
)

const TAG_CATEGORY_SET: ReadonlySet<string> = new Set(TAG_CATEGORY_IDS)

/**
 * Narrows an untrusted value to a `TagCategory`. This is the gate every value
 * coming from the database goes through: `tags.category` is a plain varchar, so
 * a row could hold anything, and an unrecognized value must fall back to the
 * heuristics rather than be trusted as a bucket name.
 */
export function isTagCategory(value: unknown): value is TagCategory {
  return typeof value === 'string' && TAG_CATEGORY_SET.has(value)
}

/** Tags grouped by category. One array per category, always all keys present. */
export type ClassifiedTags = Record<TagCategory, string[]>

/** Fresh empty bucket set — every key present, so callers can push without checks. */
export function emptyClassifiedTags(): ClassifiedTags {
  return Object.fromEntries(TAG_CATEGORY_IDS.map((id) => [id, [] as string[]])) as ClassifiedTags
}
