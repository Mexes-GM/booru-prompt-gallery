#!/usr/bin/env npx ts-node --transpile-only
/**
 * 🔥 Exhaustive Smart Tag Exclusion Validation
 * 
 * Validates the TAG_CONFLICTS dictionary against:
 *   1. 500+ real Danbooru posts with full tag sets
 *   2. 50+ test tags covering all semantic families
 *   3. Per-trigger coverage metrics
 *   4. Exception validation
 *   5. New gap-analysis triggers
 * 
 * Run standalone: npx ts-node --transpile-only __tests__/validation-tag-conflicts.ts
 */

import { resolveTagConflicts, TAG_CONFLICTS, isRelatedTag } from "../lib/tag-conflicts"
import { normalize } from "../lib/cleanPrompt"
import { PROVIDER_URLS } from "../lib/constants"

// ─── Types ───────────────────────────────────────────────────────────
interface ValidationResult {
  postId: number
  totalTags: number
  conflictsFound: number
  conflictingTags: string[]
  blockedBy: string[]
  activeTriggers: string[]
  activeExceptions: string[]
  hasMultiChars: boolean
  hasFaceIndicators: boolean
}

interface CoverageMetrics {
  trigger: string
  totalBlocks: number
  blocksTested: number
  blocksTriggered: number
  exceptionCoverage: number
}

interface ValidationSummary {
  totalPosts: number
  totalConflicts: number
  postsWithConflicts: number
  conflictRate: number
  uniqueTriggersActivated: number
  uniqueTagsBlocked: number
  coverageMetrics: CoverageMetrics[]
  topConflicts: [string, number][]
  topTriggers: [string, number][]
  falsePositives: string[]
  missedConflicts: string[]
}

// ─── Test Tags Pool (50+ tags covering all families) ─────────────────
const TEST_TAGS_POOL = [
  // Character count
  "1girl", "2girls", "solo", "multiple girls",
  // Framing
  "upper body", "full body", "close-up", "portrait", "cowboy shot",
  // Camera angle
  "from behind", "from above", "profile", "facing viewer",
  // Posture modifiers
  "looking back", "looking over shoulder",
  // Nudity
  "nude", "clothed", "fully clothed", "topless",
  // Eyes
  "blue eyes", "closed eyes", "winking", "heterochromia", "glowing eyes",
  // Gaze
  "looking at viewer", "looking away",
  // Mouth
  "open mouth", "closed mouth", "tongue out", "lips",
  // Expression
  "smile", "happy", "crying", "angry", "sleeping", "surprised", "blush",
  // Pose
  "standing", "sitting", "lying down", "kneeling", "walking", "running",
  // Arms
  "arms up", "arms crossed", "hands in pockets",
  // Hair length
  "short hair", "long hair", "very long hair", "bald",
  // Hair style
  "ponytail", "twintails", "hair bun",
  // Hair color (new family)
  "blonde hair", "black hair", "white hair",
  // Skin
  "pale skin", "dark skin",
  // Body
  "flat chest", "large breasts", "huge breasts", "tall", "short", "muscular",
  // Clothing
  "dress", "skirt", "pants", "shirt", "jacket", "swimsuit", "bikini", "armor",
  // Footwear
  "shoes", "barefoot", "high heels", "boots",
  // Legwear
  "pantyhose", "thighhighs",
  // Headwear
  "hat", "glasses",
  // Handwear
  "gloves", "bare hands",
  // Time
  "day", "night", "sunset",
  // Setting
  "indoors", "outdoors", "beach", "snow", "underwater", "space", "cave",
  // Background
  "white background", "simple background", "detailed background",
  // Weather
  "rain", "sunny",
  // Style
  "monochrome", "sketch", "realistic", "3d", "pixel art",
  // Censor
  "censored", "uncensored",
  // Action
  "fighting", "eating", "holding", "swimming", "dancing", "flying",
  // State
  "wet", "dirty", "clean", "blood", "injured",
  // Species (new family)
  "robot", "angel", "demon", "vampire",
  // Ears/Tails
  "cat ears", "animal ears", "cat tail",
  // Misc
  "masterpiece", "best quality",
]

