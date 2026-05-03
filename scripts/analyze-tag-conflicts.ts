#!/usr/bin/env npx ts-node --transpile-only
/**
 * 🔍 Smart Tag Exclusion — Coverage & Gap Analyzer
 * 
 * Agent that analyzes the TAG_CONFLICTS dictionary for:
 *   1. Coverage gaps (missing blocks, missing triggers)
 *   2. Symmetry violations
 *   3. Transitive conflicts
 *   4. Exception completeness
 *   5. False positive risk
 *   6. Redundancy
 *   7. isRelatedTag coverage
 * 
 * Usage: npx ts-node --transpile-only scripts/analyze-tag-conflicts.ts [--fix]
 *   --fix: Automatically patch lib/tag-conflicts.ts with suggested fixes
 */

import * as fs from "fs"
import * as path from "path"

// Resolve paths relative to project root (script is run from project root)
const PROJECT_ROOT = process.cwd()
const resolveProject = (...parts: string[]) => path.resolve(PROJECT_ROOT, ...parts)

// ─── Types ───────────────────────────────────────────────────────────
interface TagConflictRule {
  blocks: string[]
  exceptions?: Record<string, string[]>
}

interface ConflictDict {
  [trigger: string]: TagConflictRule
}

interface TagFamily {
  description: string
  trigger_candidates: string[]
  tags: string[]
  internal_conflicts: boolean
}

interface TagFamilies {
  families: Record<string, TagFamily>
}

interface GapReport {
  type: "missing_block" | "missing_trigger" | "asymmetry" | "transitive" | "missing_exception" | "false_positive_risk" | "redundancy" | "related_tag_gap"
  severity: "critical" | "high" | "medium" | "low"
  message: string
  suggestion: string
  trigger?: string
  tag?: string
}

// ─── Normalize (mirrors lib/cleanPrompt.ts) ──────────────────────────
function normalize(tag: string): string {
  return tag.toLowerCase().trim().replace(/['']/g, "'").replace(/_/g, " ")
}

// ─── Load data ──────────────────────────────────────────────────────
function loadJSON<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf-8")
  return JSON.parse(raw) as T
}

