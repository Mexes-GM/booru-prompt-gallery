import { supabaseAdmin } from './supabase-admin';
import { classifyTagWithLLM, AIClassificationResult } from './llm-classifier';
import { TagCategory, classifyTag } from './tag-classifier';

interface ProcessSuggestionParams {
    suggestionId: number;
    tagName: string;
    suggestedCategory: TagCategory;
}

/**
 * Orchestrates the AI classification logic with database caching and audit logging.
 * Returns true if the tag was approved (category match), false if it needs review.
 */
export async function processTagSuggestionWithAI({
    suggestionId,
    tagName,
    suggestedCategory
}: ProcessSuggestionParams): Promise<{ approved: boolean, result: AIClassificationResult }> {

    // 1. Check Cache (High Confidence Previous Results)
    const { data: cached } = await supabaseAdmin.from('ai_audit_logs')
        .select('ai_prediction, confidence')
        .eq('tag_name', tagName)
        .eq('confidence', 'high')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    let result: AIClassificationResult;

    // 1.5. Check Static Heuristics (Cost Optimization)
    const heuristicCategory = classifyTag(tagName);

    if (heuristicCategory !== 'other') {
        // We have a static rule match! Trust this 100%
        result = {
            match: heuristicCategory === suggestedCategory,
            aiCategory: heuristicCategory,
            confidence: 'high',
            reasoning: "Static Keyword Match (Heuristic)",
            usedModel: 'static_classifier',
            usage: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 }
        };
    } else if (cached) {
        const aiCategory = cached.ai_prediction as TagCategory;
        result = {
            match: aiCategory === suggestedCategory,
            aiCategory: aiCategory,
            confidence: cached.confidence,
            reasoning: "Cached from previous analysis",
            usedModel: 'cache',
            usage: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 }
        };
    } else {
        // 2. Perform fresh classification
        try {
            result = await classifyTagWithLLM(tagName, suggestedCategory);
        } catch (e: any) {
            console.error(`[AI Service] Classification failed for ${tagName}:`, e);
            throw e;
        }
    }

    // 3. Process Outcome
    // TEMPORARILY DISABLED: Auto-approval is disabled - all suggestions go to review queue
    if (false && result.match) {
        // Auto-Approve
        const { error: rpcError } = await supabaseAdmin.rpc('approve_tag_suggestion', {
            suggestion_id: suggestionId
        });

        if (rpcError) {
            console.error("[AI Service] Auto-Approve RPC Failed:", rpcError);
        } else {

        }

        // Audit Log (Success)
        await logAudit(tagName, suggestedCategory, result, 'auto_approved');

        return { approved: true, result };
    } else {
        // Queue for Review


        // Audit Log (Review)
        await logAudit(tagName, suggestedCategory, result, 'queued_for_review');

        return { approved: false, result };
    }
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
