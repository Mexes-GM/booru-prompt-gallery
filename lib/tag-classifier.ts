
// cleanPrompt import removed to avoid circular dependency

export type TagCategory = 'clothing' | 'pose' | 'scenery' | 'appearance' | 'other';

export interface ClassifiedTags {
  clothing: string[];
  pose: string[];
  scenery: string[];
  appearance: string[];
  other: string[];
}

const CLOTHING_SUFFIXES = [
  "wear", "uniform", "costume", "dress", "bikini", "swimsuit", "lingerie",
  "underwear", "panties", "bra", "shirt", "pants", "shorts", "skirt",
  "jacket", "coat", "sweater", "hoodie", "vest", "gloves", "mittens",
  "shoes", "boots", "sneakers", "socks", "stockings", "pantyhose",
  "leggings", "hat", "cap", "helmet", "glasses", "eyewear", "mask",
  "necklace", "earrings", "jewelry", "ribbon", "tie", "scarf", "belt",
  "bag", "backpack", "armor", "bodysuit", "leotard", "apron", "kimono", "yukata"
];

const POSE_KEYWORDS = [
  "standing", "sitting", "lying", "kneeling", "squatting", "walking",
  "running", "jumping", "flying", "swimming", "sleeping", "looking",
  "view", "leaning", "reaching", "holding", "carrying", "hugging",
  "kissing", "arms up", "arms behind", "legs crossed", "legs apart",
  "selfie", "peace sign", "stretching", "crying", "laughing", "smiling",
  "blush", "expression", "looking at viewer", "looking back", "from behind",
  "from below", "from above", "side view", "back view"
];

const SCENERY_KEYWORDS = [
  "indoors", "outdoors", "background", "sky", "cloud", "sun", "moon",
  "star", "water", "sea", "ocean", "river", "lake", "pool", "beach",
  "mountain", "forest", "tree", "flower", "grass", "plant", "nature",
  "city", "town", "village", "building", "house", "room", "bed",
  "couch", "chair", "table", "window", "door", "floor", "wall",
  "ceiling", "road", "street", "ruins", "scenery", "landscape",
  "night", "day", "sunset", "sunrise", "rain", "snow"
];

const APPEARANCE_KEYWORDS = [
  "1girl", "1boy", "2girls", "2boys", "hair", "eyes", "skin",
  "breasts", "chest", "nipples", "pussy", "penis", "tail", "wings",
  "horns", "ears", "animal", "fur", "scales", "muscle", "fat",
  "pregnant", "tall", "short", "body", "face", "grin", "smile",
  "blonde", "brunette", "redhead", "silver", "grey", "blue", "green", // hair colors usually
  "heterochromia", "ahoge", "twintails", "ponytail", "braid", "buns"
];

// Precompiled regexes — compiled once at module load, not per tag.
const POSE_REGEXES = POSE_KEYWORDS.map(k => new RegExp(`\\b${k}\\b`));
const SCENERY_REGEXES = SCENERY_KEYWORDS.map(k => new RegExp(`\\b${k}\\b`));
const APPEARANCE_REGEXES = APPEARANCE_KEYWORDS.map(k => new RegExp(`\\b${k}\\b`));

export function classifyTag(tag: string, overrides?: Record<string, string>): TagCategory {
  const lowerWithSpaces = tag.toLowerCase().replace(/_/g, " ");

  // 1. Check overrides first
  if (overrides) {
    // We normalize keys from DB to lowercase and spaces, so check against lowerWithSpaces
    let overrideValue = overrides[lowerWithSpaces] || overrides[tag.toLowerCase()];

    // 1.5 Derivations: if tag is "blue skirt", check if "skirt" is in overrides
    if (!overrideValue && lowerWithSpaces.includes(" ")) {
      const cleanedForSuffix = lowerWithSpaces.replace(/[<>[\](){}]/g, "").replace(/:\s*\d+(\.\d+)?\s*$/, "").replace(/\s{2,}/g, " ").trim();
      const parts = cleanedForSuffix.split(" ");
      
      let currentSuffix = "";
      for (let i = parts.length - 1; i >= 0; i--) {
        currentSuffix = currentSuffix === "" ? parts[i] : parts[i] + " " + currentSuffix;
        if (currentSuffix === cleanedForSuffix) continue;
        
        if (overrides[currentSuffix]) {
          overrideValue = overrides[currentSuffix];
          break;
        }
      }
    }

    if (overrideValue) {
      const dbCategory = overrideValue.toLowerCase().trim() as TagCategory;
      if (["clothing", "pose", "scenery", "appearance", "other"].includes(dbCategory)) {
        return dbCategory;
      }
    }
  }

  const subjectForMatching = lowerWithSpaces.replace(/[<>[\](){}]/g, "").replace(/:\s*\d+(\.\d+)?\s*$/, "").replace(/\s{2,}/g, " ").trim();
  const words = subjectForMatching.split(" ");
  const lastWord = words[words.length - 1];

  // Clothing
  if (CLOTHING_SUFFIXES.some(suffix => subjectForMatching.endsWith(suffix) || subjectForMatching.includes(` ${suffix}`))) {
    return 'clothing';
  }

  // Pose (often verbs or positions)
  if (POSE_REGEXES.some(r => r.test(subjectForMatching))) {
    return 'pose';
  }

  // Scenery
  if (SCENERY_REGEXES.some(r => r.test(subjectForMatching)) || subjectForMatching.endsWith(" background")) {
    return 'scenery';
  }

  // Appearance
  if (APPEARANCE_REGEXES.some(r => r.test(subjectForMatching)) || lastWord === "hair" || lastWord === "eyes") {
    return 'appearance';
  }

  // Booru Pattern: Tags with parentheses (like `character (series)` or `character (costume)`) 
  // usually denote specific characters or franchise variants. If it hasn't matched anything else, default to appearance.
  if (lowerWithSpaces.includes('(') && lowerWithSpaces.includes(')')) {
    return 'appearance';
  }

  return 'other';
}