// Extract TAG_CONFLICTS from the TypeScript source
function extractConflictsFromSource(): ConflictDict {
  const source = fs.readFileSync(
    resolveProject("lib/tag-conflicts.ts"),
    "utf-8"
  )

  // Find TAG_CONFLICTS start
  const startMarker = "export const TAG_CONFLICTS: Record<string, TagConflictRule> = {"
  const startIdx = source.indexOf(startMarker)
  if (startIdx === -1) throw new Error("TAG_CONFLICTS not found in source")
  
  // Track braces to find the matching closing brace of the outer object
  let depth = 0
  let pos = startIdx
  let inString = false
  let stringChar = ""
  let inComment = false
  
  // Find the opening brace
  while (pos < source.length && source[pos] !== "{") pos++
  if (source[pos] !== "{") throw new Error("Expected { after TAG_CONFLICTS declaration")
  
  // Now track brace depth from this position
  depth = 1
  pos++
  
  while (pos < source.length && depth > 0) {
    const ch = source[pos]
    
    if (inString) {
      if (ch === "\\") { pos += 2; continue }
      if (ch === stringChar) { inString = false; pos++; continue }
      pos++
      continue
    }
    
    if (inComment) {
      if (ch === "\n") inComment = false
      pos++
      continue
    }
    
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true
      stringChar = ch
      pos++
      continue
    }
    
    if (ch === "/" && pos + 1 < source.length && source[pos + 1] === "/") {
      inComment = true
      pos += 2
      continue
    }
    
    if (ch === "/" && pos + 1 < source.length && source[pos + 1] === "*") {
      pos += 2
      while (pos + 1 < source.length && !(source[pos] === "*" && source[pos + 1] === "/")) pos++
      pos += 2
      continue
    }
    
    if (ch === "{") depth++
    if (ch === "}") depth--
    pos++
  }
  
  const endPos = pos
  const dictStr = source.slice(startIdx + startMarker.length, endPos - 1) // Exclude outer braces
  
  // Parse individual entries by finding top-level "key": { ... }
  const conflicts: ConflictDict = {}
  
  // Find all top-level keys (quoted strings at depth 0, followed by colon and brace)
  let i = 0
  inString = false
  stringChar = ""
  depth = 0
  
  while (i < dictStr.length) {
    // Skip whitespace and commas
    while (i < dictStr.length && (dictStr[i] === " " || dictStr[i] === "\n" || dictStr[i] === "\r" || dictStr[i] === "\t" || dictStr[i] === ",")) i++
    if (i >= dictStr.length) break
    
    // Skip comments
    if (dictStr[i] === "/" && i + 1 < dictStr.length && dictStr[i + 1] === "/") {
      while (i < dictStr.length && dictStr[i] !== "\n") i++
      continue
    }
    if (dictStr[i] === "/" && i + 1 < dictStr.length && dictStr[i + 1] === "*") {
      i += 2
      while (i + 1 < dictStr.length && !(dictStr[i] === "*" && dictStr[i + 1] === "/")) i++
      i += 2
      continue
    }
    
    // Read key (quoted string)
    if (dictStr[i] !== '"') { i++; continue }
    const keyStart = i + 1
    i++
    while (i < dictStr.length && dictStr[i] !== '"') {
      if (dictStr[i] === "\\") i++
      i++
    }
    const key = dictStr.slice(keyStart, i)
    i++ // skip closing quote
    
    // Skip colon and whitespace
    while (i < dictStr.length && (dictStr[i] === " " || dictStr[i] === ":" || dictStr[i] === "\n")) i++
    
    // Find opening brace
    if (dictStr[i] !== "{") continue
    i++
    depth = 1
    
    // Find matching closing brace
    const valueStart = i
    inString = false
    while (i < dictStr.length && depth > 0) {
      const ch = dictStr[i]
      if (inString) {
        if (ch === "\\") { i += 2; continue }
        if (ch === stringChar) { inString = false; i++; continue }
        i++
        continue
      }
      if (ch === '"' || ch === "'" || ch === "`") { inString = true; stringChar = ch; i++; continue }
      if (ch === "/" && i + 1 < dictStr.length && dictStr[i + 1] === "/") {
        while (i < dictStr.length && dictStr[i] !== "\n") i++
        continue
      }
      if (ch === "{" ) depth++
      if (ch === "}") depth--
      i++
    }
    
    const valueStr = dictStr.slice(valueStart, i - 1) // Exclude inner braces
    
    // Parse blocks and exceptions from valueStr
    const blocks: string[] = []
    const exceptions: Record<string, string[]> = {}
    
    // Extract blocks array
    const blocksMatch = valueStr.match(/blocks\s*:\s*\[([\s\S]*?)\]/)
    if (blocksMatch) {
      const tagRegex = /"([^"]+)"/g
      let tm: RegExpExecArray | null
      while ((tm = tagRegex.exec(blocksMatch[1])) !== null) {
        blocks.push(tm[1])
      }
    }
    
    // Extract exceptions object
    const excSection = valueStr.match(/exceptions\s*:\s*\{([\s\S]*?)\}\s*,?\s*$/)
    if (excSection) {
      // Find individual exception entries: "key": [tags]
      const excEntryRegex = /"([^"]+)"\s*:\s*\[([\s\S]*?)\]/g
      let em: RegExpExecArray | null
      while ((em = excEntryRegex.exec(excSection[1])) !== null) {
        const excKey = em[1]
        const excTags: string[] = []
        const tagRegex = /"([^"]+)"/g
        let tm: RegExpExecArray | null
        while ((tm = tagRegex.exec(em[2])) !== null) {
          excTags.push(tm[1])
        }
        exceptions[excKey] = excTags
      }
    }
    
    conflicts[key] = { blocks, exceptions: Object.keys(exceptions).length > 0 ? exceptions : undefined }
  }
  
  return conflicts
}

