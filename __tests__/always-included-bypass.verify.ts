/**
 * Verification test: Tags in "Always Included" (lockedTags / customBaseText)
 * bypass cleaner rules (deduplication by inclusion, noun combining, and taxonomic reordering).
 *
 * Run with: npx tsx __tests__/always-included-bypass.verify.ts
 */
import { cleanSyntheticPrompt, type BulkSendCleanOptions } from "../lib/pack/bulk-send"
import { splitCommaSeparatedTags } from "../lib/utils/tag-utils"
import { normalizeTagForPack } from "../lib/pack/pack-generator"

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

const userBaseText =
  "spirit blossom syndra, thick thighs, curvy, wide hips, thick lips, glossy lips, syndra (league of legends), 1girl, hyper breasts, hyper, gigantic breasts, breasts, white hair, long hair, ponytail, blunt bangs, gradient hair, pink eyes, horns, blue horns, pointy ears, parted lips, makeup,jewelry, bead necklace, bead bracelet, earrings, hair ornament, hair stick"

const lockedTags = splitCommaSeparatedTags(userBaseText).map(normalizeTagForPack)

const sampledTags = [
  "competition school swimsuit",
  "shirt lift",
  "bowtie",
  "hair bow",
  "grey bikini",
  "jeans",
  "pajamas",
  "parted lips", // duplicate of tag in lockedTags
  "looking at viewer",
  "tongue out",
  "solo",
  "standing",
  "embarrassed",
  "white border",
  "snow leopard ears",
  "gradient background",
  "blue sky",
  "ceiling",
]

const cleanOptions: BulkSendCleanOptions = {
  excludeInput: "snow_leopard_ears",
  addInput: "score_7, masterpiece, best quality",
  includeCharacters: true,
  optimizeTags: true,
  lockedTags,
}

// ── 1) Locked tags bypass cleaner rules ──
{
  const promptTags = [...lockedTags, ...sampledTags]
  const prompt = cleanSyntheticPrompt(promptTags, [], cleanOptions, lockedTags)

  // 1. Quality / Added tags are at the very beginning
  assert(prompt.startsWith("score_7, masterpiece, best quality"), "Prompt starts with added quality tags")

  // 2. 'spirit blossom syndra' is preserved and appears before scenery / backgrounds
  assert(prompt.includes("spirit blossom syndra"), "'spirit blossom syndra' is present in prompt")
  const syndraIdx = prompt.indexOf("spirit blossom syndra")
  const ceilingIdx = prompt.indexOf("ceiling")
  assert(syndraIdx < ceilingIdx, "'spirit blossom syndra' appears BEFORE scenery ('ceiling'), not at the end")

  // 3. 'horns', 'breasts', 'hyper' are NOT stripped by removeRedundantByInclusion
  const resultTags = prompt.split(", ").map((t) => t.trim())
  assert(resultTags.includes("horns"), "'horns' is preserved (not stripped by 'blue horns')")
  assert(resultTags.includes("blue horns"), "'blue horns' is preserved")
  assert(resultTags.includes("breasts"), "'breasts' is preserved (not stripped by 'gigantic breasts')")
  assert(resultTags.includes("hyper"), "'hyper' is preserved (not stripped by 'hyper breasts')")

  // 4. 'white hair', 'long hair', 'gradient hair' are NOT collapsed by combineSharedNounTags
  assert(resultTags.includes("white hair"), "'white hair' is preserved")
  assert(resultTags.includes("long hair"), "'long hair' is preserved")
  assert(resultTags.includes("gradient hair"), "'gradient hair' is preserved")
  assert(!resultTags.includes("white long gradient hair"), "'white long gradient hair' is not created")

  // 5. Sampled tags are cleaned: 'snow leopard ears' was in excludeInput and is stripped
  assert(!resultTags.includes("snow leopard ears"), "Sampled tag matching excludeInput ('snow leopard ears') is removed")

  // 6. Duplicate tag 'parted lips' appears only once
  const partedLipsCount = resultTags.filter((t) => t === "parted lips").length
  assert(partedLipsCount === 1, "'parted lips' appears exactly once (deduped between locked and sampled)")

  // 7. Scenery tags from sampled tags appear at the end
  assert(resultTags.includes("blue sky") && resultTags.includes("ceiling"), "Scenery tags appear in output")

  console.log("\n--- PROMPT GENERADO (PREVIEW) ---")
  console.log(prompt)
}

// ── 2) Character tags stripping when includeCharacters: false ──
{
  const withoutCharOpts: BulkSendCleanOptions = {
    ...cleanOptions,
    includeCharacters: false,
  }
  const prompt = cleanSyntheticPrompt(
    ["1girl", "mona (genshin impact)", "standing"],
    ["mona (genshin impact)"],
    withoutCharOpts,
    ["1girl", "mona (genshin impact)"]
  )
  assert(!prompt.includes("mona"), "includeCharacters: false still strips character tag even if locked")
  assert(prompt.includes("1girl"), "Non-character locked tags are retained")
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