export function classifyTags(tags: string[], overrides?: Record<string, string>, knownCharacterTags: string[] = []): ClassifiedTags {
  const result: ClassifiedTags = {
    clothing: [],
    pose: [],
    scenery: [],
    appearance: [],
    other: []
  };

  const normalizeForMatch = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/\\(?=[()])/g, "").trim();
  const charTagsSet = new Set(knownCharacterTags.map(normalizeForMatch));

  tags.forEach(tag => {
    // 0. Check if it's a known character tag
    if (charTagsSet.has(normalizeForMatch(tag))) {
      result.appearance.push(tag);
      return;
    }

    const category = classifyTag(tag, overrides);
    if (result[category]) {
      result[category].push(tag);
    } else {
      // Fallback for unexpected categories from DB
      result['other'].push(tag);
    }
  });

  return result;
}

/**
 * Richness score for a card: a composite depth-based score (0-10) after
 * cleanPrompt + classifyTags.
 *
 * Design rationale (validated empirically twice, see
 * docs/prompt-genericness-mitigation-plan.md §7.8 and the follow-up in the same
 * section — "richness-score-v2" experiment):
 * - v1 was a binary category-COVERAGE count (0-4, "is this category non-empty?").
 *   It beat a raw tag count, but had its own blind spot: a category with a
 *   single shallow tag (e.g. one `outdoors` tag) counted exactly the same as a
 *   category with 8 detailed tags. Empirically, 33.8% of a real 80-post sample
 *   had a binary score of >=3/4 while at least one of those categories had
 *   only 1 tag — a "looks rich, isn't" false positive at the category level,
 *   the same failure mode the whole palanca was meant to catch at the prompt
 *   level.
 * - v2 (this version) scores each category by DEPTH, not just presence:
 *   0 tags = 0pts, 1-2 tags ("shallow") = 1pt, 3+ tags ("deep") = 2.5pts.
 *   Summed across the 4 categories, max = 10. This fixes the blind spot by
 *   construction (a shallow category can no longer look identical to a deep
 *   one) and, on the same 80-post sample, has ~6x the variance of the binary
 *   score (4.05 vs 0.674) — i.e. it actually discriminates between posts
 *   instead of clustering most of them at "3" or "4".
 * - Must be computed on already-classified (post-cleanPrompt) tags, not raw
 *   tag_string, or meta/artist noise dilutes the signal (see the original
 *   §7.8 finding: a post can have many total tags that are mostly
 *   artist/character/meta and still be poor in what actually describes the
 *   image).
 * - "other" is intentionally excluded: it's a catch-all bucket
 *   (artist/character/meta-ish leftovers), not a meaningful descriptive axis.
 */
export type RichnessDepth = 'none' | 'shallow' | 'deep';

export interface RichnessScore {
  /** Composite score, 0-10 (sum of per-category depth points, max 2.5 each). */
  score: number;
  /** Max possible score (10), for rendering "score/max". */
  maxScore: number;
  /** Per-category depth (none = 0 tags, shallow = 1-2, deep = 3+), for tooltips/breakdowns. */
  breakdown: Record<'clothing' | 'pose' | 'scenery' | 'appearance', RichnessDepth>;
}

const RICHNESS_CATEGORIES: Array<'clothing' | 'pose' | 'scenery' | 'appearance'> = [
  'clothing', 'pose', 'scenery', 'appearance'
];

const DEPTH_POINTS: Record<RichnessDepth, number> = {
  none: 0,
  shallow: 1,
  deep: 2.5,
};

function depthFor(count: number): RichnessDepth {
  if (count === 0) return 'none';
  if (count <= 2) return 'shallow';
  return 'deep';
}

export function computeRichnessScore(classified: ClassifiedTags): RichnessScore {
  const breakdown = {
    clothing: depthFor(classified.clothing.length),
    pose: depthFor(classified.pose.length),
    scenery: depthFor(classified.scenery.length),
    appearance: depthFor(classified.appearance.length),
  };
  const score = RICHNESS_CATEGORIES.reduce(
    (total, cat) => total + DEPTH_POINTS[breakdown[cat]],
    0
  );
  return {
    score,
    maxScore: RICHNESS_CATEGORIES.length * DEPTH_POINTS.deep,
    breakdown,
  };
}

export function getSmartCombinedTags(tags: string[]): string[] {
  // Re-use cleanPrompt's optimization logic implicitly by calling cleanPrompt?
  // Or simpler: remove redundant subset tags.
  // Simple deduplication using Set.

  const unique = Array.from(new Set(tags));
  // Remove tags that are substrings of other tags (simple redundancy check)
  // e.g. "hat" and "blue hat" -> keep "blue hat"

  // Note: cleanPrompt already does sophisticated optimization. 
  // This function acts as a specific filter for the "Smart" mode if needed beyond cleanPrompt.

  const sorted = unique.sort((a, b) => b.length - a.length); // Longest first
  const kept: string[] = [];

  for (const tag of sorted) {
    // If this tag is NOT a substring of an already kept tag
    if (!kept.some(k => k.includes(tag) && k !== tag)) {
      kept.push(tag);
    }
  }

  return kept.reverse(); // Return to original relative order (roughly)
}
