import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addCharacter, addLook, addNever, addOther, addTag, addTagExactly, setRequestExact, toggleComposition, addOutfitStyle, removeOutfitStyle, briefFromCard, chooseChanges, leaveOutVariant, restoreVariant, setBaseScene, briefFromPrompt, emptyBrief, leaveOutScene, removeCharacter, removeLook, removeNever,
  removeTag, restoreLook, restoreScene, setCharacterRole, setPeople, settleStart, toSceneRequests,
  type ChangesAxis, type PackBrief, type RequestRole, type SceneRequests,
} from '@/lib/pack/brief'
import {
  briefFromCharacters, commit, lastChange, seedDefaults, startHistory, undo as undoHistory,
  rowDefaults, withRowDefaults, withoutRowDefault, type DefaultRow,
  type BriefHistory,
} from '@/lib/pack/brief-history'
import { migratePackPreferences, sanitizePackPreferences } from '@/lib/pack/pack-config-migration'
import { normalizeTagForPack } from '@/lib/pack/pack-generator'
import type { CastRole } from '@/lib/pack/scene/cast'
import type { Permanence } from '@/lib/pack/scene/permanence'
import type { PackPeople } from '@/lib/pack/scene/scene-pool'
import { userPreferences, type PackPreferences } from '@/lib/storage'

/** What the interface shows next to "Undo" for each kind of change. */
export const BRIEF_LABELS = {
  add: (tag: string) => `Added ${tag}`,
  remove: (tag: string) => `Removed ${tag}`,
  exact: (tag: string) => `${tag}: exactly this`,
  anyForm: (tag: string) => `${tag}: any kind`,
  never: (tag: string) => `Never: ${tag}`,
  unnever: (tag: string) => `Allowed ${tag} again`,
  removeCharacter: (name: string) => `Removed ${name}`,
  addCharacter: (name: string) => `Added ${name}`,
  addLook: (tag: string) => `Added ${tag}`,
  removeLook: (tag: string) => `Removed ${tag}`,
  restoreLook: (tag: string) => `Put ${tag} back`,
  setRole: (name: string) => `Changed ${name}'s role`,
  setPeople: "Changed who's in the picture",
  setChanges: 'Changed what varies',
  leaveOutScene: 'Left a scene out',
  setBaseScene: 'Changed the scene that repeats',
  restoreScene: 'Put a scene back',
}

export interface UsePackBriefResult {
  brief: PackBrief
  requests: SceneRequests
  canUndo: boolean
  lastChange: string | null
  /** Reverts the last change and returns its label, or null when there is nothing to undo. */
  undo: () => string | null

  add: (tag: string, into?: RequestRole) => void
  /** Adds a tag to how the people who are not the characters look. */
  addOther: (tag: string) => void
  /** Adds a tag; a garment or place it adds is exact (the same tag in every prompt). */
  addExactly: (tag: string, into?: RequestRole) => void
  /** Wearing and Where: this exact tag in every prompt, or any form of it (the default). */
  setExact: (tag: string, exact: boolean) => void
  /** People: marks or unmarks a make-up to mix (`current`: the one the pack uses while none is set). */
  toggleComposition: (option: PackPeople, current: PackPeople | null) => void
  /** Wearing: a style of the outfit library (every prompt wears a whole outfit of one). */
  addStyle: (style: string, label: string) => void
  removeStyle: (style: string, label: string) => void
  /** Replaces the brief with one made from it (an example picked), as one change. */
  changeTo: (next: PackBrief, label: string) => void
  /** Adds several tags as one change (one Undo). */
  addTags: (tags: readonly string[], into?: RequestRole) => void
  remove: (tag: string) => void
  never: (tag: string) => void
  unnever: (tag: string) => void
  removeCharacter: (tag: string) => void
  /** Adds a character by name; the name needn't be in the overrides yet. */
  addCharacter: (name: string) => void
  /** `character` null picks the unnamed character. */
  addLook: (character: string | null, tag: string) => void
  removeLook: (character: string | null, tag: string) => void
  restoreLook: (character: string | null, tag: string) => void
  /** `tag` null picks the unnamed character; `role` undefined clears the role. */
  setRole: (tag: string | null, role: CastRole | undefined) => void
  setPeople: (people: PackPeople | null) => void
  setChanges: (axis: ChangesAxis) => void
  leaveOutScene: (id: string) => void
  restoreScene: (id: string) => void
  /** One-part packs: the scene that repeats, and the variants left out. */
  setBaseScene: (postId: number | undefined) => void
  leaveOutVariant: (id: string) => void
  restoreVariant: (id: string) => void

