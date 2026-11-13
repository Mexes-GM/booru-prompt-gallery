/**
 * The words and small rules the pack's components share, kept apart from the
 * components so each component file exports only components.
 */
import type { ChangesAxis } from "@/lib/pack/brief"
import type { PackPeople } from "@/lib/pack/scene/scene-pool"

// ── Generate ─────────────────────────────────────────────────────────────────────

export const MIN_PROMPTS = 1
export const MAX_PROMPTS = 100

/** "Generate 10 prompts"; while generating, "Generating… 4 of 10" (or "Generating…" before the first one). */
export function generateLabel(count: number, generating: boolean, done?: number) {
  if (generating) return done === undefined ? "Generating…" : `Generating… ${done} of ${count}`
  return `Generate ${count} ${count === 1 ? "prompt" : "prompts"}`
}

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

export type FitState =
  | { kind: "finding"; found: number }
  | { kind: "fit"; scenes: number }
  /** Few scenes at the safe content rating; the user can allow the next one. */
  | { kind: "few-rated"; onInclude: () => void }
  | { kind: "reuse"; scenes: number; reused: number }
  /** A close pose stands in for the requested one. */
  | { kind: "similar"; tag: string }
  | { kind: "short"; made: number; asked: number; scenes: number; what: string }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The visible sentence and the shorter one a screen reader hears. */
export function fitText(state: FitState): { text: string; spoken: string } {
  switch (state.kind) {
    case "finding":
      return { text: `Finding scenes… ${state.found} so far`, spoken: "Finding scenes" }
    case "fit": {
      const text = `${plural(state.scenes, "scene")} fit`
      return { text, spoken: text }
    }
    case "few-rated": {
      const text = "Few general-rated pictures. Include sensitive ones?"
      return { text, spoken: text }
    }
    case "reuse": {
      const text = `Only ${plural(state.scenes, "scene")}: ${plural(state.reused, "prompt")} will reuse a scene`
      return { text, spoken: text }
    }
    case "similar": {
      const text = `Also using: ${state.tag}`
      return { text, spoken: text }
    }
    case "short": {
      const text = `${state.made} of ${state.asked}: only ${plural(state.scenes, "scene")} ${state.scenes === 1 ? "has" : "have"} ${state.what}`
      return { text, spoken: text }
    }
  }
}

