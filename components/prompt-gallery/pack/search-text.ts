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
 * Whose posts a search looks for: "Sui-Feng doing double penetration", "Sui-Feng alone",
 * "Anyone doing double penetration", "Anyone doing sitting, with 1 girl and 1 boy",
 * "Pictures with 2 girls", "Your gallery search". `character` is the name the card shows.
 */
export function searchDescription(
  search: Pick<SceneSearch, "kind" | "poses">,
  character: string | null,
  people: PackPeople | null
): string {
  const doing = search.poses.length > 0 ? ` doing ${listWords(search.poses)}` : ""
  const withPeople = people ? `, with ${peopleWords(people)}` : ""
  switch (search.kind) {
    case "own":
      return doing ? `${character ?? "The character"}${doing}` : `${character ?? "The character"} alone`
    case "group":
      return people ? `Pictures with ${peopleWords(people)}` : "Pictures with the same people"
    case "gallery":
      return "Your gallery search"
    case "theme":
    case "anchor":
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
  "Only what's in Doing decides which posts are searched. Wearing, Where and the rest are applied afterwards to the scenes found."

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

/** The posts a search has brought, and whether it has more: "95 posts, all there are", "240 posts". */
export const searchCount = (posts: number, ended: boolean): string =>
  `${plural(posts, "post", "posts")}${ended && posts > 0 ? ", all there are" : ""}`

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

/** The tags of a search as the site gets them: "sui-feng double_penetration". */
export const searchTagsText = (search: Pick<SceneSearch, "tags">) => search.tags.join(" ")
