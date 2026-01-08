
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
  // 1. Check overrides first
  if (overrides && overrides[tag]) {
    // Ensure the DB value is a valid TagCategory, otherwise default to 'other' (or keep as is if we trust DB)
    const dbCategory = overrides[tag] as TagCategory;
    if (['clothing', 'pose', 'scenery', 'appearance', 'other'].includes(dbCategory)) {
        return dbCategory;
    }
  }

  const lower = tag.toLowerCase().replace(/_/g, " ");
  const words = lower.split(" ");
  const lastWord = words[words.length - 1];

  // Clothing
  if (CLOTHING_SUFFIXES.some(suffix => lower.endsWith(suffix) || lower.includes(` ${suffix}`))) {
    return 'clothing';
  }

  // Pose (often verbs or positions)
  if (POSE_KEYWORDS.some(k => lower.includes(k))) {
    return 'pose';
  }

  // Scenery
  if (SCENERY_KEYWORDS.some(k => lower.includes(k) || lower.endsWith(" background"))) {
    return 'scenery';
  }

  // Appearance
  if (APPEARANCE_KEYWORDS.some(k => lower.includes(k) || lastWord === "hair" || lastWord === "eyes")) {
    return 'appearance';
  }

  return 'other';
}

export function classifyTags(tags: string[], overrides?: Record<string, string>): ClassifiedTags {
  const result: ClassifiedTags = {
    clothing: [],
    pose: [],
    scenery: [],
    appearance: [],
    other: []
  };

  tags.forEach(tag => {
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
