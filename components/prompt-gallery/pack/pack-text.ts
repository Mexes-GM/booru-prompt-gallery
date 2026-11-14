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
  loadFailed: "Couldn't load the scenes. Check your connection and try again.",
  retry: "Try again",
  sheetHint: "Select a scene to leave it out",
  rerollFailed: "No other scene is left for this prompt.",
  findMore: "Find more scenes",
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
} as const

/** What a correction from the results did, for the notice with Undo. */
export const CORRECTION_TEXT = {
  never: (tag: string, changed: number) =>
    changed === 0 ? `No prompt had ${tag}` : `Removed ${tag} from ${changed} ${changed === 1 ? "prompt" : "prompts"}`,
  always: (tag: string, changed: number) =>
    changed === 0 ? `${tag} was already in every prompt` : `Added ${tag} to ${changed} ${changed === 1 ? "prompt" : "prompts"}`,
  lockedKeep: (n: number) => `${n} locked ${n === 1 ? "prompt still has" : "prompts still have"} it`,
  working: "Updating the prompts…",
} as const

/** "4 prompts missing" beside the results, when the pack came out short. */
export const missingText = (missing: number) => `${missing} ${missing === 1 ? "prompt" : "prompts"} missing`

/** What each way into a pack says it brought (shown until the first change). */
export const START_TEXT = {
  cardNamed: "From the card: who's in it.",
  cardUnnamed: "This card has no character tag, so Who has only its look.",
  cardOffers: "Its outfit and pose are offered under Wearing and Doing.",
  prompt: "Your prompt is split across the rows. Tags we don't recognize are under Also.",
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
  | { kind: "paused"; onLoadMore: () => void; waiting: boolean }

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
    case "few-variations":
      return `${state.made} of ${state.asked}: only ${plural(state.variations, state.axis)} ${state.variations === 1 ? "fits" : "fit"} this scene`
    case "no-new":
      return state.exhausted ? "No new scenes found. There's nothing more to search." : "No new scenes found on that page."
    case "paused":
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

