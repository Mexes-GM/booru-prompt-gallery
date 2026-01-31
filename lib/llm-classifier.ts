
import { TagCategory } from "./tag-classifier";

// === Types ===
export type AIClassificationResult = {
    match: boolean;
    aiCategory: TagCategory;
    confidence: 'high' | 'low';
    reasoning?: string;
    usedModel: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    }
};

type LLMResponse = {
    content: string;
    usage: NonNullable<AIClassificationResult['usage']>;
};

interface LLMProvider {
    name: string;
    attemptClassification(tagName: string, suggestedCategory: TagCategory, prompt: string): Promise<LLMResponse>;
}

// === Configuration ===
const CONFIG = {
    siteUrl: "https://booru-prompt-gallery.com",
    openRouter: {
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        model: "meta-llama/llama-3.3-70b-instruct:free",
    },
    deepSeek: {
        endpoint: "https://api.deepseek.com/chat/completions",
        model: "deepseek-chat",
    }
};

// === Base Fetch Helper ===
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 20000): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (e) {
        clearTimeout(id);
        throw e;
    }
}

// === Providers ===

class OpenRouterFreeProvider implements LLMProvider {
    name = "OpenRouter (Free)";
    private currentKeyIndex = 0;
    
    // Track exhausted keys (Rate Limited / Insufficient Credits)
    private static keyCooldowns: Map<string, number> = new Map();

    // Verified Free Models (Feb 2026)
    private readonly backupModels = [
        "meta-llama/llama-3.3-70b-instruct:free",
        "google/gemma-3-27b-it:free",
        "mistralai/mistral-small-3.1-24b-instruct:free",
        "meta-llama/llama-3.1-405b-instruct:free",
        "deepseek/deepseek-r1-0528:free"
    ];

    private get keys(): string[] {
        // Dynamic access to env to ensure load
        const raw = process.env.OPENROUTER_API_KEYS || process.env.OPENROUTER_API_KEY || "";
        return raw.split(',').map(k => k.trim()).filter(k => k.startsWith("sk-or-"));
    }

    private get currentKey(): string {
        const keys = this.keys;
        if (keys.length === 0) return "";
        return keys[this.currentKeyIndex % keys.length];
    }

    private rotateKey() {
        const keys = this.keys;
        if (keys.length > 1) {
            this.currentKeyIndex = (this.currentKeyIndex + 1) % keys.length;
            // console.log(`[OpenRouter] 🔄 Rotating to key #${this.currentKeyIndex + 1}`);
        }
    }

    async attemptClassification(tagName: string, suggestedCategory: TagCategory, prompt: string): Promise<LLMResponse> {
        const keys = this.keys;
        if (keys.length === 0) throw new Error("No OpenRouter keys configured");

        // 1. Initial Check: Are there ANY available keys?
        const now = Date.now();
        const availableKeys = keys.filter(k => {
            const cooldown = OpenRouterFreeProvider.keyCooldowns.get(k);
            return !cooldown || now > cooldown;
        });

        if (availableKeys.length === 0) {
             // Clean up expired entries
             for (const [k, time] of OpenRouterFreeProvider.keyCooldowns) {
                 if (now > time) OpenRouterFreeProvider.keyCooldowns.delete(k);
             }
             throw new Error("All OpenRouter keys are currently exhausted (Rate Limit/Daily Quota) - Falling back to Paid.");
        }

        // Try current key, if fails with rate limit or network, rotate and retry
        let attempts = 0;
        // Allow enough attempts to cycle through keys and models, skipping exhausted ones
        const maxAttempts = keys.length * 5;

        let currentModelIndex = 0;

        while (attempts < maxAttempts) {
            attempts++;
            const key = this.currentKey;
            
            // Check if THIS key is in cooldown
            if (OpenRouterFreeProvider.keyCooldowns.has(key)) {
                const cooldownEnd = OpenRouterFreeProvider.keyCooldowns.get(key)!;
                if (Date.now() < cooldownEnd) {
                    // Skip this key
                    this.rotateKey();
                    continue; 
                } else {
                    // Expired cooldown
                    OpenRouterFreeProvider.keyCooldowns.delete(key);
                }
            }

            // Use round-robin model if strictly needed, but for now stick to config model unless flagged
            // We can try different models if the main one fails with 404/Unavailable
            const modelToUse = this.backupModels[currentModelIndex % this.backupModels.length];

            try {
                return await this.callApi(key, prompt, modelToUse);
            } catch (error: any) {
                const isAuthError = error.message.includes("401");
                const isRateLimit = error.message.includes("429") || error.message.includes("402"); // 402 = insufficient credits
                const isUnavailable = error.message.includes("502") || error.message.includes("503") || error.message.includes("Provider Unavailable") || error.message.includes("404");

                if (isAuthError || isRateLimit || isUnavailable) {
                    console.warn(`[OpenRouter] Call failed (Key #${this.currentKeyIndex + 1} | ${modelToUse}): ${error.message}`);
                    
                    if (isRateLimit) {
                         // Mark this specific key as exhausted for 24 hours
                         const cooldown = 24 * 60 * 60 * 1000; 
                         OpenRouterFreeProvider.keyCooldowns.set(key, Date.now() + cooldown);
                         console.warn(`[OpenRouter] 🛑 Key marked as exhausted for 24h due to Rate Limit.`);
                    }

                    // Rotate Key AND Model
                    this.rotateKey();
                    currentModelIndex++;

                    // DEBOUNCE: Wait small amount if not hard blocked
                    if (!isRateLimit) {
                        // console.log(`[OpenRouter] ⏳ Cooling down for 2s before next attempt...`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                    
                    // loop continues
                } else {
                    // Fatal error (e.g. 400 Bad Request, malformed prompt), do not retry
                    throw error;
                }
            }
        }
        
        throw new Error("All OpenRouter keys/models exhausted or failed.");
    }

    private async callApi(apiKey: string, prompt: string, model: string): Promise<LLMResponse> {
        const body = {
            model: model,
            messages: [
                { role: "system", content: "Classify anime tags. JSON only." },
                { role: "user", content: prompt }
            ],
            temperature: 0.1,
            response_format: { type: "json_object" }
        };

        const response = await fetchWithTimeout(CONFIG.openRouter.endpoint, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": CONFIG.siteUrl,
                "X-Title": "Booru Prompt Gallery"
            },
            body: JSON.stringify(body)
        });


