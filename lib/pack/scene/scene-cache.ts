/**
 * Scene cache: the work a scene pool does for each post, kept from one pool to the next.
 *
 * A pack's pool is built again each time a page of posts arrives and each time the tag slots of
 * new tags arrive (the overrides grow). Almost all of that build is per post: reading its tags
 * into buckets and extracting its scene. But a post's scene is not a function of the post alone:
 * it also reads the slots of its tags (and of their word endings), the permanence of its tags,
 * what the booru says a tag is, and things only the whole pool knows (how many posts carry a tag,
 * whether a tag is the source's theme or looks like a name, which words are places).
 *
 * So the cache records, while it extracts a post, everything the extraction read: each slot it
 * looked up (found or not) through a recording view of the overrides, each call to the context's
 * functions with its answer, and for the pool's counts only what the extraction compared them
 * with (enough posts to vouch for a tag, enough to be the theme). A later pool reuses the scene
 * only when every one of those reads gives the same answer in its own context; otherwise the post
 * is extracted again. The result is the same as extracting every post again, by construction.
 *
 * Reads of the whole vocabulary (statistics over every slot, as franchise.ts counts words) tie the
 * entry to that overrides object; a value worked out from many slots that can be worked out again
 * (people.ts: the tags that share a noun) is noted as that value (vocabulary.ts).
 */
import type { BooruPost } from '../../booru/types'
import type { TagCategory } from '../../tag-taxonomy'
import { classifyPostForPack } from '../pack-generator'
import { extractScene, MIN_LOOSE_SUPPORT, THEME_SHARE, type Scene, type SceneContext } from './scene'
import { Reads, recordingOverrides } from './vocabulary'

/** What one extraction (or classification) read, and the answers it got. */
interface Recorded {
  reads: Reads
  /** Calls to the context's functions: which, the argument, the answer. */
  calls: Array<[CallKind, string, unknown]>
}

type CallKind = 'permanence' | 'tagKind' | 'looksLikeName' | 'place' | 'support' | 'sources' | 'share'

interface Entry {
  /** The post's own fields, as one string: a post with the same id and other tags is another post. */
  fingerprint: string
  classified?: { value: Record<TagCategory, string[]>; recorded: Recorded }
  scene?: { value: Scene | null; recorded: Recorded; key: string }
  /** Last pool build that used the entry. */
  used: number
}

export interface ScenePoolCache {
  /** classifyPostForPack(post, overrides), from the cache when nothing it read has changed. */
  classify(post: BooruPost, overrides: Record<string, string>): Record<TagCategory, string[]>
  /** extractScene(post, ctx), from the cache when nothing it read has changed (a copy: the pool may annotate it). */
  extract(post: BooruPost, ctx: SceneContext): Scene | null
  /** Marks the start of a pool build; entries no build used for a while are dropped. */
  startBuild(posts: number): void
  /** Hits and misses since the cache was made (for measuring). */
  readonly stats: { classifyHits: number; classifyMisses: number; sceneHits: number; sceneMisses: number }
}

const fingerprintOf = (post: BooruPost): string =>
  [post.tag_string, post.tag_string_character, post.tag_string_copyright, post.tag_string_artist, post.tag_string_meta, post.rating,
    post.width, post.height, post.preview_file_url, (post as { _invented?: unknown })._invented ? 1 : 0].join('\u0001')

/** The context fields an extraction reads as a whole: which gender, the cast, the site, which functions exist. */
const staticKey = (ctx: SceneContext): string =>
  JSON.stringify([ctx.subject, ctx.cast ?? null, ctx.provider ?? null,
    !!ctx.poolSupport, !!ctx.poolSources, !!ctx.poolShare, !!ctx.tagKind, !!ctx.looksLikeName, !!ctx.poolPlace])

/**
 * The context `ctx` seen through recorders. extractScene compares the pool's counts only with
 * MIN_LOOSE_SUPPORT (support and spread) and THEME_SHARE (share), so those comparisons are what
 * is recorded: a tag that went from 3 posts to 4 leaves its scene as it was.
 */
