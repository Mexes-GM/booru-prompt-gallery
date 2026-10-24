/**
 * Output formats a card can write its prompt in. Labels only: the converter
 * itself (lib/prompt/natural-format.ts) is loaded on demand, so the tag format
 * costs no extra download.
 */
export type PromptFormat = "tags" | "anima" | "flux2" | "moss"
export type NaturalPromptFormat = Exclude<PromptFormat, "tags">

export const PROMPT_FORMATS: readonly PromptFormat[] = ["tags", "anima", "flux2", "moss"]

export interface PromptFormatInfo {
  /** Menu and settings label. */
  label: string
  /** Short name for the Customize prompt summary. */
  badge: string
  /** One line under the setting. */
  description: string
  /** What the copied text contains, shown as a hint in the card's copy menu. */
  contents: string
  /** Word budget of the short version; prose formats only. */
  shortWords?: number
}

export const PROMPT_FORMAT_INFO: Record<PromptFormat, PromptFormatInfo> = {
  tags: {
    label: "Tags",
    badge: "Tags",
    description: "Booru tags separated by commas",
    contents: "tags",
  },
  anima: {
    label: "Anima",
    badge: "Anima",
    description: "Tags followed by a short description of the pose and framing",
    contents: "tags + text",
  },
  flux2: {
    label: "FLUX.2 · Krea 2",
    badge: "FLUX.2",
    description: "Plain sentences for FLUX.2 and Krea 2",
    contents: "text",
    shortWords: 80,
  },
  moss: {
    label: "MOSS-Image",
    badge: "MOSS-Image",
    description: "A longer description for MOSS-Image",
    contents: "long text",
    shortWords: 180,
  },
}

export function isPromptFormat(value: unknown): value is PromptFormat {
  return typeof value === "string" && (PROMPT_FORMATS as readonly string[]).includes(value)
}

/** Prose formats have a word budget, so they come in a short and a full version. */
export function hasWordBudget(format: PromptFormat): format is "flux2" | "moss" {
  return PROMPT_FORMAT_INFO[format].shortWords !== undefined
}