        if (!response.ok) {
            const errText = await response.text().catch(() => "Unknown");
            throw new Error(`Status ${response.status}: ${errText}`);
        }

        const data = await response.json();
        // OpenRouter specific: sometimes returns "error" object inside 200 OK
        if (data.error) { 
            throw new Error(`Provider Error: ${JSON.stringify(data.error)}`);
        }
        
        return {
            content: data.choices?.[0]?.message?.content || "",
            usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
    }
}

class DeepSeekDirectProvider implements LLMProvider {
    name = "DeepSeek (Paid)";

    private get key(): string {
        return process.env.DEEPSEEK_API_KEY || "";
    }

    async attemptClassification(tagName: string, suggestedCategory: TagCategory, prompt: string): Promise<LLMResponse> {
        if (!this.key) throw new Error("No DeepSeek key configured");

        const body = {
            model: CONFIG.deepSeek.model,
            messages: [
                { role: "system", content: "Classify anime tags. JSON only." },
                { role: "user", content: prompt }
            ],
            temperature: 0.1,
            response_format: { type: "json_object" }
        };

        const response = await fetchWithTimeout(CONFIG.deepSeek.endpoint, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.key}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => "Unknown");
            throw new Error(`DeepSeek API Error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        return {
            content: data.choices?.[0]?.message?.content || "",
            usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
    }
}

// === Parser ===
function parseLLMResult(response: LLMResponse, tagName: string, suggestedCategory: TagCategory, modelName: string): AIClassificationResult {
    const { content, usage } = response;
    
    if (!content) throw new Error("Empty content received from LLM");

    let result: { c?: string, category?: string, k?: string, confidence?: string, r?: string, reasoning?: string } = {};

    try {
        // Strip markdown code blocks
        const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
        result = JSON.parse(cleanJson);
    } catch (e) {
        // Fallback: Primitive string matching
        console.warn(`[LLM Parser] JSON Parse failed for ${tagName} from ${modelName}. content: ${content.substring(0, 50)}...`);
        const lower = content.toLowerCase();
        const categories = ['clothing', 'pose', 'scenery', 'appearance', 'other'];
        const found = categories.find(c => lower.includes(c));
        result = { c: found || 'other', k: 'low', r: 'Parser failure fallback' };
    }

    // Normalize keys (supports both minified and full keys)
    const categoryRaw = (result.c || result.category || 'other').toLowerCase();
    const confidenceRaw = (result.k || result.confidence || 'low').toLowerCase();
    const reasoning = result.r || result.reasoning || '';

    const validCategories = ['clothing', 'pose', 'scenery', 'appearance', 'other'];
    const finalCategory = validCategories.includes(categoryRaw) ? categoryRaw as TagCategory : 'other';

    // console.log(`[LLM Classifier] Tag: "${tagName}" | AI: ${finalCategory} | Model: ${modelName} | Tokens: ${usage.total_tokens}`);

    return {
        match: finalCategory === suggestedCategory,
        aiCategory: finalCategory,
        confidence: confidenceRaw === 'high' ? 'high' : 'low',
        reasoning: reasoning,
        usedModel: modelName,
        usage: usage
    };
}


// === Main Orchestrator ===
const openRouterProvider = new OpenRouterFreeProvider();
const deepSeekProvider = new DeepSeekDirectProvider();

export async function classifyTagWithLLM(tagName: string, suggestedCategory: TagCategory): Promise<AIClassificationResult> {
    // 1. Build Prompt (Minified)
    const prompt = `Classify Danbooru tag "${tagName}" (User suggests: "${suggestedCategory}").
Categories: 
- clothing (garments, accessories)
- pose (actions, camera angle)
- scenery (backgrounds, rooms, objects, items, weapons, instruments, vehicles)
- appearance (body parts, hair, skin, nudity)
- other (meta, artist, text)
JSON Response: {"c": "category", "r": "short reasoning", "k": "high"|"low"}`;

    let lastError: any;

    // 2. Try Providers in Order
    // Priority: OpenRouter (Free) -> DeepSeek (Paid)
    
    // Attempt OpenRouter
    try {
        const response = await openRouterProvider.attemptClassification(tagName, suggestedCategory, prompt);
        return parseLLMResult(response, tagName, suggestedCategory, CONFIG.openRouter.model);
    } catch (error: any) {
        // console.warn(`[LLM Classifier] OpenRouter skipped: ${error.message}`);
        lastError = error;
    }

    // Attempt DeepSeek
    try {
        // console.log(`[LLM Classifier] Falling back to DeepSeek...`);
        const response = await deepSeekProvider.attemptClassification(tagName, suggestedCategory, prompt);
        return parseLLMResult(response, tagName, suggestedCategory, CONFIG.deepSeek.model);
    } catch (error: any) {
        console.error(`[LLM Classifier] DeepSeek failed: ${error.message}`);
        lastError = error;
    }

    // 3. Fallback (If all fail)
    return {
        match: false,
        aiCategory: 'other',
        confidence: 'low',
        usedModel: 'error',
        reasoning: `All providers failed. Last error: ${lastError?.message || 'Unknown'}`
    };
}