// ─── Checker 1: Coverage Analyzer ────────────────────────────────────
function checkCoverage(conflicts: ConflictDict, families: TagFamilies["families"]): GapReport[] {
  const reports: GapReport[] = []
  const normalizedBlockSets: Record<string, Set<string>> = {}

  // Build normalized block sets for each trigger
  for (const [trigger, rule] of Object.entries(conflicts)) {
    normalizedBlockSets[trigger] = new Set(rule.blocks.map(normalize))
  }

  // For each trigger, check its family's tags
  for (const [trigger, rule] of Object.entries(conflicts)) {
    // Find which family this trigger belongs to
    let familyName: string | null = null
    let family: TagFamily | null = null
    
    for (const [fName, fam] of Object.entries(families)) {
      if (fam.tags.some(t => normalize(t) === normalize(trigger))) {
        familyName = fName
        family = fam
        break
      }
    }
    
    if (!family || !family.internal_conflicts) continue
    
    // Check: which tags from this family are missing from blocks?
    const normalizedTrigger = normalize(trigger)
    for (const tag of family.tags) {
      const nTag = normalize(tag)
      if (nTag === normalizedTrigger) continue // Don't block self
      if (normalizedBlockSets[trigger].has(nTag)) continue // Already blocked
      
      // Check if already blocked by another trigger (not a gap)
      let blockedElsewhere = false
      for (const [otherTrigger, blockedSet] of Object.entries(normalizedBlockSets)) {
        if (otherTrigger === trigger) continue
        if (blockedSet.has(nTag)) {
          blockedElsewhere = true
          break
        }
      }
      if (blockedElsewhere) continue
      
      // Check if this tag should be blocked (semantic conflict)
      // For now, flag all tags in same family not yet blocked
      reports.push({
        type: "missing_block",
        severity: "medium",
        message: `Trigger "${trigger}" does not block "${tag}" from same family "${familyName}"`,
        suggestion: `Add "${tag}" to blocks of "${trigger}"`,
        trigger,
        tag,
      })
    }
  }

  return reports
}

// ─── Checker 2: Symmetry Checker ─────────────────────────────────────
function checkSymmetry(conflicts: ConflictDict): GapReport[] {
  const reports: GapReport[] = []

  for (const [trigger, rule] of Object.entries(conflicts)) {
    const normTrigger = normalize(trigger)
    
    for (const blocked of rule.blocks) {
      const normBlocked = normalize(blocked)
      
      // Does the blocked tag also have a rule?
      if (!conflicts[blocked] && !conflicts[normBlocked]) {
        // Try to find by normalized key
        const found = Object.keys(conflicts).find(k => normalize(k) === normBlocked)
        if (!found) {
          // Check if this is a symmetric relationship (like standing ↔ sitting)
          const symmetricFamilies = ["pose", "framing", "camera_angle", "time_of_day", "nudity_level", "expression", "style", "censor", "weather"]
          // If both are likely symmetric concepts, flag
          for (const [otherTrigger, otherRule] of Object.entries(conflicts)) {
            if (normalize(otherTrigger) === normBlocked) {
              if (!otherRule.blocks.some(b => normalize(b) === normTrigger)) {
                reports.push({
                  type: "asymmetry",
                  severity: "high",
                  message: `"${trigger}" blocks "${blocked}" but "${blocked}" does not block "${trigger}"`,
                  suggestion: `Add "${trigger}" to blocks of "${blocked}" for symmetry`,
                  trigger: blocked,
                  tag: trigger,
                })
              }
              break
            }
          }
        }
      }
    }
  }

  return reports
}

// ─── Checker 3: Transitive Closure ───────────────────────────────────
function checkTransitive(conflicts: ConflictDict): GapReport[] {
  const reports: GapReport[] = []
  const normConflicts: Record<string, Set<string>> = {}

  for (const [trigger, rule] of Object.entries(conflicts)) {
    normConflicts[normalize(trigger)] = new Set(rule.blocks.map(normalize))
  }

  // For each trigger, find indirect conflicts through blocked tags
  for (const [trigger, blockedSet] of Object.entries(normConflicts)) {
    for (const intermediate of Array.from(blockedSet)) {
      const innerBlocked = normConflicts[intermediate]
      if (!innerBlocked) continue
      
      for (const transitiveTarget of Array.from(innerBlocked)) {
        if (transitiveTarget === trigger) continue
        if (blockedSet.has(transitiveTarget)) continue // Already directly blocked
        
        // Don't flag if trigger and target are the same type of concept
        // (prevents too many matches across unrelated families)
        const isSemanticallyRelated = (
          blockedSet.has(intermediate) && 
          innerBlocked.has(transitiveTarget)
        )
        
        if (isSemanticallyRelated) {
          reports.push({
            type: "transitive",
            severity: "low",
            message: `"${trigger}" blocks "${intermediate}" which blocks "${transitiveTarget}" — transitive conflict not captured`,
            suggestion: `Consider adding "${transitiveTarget}" to blocks of "${trigger}"`,
            trigger,
            tag: transitiveTarget,
          })
        }
      }
    }
  }

  return reports
}

