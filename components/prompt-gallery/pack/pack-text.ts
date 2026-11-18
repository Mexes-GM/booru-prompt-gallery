/**
 * The words and small rules the pack's components share, kept apart from the
 * components so each component file exports only components.
 */
import type { ChangesAxis } from "@/lib/pack/brief"
import type { FitNote } from "@/lib/pack/brief-pack"
import type { PackPeople } from "@/lib/pack/scene/scene-pool"
import { companionsLabel } from "./slots"

// ── Generate ─────────────────────────────────────────────────────────────────────

export const MIN_PROMPTS = 1
export const MAX_PROMPTS = 100

/** "Generate 10 prompts"; while generating, "Generating… 4 of 10" (or "Generating…" before the first one). */
export function generateLabel(count: number, generating: boolean, done?: number) {
  if (generating) return done === undefined ? "Generating…" : `Generating… ${done} of ${count}`
  return `Generate ${count} ${count === 1 ? "prompt" : "prompts"}`
}

/** Why Generate can't run yet. */
export const BLOCKED = {
  noCharacter: "Pick a character first",
  roles: "Choose Girl or Boy for each character",
  waiting: "Waiting for scenes",
  noScenes: "No scenes to make prompts from. Try changing what they're doing.",
} as const

// ── The builder ──────────────────────────────────────────────────────────────────

export const BUILDER_TEXT = {
  title: "Pack",
  exit: "Exit Pack Mode",
  close: "Close pack",
  closeHint: "Close. Your pack stays here until you start a new one.",
  newPack: "New pack",
  newPackHint: "Start another pack from a card, a prompt or a character",
  cardOutfit: "Use this card's outfit",
  cardPose: "Poses like this card",
  ratingMenu: "Content rating",
  /** The site menu, worded as the gallery's own. */
  providerMenu: "Search posts from",
  providerNeedsConsent: "Choose it in the gallery first to confirm adult content",
  providerNoSensitive: "Safe only: no sensitive rating there",
  providerChanged: (site: string) => `Now searching ${site}`,
  /**
   * After the fit line: the posts the scenes come from, and the ones that only lend clothes or a
   * place (the donor searches'); `all` once the site has no more for these searches.
   */
  loadedFrom: (posts: number, site: string, all: boolean, lend = 0) => {
    const lending = lend > 0 ? `, plus ${lend} that only lend clothes or places` : ""
    return all
      ? `from all ${posts} matching ${posts === 1 ? "post" : "posts"} on ${site}${lending}`
      : `from ${posts} ${posts === 1 ? "post" : "posts"} on ${site}${lending} so far`
  },
  loadFailed: "Couldn't load the scenes. Check your connection and try again.",
  retry: "Try again",
  sheetHint: "Select a scene to leave it out",
  rerollFailed: "No other scene is left for this prompt.",
  findMore: "Find more scenes",
  howItSearches: "How it searches",
  generatingSpoken: "Making the prompts",
  busySource: "Generate again first: the pack was made with another site or rating",
  busyRunning: "Wait for the prompts to update",
  resultsLabel: "Prompts",
  convertFailed: "Couldn't load the prompt converter, so the prompts were copied as tags. Check your connection and try again.",
} as const

/** The contact sheet of a one-part pack: one scene repeats, the others lend it a part. */
export const SHEET_TEXT = {
  fixedBadge: "Repeats",
  changeFixed: "Select to choose another scene to repeat.",
  keepFixed: "Select to keep this one.",
  pickThis: "Repeat this scene in every prompt",
  picking: "Select the scene to repeat in every prompt.",
  helpFixed:
    "Use the arrow keys to move between scenes. The first scene repeats in every prompt; select it to choose another. Space on any other scene leaves its part out or puts it back.",
  hint: (axis: string) => `The first scene repeats; the others lend their ${axis}. Select one to leave it out`,
  outfitChanges: "Each prompt takes its outfit from another scene",
  fixedLocked: "Unlock the locked prompts to choose another scene to repeat",
} as const

/** What a correction from the results did, for the notice with Undo. */
export const CORRECTION_TEXT = {
  never: (tag: string, changed: number) =>
    changed === 0 ? `No prompt had ${tag}` : `Removed ${tag} from ${changed} ${changed === 1 ? "prompt" : "prompts"}`,
  always: (tag: string, changed: number) =>
    changed === 0 ? `${tag} was already in every prompt` : `Added ${tag} to ${changed} ${changed === 1 ? "prompt" : "prompts"}`,
  lockedKeep: (n: number) => `${n} locked ${n === 1 ? "prompt still has" : "prompts still have"} it`,
  /** Rows locked when the pack was made and unlocked since: a correction doesn't remake them. */
  olderKeep: (n: number) => `${n} earlier ${n === 1 ? "prompt still has" : "prompts still have"} it. Generate again to update ${n === 1 ? "it" : "them"}`,
  /** A look tag of a pack with several characters whose owner the prompt doesn't say. */
  lookWhose: (tag: string) => `${tag} belongs to one character. Add it under Who, next to that character.`,
  working: "Updating the prompts…",
} as const

