/**
 * People in a scene: how gendered tags read, what only one gender has, and who
 * does what to whom. `attributeTraits` (scene.ts) decides who owns each trait;
 * this module holds the vocabulary it relies on and the wording of acts between
 * two people ("The man is performing oral sex on the woman"), which a shared
 * "They are performing oral sex on a woman" turns into a third person.
 */
import type { Scene, SceneCharacter } from "./scene"
import { capitalize, joinList, takesPluralVerb } from "./english"

export type Gender = "female" | "male" | "futa"

// "dark-skinned female", "muscular male", "dark-skinned futa": one adjective and
// who it describes. Longer tags ("futa with female") are pairings, not traits.
const GENDERED_TRAIT_RE = /^([a-z][a-z-]*) (female|male|futa|futanari)$/
// "clothed female nude male" (and the reverse): one state for each person.
const CLOTHED_PAIR_RE = /^(clothed|nude|naked) (female|male) (clothed|nude|naked) (female|male)$/
const GENDER_WORDS = new Set(["female", "male", "futa", "futanari", "solo", "only"])

/** The person and the adjective a gendered tag describes: "muscular male" -> male, "muscular". */
export function genderedTraits(tag: string): { gender: Gender; trait: string }[] {
  const pair = tag.match(CLOTHED_PAIR_RE)
  if (pair) return [{ gender: pair[2] as Gender, trait: pair[1] }, { gender: pair[4] as Gender, trait: pair[3] }]
  const m = tag.match(GENDERED_TRAIT_RE)
  if (!m || GENDER_WORDS.has(m[1])) return []
  return [{ gender: m[2] === "futanari" ? "futa" : (m[2] as Gender), trait: m[1] }]
}

export const FUTA_RE = /\bfuta(nari)?\b/
export const CROSSDRESSING_RE = /^(crossdressing|trap|otoko no ko|femboy|feminization|male in dress)$/

// For tags the gender profiles do not list (rare ones, other boorus' spellings):
// body parts and garments only one of them has. "penis on face" or "cum on
// breasts" relate two things, so they belong to no one in particular.
const FEMALE_BODY_RE = /\b(breasts?|boobs|tits|cleavage|underboob|sideboob|nipples?|areolae?|areola|pussy|vulva|vagina|labia|clitoris|clitoral hood|cameltoe|cleft of venus|lactation|pregnant|busty|voluptuous|curvaceous|wide hips)\b/
const MALE_BODY_RE = /\b(penis(es)?|cock|dick|erection|testicles|balls|scrotum|foreskin|precum|pectorals|beard|facial hair|mustache|stubble|bulge)\b/
const RELATION_RE = /\b(on|in|into|inside|between|against|under|over|from|to|through|around|with)\b/
const FEMALE_GARMENT_RE = /\b(bikini|bra|panties|lingerie|negligee|babydoll|nightgown|dress|sundress|skirt|miniskirt|microskirt|thighhighs|pantyhose|stockings|garter belt|garter straps|leotard|swimsuit|bodystocking|high heels|corset|bustier|camisole|chemise|playboy bunny|serafuku|pasties)\b/
const MALE_GARMENT_RE = /\b(male swimwear|swim trunks|swim briefs|boxers|boxer briefs|jockstrap|fundoshi|male underwear)\b/

/** The gender a body or garment tag implies by its words alone, or null. */
export function ruleGender(tag: string): "female" | "male" | null {
  if (RELATION_RE.test(tag)) return null
  if (MALE_GARMENT_RE.test(tag) || MALE_BODY_RE.test(tag)) return "male"
  if (FEMALE_BODY_RE.test(tag) || (FEMALE_GARMENT_RE.test(tag) && !/\bdress shirt\b/.test(tag))) return "female"
  return null
}

const NOUNS: Record<"female" | "male", { young: [string, string]; adult: [string, string] }> = {
  female: { young: ["girl", "girls"], adult: ["woman", "women"] },
  male: { young: ["boy", "boys"], adult: ["man", "men"] },
}

/**
 * "girl" / "boy" as booru counts write them, "woman" / "man" in questionable
 * and explicit posts, where "a girl and a boy" would read as minors.
 */
export function personNoun(scene: Pick<Scene, "rating">, gender: "female" | "male", plural: boolean): string {
  const nouns = NOUNS[gender][scene.rating === "q" || scene.rating === "e" ? "adult" : "young"]
  return nouns[plural ? 1 : 0]
}

/** A person or a group as a sentence subject: "the woman", "the women", "Kitagawa Marin", "one of the girls". */
export interface Role {
  label: string
  plural: boolean
  possessive: string
}

export function possessivePronoun(person: Pick<SceneCharacter, "gender" | "plural">): string {
  return person.plural ? "their" : person.gender === "male" ? "his" : person.gender === "female" ? "her" : "their"
}

export interface SceneRoles {
  /** The one person (or group) of this gender, as the owner or object of something. */
  owner(gender: Gender): Role | null
  /** Who a gendered adjective or an act describes: that person, or "one of the women" among several. */
  one(gender: Gender): Role | null
  mixed: boolean
  futa: boolean
}

/** Roles for a scene with several people (`scene.people`), or null for one person. */
export function sceneRoles(scene: Scene): SceneRoles | null {
  if (scene.girls + scene.boys + scene.others < 2 && scene.people.length < 2) return null
  const futa = scene.people.some((p) => p.futa)
  const mixed = scene.girls > 0 && scene.boys > 0
  const of = (g: Gender) => (g === "futa" ? scene.people.filter((p) => p.futa) : scene.people.filter((p) => p.gender === g))
  const count = (g: Gender) => (g === "male" ? scene.boys : scene.girls)
  const asRole = (p: SceneCharacter): Role => ({ label: p.name, plural: !!p.plural, possessive: possessivePronoun(p) })
  const owner = (g: Gender): Role | null => {
    const pool = of(g)
    return pool.length === 1 ? asRole(pool[0]) : null
  }
  const one = (g: Gender): Role | null => {
    const pool = of(g)
    if (pool.length === 1 && !pool[0].plural) return asRole(pool[0])
    if (g === "futa" || count(g) < 2) return null
    return { label: `one of the ${personNoun(scene, g, true)}`, plural: false, possessive: g === "female" ? "her" : "his" }
  }
  return { owner, one, mixed, futa }
}

