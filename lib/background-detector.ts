export type BackgroundMode = 'keep' | 'remove_all' | 'force_simple' | 'random';

import { classifyTag } from "./tag-classifier";
import { BACKGROUND_DICTIONARY } from "./background-dictionary";
import { extractColorsFromTags, getDominantColor, getCoherentBackgroundColors, getRandomElement } from "./color-theory";

// ─── Expanded Background Tag Detection ──────────────────────────────────────

export const SIMPLE_BG_TAGS = new Set([
  // Color backgrounds (all BACKGROUND_COLORS + more)
  "white background", "black background", "grey background", "gray background",
  "blue background", "red background", "green background", "yellow background",
  "pink background", "purple background", "orange background", "brown background",
  "beige background", "cream background", "cyan background", "magenta background",
  "teal background", "indigo background", "violet background", "dark background",
  "light background", "bright background", "pale background", "pastel background",
  "neon background", "muted background", "vibrant background",
  // Background types
  "simple background", "solid background", "gradient background",
  "transparent background", "colored background", "two-tone background",
  "abstract background", "pattern background", "texture background",
  "blurred background", "blurry background", "bokeh",
  "monochrome", "flat color",
  // Special
  "no background", "empty background", "blank background",
]);

// Massively expanded detailed background keywords (200+ Danbooru tags)
export const DETAILED_BG_KEYWORDS = [
  // Sky & celestial
  "scenery", "landscape", "sky", "cloud", "clouds", "cloudy sky",
  "blue sky", "starry sky", "night sky", "moon", "full moon", "crescent moon",
  "sun", "sunlight", "sunbeams", "sunset", "sunrise", "dusk", "dawn",
  "twilight", "golden hour", "starry sky", "stars", "constellation",
  "rainbow", "aurora", "northern lights",
  // Weather
  "rain", "heavy rain", "drizzle", "snow", "blizzard", "fog", "mist",
  "storm", "lightning", "thunder", "wind", "windy", "breeze",
  "cloudy", "overcast", "clear sky",
  // Natural outdoor
  "outdoors", "nature", "forest", "tree", "trees", "woods", "jungle",
  "mountain", "mountains", "hill", "hills", "cliff", "cliffs",
  "beach", "ocean", "sea", "river", "lake", "pond", "stream", "waterfall",
  "shore", "coast", "horizon", "island", "field", "meadow", "grass",
  "flower field", "garden", "park", "desert", "cave", "cavern",
  "snowscape", "ice", "glacier", "volcano", "swamp", "marsh",
  // Paths & terrain
  "path", "road", "street", "sidewalk", "highway", "trail", "dirt road",
  "bridge", "fence", "gate", "wall", "brick wall", "stone wall",
  "roof", "rooftop", "balcony", "terrace", "stairs", "staircase",
  // Urban
  "cityscape", "city", "town", "village", "building", "buildings",
  "skyscraper", "skyline", "alley", "alleyway", "market", "plaza",
  "neon lights", "streetlight", "lamppost",
  // Indoor
  "indoors", "room", "bedroom", "living room", "bathroom", "kitchen",
  "classroom", "office", "library", "hallway", "corridor",
  // Furniture & fixtures
  "chair", "table", "desk", "couch", "sofa", "bed", "window", "door",
  "floor", "ceiling", "wall", "carpet", "rug", "curtain", "curtains",
  "bookshelf", "shelf", "cabinet", "mirror", "lamp", "chandelier",
  "painting (object)", "picture frame", "clock", "tv", "television",
  // Structures
  "temple", "shrine", "church", "cathedral", "castle", "fortress",
  "ruins", "tower", "lighthouse", "windmill", "barn", "cabin",
  "house", "mansion", "palace", "school", "hospital",
  // Transport & vehicles
  "car", "vehicle", "train", "bus", "boat", "ship", "airplane",
  "bicycle", "motorcycle",
  // Elements
  "water", "fire", "flame", "flames", "smoke", "steam", "sparks",
  "bubbles", "underwater", "pool", "hot spring", "onsen", "fountain",
  // Seasonal
  "spring", "summer", "autumn", "fall", "winter",
  "cherry blossoms", "sakura", "autumn leaves", "falling leaves",
  "petals", "falling petals", "snowflakes", "falling snow",
  // Academic / work
  "classroom", "blackboard", "chalkboard", "whiteboard",
  "laboratory", "hospital room",
  // Props & scenery elements
  "bench", "statue", "monument", "flag", "banner", "sign", "signboard",
  "vending machine", "poster", "graffiti", "mural",
];