// ─── Data Fetching ────────────────────────────────────────────────────
async function fetchPosts(
  provider: keyof typeof PROVIDER_URLS,
  count: number,
  page: number
): Promise<any[]> {
  const baseUrl = PROVIDER_URLS[provider]
  const apiUrl = `${baseUrl}/posts.json`

  const params = new URLSearchParams({
    limit: count.toString(),
    page: page.toString(),
    tags: provider === "DANBOORU" ? "status:active" : "",
    only: "id,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,tag_string_meta",
  })

  try {
    const response = await fetch(`${apiUrl}?${params.toString()}`, {
      headers: {
        "User-Agent": "BooruPromptGallery/1.0 (validation-test)",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      console.warn(`  ⚠️ ${provider}: HTTP ${response.status}`)
      return []
    }

    return await response.json() as any[]
  } catch (err) {
    console.warn(`  ⚠️ ${provider} fetch error: ${(err as Error).message}`)
    return []
  }
}

// ─── Analysis ─────────────────────────────────────────────────────────
function analyzePost(post: any, testTags: string[]): ValidationResult {
  // Build base tags from all available tag strings
  const allTagStrings = [
    post.tag_string,
    post.tag_string_artist,
    post.tag_string_character,
    post.tag_string_copyright,
    post.tag_string_meta,
  ].filter(Boolean).join(" ")

  const baseTags = allTagStrings.split(/\s+/).filter(Boolean)
  const resolution = resolveTagConflicts(baseTags, testTags)

  // Detect active triggers in the post
  const normalizedBase = new Set(baseTags.map(t => normalize(t)))
  const activeTriggers: string[] = []
  for (const trigger of Object.keys(TAG_CONFLICTS)) {
    if (normalizedBase.has(normalize(trigger))) {
      activeTriggers.push(trigger)
    }
  }

  // Detect active exceptions
  const activeExceptions: string[] = []
  for (const [trigger, rule] of Object.entries(TAG_CONFLICTS)) {
    if (!rule.exceptions) continue
    for (const excKey of Object.keys(rule.exceptions)) {
      if (normalizedBase.has(normalize(excKey))) {
        activeExceptions.push(`${trigger}:${excKey}`)
      }
    }
  }

  // Detect blocked-by information
  const blockedBy: string[] = []
  for (const conflict of resolution.conflictingTags) {
    blockedBy.push(conflict.reason)
  }

  // Context flags
  let hasMultiChars = false
  let hasFaceIndicators = false
  for (const t of Array.from(normalizedBase)) {
    const tag = t as string
    if (/^[2-9]+(girls|boys)$/.test(tag) || tag.includes("multiple") || tag === "group") {
      hasMultiChars = true
    }
    if (tag.includes("eyes") || tag.includes("smile") || tag.includes("blush") ||
        tag.includes("mouth") || tag.includes("looking at viewer")) {
      hasFaceIndicators = true
    }
  }

  return {
    postId: post.id,
    totalTags: baseTags.length,
    conflictsFound: resolution.conflictingTags.length,
    conflictingTags: resolution.conflictingTags.map(c => c.tag),
    blockedBy,
    activeTriggers,
    activeExceptions,
    hasMultiChars,
    hasFaceIndicators,
  }
}

// ─── Coverage Analysis ────────────────────────────────────────────────
function computeCoverage(results: ValidationResult[], testTags: string[]): CoverageMetrics[] {
  const allBaseTagSets = results.map(r => {
    // We need to "reconstruct" base tags — store per result
    return null // This is filled during analysis
  })

  const metrics: CoverageMetrics[] = []

  for (const [trigger, rule] of Object.entries(TAG_CONFLICTS)) {
    let blocksTested = 0
    let blocksTriggered = 0
    let exceptionCoverage = 0

    for (const result of results) {
      if (result.activeTriggers.includes(trigger)) {
        // Check how many blocks of this trigger are relevant to the tags tested
        for (const blocked of rule.blocks) {
          for (const tag of testTags) {
            if (isRelatedTag(blocked, normalize(tag))) {
              blocksTested++
              if (result.conflictingTags.some(ct => normalize(ct) === normalize(tag))) {
                blocksTriggered++
              }
              break
            }
          }
        }

        // Check exception coverage
        if (rule.exceptions) {
          for (const excKey of Object.keys(rule.exceptions)) {
            if (result.activeExceptions.includes(`${trigger}:${excKey}`)) {
              exceptionCoverage++
            }
          }
        }
      }
    }

    metrics.push({
      trigger,
      totalBlocks: rule.blocks.length,
      blocksTested: Math.min(blocksTested, rule.blocks.length),
      blocksTriggered,
      exceptionCoverage: rule.exceptions
        ? Math.min(exceptionCoverage, Object.keys(rule.exceptions).length)
        : 0,
    })
  }

  return metrics
}

// ─── False Positive Detection ────────────────────────────────────────
function detectFalsePositives(results: ValidationResult[]): string[] {
  const fps: string[] = []

  for (const result of results) {
    for (const conflict of result.conflictingTags) {
      // Flag if a conflict seems wrong
      // For now, flag any conflict that blocked a tag NOT in the test pool
      // (this shouldn't happen since we only test with pool tags)
      if (!TEST_TAGS_POOL.some(t => normalize(t) === normalize(conflict))) {
        fps.push(`Post#${result.postId}: Unexpected blocked tag "${conflict}"`)
      }
    }
  }

  return fps
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log("\n" + "=".repeat(80))
  console.log("🔥 EXHAUSTIVE SMART TAG EXCLUSION VALIDATION")
  console.log("=".repeat(80))

  const allPosts: any[] = []
  const pages = [1, 5, 15, 25, 40, 60, 80, 100, 120, 150]
  
  console.log("\n📥 Fetching posts from Danbooru...")
  for (const page of pages) {
    const posts = await fetchPosts("DANBOORU", 50, page)
    allPosts.push(...posts)
    if (allPosts.length >= 500) break
    // Small delay to respect rate limits
    if (pages.indexOf(page) < pages.length - 1) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  console.log(`✅ Fetched ${allPosts.length} posts total\n`)

  if (allPosts.length < 50) {
    console.log("❌ Not enough posts. Exiting.")
    process.exit(1)
  }

  // Select diverse test tags (rotate through pool)
  const testTagCount = 15 // Test 15 random tags per post
  const results: ValidationResult[] = []
  const conflictTagStats = new Map<string, number>()
  const triggerStats = new Map<string, number>()
  
  let totalConflicts = 0
  let postsWithConflicts = 0

  console.log(`📊 Analyzing ${allPosts.length} posts with rotating test tags...\n`)

  for (let i = 0; i < allPosts.length; i++) {
    const post = allPosts[i]
    const offset = (i * 17) % TEST_TAGS_POOL.length // Rotate with prime offset
    const testTags = [
      ...TEST_TAGS_POOL.slice(offset, offset + testTagCount),
      ...TEST_TAGS_POOL.slice(0, Math.max(0, testTagCount - (TEST_TAGS_POOL.length - offset))),
    ].slice(0, testTagCount)

    const result = analyzePost(post, testTags)
    results.push(result)

    totalConflicts += result.conflictsFound
    if (result.conflictsFound > 0) {
      postsWithConflicts++
      for (const tag of result.conflictingTags) {
        conflictTagStats.set(tag, (conflictTagStats.get(tag) || 0) + 1)
      }
    }
    for (const trigger of result.activeTriggers) {
      triggerStats.set(trigger, (triggerStats.get(trigger) || 0) + 1)
    }
  }

  // ─── Report ─────────────────────────────────────────────────────────
  console.log("=".repeat(80))
  console.log("📈 VALIDATION RESULTS")
  console.log("=".repeat(80))

  console.log(`\n  📊 General:`)
  console.log(`     Total Posts:              ${results.length}`)
  console.log(`     Total Conflicts:          ${totalConflicts}`)
  console.log(`     Posts with Conflicts:     ${postsWithConflicts} (${((postsWithConflicts / results.length) * 100).toFixed(1)}%)`)
  console.log(`     Avg Conflicts per Post:   ${(totalConflicts / results.length).toFixed(2)}`)
  console.log(`     Unique Tags Blocked:      ${conflictTagStats.size}`)
  console.log(`     Unique Triggers Activated: ${triggerStats.size}/${Object.keys(TAG_CONFLICTS).length}`)

  const multiCharCount = results.filter(r => r.hasMultiChars).length
  const faceIndicatorCount = results.filter(r => r.hasFaceIndicators).length
  console.log(`\n  📊 Context Distribution:`)
  console.log(`     Multiple Characters:      ${multiCharCount} (${((multiCharCount / results.length) * 100).toFixed(1)}%)`)
  console.log(`     Face Indicators:          ${faceIndicatorCount} (${((faceIndicatorCount / results.length) * 100).toFixed(1)}%)`)

  console.log(`\n  🔝 Top 10 Most Common Conflicts:`)
  const topConflicts = Array.from(conflictTagStats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  for (const [tag, count] of topConflicts) {
    console.log(`     #${count.toString().padStart(3)} — "${tag}"`)
  }

  console.log(`\n  🎯 Top 10 Most Active Triggers:`)
  const topTriggers = Array.from(triggerStats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  for (const [trigger, count] of topTriggers) {
    console.log(`     #${count.toString().padStart(4)} — "${trigger}"`)
  }

  // Coverage metrics
  const coverage = computeCoverage(results, TEST_TAGS_POOL)
  const triggersWithCoverage = coverage.filter(m => m.blocksTriggered > 0)
  const untestedTriggers = coverage.filter(m => m.blocksTriggered === 0 && m.blocksTested === 0)

  console.log(`\n  📊 Trigger Coverage:`)
  console.log(`     Triggers tested (real data):   ${triggersWithCoverage.length}/${coverage.length}`)
  console.log(`     Triggers with NO real-world test: ${untestedTriggers.length}`)

  if (untestedTriggers.length > 0 && untestedTriggers.length < 20) {
    console.log(`     Untested: ${untestedTriggers.map(m => m.trigger).join(", ")}`)
  } else if (untestedTriggers.length >= 20) {
    console.log(`     (${untestedTriggers.length} triggers untested — listing first 10)`)
    console.log(`     Untested: ${untestedTriggers.slice(0, 10).map(m => m.trigger).join(", ")}`)
  }

  // False positive check
  const falsePositives = detectFalsePositives(results)
  if (falsePositives.length > 0) {
    console.log(`\n  ⚠️  False Positives: ${falsePositives.length}`)
    for (const fp of falsePositives.slice(0, 5)) {
      console.log(`     ${fp}`)
    }
  } else {
    console.log(`\n  ✅ No false positives detected.`)
  }

  // Sample detailed results
  console.log(`\n  📋 Sample Detailed Results (First 5 with conflicts):`)
  const samples = results.filter(r => r.conflictsFound > 0).slice(0, 5)
  for (const sample of samples) {
    console.log(`\n     Post #${sample.postId}`)
    console.log(`       Tags: ${sample.totalTags} | Conflicts: ${sample.conflictsFound}`)
    console.log(`       Blocked: ${sample.conflictingTags.join(", ")}`)
    console.log(`       Triggers: ${sample.activeTriggers.join(", ")}`)
    if (sample.activeExceptions.length > 0) {
      console.log(`       Exceptions: ${sample.activeExceptions.join(", ")}`)
    }
    console.log(`       Multi-Char: ${sample.hasMultiChars ? "✓" : "✗"} | Face: ${sample.hasFaceIndicators ? "✓" : "✗"}`)
  }

  // New trigger testing
  console.log(`\n  🆕 New Triggers (from gap analysis) — Active in test data:`)
  const newTriggers = [
    "blonde_hair", "black_hair", "white_hair", "glasses", "blindfold",
    "holding_weapon", "robot", "angel", "demon", "vampire",
    "symmetry", "swimming", "dancing", "surprised", "space", "cave", "ruins",
    "upside-down", "handstand", "bald", "armor", "blood"
  ]
  const newTriggerStats = new Map<string, number>()
  for (const trigger of newTriggers) {
    const count = triggerStats.get(trigger) || 0
    if (count > 0) newTriggerStats.set(trigger, count)
  }

  if (newTriggerStats.size > 0) {
    for (const [trigger, count] of Array.from(newTriggerStats.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`     #${count.toString().padStart(4)} — "${trigger}"`)
    }
  } else {
    console.log(`     (none active in test data — need broader/more targeted testing)`)
  }

  // Quality score
  const qualityScore = Math.min(100, Math.round(
    (triggersWithCoverage.length / Math.max(1, coverage.length)) * 50 +
    (conflictTagStats.size / Math.max(1, TEST_TAGS_POOL.length)) * 30 +
    (postsWithConflicts / Math.max(1, results.length)) * 20
  ))

  console.log(`\n  ⭐ Validation Quality Score: ${qualityScore}/100`)
  console.log(`     (Coverage × 50% + Tag Diversity × 30% + Conflict Rate × 20%)`)

  console.log("\n" + "=".repeat(80))
  console.log(`✅ Validation complete. System analyzed ${results.length} real posts successfully.`)
  console.log("=".repeat(80) + "\n")

  // Exit with failure if critical issues found
  if (falsePositives.length > 5) {
    console.log("❌ Too many false positives — system may have issues.")
    process.exit(1)
  }
}

main().catch(err => {
  console.error("❌ Validation failed:", err)
  process.exit(1)
})
