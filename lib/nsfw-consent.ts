// Pure, dependency-free decision logic for the NSFW consent friction layers.
//
// Two protections live here (see the 2026-07 NSFW audit):
//   - Capa 2: the first time a user turns the Safe/NSFW toggle ON (Safe → NSFW),
//     ask for an explicit confirmation. Once acknowledged, the toggle is instant
//     from then on. Turning it back OFF (NSFW → Safe) never needs confirmation.
//   - Capa 3: the first time a user selects the Rule34 provider (which serves
//     exclusively adult content and cannot be rating-filtered), ask for an
//     explicit confirmation. Once acknowledged, switching to Rule34 is instant.
//
// Extracted as a pure module so the decisions can be unit-tested without React —
// see __tests__/nsfw-consent.verify.ts. The components (search-bar.tsx,
// gallery-toolbar.tsx) own the AlertDialog UI and the persisted acknowledgment
// flags; this module only answers "should we confirm?" and "what's the next value?".

/** Canonical rating value meaning "safe / SFW only" (Danbooru vocabulary). */
export const SAFE_RATING = 'rating:general'

/** Canonical rating value meaning "no rating filter — show everything". */
export const ALL_RATING = 'all'

/** The provider that is adult-only and cannot be rating-filtered. */
export const ADULT_ONLY_PROVIDER = 'rule34'

/**
 * Whether flipping the Safe/NSFW toggle from its current value needs a
 * confirmation dialog first.
 *
 * Only true when the user is about to ENABLE NSFW (current value is the safe
 * rating) AND they have not previously acknowledged it. Disabling NSFW
 * (going back to safe) is always allowed without friction.
 */
export function shouldConfirmNsfwEnable(currentRating: string, acknowledged: boolean): boolean {
  const goingToNsfw = currentRating === SAFE_RATING
  return goingToNsfw && !acknowledged
}

/**
 * The rating value produced by toggling the Safe/NSFW button from its current
 * value: safe → all, anything else → safe.
 */
export function nextRatingFilter(currentRating: string): string {
  return currentRating === SAFE_RATING ? ALL_RATING : SAFE_RATING
}

/**
 * Whether selecting a given provider needs the adult-content confirmation
 * dialog first. Only true for the adult-only provider when it has not been
 * acknowledged yet.
 */
export function shouldConfirmProvider(provider: string, acknowledged: boolean): boolean {
  return provider === ADULT_ONLY_PROVIDER && !acknowledged
}