  /** Starts of a pack: they replace the whole brief, clear the history and seed "never" with the defaults. */
  startEmpty: () => void
  startFromCharacters: (names: string[]) => void
  startFromPrompt: (text: string) => { peopleTags: string[] }
  /** Starts from a brief built elsewhere (a gallery search). */
  startWith: (brief: PackBrief) => void
  startFromCard: (tags: readonly string[]) => {
    offered: { outfit: string[]; pose: string[] }
    peopleTags: string[]
  }
  /**
   * The permanence data, once loaded (and whenever it changes). A start made before it arrived is
   * placed again with it, once: the tags the user hasn't moved go where the data says
   * (settleStart), with no Undo entry. Later starts read it.
   */
  placeWith: (permanence: (tag: string) => Permanence) => void

  preferences: PackPreferences
  setPromptCount: (count: number) => void
  setIncludeSensitive: (value: boolean) => void
  addNeverDefault: (tag: string) => void
  removeNeverDefault: (tag: string) => void
  /**
   * A row's defaults (Never, Style): what every new pack starts with. Setting them is explicit and
   * never part of the brief's history. Returns the defaults they replaced, for an Undo of its own.
   */
  rowDefaults: (row: DefaultRow) => string[]
  setRowDefaults: (row: DefaultRow, tags: readonly string[]) => string[]
  removeRowDefault: (row: DefaultRow, tag: string) => string[]
}

/** A start made before the permanence data loaded: the brief it made, and how the same start makes it with the data. */
type Unsettled = { brief: PackBrief; remake: (permanence: (tag: string) => Permanence) => PackBrief }

function readPreferences(): PackPreferences {
  if (typeof window === 'undefined') return migratePackPreferences(null, null)
  try {
    return migratePackPreferences(userPreferences.getPackPreferences(), userPreferences.getPackModeConfigV2())
  } catch {
    return migratePackPreferences(null, null)
  }
}

/**
 * The state of a pack's brief: the brief itself with an undo history, and the few
 * preferences that outlive a pack. Every edit applies at once and can be undone; a
 * pack start replaces the brief. The logic lives in lib/pack/brief.ts,
 * brief-history.ts and pack-config-migration.ts; this hook is the React and storage glue.
 * `overrides` is read at the moment of each action, so its growth doesn't change the
 * identity of the actions.
 * `options.remake` makes `initial` again with the permanence data (the same start): `initial`
 * may have been made before the data loaded, and placeWith places it again with it.
 */