function recordingContext(ctx: SceneContext, recorded: Recorded): SceneContext {
  const call = <T>(kind: CallKind, arg: string, value: T): T => {
    recorded.calls.push([kind, arg, value])
    return value
  }
  const out: SceneContext = {
    ...ctx,
    overrides: recordingOverrides(ctx.overrides, recorded.reads),
    permanence: (tag) => call('permanence', tag, ctx.permanence(tag)),
  }
  if (ctx.tagKind) out.tagKind = (tag) => call('tagKind', tag, ctx.tagKind!(tag))
  if (ctx.looksLikeName) out.looksLikeName = (tag) => call('looksLikeName', tag, ctx.looksLikeName!(tag))
  if (ctx.poolSupport) out.poolSupport = (tag) => { const n = ctx.poolSupport!(tag); recorded.calls.push(['support', tag, n >= MIN_LOOSE_SUPPORT]); return n }
  if (ctx.poolSources) out.poolSources = (tag) => { const n = ctx.poolSources!(tag); recorded.calls.push(['sources', tag, n >= MIN_LOOSE_SUPPORT]); return n }
  if (ctx.poolShare) out.poolShare = (tag) => { const n = ctx.poolShare!(tag); recorded.calls.push(['share', tag, n >= THEME_SHARE]); return n }
  if (ctx.poolPlace) {
    const place = ctx.poolPlace
    out.poolPlace = { has: (noun: string) => call('place', noun, place.has(noun)) } as ReadonlySet<string>
  }
  return out
}

/** Whether every read recorded under another context gives the same answer under `ctx`. */
function stillHolds(recorded: Recorded, overrides: Record<string, string>, ctx?: SceneContext): boolean {
  if (!recorded.reads.holds(overrides)) return false
  if (!ctx) return recorded.calls.length === 0
  for (const [kind, arg, value] of recorded.calls) {
    switch (kind) {
      case 'permanence': if (ctx.permanence(arg) !== value) return false; break
      case 'tagKind': if (ctx.tagKind?.(arg) !== value) return false; break
      case 'looksLikeName': if (ctx.looksLikeName?.(arg) !== value) return false; break
      case 'place': if ((ctx.poolPlace?.has(arg) ?? false) !== value) return false; break
      case 'support': if ((ctx.poolSupport!(arg) >= MIN_LOOSE_SUPPORT) !== value) return false; break
      case 'sources': if ((ctx.poolSources!(arg) >= MIN_LOOSE_SUPPORT) !== value) return false; break
      case 'share': if ((ctx.poolShare!(arg) >= THEME_SHARE) !== value) return false; break
    }
  }
  return true
}

/** A copy of a scene a pool can annotate (typicality) without touching the one another pool holds. */
function copyScene(scene: Scene): Scene {
  const units = { ...scene.units }
  for (const unit of Object.keys(units) as Array<keyof Scene['units']>) units[unit] = [...units[unit]]
  return { ...scene, people: scene.people ? { ...scene.people } : null, pairing: [...scene.pairing], units, anchors: [...scene.anchors] }
}

/** Builds that may pass without using an entry before it is dropped (the base pool and the composition's pool are two builds). */
const KEEP_BUILDS = 4

export function createScenePoolCache(): ScenePoolCache {
  const entries = new Map<number, Entry>()
  let build = 0
  const stats = { classifyHits: 0, classifyMisses: 0, sceneHits: 0, sceneMisses: 0 }

  const entryOf = (post: BooruPost): Entry => {
    const fingerprint = fingerprintOf(post)
    let entry = entries.get(post.id)
    if (!entry || entry.fingerprint !== fingerprint) {
      entry = { fingerprint, used: build }
      entries.set(post.id, entry)
    }
    entry.used = build
    return entry
  }

  return {
    stats,
    startBuild(posts: number) {
      build++
      if (entries.size <= 2 * posts) return
      entries.forEach((entry, id) => { if (build - entry.used > KEEP_BUILDS) entries.delete(id) })
    },
    classify(post, overrides) {
      const entry = entryOf(post)
      if (entry.classified && stillHolds(entry.classified.recorded, overrides)) {
        stats.classifyHits++
        return entry.classified.value
      }
      stats.classifyMisses++
      const recorded: Recorded = { reads: new Reads(overrides), calls: [] }
      const value = classifyPostForPack(post, recordingOverrides(overrides, recorded.reads))
      entry.classified = { value, recorded }
      return value
    },
    extract(post, ctx) {
      const entry = entryOf(post)
      const key = staticKey(ctx)
      const cached = entry.scene
      if (cached && cached.key === key && stillHolds(cached.recorded, ctx.overrides, ctx)) {
        stats.sceneHits++
        return cached.value ? copyScene(cached.value) : null
      }
      stats.sceneMisses++
      const recorded: Recorded = { reads: new Reads(ctx.overrides), calls: [] }
      const value = extractScene(post, recordingContext(ctx, recorded))
      entry.scene = { value, recorded, key }
      return value ? copyScene(value) : null
    },
  }
}
