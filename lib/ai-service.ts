import { supabaseAdmin } from './supabase-admin';
import { classifyTagWithLLM, AIClassificationResult } from './llm-classifier';
import { TagCategory, classifyTag } from './tag-classifier';

interface ProcessSuggestionParams {
    suggestionId: number;
    tagName: string;
    suggestedCategory: TagCategory;
}

/**
 * DISABLED: AI classification is currently disabled.
 * Orchestrates the AI classification logic with database caching and audit logging.
 * Returns true if the tag was approved (category match), false if it needs review.
 */
export async function processTagSuggestionWithAI({
    suggestionId,
    tagName,
    suggestedCategory
}: ProcessSuggestionParams): Promise<{ approved: boolean, result: AIClassificationResult }> {
    // This function is disabled - throwing early to prevent any AI calls
    throw new Error("[AI Service] AI classification is currently disabled. This function should not be called.");
}

async function logAudit(
    tagName: string,
    suggestedCategory: string,
    result: AIClassificationResult,
    action: 'auto_approved' | 'queued_for_review'
) {
    await supabaseAdmin.from('ai_audit_logs').insert({
        tag_name: tagName,
        suggested_category: suggestedCategory,
        ai_prediction: result.aiCategory,
        confidence: result.confidence,
        model_used: result.usedModel,
        action_taken: action
    });
}
