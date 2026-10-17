/**
 * Tags that mark a prompt as matching the "explicit" content rating. A Pack
 * Mode source with that rating uses this to keep every prompt on-rating —
 * sampling from on-rating posts alone can still land on generic tags only.
 *
 * Matched by whole word on purpose: the pack vocabulary's own rating flag is
 * a substring match ("butterfly", "sundress"), far too loose for this.
 */
const EXPLICIT_WORDS = new Set([
  "sex", "sexual", "hetero", "rape", "raped", "gangbang", "mating", "oral",
  "penis", "penises", "testicles", "erection", "pussy", "vagina", "vaginal",
  "clitoris", "anus", "anal", "nipples", "nipple", "areolae", "pubic",
  "nude", "naked",
  "cum", "cumdrip", "precum", "semen", "ejaculation", "creampie", "bukkake", "lactation",
  "orgasm", "ahegao", "penetration", "fellatio", "irrumatio", "deepthroat",
  "cunnilingus", "anilingus", "paizuri", "handjob", "footjob", "thighjob",
  "masturbation", "fingering", "groping", "doggystyle", "missionary", "spitroast",
  "dildo", "vibrator", "condom", "futanari",
])

/** True when any word of `tag` (spaces/underscores, weights and parentheses ignored) is explicit. */
export function isExplicitTag(tag: string): boolean {
  const words = tag
    .toLowerCase()
    .replace(/:\s*\d+(\.\d+)?\s*\)*\s*$/, "")
    .replace(/\\?[()[\]{}]/g, " ")
    .split(/[\s_]+/)
  return words.some((w) => EXPLICIT_WORDS.has(w))
}

/** True when a comma-separated prompt contains at least one explicit tag. */
export function promptHasExplicitTag(prompt: string): boolean {
  return prompt.split(",").some((tag) => isExplicitTag(tag))
}