// ─── Checker 4: Missing Trigger Detector ─────────────────────────────
function checkMissingTriggers(conflicts: ConflictDict, families: TagFamilies["families"]): GapReport[] {
  const reports: GapReport[] = []
  const existingTriggers = new Set(Object.keys(conflicts).map(normalize))
  const existingBlocks = new Set<string>()
  
  for (const rule of Object.values(conflicts)) {
    for (const b of rule.blocks) existingBlocks.add(normalize(b))
  }

  for (const [familyName, family] of Object.entries(families)) {
    // Check if this family has at least one trigger
    const hasTrigger = family.tags.some(t => existingTriggers.has(normalize(t)))
    const hasBlock = family.tags.some(t => existingBlocks.has(normalize(t)))
    
    if (!hasTrigger && !hasBlock) {
      // Entire family is uncovered
      reports.push({
        type: "missing_trigger",
        severity: family.internal_conflicts ? "high" : "medium",
        message: `Family "${familyName}" (${family.description}) has NO triggers or blocks in TAG_CONFLICTS`,
        suggestion: `Add triggers for "${familyName}": ${family.trigger_candidates.join(", ") || family.tags.slice(0, 5).join(", ")}`,
        tag: familyName,
      })
    } else if (!hasTrigger && hasBlock) {
      // Tags appear in blocks but no triggers defined
      const candidates = family.trigger_candidates.length > 0 
        ? family.trigger_candidates 
        : family.tags.filter(t => existingBlocks.has(normalize(t))).slice(0, 5)
      
      reports.push({
        type: "missing_trigger",
        severity: "medium",
        message: `Family "${familyName}" has tags in blocks but no trigger defined`,
        suggestion: `Add triggers for "${familyName}" from: ${candidates.join(", ")}`,
        tag: familyName,
      })
    }
  }

  return reports
}

// ─── Checker 5: Exception Completeness ───────────────────────────────
function checkExceptions(conflicts: ConflictDict): GapReport[] {
  const reports: GapReport[] = []

  // Known exception patterns to verify
  const expectedExceptions: Record<string, { exception: string; unblocks: string[] }[]> = {
    "from_behind": [
      { exception: "mirror_reflection", unblocks: ["lips", "eyes", "mouth", "smile", "blush", "tears", "nose", "breasts", "cleavage", "navel"] },
      { exception: "mirror", unblocks: ["lips", "eyes", "mouth", "smile", "blush", "tears", "nose", "breasts", "cleavage", "navel"] },
      { exception: "selfie", unblocks: ["lips", "eyes", "mouth", "smile", "blush", "face", "nose"] },
    ],
    "nude": [
      { exception: "towel", unblocks: ["towel"] },
      { exception: "bath_towel", unblocks: ["towel"] },
    ],
    "naked": [
      { exception: "towel", unblocks: ["towel"] },
      { exception: "bath_towel", unblocks: ["towel"] },
    ],
    "sleeping": [
      { exception: "half-asleep", unblocks: ["eyes_open", "looking_at_viewer"] },
    ],
  }

  for (const [trigger, expected] of Object.entries(expectedExceptions)) {
    const rule = conflicts[trigger]
    if (!rule) continue
    
    for (const exp of expected) {
      if (!rule.exceptions || !rule.exceptions[exp.exception]) {
        reports.push({
          type: "missing_exception",
          severity: "medium",
          message: `Trigger "${trigger}" is missing exception "${exp.exception}" that would unblock: ${exp.unblocks.join(", ")}`,
          suggestion: `Add exception "${exp.exception}" → [${exp.unblocks.map(t => `"${t}"`).join(", ")}] to "${trigger}"`,
          trigger,
          tag: exp.exception,
        })
      }
    }
  }

  return reports
}

