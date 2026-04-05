export type BackgroundMode = 'keep' | 'remove_all' | 'force_simple';

import { classifyTag } from "./tag-classifier";

export const SIMPLE_BG_TAGS = new Set([
  "simple background",
  "transparent background",
  "white background",
  "black background",
  "grey background",
  "blue background",
  "red background",
  "green background",
  "yellow background",
  "pink background",
  "purple background",
  "orange background",
  "brown background",
  "solid background",
  "gradient background",
  "colored background",
  "pattern background",
  "abstract background",
  "monochrome",
  "two-tone background", // Added some more robust defaults
]);

export const DETAILED_BG_KEYWORDS = [
  "scenery",
  "outdoors",
  "indoors",
  "cityscape",
  "landscape",
  "sky",
  "cloud",
  "cloudy sky",
  "blue sky",
  "starry sky",
  "night sky",
  "room",
  "bedroom",
  "bed",
  "water",
  "ocean",
  "sea",
  "forest",
  "tree",
  "trees",
  "mountain",
  "mountains",
  "building",
  "buildings",
  "street",
  "nature",
  "grass",
  "flower",
  "flowers",
  "plant",
  "plants",
  "window",
  "wall",
  "floor",
  "ceiling",
  "furniture",
  "chair",
  "table",
  "desk",
  "couch",
  "sofa",
  "car",
  "vehicle",
];

export interface BackgroundAnalysis {
  type: 'simple' | 'detailed' | 'mixed' | 'unknown';
  backgroundTags: string[];
}

export function isBackgroundTag(tag: string): boolean {
  const lowerTag = tag.toLowerCase().trim();
  
  if (SIMPLE_BG_TAGS.has(lowerTag)) {
    return true;
  }
  
  if (lowerTag.endsWith(' background')) {
    return true;
  }

  // Check against detailed keywords - using exact word match where possible, 
  // or simple includes for distinct words
  if (DETAILED_BG_KEYWORDS.includes(lowerTag)) {
      return true;
  }

  return false;
}

export function analyzeBackground(tags: string[]): BackgroundAnalysis {
  const backgroundTags: string[] = [];
  let hasSimple = false;
  let hasDetailed = false;

  for (const tag of tags) {
    const lowerTag = tag.toLowerCase().trim();
    
    let isBg = false;
    
    if (SIMPLE_BG_TAGS.has(lowerTag) || lowerTag.endsWith(' background') || lowerTag === 'monochrome') {
      hasSimple = true;
      isBg = true;
    } else if (DETAILED_BG_KEYWORDS.includes(lowerTag)) {
      hasDetailed = true;
      isBg = true;
    }

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

export function processBackgroundTags(
  tags: string[],
  mode: BackgroundMode,
  replacementTags: string = "simple background, white background",
  tagOverrides?: Record<string, string>
): string[] {
  if (mode === 'keep') return tags;

  const analysis = analyzeBackground(tags);

  if (analysis.backgroundTags.length === 0 && mode !== 'force_simple' && mode !== 'remove_all') return tags;

  // Filter out the detected background tags
  let newTags = tags.filter(tag => !analysis.backgroundTags.includes(tag));     

  // If mode requires removing scenery classifications
  if (mode === 'remove_all' || mode === 'force_simple') {
    newTags = newTags.filter(tag => classifyTag(tag, tagOverrides) !== 'scenery');
  }

  // If forcing simple, inject the replacement tags
  if (mode === 'force_simple') {
    const replTags = replacementTags.split(',').map(t => t.trim()).filter(Boolean);
    // Add replacement tags if they aren't already there
    replTags.forEach(rt => {
      if (!newTags.some(t => t.toLowerCase() === rt.toLowerCase())) {
        newTags.push(rt);
      }
    });
  }

  return newTags;
}
