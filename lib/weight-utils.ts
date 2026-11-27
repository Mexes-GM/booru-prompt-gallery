
import { splitCommaSeparatedTags, joinTags } from '@/lib/utils/tag-utils'

export const applyWeights = (prompt: string, weights: Record<string, number>): string => {
    if (!prompt) return ""

    // Split by comma to respect tag boundaries
    const tags = splitCommaSeparatedTags(prompt)

    const processedTags = tags.map(tag => {
        // Parse current tag to extract base name and current weight
        const weightMatch = tag.match(/^\((.*):([0-9.]+)\)$/)
        let baseTag = tag
        let currentWeight = 1.0

        if (weightMatch) {
            baseTag = weightMatch[1]
            currentWeight = parseFloat(weightMatch[2])
        } else {
            const simpleParenMatch = tag.match(/^\((.*)\)$/)
            if (simpleParenMatch && !tag.includes(':')) {
                baseTag = simpleParenMatch[1]
                currentWeight = 1.1
            }
        }

        baseTag = baseTag.trim()

        // Check if there is a global weight for this base tag.
        // Keys in the weights map are normalized (lowercase) by cleanPrompt.

        const lowerBase = baseTag.toLowerCase()
        if (weights[lowerBase] !== undefined) {
            const newWeight = weights[lowerBase]
            // If weight is exactly 1.0, treat it as "default/pass-through"
            // This allows the key to exist in the global map (for the Manage modal)
            // without overriding local weights or forcing (tag:1.0) syntax.
            if (newWeight === 1.0) return tag 
            
            return `(${baseTag}:${newWeight})`
        }

        // Return original if no global weight
        return tag
    })

    return joinTags(processedTags)
}

export const extractWeights = (prompt: string): Record<string, number> => {
    if (!prompt) return {}

    const weights: Record<string, number> = {}
    const tags = splitCommaSeparatedTags(prompt)

    tags.forEach(tag => {
        const weightMatch = tag.match(/^\((.*):([0-9.]+)\)$/)
        if (weightMatch) {
            const baseTag = weightMatch[1].trim()
            const weight = parseFloat(weightMatch[2])
            if (!isNaN(weight)) {
                weights[baseTag] = weight
            }
        }
    })

    return weights
}

/** A tag read from prompt syntax: the tag itself and, when the text gave one, its weight. */
export interface WeightedTag {
    /** The tag without brackets, weight or escapes, as typed otherwise ("score_9", "Masterpiece"). */
    tag: string
    /** Undefined when the text carried no weight; 1 when it said so ("(smile:1)"). */
    weight?: number
}

/** True when the bracket at the start of `text` closes at its last character (escaped brackets don't count). */
function wrapsWhole(text: string): boolean {
    let depth = 0
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (c === '\\') { i++; continue }
        if (c === '(' || c === '[') depth++
        else if (c === ')' || c === ']') {
            depth--
            if (depth === 0) return i === text.length - 1
        }
    }
    return false
}

const EXPLICIT_WEIGHT = /^(.*\S)\s*:\s*(\d+(?:\.\d*)?|\.\d+)$/

/**
 * Reads the weight syntax of a prompt tag, as ComfyUI and A1111 read it:
 * "(smile:1.3)" is 1.3, "(smile)" is 1.1, "((smile))" is 1.21, "[smile]" is 1 / 1.1, and
 * "smile:1.3" without brackets is 1.3 (the natural-language converter strips it the same way).
 * Escaped brackets ("kashima \(kancolle\)") are part of the tag and come back unescaped.
 * A qualifier ("kashima (kancolle)") or an emoticon (":3", "(o)_(o)") is a tag, not a weight.
 */
export function readWeightedTag(raw: string): WeightedTag {
    let text = raw.trim()
    let weight = 1
    let weighted = false
    while (text.length >= 2 && ((text[0] === '(' && text.endsWith(')')) || (text[0] === '[' && text.endsWith(']'))) && wrapsWhole(text)) {
        const round = text[0] === '('
        let inner = text.slice(1, -1).trim()
        const explicit = round ? EXPLICIT_WEIGHT.exec(inner) : null
        if (explicit) {
            weight *= Number(explicit[2])
            inner = explicit[1].trim()
        } else {
            weight *= round ? 1.1 : 1 / 1.1
        }
        weighted = true
        text = inner
    }
    if (!weighted) {
        const bare = EXPLICIT_WEIGHT.exec(text)
        if (bare && /\p{L}/u.test(bare[1]) && !bare[1].endsWith(':')) {
            weight = Number(bare[2])
            text = bare[1].trim()
            weighted = true
        }
    }
    const tag = text.replace(/\\([()[\]\\])/g, '$1').trim()
    if (!weighted || !tag || !Number.isFinite(weight)) return { tag: tag || raw.trim() }
    return { tag, weight: Math.round(weight * 1000) / 1000 }
}

/** A tag with a weight written as the app writes weights: "(smile:1.3)"; weight 1 or none: the tag alone. */
export const writeWeight = (tag: string, weight: number | undefined): string =>
    weight === undefined || weight === 1 ? tag : `(${tag}:${weight})`

export const parseTagString = (rawTag: string): { text: string; weight: number } => {
    const trimmed = rawTag.trim()

    const weightMatch = trimmed.match(/^\((.*):([0-9.]+)\)$/)
    if (weightMatch) {
        return {
            text: weightMatch[1].trim(),
            weight: parseFloat(weightMatch[2])
        }
    }

    const simpleParenMatch = trimmed.match(/^\((.*)\)$/)
    if (simpleParenMatch && !trimmed.includes(':')) {
        return {
            text: simpleParenMatch[1].trim(),
            weight: 1.1
        }
    }

    return {
        text: trimmed,
        weight: 1.0
    }
}
