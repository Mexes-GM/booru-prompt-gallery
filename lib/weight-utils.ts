
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

        // Check if there is a global weight for this base tag
        // We use lowercase for specific matching to match behavior in cleanPrompt but let's see
        // The prompt tags might be normalized or not. 
        // Best to check exact match first, then normalized?
        // cleanPrompt normalizes tags.
        // Let's assume keys in weights are normalized (lowercase).

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