// ─── New: Background Remove Granularity ────────────────────────────────────
export type BackgroundRemoveMode = 'all' | 'simple_only' | 'detailed_only';

export interface BackgroundAnalysis {
  type: 'simple' | 'detailed' | 'mixed' | 'unknown';
  backgroundTags: string[];
}

export function isBackgroundTag(tag: string): boolean {
  const lowerTag = tag.toLowerCase().trim();
  
  if (SIMPLE_BG_TAGS.has(lowerTag)) return true;
  if (lowerTag.endsWith(' background')) return true;
  if (DETAILED_BG_KEYWORDS.includes(lowerTag)) return true;
  
  return false;
}

export function analyzeBackground(tags: string[]): BackgroundAnalysis {
  const backgroundTags: string[] = [];
  let hasSimple = false;
  let hasDetailed = false;

  for (const tag of tags) {
    const lowerTag = tag.toLowerCase().trim();
    
    let isBg = false;
    let isSimple = false;
    let isDetailed = false;
    
    // Simple background detection: explicit set OR ends with 'background'
    if (SIMPLE_BG_TAGS.has(lowerTag) || lowerTag.endsWith(' background') || lowerTag === 'monochrome') {
      hasSimple = true;
      isBg = true;
      isSimple = true;
    }
    
    // Detailed background detection: keyword match
    if (DETAILED_BG_KEYWORDS.includes(lowerTag)) {
      hasDetailed = true;
      isBg = true;
      isDetailed = true;
    }
    
    // Store with classification metadata via extended string (backward-compatible)
    if (isBg) {
      backgroundTags.push(tag);
    }
  }

  let type: BackgroundAnalysis['type'] = 'unknown';
  if (hasSimple && hasDetailed) type = 'mixed';
  else if (hasSimple) type = 'simple';
  else if (hasDetailed) type = 'detailed';

  return { type, backgroundTags };
}

// ─── New: Classify a tag as simple or detailed background ──────────────────
function isSimpleBgTag(tag: string): boolean {
  const lowerTag = tag.toLowerCase().trim();
  return SIMPLE_BG_TAGS.has(lowerTag) || lowerTag.endsWith(' background') || lowerTag === 'monochrome';
}

function isDetailedBgTag(tag: string): boolean {
  const lowerTag = tag.toLowerCase().trim();
  return DETAILED_BG_KEYWORDS.includes(lowerTag) && !isSimpleBgTag(tag);
}

// ─── Expanded: Random Background Options ──────────────────────────────────
export interface RandomBackgroundOptions {
  patternsEnabled?: boolean;
  includeGradients?: boolean;
}

// ─── New: Procedural Gradient Generation ──────────────────────────────────
const COOL_GRADIENT_COMBOS: [string, string][] = [
  ["blue", "purple"], ["blue", "cyan"], ["blue", "pink"],
  ["purple", "pink"], ["purple", "orange"], ["pink", "orange"],
  ["pink", "yellow"], ["red", "orange"], ["red", "purple"],
  ["green", "blue"], ["green", "cyan"], ["green", "teal"],
  ["teal", "blue"], ["teal", "purple"], ["orange", "yellow"],
  ["yellow", "green"], ["cyan", "indigo"], ["violet", "indigo"],
  ["white", "blue"], ["white", "pink"], ["black", "purple"],
  ["cream", "beige"], ["cream", "brown"], ["grey", "blue"],
];