/**
 * After Copy all, when what was copied isn't the whole, current pack: how many are
 * missing, and whether the brief changed after the prompts were made.
 */
export function copyNoteText({ missing, stale }: { missing: number; stale: boolean }): string | undefined {
  const parts = [
    missing > 0 ? `${missing} ${missing === 1 ? "prompt is" : "prompts are"} missing.` : null,
    stale ? "These were made before your last changes to the pack." : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" ") : undefined
}

/** The size option of Copy all, worded as the old builder's (pack-add-resolution). */
export const SIZE_TEXT = {
  option: "Add size as [WIDTHxHEIGHT]",
  optionDetail: "For the extension's Import List. Taken from the post each prompt's scene came from.",
  copyAll: "Copy all with size",
  menu: "Copy options",
  rowLabel: "Suggested size",
  unsized: (n: number) => `${n} ${n === 1 ? "prompt has" : "prompts have"} no size and ${n === 1 ? "was" : "were"} copied without one.`,
} as const

/** Under Wearing: what it does to the character's own clothes. */
export const WEARING_TEXT = {
  anyKind: "Each prompt gets its own kind of it, in place of the usual outfit",
  exact: "Replaces the usual outfit",
  styles: "Each prompt wears a different outfit from the library",
} as const

/** The outfit library's styles as Wearing offers them (not tags: a whole outfit of the style per prompt). */
export const STYLE_TEXT = {
  name: (style: string) => style.charAt(0).toUpperCase() + style.slice(1),
  count: (n: number) => `${n} ${n === 1 ? "outfit" : "outfits"}`,
  chip: (style: string) => `${style.charAt(0).toUpperCase() + style.slice(1)} outfits`,
  notAtRating: "Not used at the Safe rating",
  unused: (styles: readonly string[]) =>
    `${styles.map((s) => `${s.charAt(0).toUpperCase() + s.slice(1)} outfits`).join(" and ")} ${styles.length === 1 ? "isn't" : "aren't"} used at the Safe rating.`,
} as const

/** "4 prompts missing" beside the results, when the pack came out short. */
export const missingText = (missing: number) => `${missing} ${missing === 1 ? "prompt" : "prompts"} missing`

/** The empty brief's examples (lib/pack/brief-pack.ts BRIEF_EXAMPLES), as the user reads them. */
export const EXAMPLE_TEXT: Readonly<Record<string, { title: string; detail: string }>> = {
  "beach-day": { title: "A day at the beach", detail: "sundress · beach" },
  library: { title: "Sitting in a library", detail: "sitting · library" },
  school: { title: "At school", detail: "school uniform · classroom" },
  outfits: { title: "Same picture, new outfits", detail: "Only the outfit changes" },
}
export const EXAMPLES_HEADING = "Not sure where to start? Try one of these"

/** One-time tips, shown the first time each one is useful. */
export const TIP_TEXT = {
  sheet: "These are the scenes the pack will use. Select one to leave it out; select it again to put it back.",
  results: "Select a tag in a prompt to put it in every prompt (Always) or keep it out of all of them (Never).",
  axis: (axis: string) =>
    `One scene repeats in every prompt, marked Repeats. Only its ${axis} changes, taken from the other scenes. Select the marked scene to choose another.`,
  dismiss: "Dismiss tip",
} as const

/** Under Others when the make-up has no one besides the characters: the tags stay. */
export const OTHERS_UNUSED = "No one else is in the picture, so these aren't used."

/** What each way into a pack says it brought (shown until the first change). */
export const START_TEXT = {
  cardNamed: "From the card: who's in it.",
  cardUnnamed: "This card has no character tag, so Who has only its look.",
  cardOffers: "Its outfit and pose are offered under Wearing and Doing.",
  prompt: "Your prompt is split across the rows. Tags we don't recognize are under Style.",
  search: "Started from your search.",
  searchSkipped: (tags: readonly string[]) => `Search filters left out: ${tags.join(", ")}.`,
} as const

/** The pack's content ratings, as the rating menu names them. */
export const RATING_OPTIONS = [
  { value: "sfw", label: "Safe" },
  { value: "questionable", label: "Questionable" },
  { value: "explicit", label: "Explicit" },
  { value: "both", label: "Questionable and explicit" },
] as const

// ── Copy ─────────────────────────────────────────────────────────────────────────

