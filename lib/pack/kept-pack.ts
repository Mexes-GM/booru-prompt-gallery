/**
 * The bar shown while the Pack Builder is closed with a pack kept aside
 * (prompt-gallery.tsx): what it says about that pack.
 */
export function keptPackMessage(promptCount: number): string {
  if (promptCount <= 0) return 'Your pack is kept.'
  return `Your pack is kept, with ${promptCount} ${promptCount === 1 ? 'prompt' : 'prompts'}.`
}
