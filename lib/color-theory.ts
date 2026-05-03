import { BACKGROUND_COLORS } from './background-dictionary';

// Mapping of color names to HSV values to approximate color relationships
// H: 0-360, S: 0-100, V: 0-100
const COLOR_MAP: Record<string, { h: number; s: number; v: number }> = {
  red: { h: 0, s: 100, v: 100 },
  orange: { h: 30, s: 100, v: 100 },
  yellow: { h: 60, s: 100, v: 100 },
  green: { h: 120, s: 100, v: 100 },
  cyan: { h: 180, s: 100, v: 100 },
  blue: { h: 240, s: 100, v: 100 },
  indigo: { h: 275, s: 100, v: 100 },
  violet: { h: 285, s: 100, v: 100 },
  purple: { h: 300, s: 100, v: 100 },
  magenta: { h: 300, s: 100, v: 100 },
  pink: { h: 330, s: 50, v: 100 },
  brown: { h: 30, s: 100, v: 50 },
  white: { h: 0, s: 0, v: 100 },
  grey: { h: 0, s: 0, v: 50 },
  black: { h: 0, s: 0, v: 0 },
  beige: { h: 30, s: 20, v: 96 },
  cream: { h: 60, s: 10, v: 100 },
  teal: { h: 180, s: 100, v: 50 }
};

const NEUTRAL_COLORS = ["white", "black", "grey", "beige", "cream"];

/**
 * Extracts all color mentions from a list of tags.
 */
export function extractColorsFromTags(tags: string[]): string[] {
  const foundColors: string[] = [];
  const colorKeywords = Object.keys(COLOR_MAP);

  for (const tag of tags) {
    const lowerTag = tag.toLowerCase();
    for (const color of colorKeywords) {
      // Look for exact word matches to avoid matching "red" in "bored"
      const regex = new RegExp(`\\b${color}\\b`);
      if (regex.test(lowerTag)) {
        foundColors.push(color);
      }
    }
  }

  return foundColors;
}

/**
 * Determines the dominant color from an array of color strings based on frequency.
 */
export function getDominantColor(colors: string[]): string | null {
  if (colors.length === 0) return null;

  const frequency: Record<string, number> = {};
  let maxFreq = 0;
  let dominant = colors[0];

  for (const color of colors) {
    frequency[color] = (frequency[color] || 0) + 1;
    if (frequency[color] > maxFreq) {
      maxFreq = frequency[color];
      dominant = color;
    }
  }

  return dominant;
}

/**
 * Gets coherent background colors (analogous or neutral) for a given dominant color.
 */
export function getCoherentBackgroundColors(dominantColor: string | null): string[] {
  // If no dominant color is found, return all colors as possibilities
  if (!dominantColor || !COLOR_MAP[dominantColor]) {
    return BACKGROUND_COLORS;
  }

  const baseHsv = COLOR_MAP[dominantColor];
  
  // If dominant color is neutral, return a mix of neutrals and low-saturation colors
  if (NEUTRAL_COLORS.includes(dominantColor)) {
    return BACKGROUND_COLORS;
  }

  const coherent: string[] = [...NEUTRAL_COLORS]; // Neutrals always work

  for (const [colorName, hsv] of Object.entries(COLOR_MAP)) {
    if (NEUTRAL_COLORS.includes(colorName)) continue;
    
    // Analogous colors: Hue difference is small (e.g., within 45 degrees)
    let hueDiff = Math.abs(baseHsv.h - hsv.h);
    if (hueDiff > 180) {
      hueDiff = 360 - hueDiff;
    }

    if (hueDiff <= 45) {
      coherent.push(colorName);
    }
  }

  return coherent;
}

export function getRandomElement<T>(arr: T[], rng?: () => number): T | null {
    if (!arr || arr.length === 0) return null;
    const idx = rng ? Math.floor(rng() * arr.length) : Math.floor(Math.random() * arr.length);
    return arr[idx];
}

/**
 * Simple seeded PRNG (mulberry32) for deterministic random generation.
 * Pass the same seed to get the same sequence of pseudo-random numbers.
 */
export function seededRandom(seed: number): () => number {
  return function() {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
