/**
 * Random known characters, one per prompt (PackBrief.randomCast): Who names nobody, and each prompt
 * gets a different character of a known series, drawn from the most posted ones or from one series,
 * of the gender the pack's people leave room for. Up to one per prompt: a 50-prompt pack can have 50
 * characters.
 *
 * The draw comes from the character index (lib/pack/cast-picker.ts): every character in it has a
 * trait profile, so each one is drawn from it with no request (source-plan.ts asks for no look
 * search in a pack of random characters), and none is an original character, a player's stand-in
 * or a character the data marks as young.
 *
 * The engine works from castBrief: the brief with the drawn characters in Who, one per prompt, as a
 * cast picked by hand would be. Everything downstream (cast-turns.ts, the saved pack) is the same.
 *
 * Pure: no React, no requests.
 */
import type { BooruProvider } from '../booru/types'
import { briefCompositions, type CastMember, type PackBrief, type RandomCast } from './brief'
import { castCandidates, castMembers, drawCast, type CastGender, type CastSource, type CharacterIndex } from './cast-picker'
import { normalizeTagForPack } from './pack-generator'

/** The most characters a draw gives: the most prompts a pack has. */
export const MAX_RANDOM_CAST = 100

/**
 * The gender 'auto' means: the one every make-up of People has room for, girls first (a pack
 * without People has a girl). "With 1 boy" and "With 2 boys" both have a girl: the character is the
 * girl and the boys are the others. Make-ups of only boys: boys. A girl in some and none in others: any.
 */
export function randomCastGender(gender: RandomCast['gender'], brief: Pick<PackBrief, 'people' | 'peopleMix'>): CastGender {
  if (gender !== 'auto') return gender
  const makeUps = briefCompositions(brief)
  if (makeUps.length === 0 || makeUps.every((p) => p.girls >= 1)) return 'girls'
  if (makeUps.every((p) => p.boys >= 1)) return 'boys'
  return 'any'
}

export interface DrawArgs {
  source: CastSource
  gender: CastGender
  /** How many characters the pack needs (its prompts). */
  count: number
  seed: number
  provider: BooruProvider
  /** Characters that stay (the locked rows'): first, and never drawn again. */
  keep?: readonly CastMember[]
}

/**
 * A draw of `count` characters for a pack of random characters: `keep` first, then others at random
 * from the top of the candidates (cast-picker.ts drawCast, the same for the same seed), as the
 * pack's site names them. Fewer when the source has fewer.
 */
export function drawRandomCast(index: Pick<CharacterIndex, 'characters'>, args: DrawArgs): CastMember[] {
  const keep = (args.keep ?? []).map((m) => ({ ...m }))
  const want = Math.max(0, Math.min(MAX_RANDOM_CAST, Math.floor(args.count)) - keep.length)
  const candidates = castCandidates(index, { source: args.source, gender: args.gender, exclude: keep.map((m) => m.tag) })
  return [...keep, ...castMembers(drawCast(candidates, want, 'random', args.seed), args.provider)]
}

/** Sets random characters on the brief (a new draw), or takes them off with null. */
export function setRandomCast(brief: PackBrief, randomCast: RandomCast | null): PackBrief {
  const next: PackBrief = { ...brief }
  if (randomCast) next.randomCast = { ...randomCast, drawn: randomCast.drawn.map((m) => ({ ...m })) }
  else delete next.randomCast
  return next
}

/** True when the brief draws its characters: random characters set and nobody named in Who. */
export const drawsCast = (brief: Pick<PackBrief, 'who' | 'randomCast'>): boolean =>
  !!brief.randomCast && !brief.who.some((c) => c.tag !== null)

/**
 * The brief the engine works from: with random characters, Who holds the drawn ones (each with
 * their gender), one per prompt; the unnamed character's look edits are kept on each. Any other
 * brief as it is.
 */
export function castBrief(brief: PackBrief): PackBrief {
  if (!drawsCast(brief)) return brief
  const drawn = brief.randomCast!.drawn
  if (drawn.length === 0) return brief
  const unnamed = brief.who[0]
  const seen = new Set<string>()
  const who = drawn.flatMap((m) => {
    const tag = normalizeTagForPack(m.tag)
    if (!tag || seen.has(tag)) return []
    seen.add(tag)
    return [{ tag, ...(m.role ? { role: m.role } : {}), addedLook: [...(unnamed?.addedLook ?? [])], removedLook: [...(unnamed?.removedLook ?? [])] }]
  })
  return { ...brief, who, ...(who.length >= 2 ? { castMode: 'turns' as const } : {}) }
}

/** The characters a pack of random characters needs to draw again for `slots` new rows: none while the draw has room. */
export function needsRedraw(brief: Pick<PackBrief, 'who' | 'randomCast'>, needed: number, generatedBefore: boolean): boolean {
  if (!drawsCast(brief)) return false
  return generatedBefore || brief.randomCast!.drawn.length < needed
}

/**
 * True when a new draw is worth using: it names at least one character beyond the kept ones. A draw
 * with nobody new (the series or gender has no candidates left) would leave Who unnamed, so the
 * pack keeps the draw it has instead.
 */
export const redrawUsable = (drawn: ReadonlyArray<unknown>, keep: ReadonlyArray<unknown>): boolean =>
  drawn.length > 0 && drawn.length > keep.length

/** A draw as a key: the characters' names in order, to tell when the engine has a draw's characters. */
export const drawKey = (members: ReadonlyArray<Pick<CastMember, 'tag'>>): string =>
  members.map((m) => normalizeTagForPack(m.tag)).filter(Boolean).join('|')
