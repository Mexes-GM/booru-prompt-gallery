/**
 * What the pack searches, in plain words: one line per search of the source plan
 * (whose posts it looks for), the ratings, the tags a site's limit left out, and a
 * search that found nothing. Pure, so the wording is tested.
 */
import type { SceneSearch, SourcePlan } from "@/lib/pack/source-plan"
import type { PackPeople } from "@/lib/pack/scene/scene-pool"
import { showTag } from "./slots"

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "2 girls and 1 boy". */
export function peopleWords(people: PackPeople): string {
  const parts = [
    people.girls > 0 ? plural(people.girls, "girl", "girls") : null,
    people.boys > 0 ? plural(people.boys, "boy", "boys") : null,
  ].filter(Boolean)
  return parts.join(" and ")
}

const listWords = (tags: readonly string[]) =>
  tags.length <= 1 ? tags.map(showTag).join("") : `${tags.slice(0, -1).map(showTag).join(", ")} and ${showTag(tags[tags.length - 1])}`

/**
 * Whose posts a search looks for: "Sui-Feng doing double penetration", "Sui-Feng alone" (their own
 * search with "solo"), "Sui-Feng, alone or with others" (by name only), "Anyone doing double
 * penetration", "Anyone doing sitting, with 1 girl and 1 boy", "Pictures with 2 girls", "Your
 * gallery search". `character` is the name the card shows.
 */
export function searchDescription(
  search: Pick<SceneSearch, "kind" | "poses"> & { tags?: readonly string[]; people?: PackPeople; concept?: SceneSearch["concept"]; everyone?: true },
  character: string | null,
  planPeople: PackPeople | null
): string {
  // A mixed pack's composition search says its own composition.
  const people = search.people ?? planPeople
  const doing = search.poses.length > 0 ? ` doing ${listWords(search.poses)}` : ""
  const withPeople = people ? `, with ${peopleWords(people)}` : ""
  switch (search.kind) {
    case "own":
      if (doing) return `${character ?? "The character"}${doing}`
      return search.tags?.includes("solo") ? `${character ?? "The character"} alone` : `${character ?? "The character"}, alone or with others`
    case "group":
      return people ? `Pictures with ${peopleWords(people)}` : "Pictures with the same people"
    case "gallery":
      return "Your gallery search"
    case "theme":
    case "anchor":
      // One character per prompt with clothes or a place asked for: the search is of them.
      if (!doing && search.concept) return `${donorDescription(search.concept.role, search.concept.tags)}${withPeople}`
      // One per prompt with many characters: the one search all their scenes come from.
      if (!doing && search.everyone) return search.tags?.includes("solo") ? "Anyone alone, for every character" : `Anyone${withPeople}, for every character`
      return `Anyone${doing}${withPeople}`
  }
}

const RATING_WORDS: Record<string, string> = {
  "rating:general": "Safe",
  "rating:sensitive": "Sensitive",
  "rating:questionable": "Questionable",
  "rating:explicit": "Explicit",
}

/** "Each search runs for Safe and Sensitive pictures." */
export function ratingsSentence(ratings: readonly string[]): string {
  const words = ratings.map((r) => RATING_WORDS[r] ?? r.replace(/^rating:/, ""))
  return `Each search runs for ${words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0]} pictures.`
}

/** The rule behind the searches, said once under them. */
export const SEARCH_RULE =
  "What's in Doing decides which scenes are searched. Clothes and places set to Any get searches of their own that only lend them; the rest is applied to the scenes found."

/** A search that ran out without a single post; the character's own search says the name may be spelled another way. */
export function noPostsSentence(kind: SceneSearch["kind"], site: string): string {
  return kind === "own"
    ? `No posts on ${site} for this search. The site may spell the character's name differently.`
    : `No posts on ${site} for these tags.`
}

/** "double penetration and anal didn't fit: Danbooru searches at most 2 tags at a time." */
export function leftOutSentence(leftOut: SourcePlan["leftOut"], site: string, limit: number): string | null {
  if (leftOut.length === 0) return null
  const tags = listWords(leftOut.map((l) => l.tag))
  return `${tags} didn't fit in the searches: ${site} searches at most ${plural(limit, "tag", "tags")} at a time.`
}

/**
 * The posts a search adds to the pack, and whether it has more: "95 posts, all there are",
 * "240 posts", "12 new of 95 posts" (the rest were already in a search above). The first numbers
 * of the rows add up to the loaded line's. `earlier`: posts of the search a search the pack had
 * before a change loaded, counted in and said: "240 posts (95 found earlier)".
 */
export const searchCount = (adds: number, posts: number, ended: boolean, earlier: number = 0): string => {
  const count = posts > adds ? `${adds} new of ${plural(posts, "post", "posts")}` : plural(adds, "post", "posts")
  return `${count}${earlier > 0 ? ` (${earlier} found earlier)` : ""}${ended && posts > 0 ? ", all there are" : ""}`
}

/** A donor search in plain words: "Anyone wearing bikini", "Any picture at a beach". */
export function donorDescription(kind: "wearing" | "where", conditions: readonly string[]): string {
  if (kind === "wearing") return `Anyone wearing ${listWords(conditions)}`
  const first = showTag(conditions[0] ?? "")
  return `Any picture at ${/^[aeiou]/i.test(first) ? "an" : "a"} ${listWords(conditions)}`
}

/** What a donor search's posts are for. */
export const DONOR_ROLE: Record<"wearing" | "where", string> = {
  wearing: "Only lends clothes to the scenes found.",
  where: "Only lends a place to the scenes found.",
}

/**
 * Where a character's look comes from, said under the scene searches: "Tifa Lockhart's look: from
 * their own pictures". Scenes may come from anyone; hair, eyes and body come from the character's
 * own posts.
 */
export const lookDescription = (character: string) => `${character}'s look: from their own pictures`

/**
 * The characters whose look comes from the app's own data on them, with no search (a pack of one
 * per prompt with many characters): "Looks of Ningguang and Beidou: from what the app already knows
 * about them, no search needed".
 */
export const profileLookDescription = (characters: readonly string[]) =>
  `${characters.length === 1 ? `${characters[0]}'s look` : `Looks of ${listNames(characters)}`}: from what the app already knows about them, no search needed`

const listNames = (names: readonly string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

/** The tags of a search as the site gets them: "sui-feng double_penetration". */
export const searchTagsText = (search: Pick<SceneSearch, "tags">) => search.tags.join(" ")