// ─── Checker 6: False Positive Risk Simulator ────────────────────────
function checkFalsePositives(conflicts: ConflictDict, families: TagFamilies["families"]): GapReport[] {
  const reports: GapReport[] = []
  
  // Build normalized lookup
  const normConflicts: Record<string, { blocks: Set<string>; exceptions: Record<string, string[]> }> = {}
  for (const [trigger, rule] of Object.entries(conflicts)) {
    normConflicts[normalize(trigger)] = {
      blocks: new Set(rule.blocks.map(normalize)),
      exceptions: rule.exceptions || {},
    }
  }

  // Simulate: find tags in blocks that are too broad
  // e.g., "shoes" in barefoot's blocks would block ALL shoe variants — is that correct?
  const broadBlockers: Record<string, string[]> = {
    "barefoot": ["shoes"],
    "nude": ["dress"],
    "closed_eyes": ["eyes"],
  }

  for (const [trigger, broadTags] of Object.entries(broadBlockers)) {
    const rule = normConflicts[normalize(trigger)]
    if (!rule) continue
    
    for (const broadTag of broadTags) {
      const nBroad = normalize(broadTag)
      if (rule.blocks.has(nBroad)) {
        // Check if there are specific exceptions that should narrow this
        const hasNarrowing = Object.values(rule.exceptions).some(arr => 
          arr.some(t => normalize(t) === nBroad)
        )
        
        if (!hasNarrowing) {
          reports.push({
            type: "false_positive_risk",
            severity: "low",
            message: `"${trigger}" blocks "${broadTag}" broadly — may cause false positives for variants`,
            suggestion: `Verify that blocking "${broadTag}" under "${trigger}" is semantically correct in all cases`,
            trigger,
            tag: broadTag,
          })
        }
      }
    }
  }

  return reports
}

// ─── Checker 7: Redundancy Detector ──────────────────────────────────
function checkRedundancy(conflicts: ConflictDict): GapReport[] {
  const reports: GapReport[] = []
  const triggers = Object.entries(conflicts)

  for (let i = 0; i < triggers.length; i++) {
    for (let j = i + 1; j < triggers.length; j++) {
      const [t1, r1] = triggers[i]
      const [t2, r2] = triggers[j]
      
      const b1 = new Set(r1.blocks.map(normalize))
      const b2 = new Set(r2.blocks.map(normalize))
      
      // Jaccard similarity
      const b1Arr = Array.from(b1)
      const b2Arr = Array.from(b2)
      const intersection = new Set(b1Arr.filter(x => b2.has(x)))
      const union = new Set([...b1Arr, ...b2Arr])
      const similarity = intersection.size / union.size
      
      if (similarity > 0.7) {
        reports.push({
          type: "redundancy",
          severity: "low",
          message: `"${t1}" and "${t2}" have ${(similarity * 100).toFixed(0)}% block overlap — consider merging`,
          suggestion: `Consolidate "${t1}" and "${t2}" into a single trigger with exceptions for differences`,
          trigger: t1,
          tag: t2,
        })
      }
    }
  }

  return reports
}

