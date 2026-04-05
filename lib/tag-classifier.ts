
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

export function classifyTag(tag: string, overrides?: Record<string, string>): TagCategory {
  const lowerWithSpaces = tag.toLowerCase().replace(/_/g, " ");

  // 1. Check overrides first
  if (overrides) {
    // We normalize keys from DB to lowercase and spaces, so check against lowerWithSpaces
    let overrideValue = overrides[lowerWithSpaces] || overrides[tag.toLowerCase()];

    // 1.5 Derivations: if tag is "blue skirt", check if "skirt" is in overrides
    if (!overrideValue && lowerWithSpaces.includes(" ")) {
      const cleanedForSuffix = lowerWithSpaces.replace(/\s*\([^)]*\)/g, "").trim();
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

  const subjectForMatching = lowerWithSpaces.replace(/\s*\(.*?\)/g, "").trim();
  const words = subjectForMatching.split(" ");
  const lastWord = words[words.length - 1];

  const hasKeyword = (keywords: string[], text: string) => {
    return keywords.some(k => new RegExp(`\\b${k}\\b`).test(text));
  };

  // Clothing
  if (CLOTHING_SUFFIXES.some(suffix => subjectForMatching.endsWith(suffix) || subjectForMatching.includes(` ${suffix}`))) {
    return 'clothing';
  }

  // Pose (often verbs or positions)
  if (hasKeyword(POSE_KEYWORDS, subjectForMatching)) {
    return 'pose';
  }

  // Scenery
  if (hasKeyword(SCENERY_KEYWORDS, subjectForMatching) || subjectForMatching.endsWith(" background")) {
    return 'scenery';
  }

  // Appearance
  if (hasKeyword(APPEARANCE_KEYWORDS, subjectForMatching) || lastWord === "hair" || lastWord === "eyes") {
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

export function getSmartCombinedTags(tags: string[]): string[] {
  // Re-use cleanPrompt's optimization logic implicitly by calling cleanPrompt?
  // Or simpler: remove redundant subset tags.
  // For now, let's implement a simple dedupe.

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
