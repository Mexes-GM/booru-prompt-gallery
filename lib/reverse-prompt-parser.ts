/**
 * Reverse Prompt Parser
 * Cleans and categorizes raw prompts from external sources
 */

import { normalize, toSpace, toUnderscore, parseTagList, QUALITY_TAGS_SET } from "./cleanPrompt"
import { classifyTags, type ClassifiedTags } from "./tag-classifier"

export interface ParsedRawPrompt {
  rawTags: string[]
  cleanedTags: string[]
  classified: ClassifiedTags
  quality: string[]
}

/**
 * Distributes weights and brackets to individual tags inside comma-separated blocks.
 * E.g. "(((elf, ears)))" -> ["(((elf)))", "(((ears)))"]
 */
export function distributeBracketsAndSplit(prompt: string): string[] {
  const result: string[] = [];
  let currentWord = "";
  let inBrackets = 0;
  const bracketStack: string[] = [];

  for (let i = 0; i < prompt.length; i++) {
    const char = prompt[i];

    if (char === '(' || char === '[' || char === '{' || char === '<') {
      inBrackets++;
      bracketStack.push(char);
      currentWord += char;
    } else if (char === ')' || char === ']' || char === '}' || char === '>') {
      inBrackets--;
      bracketStack.pop();
      currentWord += char;
    } else if (char === ',' && inBrackets === 0) {
      if (currentWord.trim()) result.push(currentWord.trim());
      currentWord = "";
    } else if (char === ',' && inBrackets > 0) {
      const closingBrackets = bracketStack.slice().reverse().map(c => {
        if (c === '(') return ')';
        if (c === '[') return ']';
        if (c === '{') return '}';
        if (c === '<') return '>';
        return c;
      }).join('');
      
      const parts = currentWord.split(':');
      let weight = '';
      if (parts.length > 1 && /^[\d\.]+$/.test(parts[parts.length - 1].trim())) {
        weight = ':' + parts.pop()!;
        currentWord = parts.join(':');
      }

      currentWord += weight + closingBrackets;
      if (currentWord.trim()) result.push(currentWord.trim());

      currentWord = bracketStack.join(''); // Restart with opening brackets
    } else {
      currentWord += char;
    }
  }

  if (currentWord.trim()) result.push(currentWord.trim());
  return result;
}

/**
 * Parses a raw prompt string (from Civitai, PNG metadata, etc.)
 * Splits by comma or space and normalizes tags
 * @param rawPrompt Raw prompt string with messy formatting
 * @param tagOverrides Dictionary of tag overrides (usually from Lazy Fetch)
 * @param options Options to remove weights and LoRAs
 * @returns Parsed and cleaned tags
 */