export function usePackBrief(
  overrides: Record<string, string>,
  initial?: PackBrief,
  options?: { seeded?: boolean; remake?: (permanence: (tag: string) => Permanence) => PackBrief }
): UsePackBriefResult {
  const [preferences, setPreferencesState] = useState<PackPreferences>(readPreferences)
  // A pack can start with its brief already made (an entry), so nothing is written while rendering.
  // A pack kept across a reload comes back as it was: its defaults were seeded when it started.
  const [history, setHistory] = useState<BriefHistory>(() => startHistory(
    options?.seeded && initial ? initial : seedDefaults(initial ?? emptyBrief(), preferences)
  ))

  // Latest values for callbacks that must stay stable and still read the current state.
  const overridesRef = useRef(overrides)
  const historyRef = useRef(history)
  const preferencesRef = useRef(preferences)
  useEffect(() => { overridesRef.current = overrides }, [overrides])
  // The permanence data once placeWith has given it, and the start still to place with it:
  // the brief the start made, and how the same start makes it with the data.
  const permanenceRef = useRef<((tag: string) => Permanence) | null>(null)
  const unsettledRef = useRef<Unsettled | null>(
    initial && options?.remake && !options.seeded ? { brief: initial, remake: options.remake } : null
  )

  const setHistoryNow = useCallback((next: BriefHistory) => {
    historyRef.current = next
    setHistory(next)
  }, [])

  const placeWith = useCallback((permanence: (tag: string) => Permanence) => {
    permanenceRef.current = permanence
    const unsettled = unsettledRef.current
    if (!unsettled) return
    unsettledRef.current = null
    const settled = unsettled.remake(permanence)
    const current = historyRef.current
    // The briefs Undo goes back to too, so it never brings the old placing back.
    const place = (brief: PackBrief) => settleStart(unsettled.brief, settled, brief)
    const present = place(current.present)
    const past = current.past.map((c) => {
      const brief = place(c.brief)
      return brief === c.brief ? c : { ...c, brief }
    })
    if (present !== current.present || past.some((c, i) => c !== current.past[i])) setHistoryNow({ present, past })
  }, [setHistoryNow])

  const change = useCallback((label: string, edit: (brief: PackBrief) => PackBrief) => {
    setHistoryNow(commit(historyRef.current, edit(historyRef.current.present), label))
  }, [setHistoryNow])

  /** `remake`: how the start makes `brief` with the permanence data, for a start made before it loaded. */
  const start = useCallback((brief: PackBrief, remake?: Unsettled['remake']) => {
    unsettledRef.current = remake && !permanenceRef.current ? { brief, remake } : null
    // The defaults as saved now: the classic builder may have changed Never since.
    const fresh = readPreferences()
    preferencesRef.current = fresh
    setPreferencesState(fresh)
    setHistoryNow(startHistory(seedDefaults(brief, fresh)))
  }, [setHistoryNow])

  const undo = useCallback((): string | null => {
    const result = undoHistory(historyRef.current)
    if (result.undone !== null) setHistoryNow(result.history)
    return result.undone
  }, [setHistoryNow])

  const updatePreferences = useCallback((next: PackPreferences) => {
    const clean = sanitizePackPreferences(next)
    preferencesRef.current = clean
    setPreferencesState(clean)
    try { userPreferences.setPackPreferences(clean) } catch { /* storage unavailable: the choice lasts this session */ }
  }, [])

  const add = useCallback((tag: string, into?: RequestRole) => {
    change(BRIEF_LABELS.add(tag.trim()), (b) => addTag(b, tag, overridesRef.current, into))
  }, [change])
  const addExactly = useCallback((tag: string, into?: RequestRole) => {
    change(BRIEF_LABELS.add(tag.trim()), (b) => addTagExactly(b, tag, overridesRef.current, into))
  }, [change])
  const setExact = useCallback((tag: string, exact: boolean) => {
    change(exact ? BRIEF_LABELS.exact(tag) : BRIEF_LABELS.anyForm(tag), (b) => setRequestExact(b, tag, exact))
  }, [change])
  const toggleCompositionAction = useCallback((option: PackPeople, current: PackPeople | null) => {
    change(BRIEF_LABELS.setPeople, (b) => toggleComposition(b, option, current))
  }, [change])
  const addStyle = useCallback((style: string, label: string) => {
    change(BRIEF_LABELS.add(label), (b) => addOutfitStyle(b, style))
  }, [change])
  const removeStyle = useCallback((style: string, label: string) => {
    change(BRIEF_LABELS.remove(label), (b) => removeOutfitStyle(b, style))
  }, [change])
  const addOtherAction = useCallback((tag: string) => {
    change(BRIEF_LABELS.add(tag.trim()), (b) => addOther(b, tag))
  }, [change])
  const addTags = useCallback((tags: readonly string[], into?: RequestRole) => {
    const names = tags.map((t) => t.trim()).filter(Boolean)
    if (names.length === 0) return
    change(BRIEF_LABELS.add(names.join(', ')), (b) => names.reduce((next, tag) => addTag(next, tag, overridesRef.current, into), b))
  }, [change])
  const changeTo = useCallback((next: PackBrief, label: string) => change(label, () => next), [change])
  const remove = useCallback((tag: string) => change(BRIEF_LABELS.remove(tag), (b) => removeTag(b, tag)), [change])
  const never = useCallback((tag: string) => change(BRIEF_LABELS.never(tag), (b) => addNever(b, tag)), [change])
  const unnever = useCallback((tag: string) => change(BRIEF_LABELS.unnever(tag), (b) => removeNever(b, tag)), [change])
  const removeCharacterAction = useCallback(
    (tag: string) => change(BRIEF_LABELS.removeCharacter(tag), (b) => removeCharacter(b, tag)),
    [change]
  )
  const addCharacterAction = useCallback(
    (name: string) => change(BRIEF_LABELS.addCharacter(name.trim()), (b) => addCharacter(b, name)),
    [change]
  )
  const addLookAction = useCallback(
    (character: string | null, tag: string) => change(BRIEF_LABELS.addLook(tag.trim()), (b) => addLook(b, character, tag)),
    [change]
  )
  const removeLookAction = useCallback(
    (character: string | null, tag: string) => change(BRIEF_LABELS.removeLook(tag), (b) => removeLook(b, character, tag)),
    [change]
  )
  const restoreLookAction = useCallback(
    (character: string | null, tag: string) => change(BRIEF_LABELS.restoreLook(tag), (b) => restoreLook(b, character, tag)),
    [change]
  )
  const setRole = useCallback(
    (tag: string | null, role: CastRole | undefined) =>
      change(BRIEF_LABELS.setRole(tag ?? 'the character'), (b) => setCharacterRole(b, tag, role)),
    [change]
  )
  const setPeopleAction = useCallback(
    (people: PackPeople | null) => change(BRIEF_LABELS.setPeople, (b) => setPeople(b, people)),
    [change]
  )
  const setChangesAction = useCallback(
    (axis: ChangesAxis) => change(BRIEF_LABELS.setChanges, (b) => chooseChanges(b, axis)),
    [change]
  )
  const leaveOutSceneAction = useCallback(
    (id: string) => change(BRIEF_LABELS.leaveOutScene, (b) => leaveOutScene(b, id)),
    [change]
  )
  const restoreSceneAction = useCallback(
    (id: string) => change(BRIEF_LABELS.restoreScene, (b) => restoreScene(b, id)),
    [change]
  )

  const setBaseSceneAction = useCallback(
    (postId: number | undefined) => change(BRIEF_LABELS.setBaseScene, (b) => setBaseScene(b, postId)),
    [change]
  )
  const leaveOutVariantAction = useCallback(
    (id: string) => change(BRIEF_LABELS.leaveOutScene, (b) => leaveOutVariant(b, id)),
    [change]
  )
  const restoreVariantAction = useCallback(
    (id: string) => change(BRIEF_LABELS.restoreScene, (b) => restoreVariant(b, id)),
    [change]
  )
  const startEmpty = useCallback(() => start(emptyBrief()), [start])
  const startWith = useCallback((brief: PackBrief) => start(brief), [start])
  const startFromCharacters = useCallback((names: string[]) => start(briefFromCharacters(names)), [start])
  const startFromPrompt = useCallback((text: string) => {
    const overrides = overridesRef.current
    const { brief, peopleTags } = briefFromPrompt(text, overrides, permanenceRef.current ?? undefined)
    start(brief, (permanence) => briefFromPrompt(text, overrides, permanence).brief)
    return { peopleTags }
  }, [start])
  const startFromCard = useCallback((tags: readonly string[]) => {
    const overrides = overridesRef.current
    const { brief, offered, peopleTags } = briefFromCard(tags, overrides, permanenceRef.current ?? undefined)
    start(brief, (permanence) => briefFromCard(tags, overrides, permanence).brief)
    return { offered, peopleTags }
  }, [start])

  const setPromptCount = useCallback(
    (count: number) => updatePreferences({ ...preferencesRef.current, promptCount: count }),
    [updatePreferences]
  )
  const setIncludeSensitive = useCallback(
    (value: boolean) => updatePreferences({ ...preferencesRef.current, includeSensitive: value }),
    [updatePreferences]
  )
  const addNeverDefault = useCallback(
    (tag: string) => updatePreferences({
      ...preferencesRef.current,
      neverDefaults: [...preferencesRef.current.neverDefaults, tag],
    }),
    [updatePreferences]
  )
  const removeNeverDefault = useCallback(
    (tag: string) => {
      const name = normalizeTagForPack(tag)
      updatePreferences({
        ...preferencesRef.current,
        neverDefaults: preferencesRef.current.neverDefaults.filter((t) => normalizeTagForPack(t) !== name),
      })
    },
    [updatePreferences]
  )

  const getRowDefaults = useCallback((row: DefaultRow) => rowDefaults(preferencesRef.current, row), [])
  const setRowDefaults = useCallback((row: DefaultRow, tags: readonly string[]) => {
    const before = rowDefaults(preferencesRef.current, row)
    updatePreferences(withRowDefaults(preferencesRef.current, row, tags))
    return before
  }, [updatePreferences])
  const removeRowDefault = useCallback((row: DefaultRow, tag: string) => {
    const before = rowDefaults(preferencesRef.current, row)
    updatePreferences(withoutRowDefault(preferencesRef.current, row, tag))
    return before
  }, [updatePreferences])

  const brief = history.present
  const requests = useMemo(() => toSceneRequests(brief), [brief])

  return {
    brief, requests, canUndo: history.past.length > 0, lastChange: lastChange(history), undo,
    add, addOther: addOtherAction, addExactly, setExact, addStyle, removeStyle, toggleComposition: toggleCompositionAction, addTags, changeTo, remove, never, unnever, removeCharacter: removeCharacterAction, setRole,
    addCharacter: addCharacterAction, addLook: addLookAction, removeLook: removeLookAction, restoreLook: restoreLookAction,
    setPeople: setPeopleAction, setChanges: setChangesAction,
    leaveOutScene: leaveOutSceneAction, restoreScene: restoreSceneAction,
    setBaseScene: setBaseSceneAction, leaveOutVariant: leaveOutVariantAction, restoreVariant: restoreVariantAction,
    startEmpty, startWith, startFromCharacters, startFromPrompt, startFromCard, placeWith,
    preferences, setPromptCount, setIncludeSensitive, addNeverDefault, removeNeverDefault,
    rowDefaults: getRowDefaults, setRowDefaults, removeRowDefault,
  }
}