// ─── Checker 8: isRelatedTag Coverage ────────────────────────────────
function checkRelatedTagCoverage(conflicts: ConflictDict): GapReport[] {
  const reports: GapReport[] = []
  
  // Current isRelatedTag only covers: eyes, hair, breasts
  // Find tags in blocks that would benefit from broader coverage
  const coveredPrefixes = new Set(["eyes", "hair", "breasts"])
  const neededPrefixes = new Set<string>()
  
  for (const rule of Object.values(conflicts)) {
    for (const blocked of rule.blocks) {
      const parts = blocked.split("_")
      if (parts.length > 1) {
        const suffix = parts[parts.length - 1]
        if (!coveredPrefixes.has(suffix) && !coveredPrefixes.has(parts[0])) {
          // Check if this suffix appears in multiple blocks
          neededPrefixes.add(suffix)
        }
      }
    }
  }
  
  // Check which suffixes would benefit from isRelatedTag expansion
  const valuableSuffixes = [
    "skin", "legs", "arms", "clothes", "shoes", "ears", "tail", 
    "background", "hair", "uniform", "sleeves", "body", "face", 
    "hands", "feet", "socks", "skirt", "pants", "dress"
  ]
  
  for (const suffix of valuableSuffixes) {
    if (!coveredPrefixes.has(suffix)) {
      const examples: string[] = []
      for (const rule of Object.values(conflicts)) {
        for (const blocked of rule.blocks) {
          if (blocked.endsWith("_" + suffix) || blocked.startsWith(suffix + "_")) {
            examples.push(blocked)
          }
        }
      }
      if (examples.length > 0) {
        reports.push({
          type: "related_tag_gap",
          severity: "medium",
          message: `isRelatedTag does not cover suffix "${suffix}" — affects ${examples.length} block entries`,
          suggestion: `Add "${suffix}" to isRelatedTag() function to enable fuzzy matching for: ${examples.slice(0, 5).join(", ")}`,
          tag: suffix,
        })
      }
    }
  }

  return reports
}

