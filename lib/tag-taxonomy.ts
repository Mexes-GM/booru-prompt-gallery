/**
 * Single source of truth for the tag taxonomy.
 *
 * Before this module the categories were re-declared in 13 files: the
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
 * (see supabase/migrations/20260923000000_expand_tag_taxonomy_and_subcategories.sql).
 * SQL cannot read this file, so widening the taxonomy needs a migration alongside it.
 */

/**
 * Canonical order. Drives the order tags are emitted in a built prompt
 * (`cleanPrompt`) and the order axes are listed in Pack Mode, so it is not
 * arbitrary: appearance first (who the subject is), then what they wear, what
 * they carry/hold, what they do, where they are, creatures around them, and finally the catch-all.
 */
export const TAG_CATEGORY_IDS = [
  'appearance',
  'clothing',
  'equipment',
  'pose',
  'scenery',
  'creature',
  'other',
] as const

export type TagCategory = (typeof TAG_CATEGORY_IDS)[number]

/** Accent colour family per category, shared by every surface that renders one. */
export type TagCategoryAccent = 'blue' | 'green' | 'amber' | 'purple' | 'orange' | 'teal' | 'neutral'

/** Icon identity per category; resolved to a component in components/tag-category-icon.ts. */
export type TagCategoryIconName = 'face' | 'shirt' | 'sword' | 'person' | 'mountain' | 'paw' | 'package'

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
  equipment: {
    id: 'equipment',
    label: 'Equipment',
    description: 'Weapons, handheld props, and character items',
    accent: 'amber',
    iconName: 'sword',
    isRichnessAxis: true,
    isPackAxis: true,
  },
  pose: {
    id: 'pose',
    label: 'Pose',
    description: 'Body position, gestures, actions, and angles',
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
  creature: {
    id: 'creature',
    label: 'Creature',
    description: 'Animals, mythical beasts, and pets',
    accent: 'teal',
    iconName: 'paw',
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
} as const satisfies Record<TagCategory, TagCategoryDefinition>

/**
 * 33 orthogonal slots (subcategories) distributed across the 7 categories.
 */
export const TAG_SUBCATEGORIES = {
  appearance: ['hair', 'eyes', 'anatomy', 'demographics'],
  clothing: ['outfit', 'top', 'bottom', 'underwear', 'headwear', 'eyewear', 'legwear', 'footwear', 'accents'],
  equipment: ['weapon', 'handheld'],
  pose: ['camera', 'posture', 'gesture', 'expression', 'kinetic', 'combat', 'interaction', 'physiological'],
  scenery: ['setting', 'props', 'atmosphere'],
  creature: ['animal'],
  other: ['character', 'copyright', 'artist', 'style', 'layout', 'meta'],
} as const satisfies Record<TagCategory, readonly string[]>

export type TagSubcategory<C extends TagCategory = TagCategory> = (typeof TAG_SUBCATEGORIES)[C][number]

/**
 * User-facing display labels for subcategories where the internal DB slot
 * differs from the optimal UI terminology (e.g. 'demographics' -> 'subject').
 */
export const TAG_SUBCATEGORY_LABELS: Record<string, string> = {
  demographics: 'subject',
}

export function formatSubcategoryLabel(subcategory?: string | null): string {
  if (!subcategory) return ''
  return TAG_SUBCATEGORY_LABELS[subcategory] ?? subcategory
}

export interface SlotConstraint {
  maxCount: number;
  incompatibleWith: string[];
  requiresOneOf?: string[];
}

export interface SlotGroupConstraint {
  maxTotal: number;
  slots: string[];
}

export const SLOT_CONSTRAINTS: Record<string, SlotConstraint> = {
  // === CLOTHING ===
  "clothing:outfit":   { maxCount: 1, incompatibleWith: ["clothing:top", "clothing:bottom"] },
  "clothing:top":      { maxCount: 1, incompatibleWith: ["clothing:outfit"] },
  "clothing:bottom":   { maxCount: 1, incompatibleWith: ["clothing:outfit"] },
  "clothing:underwear":{ maxCount: 1, incompatibleWith: [] },
  "clothing:headwear": { maxCount: 1, incompatibleWith: [] },
  "clothing:eyewear":  { maxCount: 1, incompatibleWith: [] },
  "clothing:legwear":  { maxCount: 1, incompatibleWith: [] },
  "clothing:footwear": { maxCount: 1, incompatibleWith: [] },
  "clothing:accents":  { maxCount: 3, incompatibleWith: [] },

  // === EQUIPMENT ===
  "equipment:weapon":  { maxCount: 2, incompatibleWith: [] },
  "equipment:handheld":{ maxCount: 2, incompatibleWith: [] },

  // === POSE ===
  "pose:camera":        { maxCount: 1, incompatibleWith: [] },
  "pose:posture":       { maxCount: 1, incompatibleWith: [] },
  "pose:gesture":       { maxCount: 1, incompatibleWith: [] },
  "pose:expression":    { maxCount: 1, incompatibleWith: [] },
  "pose:kinetic":       { maxCount: 1, incompatibleWith: ["pose:physiological"] },
  "pose:combat":        { maxCount: 1, incompatibleWith: ["pose:physiological"] },
  "pose:interaction":   { maxCount: 1, incompatibleWith: ["pose:physiological"] },
  "pose:physiological": { maxCount: 1, incompatibleWith: ["pose:kinetic", "pose:combat", "pose:interaction"] },

  // === SCENERY ===
  "scenery:setting":   { maxCount: 1, incompatibleWith: [] },
  "scenery:props":     { maxCount: 3, incompatibleWith: [] },
  "scenery:atmosphere":{ maxCount: 2, incompatibleWith: [] },

  // === CREATURE ===
  "creature:animal":   { maxCount: 2, incompatibleWith: [] },

  // === APPEARANCE ===
  "appearance:hair":        { maxCount: 3, incompatibleWith: [] },
  "appearance:eyes":        { maxCount: 2, incompatibleWith: [] },
  "appearance:anatomy":     { maxCount: 4, incompatibleWith: [] },
  "appearance:demographics":{ maxCount: 2, incompatibleWith: [] },

  // === OTHER ===
  "other:character": { maxCount: 3, incompatibleWith: [] },
  "other:copyright": { maxCount: 2, incompatibleWith: [] },
  "other:artist":    { maxCount: 2, incompatibleWith: [] },
  "other:style":     { maxCount: 2, incompatibleWith: [] },
  "other:layout":    { maxCount: 2, incompatibleWith: [] },
  "other:meta":      { maxCount: 5, incompatibleWith: [] }
}

export const SLOT_GROUP_CONSTRAINTS: Record<string, SlotGroupConstraint> = {
  "pose:active_actions": {
    maxTotal: 2,
    slots: ["pose:kinetic", "pose:combat", "pose:interaction"]
  }
}

/** Confidence threshold below which tags are isolated into status = 'needs_review' */
export const CONFIDENCE_THRESHOLD = 0.70

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

/**
 * Resolves category and optional subcategory from an override string
 * which may be either "category" or "category:subcategory".
 */
export function parseTagSlot(overrideValue?: string | null): { category: TagCategory; subcategory?: string; slot?: string } | null {
  if (!overrideValue || typeof overrideValue !== 'string') return null
  const trimmed = overrideValue.toLowerCase().trim()
  const colonIdx = trimmed.indexOf(':')
  const cat = colonIdx === -1 ? trimmed : trimmed.slice(0, colonIdx)
  if (!isTagCategory(cat)) return null
  const subcat = colonIdx === -1 ? undefined : trimmed.slice(colonIdx + 1)
  const slot = subcat ? `${cat}:${subcat}` : undefined
  return { category: cat, subcategory: subcat, slot }
}

/**
 * Raw override value ("category" or "category:subcategory") for a tag: exact
 * match first, then the longest known suffix ("blue skirt" -> "skirt"), so
 * colour/material variants inherit their base tag's slot.
 */
export function resolveOverrideValue(tag: string, overrides?: Record<string, string>): string | undefined {
  if (!overrides) return undefined
  const lowerWithSpaces = tag.toLowerCase().replace(/_/g, ' ')
  const exact = overrides[lowerWithSpaces] || overrides[tag.toLowerCase()]
  if (exact || !lowerWithSpaces.includes(' ')) return exact || undefined

  const cleaned = lowerWithSpaces
    .replace(/[<>[\](){}]/g, '')
    .replace(/:\s*\d+(\.\d+)?\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const parts = cleaned.split(' ')
  let suffix = ''
  for (let i = parts.length - 1; i >= 0; i--) {
    suffix = suffix === '' ? parts[i] : `${parts[i]} ${suffix}`
    if (suffix === cleaned) continue
    if (overrides[suffix]) return overrides[suffix]
  }
  return undefined
}

/**
 * Resolves the slot information for a given tag from the tag overrides dictionary.
 */
export function getTagSlotFromOverrides(
  tag: string,
  overrides?: Record<string, string>
): { category: TagCategory; subcategory?: string; slot?: string } | null {
  return parseTagSlot(resolveOverrideValue(tag, overrides))
}

export type PackArchetypeId = 'character' | 'wardrobe' | 'expressions' | 'atmosphere' | 'custom'

export interface PackArchetype {
  id: PackArchetypeId
  label: string
  description: string
  /** Categories locked whole: every base-card tag in them is constant. */
  lockedCategories: TagCategory[]
  /** Slots locked inside an otherwise varying category ("partial" lock). */
  lockedSlots?: string[]
}

/** Every slot of a category, as "category:subcategory". */
export function slotsOf(category: TagCategory): string[] {
  return TAG_SUBCATEGORIES[category].map((sub) => `${category}:${sub}`)
}

/** Category part of a "category:subcategory" slot, if it names a known category. */
export function categoryOfSlot(slot: string): TagCategory | null {
  const cat = slot.split(':')[0]
  return isTagCategory(cat) ? cat : null
}

// Only used by pack-config-migration.ts (Pack Mode simplification retired the
// archetype selector — see docs/superpowers/specs/2026-09-27-pack-mode-simplification-design.md).
export const PACK_ARCHETYPES: Record<PackArchetypeId, PackArchetype> = {
  character: {
    id: 'character',
    label: 'Character',
    description: 'Keep character appearance constant, vary wardrobe, poses & scene',
    lockedCategories: ['appearance'],
  },
  wardrobe: {
    id: 'wardrobe',
    label: 'Wardrobe',
    description: 'Keep outfit constant, vary subject, poses & scene',
    lockedCategories: ['clothing'],
  },
  expressions: {
    id: 'expressions',
    label: 'Expressions',
    description: 'Keep everything from the base, vary only facial expressions & gestures',
    lockedCategories: ['appearance', 'clothing', 'equipment', 'scenery', 'creature'],
    lockedSlots: ['pose:camera', 'pose:posture', 'pose:kinetic', 'pose:combat', 'pose:interaction', 'pose:physiological'],
  },
  atmosphere: {
    id: 'atmosphere',
    label: 'Atmosphere',
    description: 'Keep character, outfit, items and pose, vary setting & atmosphere',
    lockedCategories: ['appearance', 'clothing', 'equipment', 'pose', 'creature'],
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    description: 'Full manual control over what stays constant and what varies',
    lockedCategories: [],
  },
}
