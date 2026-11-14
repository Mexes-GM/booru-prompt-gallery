/**
 * What each row of the pack's card is: its label, its icon and the colour of its
 * category, and the words it shows when it is empty. Class strings are written out
 * whole so Tailwind sees them.
 */
import { Ban, Palette, Plus, UserRound, UsersRound, type LucideIcon } from "lucide-react"
import { TAG_CATEGORY_ICONS } from "@/components/tag-category-icon"
import type { PackBrief, RequestRole } from "@/lib/pack/brief"
import type { PackPeople } from "@/lib/pack/scene/scene-pool"

export type SlotId = "who" | RequestRole | "style" | "never" | "others"

export interface SlotMeta {
  id: SlotId
  label: string
  icon: LucideIcon
  /** Icon colour: the slot's prompt category, or quiet text for slots without one. */
  iconClass: string
  /** Shown in the field while the slot is empty. */
  emptyText: string
  /** Shown in the field once the slot has something. */
  moreText: string
  /** Shown under the row while it is empty, in full (a placeholder would be cut off). */
  help?: string
}

export const SLOTS: Record<SlotId, SlotMeta> = {
  who: {
    id: "who",
    label: "Who",
    icon: UserRound,
    iconClass: "text-cat-appearance-text",
    emptyText: "Anything",
    moreText: "Add a character or look",
  },
  wearing: {
    id: "wearing",
    label: "Wearing",
    icon: TAG_CATEGORY_ICONS.clothing,
    iconClass: "text-cat-clothing-text",
    emptyText: "Anything",
    moreText: "Add clothing",
  },
  doing: {
    id: "doing",
    label: "Doing",
    icon: TAG_CATEGORY_ICONS.pose,
    iconClass: "text-cat-pose-text",
    emptyText: "Anything",
    moreText: "Add a pose or action",
    help: "Poses and actions, like sitting or shirt lift",
  },
  where: {
    id: "where",
    label: "Where",
    icon: TAG_CATEGORY_ICONS.scenery,
    iconClass: "text-cat-scenery-text",
    emptyText: "Anything",
    moreText: "Add a place",
    help: "A place, or the time of day, weather and light. Any finds places that have it; Exactly adds it to each scene",
  },
  also: {
    id: "also",
    label: "Also",
    icon: Plus,
    iconClass: "text-muted-foreground",
    emptyText: "Add tags",
    moreText: "Add more",
    help: "Expression, camera, objects, and what shows in this picture",
  },
  style: {
    id: "style",
    label: "Style",
    icon: Palette,
    iconClass: "text-muted-foreground",
    emptyText: "Add style tags",
    moreText: "Add more",
    help: "Artists, quality tags, LoRA triggers. Every prompt starts with these, as typed.",
  },
  never: {
    id: "never",
    label: "Never",
    icon: Ban,
    iconClass: "text-destructive-text",
    emptyText: "Tags no prompt should have",
    moreText: "Add a tag",
  },
  others: {
    id: "others",
    label: "Others",
    icon: UsersRound,
    iconClass: "text-cat-appearance-text",
    emptyText: "Anything",
    moreText: "Add a look tag",
    help: "How the other people look, like dark-skinned male, faceless male or muscular male",
  },
}

export const SLOT_ORDER: readonly SlotId[] = ["who", "wearing", "doing", "where", "also", "style", "never", "others"]

/** A tag the autocomplete offers. */
export interface TagSuggestion {
  name: string
  /** Posts with this tag, when known. */
  count?: number
  /** A short word on what it is ("Character", "Clothing"). */
  kind?: string
}

/** Where tags come from while a field is being typed in. */
export type SuggestionStatus = "idle" | "loading" | "empty" | "error"

export interface CharacterInfo {
  /** Display name; defaults to the tag, title-cased, without its series in brackets. */
  name?: string
  /** The character's usual look (hair, eyes, body), as tags. */
  usualLook: readonly string[]
  /** Tags of the usual look the garments in Wearing replace: kept on the card, not in the prompts. */
  replacedLook?: readonly string[]
}

/**
 * The one name a character shows everywhere (Who, the summary):
 * "tifa lockhart" -> "Tifa Lockhart", "makima (chainsaw man)" -> "Makima".
 */
export function characterName(tag: string, info?: Pick<CharacterInfo, "name">): string {
  if (info?.name) return info.name
  const bare = tag.replace(/_/g, " ").replace(/\s*\([^)]*\)\s*$/, "").trim() || tag
  return bare.replace(/(^|[\s-])([a-z])/g, (_m, before: string, letter: string) => before + letter.toUpperCase())
}

/** A tag as the card shows it: spaces, not underscores. */
export const showTag = (tag: string) => tag.replace(/_/g, " ")

/** Splits typed or pasted text into tags. */
export function splitTyped(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * "With 1 boy", "With 2 girls", "With 1 girl and 1 boy", or "Alone": who else is in
 * the picture besides the characters on the card.
 */
export function companionsLabel(people: PackPeople, cast: PackPeople): string {
  const girls = Math.max(0, people.girls - cast.girls)
  const boys = Math.max(0, people.boys - cast.boys)
  const parts = [
    girls > 0 ? plural(girls, "girl", "girls") : null,
    boys > 0 ? plural(boys, "boy", "boys") : null,
  ].filter(Boolean)
  return parts.length === 0 ? "Alone" : `With ${parts.join(" and ")}`
}

/** The tags the card asks for in one slot, in the order they were added. Style is `literal`. */
export function slotTags(brief: PackBrief, slot: RequestRole | "style" | "others"): string[] {
  if (slot === "style") return [...brief.literal]
  if (slot === "others") return [...brief.others]
  return brief.requests.filter((r) => r.role === slot).map((r) => r.tag)
}

/**
 * The card in one line: "Tifa Lockhart · bikini · princess carry · with 1 boy".
 * `peopleLabel` is the chosen People option, if any; `characterInfo` is the same
 * record the card gets, so names match.
 */
export function briefSummaryParts(
  brief: PackBrief,
  peopleLabel?: string | null,
  characterInfo?: Readonly<Record<string, Pick<CharacterInfo, "name">>>,
): string[] {
  const names = brief.who.flatMap((c) => (c.tag ? [characterName(c.tag, characterInfo?.[c.tag])] : []))
  const parts = [
    ...names,
    ...slotTags(brief, "wearing"),
    ...slotTags(brief, "doing"),
    ...slotTags(brief, "where"),
    ...slotTags(brief, "also"),
    ...slotTags(brief, "style"),
  ].map(showTag)
  if (peopleLabel) parts.push(peopleLabel.charAt(0).toLowerCase() + peopleLabel.slice(1))
  parts.push(...brief.others.map(showTag))
  return parts
}
