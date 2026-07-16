/**
 * Regression tests for the "Prepend Artist (@artist)" feature (lib/cleanPrompt.ts).
 *
 * Context: Anima Pencil-XL (and related Anima checkpoints) ships with a large
 * repertoire of learned artist styles invokable via "@artistname" syntax. This
 * option lets users prepend the CARD'S OWN artist (its first tag_string_artist
 * tag) as "@artist," at the very start of the generated prompt — per card, so
 * each card's artist matches the artist that actually drew that specific post.
 * Disableable; only meaningful for Anima checkpoints (other checkpoints just
 * see a literal, harmless "@artist" token).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/prepend-anima-artist.verify.ts
 */
import { cleanPrompt } from "../lib/cleanPrompt"

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

const BASE_OPTS = { optimizeTags: true, includeCharacters: true, includeCopyrights: true, escapeOutput: false }

// ── 1) Feature off (default): no "@artist" prefix, artist tag stays excluded from prompt (existing behavior) ──
{
  const out = cleanPrompt("1girl, solo, long hair", "wlop", "", "", { ...BASE_OPTS })
  assert(!out.startsWith("@"), "off: prompt does not start with @artist when option is not set")
  assert(!out.includes("wlop"), "off: artist tag is not leaked into the prompt body")
}

// ── 2) Feature on: prepends "@artist," at the very start ──
{
  const out = cleanPrompt("1girl, solo, long hair", "wlop", "", "", { ...BASE_OPTS, prependArtistTag: "wlop" })
  assert(out.startsWith("@wlop,"), `on: prompt starts with "@wlop," (got: "${out.slice(0, 20)}")`)
}

// ── 3) Multi-word artist name (spaces preserved, no escaping/normalization applied to the artist prefix) ──
{
  const out = cleanPrompt("1girl, solo", "", "", "", { ...BASE_OPTS, prependArtistTag: "sakimichan" })
  assert(out.startsWith("@sakimichan,"), "multi-char artist name prepended verbatim")
}

// ── 4) No artist tag resolved (e.g. Aibooru AI post with no booru artist) → no-op, prompt unchanged ──
{
  const withOpt = cleanPrompt("1girl, solo", "", "", "", { ...BASE_OPTS, prependArtistTag: undefined })
  const without = cleanPrompt("1girl, solo", "", "", "", { ...BASE_OPTS })
  assert(withOpt === without, "undefined prependArtistTag is a no-op identical to not passing the option")
  assert(!withOpt.startsWith("@"), "no artist resolved -> prompt does not start with @")
}

// ── 5) Empty-string artist tag (e.g. blank after trim) is also a no-op ──
{
  const out = cleanPrompt("1girl, solo", "", "", "", { ...BASE_OPTS, prependArtistTag: "" })
  assert(!out.startsWith("@"), "empty-string prependArtistTag does not add an empty '@,' prefix")
}

// ── 6) Rest of the prompt pipeline (tag cleaning/ordering) is unaffected by the prefix ──
{
  const out = cleanPrompt(
    "1girl, solo, hair, long hair, white hair",
    "wlop",
    "hatsune miku",
    "vocaloid",
    { ...BASE_OPTS, prependArtistTag: "wlop" },
  )
  const rest = out.replace(/^@wlop,\s*/, "")
  assert(rest.includes("long white hair"), "smart tag combination still runs after the artist prefix")
  assert(rest.includes("hatsune miku"), "character tags still included after the artist prefix")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