export const COPY_FAILED = "Couldn't copy. Select the text and copy it yourself."

// ── Changes ──────────────────────────────────────────────────────────────────────

export const CHANGES_OPTIONS: ReadonlyArray<{ value: ChangesAxis; label: string; explain: string }> = [
  { value: "scene", label: "Whole scene", explain: "Each prompt comes from a different scene." },
  { value: "outfit", label: "Only the outfit", explain: "Same pose and place in every prompt; the outfit changes." },
  { value: "pose", label: "Only the pose", explain: "Same outfit and place in every prompt; the pose changes." },
  { value: "place", label: "Only the place", explain: "Same outfit and pose in every prompt; the place changes." },
  { value: "expression", label: "Only the expression", explain: "Everything stays the same except the expression." },
]

// ── People ───────────────────────────────────────────────────────────────────────

export const peopleKey = (p: PackPeople) => `${p.girls}g${p.boys}b`

/** Never and Style: the tags every new pack starts with (pack-preferences), set from a row on purpose. */
export const DEFAULTS_TEXT = {
  use: "Use in new packs",
  clear: "Start new packs empty",
  useHint: "New packs start with these tags in this row",
  markHint: "In new packs. Select to remove it from new packs",
  removeOne: (tag: string) => `Remove ${tag} from new packs`,
  saved: (row: string) => `New packs start with these in ${row}.`,
  cleared: (row: string) => `New packs start with ${row} empty.`,
  removed: (tag: string) => `${tag} removed from new packs.`,
} as const

/** A pairing or a focus typed in a row ("hetero"): who is in the picture sets it. */
export const COMPOSITION_TEXT = {
  setByPeople: (tag: string) => `${tag} is set by who's in the picture, under People.`,
} as const

/** People with several make-ups marked. */
export const PEOPLE_TEXT = {
  noRoom: "No room for the characters",
  lastOne: "A pack needs at least one",
  axis: "The scene that repeats sets who's in the picture",
} as const

/** The line under People when the requested pose needs company: "This pose needs 2 people". */
export const poseNeedsText = (people: number) => `This pose needs ${people} people`

// ── Wearing ──────────────────────────────────────────────────────────────────────

export type OutfitSource =
  | { kind: "scene" }
  | { kind: "usual" }
  | { kind: "official"; name: string }
  | { kind: "library" }

export const OUTFIT_KIND_LABEL = {
  scene: "Each scene's outfit",
  usual: "Usual outfit",
  library: "Outfit library",
} as const

export function outfitSourceLabel(source: OutfitSource): string {
  return source.kind === "official" ? source.name : OUTFIT_KIND_LABEL[source.kind]
}

/** The value after "Outfit:" on the menu button: "each scene's", "usual", "from the library", or the outfit's name. */
const OUTFIT_SHORT = { scene: "each scene's", usual: "usual", library: "from the library" } as const
export function outfitSourceValue(source: OutfitSource): string {
  return source.kind === "official" ? source.name : OUTFIT_SHORT[source.kind]
}

export const outfitKey = (s: OutfitSource) => (s.kind === "official" ? `official:${s.name}` : s.kind)

export function outfitFromKey(key: string): OutfitSource {
  if (key.startsWith("official:")) return { kind: "official", name: key.slice("official:".length) }
  return { kind: key as "scene" | "usual" | "library" }
}

// ── Fit line ─────────────────────────────────────────────────────────────────────

/**
 * One sentence of the fit line (lib/pack/brief-pack.ts's FitNote); the offer of
 * sensitive pictures carries what accepting it does.
 */
export type FitState =
  | Exclude<FitNote, { kind: "few-rated" | "paused" }>
  /** Few scenes at the safe content rating; the user can allow the next one. */
  | { kind: "few-rated"; onInclude: () => void }
  /** Fetching stopped at the pace limit; `waiting` while it cools down. */
  | { kind: "paused"; onLoadMore: () => void; waiting: boolean; nothingNew?: boolean }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function shortText(state: Extract<FitState, { kind: "short" }>): string {
  if (state.scenes === 0) return state.what ? `No scene has ${state.what}` : "No scenes found"
  const lead = `${state.made} of ${state.asked}`
  if (!state.what) return `${lead}: only ${plural(state.scenes, "scene")} found`
  return `${lead}: only ${plural(state.scenes, "scene")} ${state.scenes === 1 ? "has" : "have"} ${state.what}`
}

