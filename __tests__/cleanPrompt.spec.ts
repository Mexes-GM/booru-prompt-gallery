import { cleanPrompt } from "../lib/cleanPrompt"

// Tiny assertion helper to avoid pulling a test runner
function expectEqual(actual: unknown, expected: unknown, label?: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    console.error("Assertion failed", { label, actual, expected })
    process.exitCode = 1
  }
}

// 1) Removes meta like web address and patreon logo
{
  const input = "1girl, black long hair, patreon logo, web address, black dress"
  const out = cleanPrompt(input, "", "", "")
  // Ensure meta removed, others preserved (order may change due to sorting length)
  expectEqual(out.includes("patreon logo"), false, "remove patreon logo")
  expectEqual(out.includes("web address"), false, "remove web address")
  expectEqual(out.includes("1girl"), true, "keep 1girl")
  expectEqual(out.includes("black long hair"), true, "keep hair")
}

// 2) Optimization off should not combine adjectives
{
  const input = "white skirt, long skirt"
  const out = cleanPrompt(input, "", "", "", { optimizeTags: false })
  expectEqual(out.includes("white long skirt"), false, "no combined skirt when opt off")
}

// 3) Optimization on combines adjectives for same noun
{
  const input = "white skirt, long skirt"
  const out = cleanPrompt(input, "", "", "", { optimizeTags: true })
  expectEqual(out.includes("white long skirt"), true, "combined skirt when opt on")
}

// 4) Characters/copyright toggles
{
  const chars = "sakura_kinomoto"
  const copy = "cardcaptor_sakura"
  const out = cleanPrompt("1girl, magic", "", chars, copy, { includeCharacters: false, includeCopyrights: true })
  expectEqual(out.includes("sakura kinomoto"), false, "character removed when disabled")
  expectEqual(out.includes("cardcaptor sakura"), true, "copyright kept")
}

// 5) Exclusions by user list
{
  const out = cleanPrompt("1girl, blue eyes, long hair", "", "", "", { exclude: ["blue eyes"] })
  expectEqual(out.includes("blue eyes"), false, "user exclusion honored")
}

// 6) Breast hierarchy keeps only the most specific
{
  const out = cleanPrompt("small breasts, large breasts, 1girl", "", "", "")
  expectEqual(out.includes("large breasts"), true, "keeps most specific")
  expectEqual(out.includes("small breasts"), false, "removes less specific")
}

console.log("cleanPrompt basic checks complete")