// ─── Main ─────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2)
  const autoFix = args.includes("--fix")
  
  console.log("\n" + "=".repeat(75))
  console.log("🔍 Smart Tag Exclusion — Coverage & Gap Analyzer")
  console.log("=".repeat(75))

  // Load data
  const families = loadJSON<TagFamilies>(
    resolveProject("scripts/tag-families.json")
  ).families

  const conflicts = extractConflictsFromSource()
  console.log(`\n📊 Loaded ${Object.keys(conflicts).length} triggers from TAG_CONFLICTS`)
  console.log(`📊 Loaded ${Object.keys(families).length} tag families\n`)

  // Run all checkers
  const allReports: GapReport[] = []
  
  console.log("🔎 Running checkers...\n")
  
  const coverageReports = checkCoverage(conflicts, families)
  console.log(`  1. Coverage Analyzer:    ${coverageReports.length} gaps found`)
  allReports.push(...coverageReports)

  const symmetryReports = checkSymmetry(conflicts)
  console.log(`  2. Symmetry Checker:     ${symmetryReports.length} asymmetries found`)
  allReports.push(...symmetryReports)

  const transitiveReports = checkTransitive(conflicts)
  console.log(`  3. Transitive Closure:   ${transitiveReports.length} indirect conflicts found`)
  allReports.push(...transitiveReports)

  const missingTriggerReports = checkMissingTriggers(conflicts, families)
  console.log(`  4. Missing Triggers:     ${missingTriggerReports.length} families uncovered`)
  allReports.push(...missingTriggerReports)

  const exceptionReports = checkExceptions(conflicts)
  console.log(`  5. Exception Completeness: ${exceptionReports.length} missing exceptions`)
  allReports.push(...exceptionReports)

  const fpReports = checkFalsePositives(conflicts, families)
  console.log(`  6. False Positive Risk:  ${fpReports.length} risks identified`)
  allReports.push(...fpReports)

  const redundancyReports = checkRedundancy(conflicts)
  console.log(`  7. Redundancy:          ${redundancyReports.length} near-duplicates`)
  allReports.push(...redundancyReports)

  const relatedReports = checkRelatedTagCoverage(conflicts)
  console.log(`  8. isRelatedTag Coverage: ${relatedReports.length} gaps`)
  allReports.push(...relatedReports)

  // Group by severity
  const critical = allReports.filter(r => r.severity === "critical")
  const high = allReports.filter(r => r.severity === "high")
  const medium = allReports.filter(r => r.severity === "medium")
  const low = allReports.filter(r => r.severity === "low")

  // ─── Generate Report ─────────────────────────────────────────────
  console.log("\n" + "=".repeat(75))
  console.log("📈 ANALYSIS REPORT")
  console.log("=".repeat(75))
  
  console.log(`\n  🔴 Critical: ${critical.length}`)
  console.log(`  🟠 High:     ${high.length}`)
  console.log(`  🟡 Medium:   ${medium.length}`)
  console.log(`  🟢 Low:      ${low.length}`)
  console.log(`  📋 Total:    ${allReports.length}`)

  // Print high severity items
  if (high.length > 0) {
    console.log(`\n── 🟠 HIGH SEVERITY ──`)
    for (const r of high.slice(0, 10)) {
      console.log(`  • ${r.message}`)
      console.log(`    → ${r.suggestion}`)
    }
    if (high.length > 10) console.log(`  ... and ${high.length - 10} more`)
  }

  // Print medium items (first 15)
  if (medium.length > 0) {
    console.log(`\n── 🟡 MEDIUM SEVERITY (${medium.length}) ──`)
    for (const r of medium.slice(0, 15)) {
      console.log(`  • ${r.message}`)
      console.log(`    → ${r.suggestion}`)
    }
    if (medium.length > 15) console.log(`  ... and ${medium.length - 15} more`)
  }

  // Print low items (first 5)
  if (low.length > 0) {
    console.log(`\n── 🟢 LOW SEVERITY (${low.length}) ──`)
    for (const r of low.slice(0, 5)) {
      console.log(`  • ${r.message}`)
      console.log(`    → ${r.suggestion}`)
    }
    if (low.length > 5) console.log(`  ... and ${low.length - 5} more`)
  }

  // Print groups by type
  console.log(`\n── 📊 BY TYPE ──`)
  const byType: Record<string, number> = {}
  for (const r of allReports) {
    byType[r.type] = (byType[r.type] || 0) + 1
  }
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`)
  }

  // ─── Top Suggestions Summary ────────────────────────────────────
  console.log(`\n── 💡 TOP SUGGESTIONS ──`)
  
  const suggestions: string[] = []
  
  // 1. New triggers to add
  const newTriggerFamilies = missingTriggerReports
    .filter(r => r.severity === "high")
    .slice(0, 5)
  if (newTriggerFamilies.length > 0) {
    suggestions.push(`Add triggers for families: ${newTriggerFamilies.map(r => r.tag).join(", ")}`)
  }
  
  // 2. isRelatedTag expansion
  const relatedTagSuffixes = relatedReports.map(r => r.tag).join(", ")
  if (relatedReports.length > 0) {
    suggestions.push(`Expand isRelatedTag() to cover: ${relatedTagSuffixes}`)
  }
  
  // 3. Symmetries to fix
  if (symmetryReports.length > 0) {
    suggestions.push(`Fix ${symmetryReports.length} asymmetric block relationships`)
  }
  
  // 4. Exceptions to add
  if (exceptionReports.length > 0) {
    suggestions.push(`Add ${exceptionReports.length} missing exceptions (mirror, selfie, towel...)`)
  }
  
  for (const s of suggestions) {
    console.log(`  • ${s}`)
  }

  // ─── Coverage Score ──────────────────────────────────────────────
  console.log(`\n── 📊 COVERAGE SCORE ──`)
  
  let familiesCovered = 0
  let familiesTotal = 0
  const existingTriggers = new Set(Object.keys(conflicts).map(normalize))
  const existingBlocks = new Set<string>()
  for (const rule of Object.values(conflicts)) {
    for (const b of rule.blocks) existingBlocks.add(normalize(b))
  }
  
  for (const [, family] of Object.entries(families)) {
    familiesTotal++
    const hasTrigger = family.tags.some(t => existingTriggers.has(normalize(t)))
    const hasBlock = family.tags.some(t => existingBlocks.has(normalize(t)))
    if (hasTrigger || hasBlock) familiesCovered++
  }
  
  const coveragePct = ((familiesCovered / familiesTotal) * 100).toFixed(1)
  console.log(`  Families covered: ${familiesCovered}/${familiesTotal} (${coveragePct}%)`)
  
  // Quality score (inverse of gaps)
  const maxGaps = 200
  const qualityScore = Math.max(0, Math.round(100 - (allReports.length / maxGaps) * 100))
  console.log(`  Quality Score: ${qualityScore}/100`)
  
  console.log("\n" + "=".repeat(75))
  console.log(`✅ Analysis complete. ${allReports.length} gaps identified.`)
  console.log(`   Run with --fix to auto-apply suggestions (not implemented yet)`)
  console.log("=".repeat(75) + "\n")
}

main()
