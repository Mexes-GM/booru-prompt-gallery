/**
 * A recording view of the tag slots (the overrides: tag -> "category:subcategory"), for the scene
 * cache (scene-cache.ts): every slot read through it is noted with the answer it got, so a later
 * pool can tell whether the same reads still give the same answers with its own overrides.
 *
 * Code that reads the slots as a whole (statistics over every tag, cached per overrides object)
 * asks for the plain object with `wholeVocabulary`, which ties the reads to that very object; code
 * that derives one value from many slots and can work it out again (a family of tags) uses
 * `derivedRead`, which notes the value instead. Outside a recording view both just pass through.
 */

/** The slots one extraction read, and how to tell whether they still read the same. */
export class Reads {
  readonly raw: Record<string, string>
  readonly keys: string[] = []
  readonly values: Array<string | undefined> = []
  /** Read as a whole: only these very overrides give the same answers. */
  whole = false
  readonly derived: Array<{ value: unknown; recheck: (raw: Record<string, string>) => unknown; same: (a: unknown, b: unknown) => boolean }> = []

  constructor(raw: Record<string, string>) {
    this.raw = raw
  }

  /** True when every read gives the same answer with `overrides`. */
  holds(overrides: Record<string, string>): boolean {
    if (overrides === this.raw) return true
    if (this.whole) return false
    for (let i = 0; i < this.keys.length; i++) if (overrides[this.keys[i]] !== this.values[i]) return false
    for (const d of this.derived) if (!d.same(d.recheck(overrides), d.value)) return false
    return true
  }
}

const views = new WeakMap<object, Reads>()

/** `raw` seen through a view that notes every slot read into `reads`. */
export function recordingOverrides(raw: Record<string, string>, reads: Reads): Record<string, string> {
  const note = (key: string) => {
    reads.keys.push(key)
    reads.values.push(raw[key])
  }
  const view = new Proxy(raw, {
    get(target, key, receiver) {
      if (typeof key === 'string') note(key)
      return Reflect.get(target, key, receiver)
    },
    has(target, key) {
      if (typeof key === 'string') note(key)
      return Reflect.has(target, key)
    },
    ownKeys(target) {
      reads.whole = true
      return Reflect.ownKeys(target)
    },
    getOwnPropertyDescriptor(target, key) {
      reads.whole = true
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  views.set(view, reads)
  return view
}

/** The plain overrides, for reading them as a whole; a recording view notes that its reads depend on all of them. */
export function wholeVocabulary(overrides: Record<string, string>): Record<string, string> {
  const reads = views.get(overrides)
  if (!reads) return overrides
  reads.whole = true
  return reads.raw
}

/**
 * `compute` on the plain overrides; a recording view notes the value, to be worked out again with
 * later overrides and compared with `same`.
 */
export function derivedRead<T>(overrides: Record<string, string>, compute: (raw: Record<string, string>) => T, same: (a: T, b: T) => boolean): T {
  const reads = views.get(overrides)
  const value = compute(reads ? reads.raw : overrides)
  if (reads) reads.derived.push({ value, recheck: compute, same: same as (a: unknown, b: unknown) => boolean })
  return value
}