const OBJECT_FEMALE = /\b(?:a|another) (?:woman|female|girl)\b/
const OBJECT_MALE = /\b(?:a|another) (?:man|male|boy)\b/
const OWN_FEMALE_RE = /\{pos\} (breasts?|chest|vulva|pussy|nipples|clitoris)\b/
const OWN_MALE_RE = /\{pos\} (penis|testicles|cock)\b/
const PENETRATION_RE = /^(female|male|futa) (penetrated|penetrating)(?: (female|male|futa))?$/
// "a man having vaginal intercourse with a woman": the act with its subject in it.
const NOUN_SUBJECT_RE = /^an? (man|woman) ([a-z]+ing\b.*)$/

/**
 * A sex act or contact as one person's action ("The man is performing oral sex
 * on the woman"), when the tag or its phrase says who does it. `text` is the
 * phrase with `{pos}` still in it. Null leaves the act to the shared sentence.
 */
export function roleAct(tag: string, text: string | undefined, roles: SceneRoles | null): { role: Role; text: string } | null {
  if (!roles) return null
  const pen = tag.match(PENETRATION_RE)
  let actor: Role | null = null
  let rest = text ?? ""
  if (pen) {
    actor = roles.one(pen[1] as Gender)
    const object = pen[3] ? objectLabel(pen[3] as Gender, roles, actor) : null
    rest = pen[2] === "penetrated" ? "being penetrated" : object ? `penetrating ${object}` : "penetrating a partner"
  } else if (text) {
    const subject = text.match(NOUN_SUBJECT_RE)
    if (subject) {
      actor = roles.one(subject[1] === "woman" ? "female" : "male")
      rest = subject[2]
    } else if (OWN_FEMALE_RE.test(text)) actor = roles.mixed ? roles.one("female") : null
    else if (OWN_MALE_RE.test(text)) actor = roles.mixed && !roles.futa ? roles.one("male") : null
    else if (OBJECT_FEMALE.test(text)) actor = roles.mixed ? roles.one("male") : roles.one("female")
    else if (OBJECT_MALE.test(text)) actor = roles.mixed ? roles.one("female") : roles.one("male")
    else if (/\ba penis\b/.test(text) && roles.mixed && !roles.futa) actor = roles.one("female")
  }
  if (!actor) return null
  const her = objectLabel("female", roles, actor)
  const him = objectLabel("male", roles, actor)
  rest = rest
    .replace(/\{pos\}/g, actor.possessive)
    .replace(new RegExp(OBJECT_FEMALE.source, "g"), her ?? "$&")
    .replace(new RegExp(OBJECT_MALE.source, "g"), him ?? "$&")
    .replace(/\ba penis\b/g, roles.mixed && !roles.futa && him && him !== "the other" ? `${possessiveOf(him)} penis` : "a penis")
  return { role: actor, text: rest }
}

/** "the woman" as the object of someone else's act, or "the other" between two people of one gender. */
function objectLabel(gender: Gender, roles: SceneRoles, actor: Role | null): string | null {
  const target = roles.owner(gender) ?? roles.one(gender)
  if (!target) return null
  return target.label === actor?.label || target.label.startsWith("one of") || target.plural ? "the other" : target.label
}

export function possessiveOf(label: string): string {
  return /s$/.test(label) ? `${label}'` : `${label}'s`
}

// Adjectives that cannot describe the same person: they are two of them.
const OPPOSITES: [string, string][] = [
  ["smaller", "bigger"], ["smaller", "larger"], ["shorter", "taller"], ["short", "tall"],
  ["dark-skinned", "pale-skinned"], ["dark-skinned", "light-skinned"], ["pale-skinned", "tan"],
  ["dominant", "submissive"], ["older", "younger"], ["clothed", "nude"], ["clothed", "naked"],
  ["chubby", "slim"], ["fat", "slim"], ["fat", "thin"], ["flat-chested", "busty"],
]
const opposed = (a: string, b: string) => OPPOSITES.some(([x, y]) => (a === x && b === y) || (a === y && b === x))

/** Groups adjectives into people: ["smaller", "dark-skinned", "bigger"] -> [["smaller", "dark-skinned"], ["bigger"]]. */
export function splitOpposites(adjectives: string[]): string[][] {
  const people: string[][] = []
  for (const adjective of adjectives) {
    const fits = people.find((p) => !p.some((a) => opposed(a, adjective)))
    if (fits) fits.push(adjective)
    else people.push([adjective])
  }
  return people
}

/** "One of them is smaller, and another is bigger." — or one clause when nothing is opposed. */
export function oneOfSentence(role: Role, adjectives: string[]): string {
  const people = splitOpposites(adjectives)
  if (!people.length) return ""
  const rest = people.slice(1).flat()
  return `${capitalize(role.label)} is ${joinList(people[0])}${rest.length ? `, and another is ${joinList(rest)}` : ""}.`
}

/** "The man's penis is visible." */
export function visibleSentence(label: string, parts: string[]): string {
  if (!parts.length) return ""
  const many = parts.length > 1 || takesPluralVerb(parts[0])
  return `${capitalize(possessiveOf(label))} ${joinList(parts)} ${many ? "are" : "is"} visible.`
}