export function parseRawPrompt(
  rawPrompt: string, 
  tagOverrides?: Record<string, string>,
  options?: { removeWeights?: boolean, removeLoras?: boolean }
): ParsedRawPrompt {
  if (!rawPrompt || typeof rawPrompt !== "string") {
    return {
      rawTags: [],
      cleanedTags: [],
      classified: {
        appearance: [],
        clothing: [],
        pose: [],
        scenery: [],
        other: [],
      },
      quality: [],
    }
  }

  let workingPrompt = rawPrompt;

  // Clean raw pasted data from typical A1111/Forge blocks
  // Strip out Negative prompt blocks if present (case-insensitive)
  const negMatch = workingPrompt.match(/negative prompt:/i);
  if (negMatch && negMatch.index !== undefined) {
    workingPrompt = workingPrompt.substring(0, negMatch.index).trim();
  }

  // Strip out generated Steps/Sampler metadata blocks
  const stepsMatch = workingPrompt.match(/\nsteps:/i);
  if (stepsMatch && stepsMatch.index !== undefined) {
    workingPrompt = workingPrompt.substring(0, stepsMatch.index).trim();
  }

  // Sometimes EXIF data is improperly pasted or extracted with keys at the start
  // e.g. "ResolutionUnit None\nUserComment masterpiece, best quality..."
  // or "parameters\nmasterpiece, best quality..."
  const exifGarbageMatch = workingPrompt.match(/^(?:ResolutionUnit\s+None\s*\n*)?(?:UserComment|parameters)\s*/i);
  if (exifGarbageMatch && exifGarbageMatch.index === 0) {
    workingPrompt = workingPrompt.substring(exifGarbageMatch[0].length).trim();
  }

  // Replace newlines with commas so tags separated by newlines are parsed correctly (like BREAK)
  workingPrompt = workingPrompt.replace(/\n/g, ", ");

  // Determine delimiter: prefer comma if present
  const hasComma = workingPrompt.includes(",")
  const delimiter = hasComma ? "," : " "

  let intialFilteredTags: string[] = hasComma 
    ? distributeBracketsAndSplit(workingPrompt).map((t) => t.trim()).filter(Boolean)
    : workingPrompt.split(/\s+/).filter(Boolean);

  if (options?.removeLoras) {
    intialFilteredTags = intialFilteredTags.filter((tag) => !tag.toLowerCase().startsWith("<lora:"));
  }

    const rawTags: string[] = [...intialFilteredTags];
  if (options?.removeWeights) {
    intialFilteredTags = intialFilteredTags.map((tag) => {
      // Don't strip brackets from LORAs if we kept them, but actually we mostly care about tags.
      if (tag.toLowerCase().startsWith("<lora:")) return tag;
      return tag.replace(/[<>[\](){}]/g, "").replace(/:\s*\d+(\.\d+)?\s*$/, "").trim();
    });
  }

  // Normalize: lowercase, underscores->spaces, trim
  const cleanedTags = intialFilteredTags
    .map((tag) => normalize(tag))
    .filter((tag) => {
      // Remove empty strings, single characters, and obvious noise
      if (!tag || tag.length <= 1) return false
      // Remove URLs/email-like patterns
      if (tag.includes("http") || tag.includes("@")) return false
      // Remove symbols-only
      if (/^[\W_]+$/.test(tag)) return false
      return true
    })

  // Separate quality tags from content tags
  const qualityTags = cleanedTags.filter((tag) => QUALITY_TAGS_SET.has(tag))
  const contentTags = cleanedTags.filter((tag) => !QUALITY_TAGS_SET.has(tag))

  // Classify the content tags using our overrides
  const classified = classifyTags(contentTags, tagOverrides)

  return {
    rawTags,
    cleanedTags,
    classified,
    quality: qualityTags,
  }
}

/**
 * Reconstructs a prompt from parsed components
 * Allows selective inclusion of categories
 */
export function reconstructPrompt(
  classified: ClassifiedTags,
  quality: string[],
  options?: {
    appearance?: boolean
    clothing?: boolean
    pose?: boolean
    scenery?: boolean
    other?: boolean
    quality?: boolean
    escapeParentheses?: boolean
  }
): string {
  const {
    appearance = true,
    clothing = true,
    pose = true,
    scenery = true,
    other = true,
    quality: includeQuality = true,
    escapeParentheses = false,
  } = options || {}

  const parts: string[] = []

  if (appearance) parts.push(...classified.appearance)
  if (clothing) parts.push(...classified.clothing)
  if (pose) parts.push(...classified.pose)
  if (scenery) parts.push(...classified.scenery)
  if (other) parts.push(...classified.other)
  if (includeQuality) parts.push(...quality)

  const escapeTag = (tag: string) => {
    if (!escapeParentheses) return tag
    return tag.replace(/\(/g, "\\(").replace(/\)/g, "\\)")
  }

  return parts.map(escapeTag).join(", ")
}

/**
 * Get the total count of tags in a classified structure
 */
export function countClassifiedTags(classified: ClassifiedTags, quality: string[]): number {
  return (
    classified.appearance.length +
    classified.clothing.length +
    classified.pose.length +
    classified.scenery.length +
    classified.other.length +
    quality.length
  )
}
