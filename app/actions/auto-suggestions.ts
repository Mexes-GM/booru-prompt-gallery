'use server'

import { supabaseAdmin } from '@/lib/supabase-admin'
import { classifyTag, TagCategory } from '@/lib/tag-classifier'
import { cookies } from 'next/headers'
import { normalize } from '@/lib/cleanPrompt'
import { requireAdmin } from '@/lib/auth/authorization'
import { PROVIDER_URLS } from '@/lib/constants'

// Rate Limit Configuration
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 3; // 3 mining operations per minute per user is plenty

interface DanbooruPost {
    id: number;
    tag_string: string;
    tag_string_general: string;
    tag_string_character: string;
    // ... we mostly care about tag_string
}

export async function generateAutoSuggestions() {
    try {
        // 1. Security & Auth Check
        await requireAdmin()

        // 2. Simple Rate Limiting (Database based)
        // Check how many 'mining_proposal_created' logs were created in the last minute by 'auto_mining'
        // Ideally we'd filter by user, but since it's a global admin tool, global rate limit on mining is also safer for tokens.
        const oneMinuteAgo = new Date(Date.now() - RATE_LIMIT_WINDOW).toISOString();
        
        const { count: recentMiningOps, error: rlError } = await supabaseAdmin
            .from('ai_audit_logs')
            .select('*', { count: 'exact', head: true })
            .eq('action_taken', 'mining_proposal_created')
            .gte('created_at', oneMinuteAgo);

        if (recentMiningOps && recentMiningOps > (MAX_REQUESTS_PER_WINDOW * 5)) {
             // 5 tags per request * 3 requests = 15 logs aprox. If we see > 15 logs, slow down.
             throw new Error("Rate limit exceeded. Please wait a moment before mining again.");
        }

        console.log("[Auto-Suggest] Fetching random posts from Danbooru...");
        // 3. Fetch Random Posts from Danbooru
        // Using "random:5" optimized tag to avoid DB timeouts
        const response = await fetch(`${PROVIDER_URLS.DANBOORU}/posts.json?tags=random:5`, {
            headers: {
                "User-Agent": "BooruPromptGallery/1.0"
            }
        });

        if (!response.ok) {
            throw new Error(`Danbooru API failed: ${response.status}`);
        }

        const posts: DanbooruPost[] = await response.json();
        const uniqueTags = new Set<string>();

        // 2. Extract Tags & Normalize (Centralized Logic)
        posts.forEach(post => {
            if (post.tag_string) {
                post.tag_string.split(' ').forEach(tag => {
                    if (tag.trim().length > 0) {
                        // Apply normalization (underscores -> spaces, lowercase)
                        // This prevents duplicate entries like "brown_dress" vs "brown dress"
                        uniqueTags.add(normalize(tag));
                    }
                });
            }
        });

        const allTags = Array.from(uniqueTags);
        console.log(`[Auto-Suggest] Found ${allTags.length} unique tags from 5 posts.`);

        // 3. Filter: Find tags that are NOT in DB or are 'other'
        // We select only "name" from tags where name is in our list
        const { data: existingTags, error: dbError } = await supabaseAdmin
            .from('tags')
            .select('name, category')
            .in('name', allTags);
        
        if (dbError) throw dbError;

        const existingMap = new Map(existingTags?.map(t => [t.name, t.category]));
        
        // Candidates: Tags that don't exist OR exist but are 'other'
        const candidates = allTags.filter(tag => {
            const cat = existingMap.get(tag);
            return !cat || cat === 'other';
        });

        console.log(`[Auto-Suggest] ${candidates.length} tags need classification.`);

        // Limit to avoid burning tokens (e.g., process 10 max per click)
        const toProcess = candidates.slice(0, 10);
        let processedCount = 0;

        for (const tagName of toProcess) {
            // Check Static Heuristics FIRST (optimization)
            const heuristicCategory = classifyTag(tagName);
            
            // If Heuristic found a specific category (not 'other'), propose it directly!
            // This skips the expensive AI call for obvious things like "1girl", "blue_eyes", etc.
            let aiResultCategory: string | null = null;
            let aiReasoning = "AI Analysis";
            let aiConfidence = "low";
            let aiModel = "unknown";

            if (heuristicCategory !== 'other') {
                console.log(`[Auto-Suggest] logic: "${tagName}" matched static classifier -> ${heuristicCategory}`);
                aiResultCategory = heuristicCategory;
                aiReasoning = "Static Keyword Match";
                aiConfidence = "high";
                aiModel = "static_classifier";
            }
            
            // OPTIMIZATION: If static match is found, insert directly into TAGS table and skip SUGGESTION queue
            // This prevents cluttering the admin UI with obvious things like "1girl" or "blue dress"
            if (aiResultCategory && aiModel === "static_classifier") {
                 const currentCategory = existingMap.get(tagName) || 'other';

                 if (currentCategory === 'other' && aiResultCategory !== 'other') {
                    // Update or Insert directly
                     if (existingMap.has(tagName)) {
                        // Update existing tag
                        await supabaseAdmin.from('tags').update({ category: aiResultCategory }).eq('name', tagName);
                     } else {
                        // Insert new tag
                        await supabaseAdmin.from('tags').insert({ name: tagName, category: aiResultCategory });
                     }
                     processedCount++;
                     // Skip creating a suggestion
                     continue;
                 }
            }

            // A. Ensure Tag Exists in DB (as 'other' if new)
            const currentCategory = existingMap.get(tagName) || 'other';
            let tagId: string;

            if (!existingMap.has(tagName)) {
                // Create it
                const { data: newTag, error: createError } = await supabaseAdmin
                    .from('tags')
                    .insert({ name: tagName, category: 'other' })
                    .select('id')
                    .single();
                
                if (createError) {
                    console.error(`Failed to create tag ${tagName}`, createError);
                    continue;
                }
                tagId = newTag.id;
            } else {
                // Get ID
                const { data: tagData } = await supabaseAdmin
                    .from('tags')
                    .select('id')
                    .eq('name', tagName)
                    .single();
                
                if (!tagData) continue;
                tagId = tagData.id;
            }

            // B. Classify (If not already statically matched)
            // AI classification is disabled - heuristic classifier handles most cases

            // C. Create Suggestion if we have a category
            if (aiResultCategory && aiResultCategory !== 'other') {
                const { error: suggestError } = await supabaseAdmin
                    .from('tag_suggestions')
                    .insert({
                        tag_id: tagId,
                        current_category: currentCategory,
                        suggested_category: aiResultCategory,
                        status: 'pending' 
                    });

                if (!suggestError) {
                    processedCount++;
                    // Log to AI Audit Logs for transparency
                    await supabaseAdmin.from('ai_audit_logs').insert({
                        tag_name: tagName,
                        suggested_category: 'auto_mining', 
                        ai_prediction: aiResultCategory,
                        confidence: aiConfidence,
                        model_used: aiModel,
                        action_taken: 'mining_proposal_created'
                    });
                }
            }
        } // End of for loop

        return { success: true, count: processedCount, totalFound: candidates.length };

    } catch (error: any) {
        console.error("Auto-Suggest Error:", error);
        return { success: false, error: error.message };
    }
}
