/**
 * Exhaustive Stress Test: 50+ random Danbooru posts with 40+ tags each
 * Tests the Smart Tag Exclusion system against real-world data
 */

import { resolveTagConflicts } from "../lib/tag-conflicts"
import { normalize } from "../lib/cleanPrompt"
import { PROVIDER_URLS } from "../lib/constants"

interface StressTestResult {
  postId: number
  tagCount: number
  addedTagsCount: number
  conflictsFound: number
  conflictingTags: string[]
  triggers: string[]
  hasMultiChars: boolean
  hasFaceIndicators: boolean
}

const DANBOORU_API = `${PROVIDER_URLS.DANBOORU}/posts.json`

async function fetchDanbooruPosts(limit: number = 50): Promise<any[]> {
  console.log(`\n📥 Fetching ${limit} random Danbooru posts with 40+ tags...`)
  
  try {
    const params = new URLSearchParams({
      limit: limit.toString(),
      page: Math.floor(Math.random() * 100).toString(), // Random page
      tags: "status:active", // Only active posts
      only: "id,tag_string,tag_string_artist,tag_string_character,tag_string_copyright"
    })

    const response = await fetch(`${DANBOORU_API}?${params.toString()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const posts = await response.json() as any[]
    
    // Filter posts with 40+ tags
    const filtered = posts.filter(p => {
      const tagCount = (p.tag_string || "").split(/\s+/).length
      return tagCount >= 40
    })

    console.log(`✅ Fetched ${filtered.length} posts with 40+ tags\n`)
    return filtered
  } catch (error) {
    console.error("❌ Failed to fetch posts:", error)
    process.exit(1)
  }
}

function analyzePost(post: any): StressTestResult {
  const baseTags = post.tag_string ? post.tag_string.split(/\s+/).filter(Boolean) : []
  
  // Simulate adding sample tags from common add-tags presets
  const commonAddTags = [
    "lips", "nose", "blush", "smile", "open mouth",
    "breasts", "cleavage", "navel", "exposed breasts",
    "looking at viewer", "front facing",
    "masterpiece", "best quality"
  ]

  const conflictResolution = resolveTagConflicts(baseTags, commonAddTags)
  
  // Analyze triggers
  const normalizedBase = new Set(baseTags.map((t: string) => normalize(t)))
  const triggerArray: string[] = []
  
  for (const t of Array.from(normalizedBase)) {
    if ((t as string).includes("from behind") || t === "back" || (t as string).includes("back")) {
      triggerArray.push(t as string)
    }
  }

  let hasMultiChars = false
  let hasFaceIndicators = false

  for (const t of Array.from(normalizedBase)) {
    const tag = t as string
    if (/^[2-9]+(girls|boys)$/.test(tag) || tag.includes("multiple") || tag === "group") {
      hasMultiChars = true
    }
    if (tag.includes("eyes") || tag.includes("smile") || tag.includes("blush")) {
      hasFaceIndicators = true
    }
  }

  return {
    postId: post.id,
    tagCount: baseTags.length,
    addedTagsCount: commonAddTags.length,
    conflictsFound: conflictResolution.conflictingTags.length,
    conflictingTags: conflictResolution.conflictingTags.map(c => c.tag),
    triggers: triggerArray,
    hasMultiChars,
    hasFaceIndicators
  }
}

async function runStressTest() {
  console.log("\n" + "=".repeat(70))
  console.log("🔥 EXHAUSTIVE STRESS TEST: Smart Tag Exclusion System")
  console.log("=".repeat(70))

  const posts = await fetchDanbooruPosts(50)
  
  if (posts.length === 0) {
    console.log("❌ No posts with 40+ tags found. Exiting.")
    process.exit(1)
  }

  const results: StressTestResult[] = []
  const tagConflictStats = new Map<string, number>()
  const triggerStats = new Map<string, number>()
  
  let totalConflicts = 0
  let postsWithConflicts = 0
  let totalTagsAnalyzed = 0

  console.log(`\n📊 Analyzing ${posts.length} posts...\n`)

  for (const post of posts) {
    const result = analyzePost(post)
    results.push(result)

    totalTagsAnalyzed += result.tagCount
    totalConflicts += result.conflictsFound

    if (result.conflictsFound > 0) {
      postsWithConflicts++
      result.conflictingTags.forEach(tag => {
        tagConflictStats.set(tag, (tagConflictStats.get(tag) || 0) + 1)
      })
    }

    result.triggers.forEach(t => {
      triggerStats.set(t, (triggerStats.get(t) || 0) + 1)
    })
  }

  // Generate Report
  console.log("\n" + "=".repeat(70))
  console.log("📈 STRESS TEST RESULTS")
  console.log("=".repeat(70))
  
  console.log(`\n✓ Total Posts Analyzed:        ${results.length}`)
  console.log(`✓ Average Tags Per Post:       ${(totalTagsAnalyzed / results.length).toFixed(1)}`)
  console.log(`✓ Total Tags Analyzed:         ${totalTagsAnalyzed}`)
  console.log(`✓ Total Conflicts Found:       ${totalConflicts}`)
  console.log(`✓ Posts with Conflicts:        ${postsWithConflicts} (${((postsWithConflicts / results.length) * 100).toFixed(1)}%)`)
  console.log(`✓ Conflict Rate (avg/post):    ${(totalConflicts / results.length).toFixed(2)}`)

  console.log(`\n📌 Most Common Conflict Tags:`)
  const topConflicts = Array.from(tagConflictStats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  
  topConflicts.forEach(([tag, count]) => {
    console.log(`   • "${tag}": ${count} conflicts`)
  })

  console.log(`\n📍 Most Common Trigger Tags:`)
  const topTriggers = Array.from(triggerStats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  
  topTriggers.forEach(([tag, count]) => {
    console.log(`   • "${tag}": ${count} occurrences`)
  })

  console.log(`\n🔍 Context Distribution:`)
  const multiCharCount = results.filter(r => r.hasMultiChars).length
  const faceIndicatorCount = results.filter(r => r.hasFaceIndicators).length
  console.log(`   • Posts with Multiple Characters:  ${multiCharCount} (${((multiCharCount / results.length) * 100).toFixed(1)}%)`)
  console.log(`   • Posts with Face Indicators:      ${faceIndicatorCount} (${((faceIndicatorCount / results.length) * 100).toFixed(1)}%)`)

  console.log(`\n📋 Sample Conflicts (First 5):`)
  const conflictSamples = results.filter(r => r.conflictsFound > 0).slice(0, 5)
  
  conflictSamples.forEach((result, i) => {
    console.log(`\n   [${i + 1}] Post ID: ${result.postId}`)
    console.log(`       Tags: ${result.tagCount} | Conflicts: ${result.conflictsFound}`)
    console.log(`       Blocked: ${result.conflictingTags.join(", ")}`)
    console.log(`       Multi-Char: ${result.hasMultiChars ? "✓" : "✗"} | Face Indicators: ${result.hasFaceIndicators ? "✓" : "✗"}`)
  })

  console.log(`\n` + "=".repeat(70))
  console.log(`✅ Stress Test Complete! System handled ${results.length} real posts successfully.`)
  console.log("=".repeat(70) + "\n")
}

runStressTest().catch(console.error)