function fitSentence(state: FitState): string {
  switch (state.kind) {
    case "finding":
      return `Finding scenes… ${state.found} so far`
    case "fit":
      return `${plural(state.scenes, "scene")} ${state.scenes === 1 ? "fits" : "fit"}`
    case "few-rated":
      return "Few general-rated pictures. Include sensitive ones?"
    case "reuse":
      return `Only ${plural(state.scenes, "scene")}: ${plural(state.reused, "prompt")} ${state.done ? "reuse" : "will reuse"} a scene`
    case "similar":
      return `Also using: ${state.tag}`
    case "short":
      return shortText(state)
    case "imposed":
      return state.done
        ? `Added ${state.tag} to ${plural(state.prompts, "scene")} that didn't have it`
        : `${plural(state.prompts, "prompt")} will add ${state.tag} to a scene that doesn't have it`
    case "no-pose-here": {
      const who = companionsLabel(state.people, state.cast)
      const others = state.scenes > 0 ? `. ${plural(state.scenes, "scene")} with other people ${state.scenes === 1 ? "has" : "have"} it` : ""
      return `${who}: no scene has ${state.what}${others}`
    }
    case "needs-company":
      return `${state.tag} needs two people, but ${plural(state.prompts, "prompt")} ${state.prompts === 1 ? "shows" : "show"} one`
    case "dropped":
      return state.reason === "never"
        ? `Left out ${state.tag}: it's also under Never`
        : `Left out ${state.tag}: it doesn't match who's in the picture`
    case "stale":
      return "The pack changed. Generate again to update these prompts."
    case "people-missing": {
      const asked = companionsLabel(state.asked, state.cast)
      const instead = state.using ? ` Using “${companionsLabel(state.using, state.cast)}” instead.` : ""
      return `No scenes for “${asked}”.${instead}`
    }
    case "axis-fit":
      return `${plural(state.variations, state.axis)} ${state.variations === 1 ? "fits" : "fit"} this scene`
    case "finding-variants":
      return `Finding ${state.axis}s that fit this scene…`
    case "people-short-of-cast":
      return "The People option chosen has no room for all your characters. Choose another one."
    case "kept-on-axis": {
      const tags = state.tags.join(", ")
      return `${tags} ${state.tags.length === 1 ? "stays" : "stay"} in every prompt. The rest of the ${state.axis} changes.`
    }
    case "few-variations": {
      const what = state.kept?.length ? `${plural(state.variations, state.axis)} with ${state.kept.join(", ")}` : plural(state.variations, state.axis)
      return `${state.made} of ${state.asked}: only ${what} ${state.variations === 1 ? "fits" : "fit"} this scene`
    }
    case "waiting":
      return "Waiting a few seconds to keep searching"
    case "variety": {
      const kind = state.styles ? `${state.what} outfit` : state.what
      if (state.variants >= state.prompts) {
        return state.role === "where" ? `Each prompt is at a different ${kind}` : `Each prompt wears a different ${kind}`
      }
      return state.styles
        ? `${plural(state.variants, `${state.what} outfit`)} across ${plural(state.prompts, "prompt")}`
        : `${plural(state.variants, "kind")} of ${state.what} across ${plural(state.prompts, "prompt")}`
    }
    case "as-written":
      if (state.styles) return `${plural(state.prompts, "prompt")} ${state.prompts === 1 ? "has" : "have"} no ${state.what} outfit: the library has no other one`
      return state.partial
        ? `${plural(state.prompts, "prompt")} ${state.prompts === 1 ? "has" : "have"} only part of ${state.what} from another picture; the rest is as typed`
        : `${plural(state.prompts, "prompt")} ${state.prompts === 1 ? "has" : "have"} ${state.what} as typed: no other kind was found`
    case "condition-supply":
      if (state.styles) {
        return state.variants === 0
          ? `The library has no ${state.what} outfit for this pack`
          : `Only ${plural(state.variants, `${state.what} outfit`)} for ${plural(state.asked, "prompt")}`
      }
      return state.variants === 0
        ? `No loaded picture has ${state.what} yet, so it would go as typed`
        : `Only ${plural(state.variants, "kind")} of ${state.what} so far for ${plural(state.asked, "prompt")}`
    case "no-new":
      return state.exhausted ? "No new scenes found. There's nothing more to search." : "No new scenes found on that page."
    case "paused":
      if (state.nothingNew) {
        return state.waiting
          ? "No new scenes on that page. You can search again in a few seconds."
          : "No new scenes on that page. Search again for more."
      }
      return state.waiting
        ? "Paused to avoid too many requests. You can search again in a few seconds."
        : "Paused to avoid too many requests. Search again for more scenes."
  }
}

/** The visible sentence and the shorter one a screen reader hears. */
export function fitText(state: FitState): { text: string; spoken: string } {
  const text = fitSentence(state)
  return { text, spoken: state.kind === "finding" ? "Finding scenes" : state.kind === "finding-variants" ? "Finding variants" : text }
}

