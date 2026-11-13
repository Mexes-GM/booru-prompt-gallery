/**
 * A pack kept while the Pack Builder is closed or its base is being changed
 * (prompt-gallery.tsx): what the bar says about it, and whether a base picked
 * again is the one it already has.
 */
export function keptPackMessage(promptCount: number): string {
  if (promptCount <= 0) return 'Your pack is kept.'
  return `Your pack is kept, with ${promptCount} ${promptCount === 1 ? 'prompt' : 'prompts'}.`
}

/** What a pack is built on, as far as picking it again is concerned. */
export type PackBaseKey =
  | { kind: 'card'; id: number }
  | { kind: 'character'; names: readonly string[] }
  | { kind: 'prompt'; text: string }

const looseName = (name: string) => name.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ')
const looseText = (text: string) => text.trim().replace(/\s+/g, ' ')

/**
 * True when `next` is the base the current pack already has, so picking it reopens
 * the pack as it is (prompts, settings, characters) instead of starting over. The
 * same for both methods: a card by its post, characters by their names in order (the
 * first is the base), a prompt by its text. No current pack, no match.
 */
export function isSamePackBase(current: PackBaseKey | null, next: PackBaseKey): boolean {
  if (!current || current.kind !== next.kind) return false
  if (current.kind === 'card' && next.kind === 'card') return current.id === next.id
  if (current.kind === 'character' && next.kind === 'character') {
    return current.names.length === next.names.length && current.names.every((name, i) => looseName(name) === looseName(next.names[i]))
  }
  if (current.kind === 'prompt' && next.kind === 'prompt') return looseText(current.text) !== '' && looseText(current.text) === looseText(next.text)
  return false
}