function generateGradientBackground(dominantColor: string | null): string[] | null {
  if (Math.random() > 0.25) return null;

  let combo: [string, string];

  if (dominantColor && dominantColor !== "white" && dominantColor !== "black" && dominantColor !== "grey") {
    const matching = COOL_GRADIENT_COMBOS.filter(
      ([a, b]) => a === dominantColor || b === dominantColor
    );
    if (matching.length > 0) {
      combo = matching[Math.floor(Math.random() * matching.length)];
    } else {
      combo = COOL_GRADIENT_COMBOS[Math.floor(Math.random() * COOL_GRADIENT_COMBOS.length)];
    }
  } else {
    combo = COOL_GRADIENT_COMBOS[Math.floor(Math.random() * COOL_GRADIENT_COMBOS.length)];
  }

  const style = Math.random() > 0.5 ? "gradient background" : "two-tone background";
  return [`${combo[0]} background`, `${combo[1]} background`, style];
}

// ─── Core Processing ────────────────────────────────────────────────────────
export function processBackgroundTags(
  tags: string[],
  mode: BackgroundMode,
  replacementTags: string = "simple background, white background",
  tagOverrides?: Record<string, string>,
  randomOptions?: RandomBackgroundOptions,
  removeMode: BackgroundRemoveMode = 'all',
): string[] {
  if (mode === 'keep') return tags;

  const analysis = analyzeBackground(tags);

  // Early return if no background tags detected AND mode isn't force_simple/random
  if (analysis.backgroundTags.length === 0 && mode !== 'force_simple' && mode !== 'remove_all' && mode !== 'random') return tags;

  // Filter out background tags based on granularity
  let newTags: string[];
  
  if (mode === 'remove_all') {
    // Apply granularity filtering
    switch (removeMode) {
      case 'simple_only':
        newTags = tags.filter(tag => !isSimpleBgTag(tag));
        break;
      case 'detailed_only':
        newTags = tags.filter(tag => !isDetailedBgTag(tag));
        break;
      case 'all':
      default:
        newTags = tags.filter(tag => !analysis.backgroundTags.includes(tag));
        // Also filter scenery-classified tags for full removal
        newTags = newTags.filter(tag => classifyTag(tag, tagOverrides) !== 'scenery');
        break;
    }
  } else if (mode === 'force_simple' || mode === 'random') {
    // Full removal + scenery filter
    newTags = tags.filter(tag => !analysis.backgroundTags.includes(tag));
    newTags = newTags.filter(tag => classifyTag(tag, tagOverrides) !== 'scenery');
  } else {
    newTags = [...tags];
  }

  // If forcing simple, inject the replacement tags
  if (mode === 'force_simple') {
    const replTags = replacementTags.split(',').map(t => t.trim()).filter(Boolean);
    replTags.forEach(rt => {
      if (!newTags.some(t => t.toLowerCase() === rt.toLowerCase())) {
        newTags.push(rt);
      }
    });
  }

  // Random mode: generate unique backgrounds per card
  if (mode === 'random') {
    const generatedTags: string[] = [];
    
    // 1. Color Theory Detection
    const colors = extractColorsFromTags(newTags);
    const dominantColor = getDominantColor(colors);
    const coherentColors = getCoherentBackgroundColors(dominantColor);
    
    // Pick a random coherent color
    const pickedColor = getRandomElement(coherentColors);
    
    // Base background tag
    if (pickedColor) {
      generatedTags.push(`${pickedColor} background`);
    } else {
      generatedTags.push("simple background");
    }

    // 2. Gradient check
    if (randomOptions?.includeGradients !== false) {
      const gradient = generateGradientBackground(dominantColor);
      if (gradient) {
        generatedTags.push(...gradient);
      }
    }

    // 3. Pattern or medium
    if (randomOptions?.patternsEnabled && Math.random() > 0.5) {
      const pattern = getRandomElement(BACKGROUND_DICTIONARY.patterns);
      if (pattern) generatedTags.push(pattern);
    } else if (Math.random() > 0.3) {
      const medium = getRandomElement(BACKGROUND_DICTIONARY.mediums);
      if (medium) generatedTags.push(medium);
    }

    // Ensure we don't exceed 3 tags
    const finalGenerated = generatedTags.slice(0, 3);
    
    finalGenerated.forEach(rt => {
      if (!newTags.some(t => t.toLowerCase() === rt.toLowerCase())) {
        newTags.push(rt);
      }
    });
  }

  return newTags;
}
