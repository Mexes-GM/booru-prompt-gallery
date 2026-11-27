/**
 * The two pack builders: the new one (opens by default) and the classic one, kept for whoever
 * finds it useful. Each keeps its own pack; switching starts the other from the same card,
 * prompt or characters, never with the rest of the pack. Pure: texts and one comparison.
 */
import type { PackBriefStart } from "./pack-brief-builder"

export const BUILDER_SWITCH_TEXT = {
  /** The new builder's header. */
  classic: "Classic builder",
  classicShort: "Classic",
  classicHint: "Open this pack's card or character in the classic builder, with its own settings",
  /** The entry dialog. */
  entryClassic: "Open in the classic builder",
  entryClassicHint: "The earlier builder, with more settings",
  /** The classic builder's menu. */
  toNewLabel: "New builder",
  toNewHint: "Open this pack's card or character in the new builder",
  toClassic: "Opened in the classic builder. It starts from the same card or character; the rest of this pack stays in the new builder.",
  toNew: "Opened in the new builder. It starts from the same card or character; the classic builder keeps its own pack.",
  /** While a card is picked for the new builder. */
  pickCard: "Pick a card and press Use as base to start the pack.",
  backToPack: "Back to pack",
  /** A card's "Make a pack" while the pack in the builder has prompts. */
  replaceTitle: "Replace your pack?",
  replaceBody: (prompts: number) =>
    `Your pack has ${prompts} ${prompts === 1 ? "prompt" : "prompts"}. A pack from this card replaces it.`,
  replaceKeep: "Keep my pack",
  replaceStart: "Start new pack",
} as const

const norm = (s: string) => s.toLowerCase().replace(/_/g, " ").trim()

/** A start as a base the other builder knows: a pack kept across a reload is its characters. */
export function baseOfStart(start: PackBriefStart): PackBriefStart {
  if (start.kind !== "restored") return start
  return { kind: "characters", names: start.saved.brief.who.flatMap((c) => (c.tag ? [c.tag] : [])) }
}

/** True when two starts are the same base: the same card, prompt or characters. */
export function sameBriefStart(first: PackBriefStart, second: PackBriefStart): boolean {
  const a = baseOfStart(first)
  const b = baseOfStart(second)
  if (a.kind === "card" || b.kind === "card") return a.kind === "card" && b.kind === "card" && a.post.id === b.post.id
  if (a.kind === "prompt" || b.kind === "prompt") return a.kind === "prompt" && b.kind === "prompt" && a.text.trim() === b.text.trim()
  const names = (s: PackBriefStart) =>
    (s.kind === "characters" ? [...s.names] : s.kind === "search" && s.character ? [s.character] : []).map(norm).sort().join("|")
  return names(a) !== "" && names(a) === names(b)
}
