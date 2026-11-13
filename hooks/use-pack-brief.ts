import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addCharacter, addLook, addNever, addTag, briefFromCard, briefFromPrompt, emptyBrief, leaveOutScene, removeCharacter, removeLook, removeNever,
  removeTag, restoreLook, restoreScene, setChanges, setCharacterRole, setPeople, toSceneRequests,
  type ChangesAxis, type PackBrief, type RequestRole, type SceneRequests,
} from '@/lib/pack/brief'
import {
  briefFromCharacters, commit, lastChange, seedNever, startHistory, undo as undoHistory,
  type BriefHistory,
} from '@/lib/pack/brief-history'
import { migratePackPreferences, sanitizePackPreferences } from '@/lib/pack/pack-config-migration'
import { normalizeTagForPack } from '@/lib/pack/pack-generator'
import type { CastRole } from '@/lib/pack/scene/cast'
import type { PackPeople } from '@/lib/pack/scene/scene-pool'
import { userPreferences, type PackPreferences } from '@/lib/storage'

/** What the interface shows next to "Undo" for each kind of change. */
export const BRIEF_LABELS = {
  add: (tag: string) => `Added ${tag}`,
  remove: (tag: string) => `Removed ${tag}`,
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

  /** Starts of a pack: they replace the whole brief, clear the history and seed "never" with the defaults. */
  startEmpty: () => void
  startFromCharacters: (names: string[]) => void
  startFromPrompt: (text: string) => { peopleTags: string[] }
  startFromCard: (tags: readonly string[]) => {
    offered: { outfit: string[]; pose: string[] }
    peopleTags: string[]
  }

  preferences: PackPreferences
  setPromptCount: (count: number) => void
  setIncludeSensitive: (value: boolean) => void
  addNeverDefault: (tag: string) => void
  removeNeverDefault: (tag: string) => void
}

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
 */
export function usePackBrief(overrides: Record<string, string>): UsePackBriefResult {
  const [preferences, setPreferencesState] = useState<PackPreferences>(readPreferences)
  const [history, setHistory] = useState<BriefHistory>(() => startHistory(seedNever(emptyBrief(), preferences.neverDefaults)))

  // Latest values for callbacks that must stay stable and still read the current state.
  const overridesRef = useRef(overrides)
  const historyRef = useRef(history)
  const preferencesRef = useRef(preferences)
  useEffect(() => { overridesRef.current = overrides }, [overrides])

  const setHistoryNow = useCallback((next: BriefHistory) => {
    historyRef.current = next
    setHistory(next)
  }, [])

  const change = useCallback((label: string, edit: (brief: PackBrief) => PackBrief) => {
    setHistoryNow(commit(historyRef.current, edit(historyRef.current.present), label))
  }, [setHistoryNow])

  const start = useCallback((brief: PackBrief) => {
    setHistoryNow(startHistory(seedNever(brief, preferencesRef.current.neverDefaults)))
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
    (axis: ChangesAxis) => change(BRIEF_LABELS.setChanges, (b) => setChanges(b, axis)),
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

  const startEmpty = useCallback(() => start(emptyBrief()), [start])
  const startFromCharacters = useCallback((names: string[]) => start(briefFromCharacters(names)), [start])
  const startFromPrompt = useCallback((text: string) => {
    const { brief, peopleTags } = briefFromPrompt(text, overridesRef.current)
    start(brief)
    return { peopleTags }
  }, [start])
  const startFromCard = useCallback((tags: readonly string[]) => {
    const { brief, offered, peopleTags } = briefFromCard(tags, overridesRef.current)
    start(brief)
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

  const brief = history.present
  const requests = useMemo(() => toSceneRequests(brief), [brief])

  return {
    brief, requests, canUndo: history.past.length > 0, lastChange: lastChange(history), undo,
    add, remove, never, unnever, removeCharacter: removeCharacterAction, setRole,
    addCharacter: addCharacterAction, addLook: addLookAction, removeLook: removeLookAction, restoreLook: restoreLookAction,
    setPeople: setPeopleAction, setChanges: setChangesAction,
    leaveOutScene: leaveOutSceneAction, restoreScene: restoreSceneAction,
    startEmpty, startFromCharacters, startFromPrompt, startFromCard,
    preferences, setPromptCount, setIncludeSensitive, addNeverDefault, removeNeverDefault,
  }
}
