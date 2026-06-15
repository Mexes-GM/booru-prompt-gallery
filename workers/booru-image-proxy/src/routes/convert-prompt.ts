import { Env } from '../types'
import { jsonResponse, errorResponse } from '../utils'
import { Redis } from '@upstash/redis/cloudflare'
import { Ratelimit } from '@upstash/ratelimit'

const SYSTEM_PROMPT = `You are an expert prompt engineer for Anima, a text-to-image model focused on anime/illustration style. Convert booru tags into a descriptive natural language paragraph.

STRUCTURE: character identity → appearance → clothing/outfit → pose/action → setting → lighting/style.

RULES:
- Replace underscores with spaces (except score_7, score_9).
- Capitalize character/series/artist names properly.
- Natural prose for poses, expressions, spatial relationships. Tags for identity, body, hair, eyes, outfit, background.
- Outfit detail should be dense with redundancy.
- Only describe what the tags say.

OUTPUT LENGTH:
- Write exactly as much as the tags describe — many tags → longer paragraph, few tags → shorter.
- Target 2–6 sentences. Never pad with filler or truncate mid-description.
- One flowing paragraph. No bullet points, markdown, or analysis.

FORBIDDEN (violating any of these ruins the output):
1. MULTI-CHARACTER: The word "both" is FORBIDDEN. Never use "both" or "their" to group characters. Describe each character fully and sequentially, without merging. "Reisalin has X and wears Y. Yumia has Z and wears W." Only shared element allowed: the background.
2. NO personality words: "confident", "playful", "shy", "carefree", "demure", "cheeky", "flirtatious", "bold", "innocent", "suggestive", "alluring".
3. NO anatomical lists: "including her eyes, nose, and lips", "prominent lips and noses", "facial features include".
4. NO quality tags as atmosphere. "masterpiece" is a tag, not a scene descriptor.
5. NO hedging: "possibly", "maybe", "seems to", "appears to".
6. NO "young woman" or "girl" when a character name exists.
7. NO "teeth" unless tagged.
8. NO bullet points, markdown, or analysis. One paragraph only.

BEFORE OUTPUTTING: mentally scan for forbidden words. If any appear, rewrite.`

const USER_MESSAGE_TEMPLATE = `Example:
Tags: yor briar, spy x family, 1girl, black hair, long hair, hair bun, red eyes, silk nightgown, black nightgown, thin straps, bedroom, silk sheets, lying on stomach, cowboy shot, dim lighting, warm lighting, thick thighs, wide hips, shiny skin, lips, nose
Output: Yor Briar from Spy x Family, a woman with long black hair tied in a bun and red eyes. She wears a black silk nightgown with thin straps that hugs her figure, her thick thighs and wide hips prominent. She lies on her stomach across silk sheets in a dimly lit bedroom. Warm lighting casts soft shadows across the scene, captured in a cowboy shot framing.

Now convert these tags:
TAGS_PLACEHOLDER`

/** Creates all rate limiters from a single Redis connection. Returns null if Redis is not configured. */
function createRatelimiters(env: Env) {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return null
  }
  const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
  return {
    // Free tier: 15 req/min burst + 10 req/day overall budget
    freeMinute: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(15,  '1 m'), prefix: 'rl:ai:free:min', analytics: false }),
    freeDaily:  new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10,  '24 h'), prefix: 'rl:ai:free:day', analytics: false }),
    // Paid tier (own API key): only per-minute protection
    paidMinute: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60,  '1 m'), prefix: 'rl:ai:paid:min', analytics: false }),
  }
}

/** Detect if a Cloudflare Workers AI error is a quota/rate-limit error. */
function isCfAiQuotaError(err: unknown): boolean {
  const msg = ((err as any)?.message ?? '').toLowerCase()
  return msg.includes('limit') || msg.includes('quota') || msg.includes('exceed') || msg.includes('rate')
}

/**
 * Safely extract text content from an OpenAI-compatible chat completion response.
 * Handles: content, reasoning_content (thinking models), legacy text field,
 * empty/missing choices, and null content.
 *
 * Returns { content, usage } — content is always a string (empty if extraction failed).
 * Logs full response body when content extraction fails, so operators can diagnose.
 */
function extractOpenAICompatibleContent(
  data: any,
  provider: string,
): { content: string; usage: any | null } {
  const choice = data?.choices?.[0]
  if (!choice) {
    console.error(
      `${provider}: no choices in response`,
      JSON.stringify(data).slice(0, 1000),
    )
    return { content: '', usage: data?.usage ?? null }
  }

  // Try content first, then reasoning_content (thinking models like DeepSeek V4),
  // then legacy text field, then empty string.
  const content =
    choice.message?.content?.trim() ||
    choice.message?.reasoning_content?.trim() ||
    choice.text?.trim() ||
    ''

  if (!content) {
    console.error(
      `${provider}: empty content — full response:`,
      JSON.stringify(data).slice(0, 2000),
    )
  }

  return { content, usage: data?.usage ?? null }
}

const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
// Alternatives:
// '@cf/meta/llama-3.3-70b-instruct-fp8-fast' — 70B, most natural prose
// '@cf/zai-org/glm-4.7-flash' — instruction-following, fast
// '@cf/meta/llama-3.1-8b-instruct-fast' — 8B, fastest
const VISION_MODEL = '@cf/google/gemma-4-26b-a4b-it'
// Gemma 4 26B MoE (4B active) — vision, fast, uses free CF neurons quota

function isExternalUrl(s: string): boolean {
  return s.startsWith('http://') || s.startsWith('https://')
}

function isDataUrl(s: string): boolean {
  return s.startsWith('data:')
}

/** Validate API key format per provider. Rejects obviously malformed/malicious input. */
function isValidApiKey(provider: string, key: string): boolean {
  if (!key || typeof key !== 'string') return false
  // Max reasonable length — no legitimate key exceeds 200 chars
  if (key.length > 200) return false
  // Reject keys with control chars, newlines, or null bytes (injection attempt)
  if (/[\x00-\x1f\x7f]/.test(key)) return false

  switch (provider) {
    case 'openai':     return /^sk-[a-zA-Z0-9]{20,}$/.test(key)
    case 'gemini':     return /^AIza[a-zA-Z0-9_-]{30,}$/.test(key)
    case 'claude':     return /^sk-ant-[a-zA-Z0-9-]{20,}$/.test(key)
    case 'deepseek':   return /^sk-[a-zA-Z0-9]{20,}$/.test(key)
    case 'openrouter': return /^sk-or-[a-zA-Z0-9]{20,}$/.test(key)
    default:           return false
  }
}

/** Validate provider is one of the allowed values. */
function isValidProvider(provider: string): boolean {
  return ['cloudflare', 'openai', 'gemini', 'claude', 'deepseek', 'openrouter'].includes(provider)
}

/** Validate model ID format. Only allow alphanumeric, hyphens, underscores, dots, slashes. */
function isValidModelId(model: string): boolean {
  if (!model || typeof model !== 'string') return false
  if (model.length > 100) return false
  // Allow: alphanumeric, hyphens, underscores, dots, slashes (for openrouter format like "google/gemini-pro")
  return /^[a-zA-Z0-9._\-\/]+$/.test(model)
}

/**
 * Validate image URL to prevent SSRF attacks.
 * Only allows domains that the image proxy supports.
 */
function isSafeImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false

  // Must be http or https
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false

  // Max URL length
  if (url.length > 2000) return false

  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()

    // Allowlist of domains supported by the image proxy
    const ALLOWED_DOMAINS = [
      'gelbooru.com',
      'img1.gelbooru.com', 'img2.gelbooru.com', 'img3.gelbooru.com',
      'img4.gelbooru.com', 'img5.gelbooru.com',
      'danbooru.donmai.us',
      'cdn.donmai.us',
      'aibooru.online',
      'cdn.aibooru.download',
      'rule34.xxx',
      'api.rule34.xxx',
      'e621.net',
      'static1.e621.net',
      'e926.net',
    ]

    // Check if hostname matches allowed domains (exact or subdomain)
    const isAllowed = ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`))
    
    return isAllowed
  } catch {
    return false
  }
}

function proxyImageUrl(rawUrl: string, workerHost: string): string {
  // Route external images through the worker's own image proxy
  // so CF AI downloads from us, not from the CDN directly
  return `https://${workerHost}/?url=${encodeURIComponent(rawUrl)}`
}

function buildVisionMessages(tags: string | undefined, image: string, workerHost: string) {
  const systemPromptVision = `Convert Booru tags into a single flowing paragraph of natural English prose. You also receive an image for visual reference — use it to refine colors, lighting, and composition that the tags may describe imprecisely. Replace underscores with spaces. Capitalize names. Output only the paragraph. Do not use bullet points, markdown, or analysis.`

  let userContent: string
  if (tags) {
    userContent = `Image + Tags below. Cross-reference both to produce a natural language description.

TAGS:
${tags}

Describe the character, their appearance, outfit, pose, the setting, and the lighting — combining what the tags name with what the image shows.`
  } else {
    userContent = 'Describe this image as a detailed natural language prompt for an image generator. Focus on subject identity, body/appearance, clothing, pose, setting, lighting, style, and composition.'
  }

  // Route external URLs through the worker's own image proxy
  const imgUrl = isExternalUrl(image) ? proxyImageUrl(image, workerHost) : image

  return {
    model: VISION_MODEL,
    messages: [
      { role: 'system', content: systemPromptVision },
      {
        role: 'user',
        content: [
          { type: 'text', text: userContent },
          { type: 'image_url', image_url: { url: imgUrl } }
        ]
      }
    ]
  }
}

/**
 * Build multimodal messages for providers with native vision (OpenAI, Claude, OpenRouter).
 * The provider downloads the image directly — no proxy needed.
 */
function buildNativeVisionUserContent(tags: string | undefined, image: string): string {
  if (tags) {
    return `TAGS:\n${tags}\n\nDescribe this image in natural language, combining the character/outfit/scene information from the tags with the visual details (colors, lighting, composition, spatial relationships) you see in the image.`
  }
  return 'Describe this image as a natural language prompt for an image generator. Focus on subject identity, appearance, clothing, pose, setting, lighting, and composition.'
}

function buildTextMessages(tags: string, model?: string) {
  const userMessage = USER_MESSAGE_TEMPLATE.replace('TAGS_PLACEHOLDER', tags)
  return {
    model: model || TEXT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage }
    ]
  }
}

/**
 * Analyze an image using the free vision model (Gemma 4) and return a concise
 * visual description to inject into the prompt of text-only models.
 * Returns empty string on failure so the pipeline degrades gracefully.
 */
async function analyzeImageForPrompt(
  tags: string | undefined,
  image: string,
  workerHost: string,
  ai: Ai | undefined,
): Promise<string> {
  if (!ai) return ''
  try {
    const vision = buildVisionMessages(tags, image, workerHost)
    const response = await ai.run(vision.model, { messages: vision.messages }) as any
    const description = response.response
      || response.choices?.[0]?.message?.content
      || response.choices?.[0]?.text
      || ''
    return description?.trim() || ''
  } catch (err) {
    console.error('analyzeImageForPrompt error:', err)
    return ''
  }
}

/**
 * Build text messages enriched with an image description for models that
 * lack native vision. The description is injected as context before the tags.
 */
function buildEnrichedUserMessage(imageDescription: string, tags: string): string {
  return `[Visual analysis of the reference image]:\n${imageDescription}\n\nTAGS:\n${tags}\n\nUsing both the visual analysis above and the tags below, produce a natural language description. The visual analysis provides colors, lighting, composition and spatial details. The tags provide character identity, outfits, and attributes. Combine both sources.`
}

function buildTextMessagesWithVision(tags: string, imageDescription: string, model?: string) {
  return {
    model: model || TEXT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildEnrichedUserMessage(imageDescription, tags) }
    ]
  }
}

/** Extract text result from a Workers AI response (multiple possible shapes). */
function extractCfAiResult(response: any): string {
  return response.response
    || response.choices?.[0]?.message?.content
    || response.choices?.[0]?.text
    || response.content
    || response.text
    || ''
}

export async function convertPromptHandler(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('Method Not Allowed', 405)
  }

  try {
    const body = (await request.json()) as { tags?: string, provider?: string, apiKey?: string, image?: string, model?: string }
    const { tags, provider = 'cloudflare', apiKey, image, model: customModel } = body

    // ── Input Validation ──────────────────────────────────────────────────────
    // Validate provider early
    if (!isValidProvider(provider)) {
      return errorResponse('Invalid provider. Supported: cloudflare, openai, gemini, claude, deepseek, openrouter.', 400)
    }

    // Validate tags length (prevent token abuse / DoS)
    if (tags && tags.length > 3000) {
      return errorResponse('Tags too long. Maximum 3000 characters.', 400)
    }

    // Validate image URL (SSRF protection)
    if (image && !isSafeImageUrl(image)) {
      return errorResponse('Invalid or unsafe image URL. Must be a public HTTP/HTTPS URL.', 400)
    }

    // Validate custom model ID format
    if (customModel && !isValidModelId(customModel)) {
      return errorResponse('Invalid model ID format. Only alphanumeric characters, hyphens, underscores, dots, and slashes allowed.', 400)
    }

    if (!tags && !image) {
      return errorResponse('Either tags or image (or both) are required', 400)
    }

    // Validate API key format for non-free providers
    if (apiKey && provider !== 'cloudflare') {
      if (!isValidApiKey(provider, apiKey)) {
        return errorResponse('Invalid API key format. Please check your key and try again.', 400)
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    // Worker host for self-referencing the image proxy
    const workerHost = new URL(request.url).host

    // ── Rate Limiting ──────────────────────────────────────────────────────────
    const ip = request.headers.get('cf-connecting-ip') || 'unknown'
    const isFreeTier = provider === 'cloudflare' || !apiKey
    const limiters = createRatelimiters(env)
    let dailyRemaining: number | null = null

    if (limiters) {
      if (isFreeTier) {
        // 1. Check daily budget first (100 req / 24 h)
        const daily = await limiters.freeDaily.limit(ip)
        dailyRemaining = daily.remaining
        if (!daily.success) {
          return errorResponse(
            'Daily limit reached. You have used all 10 free conversions for today. Come back tomorrow or add your own API key in ⚙️ Settings.',
            429,
            {
              'X-RateLimit-Limit': daily.limit.toString(),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': daily.reset.toString(),
              'X-RateLimit-Type': 'daily',
            }
          )
        }

        // 2. Check per-minute burst limit (15 req / min)
        const minute = await limiters.freeMinute.limit(ip)
        if (!minute.success) {
          return errorResponse(
            'Too many requests. Please wait a moment before trying again.',
            429,
            {
              'X-RateLimit-Limit': minute.limit.toString(),
              'X-RateLimit-Remaining': minute.remaining.toString(),
              'X-RateLimit-Reset': minute.reset.toString(),
              'X-RateLimit-Type': 'minute',
              'X-RateLimit-Daily-Remaining': daily.remaining.toString(),
            }
          )
        }
      } else {
        // Paid / own API key: only per-minute protection (60 req / min)
        const minute = await limiters.paidMinute.limit(ip)
        if (!minute.success) {
          return errorResponse(
            'Too many requests. Please wait a moment before trying again.',
            429,
            {
              'X-RateLimit-Limit': minute.limit.toString(),
              'X-RateLimit-Remaining': minute.remaining.toString(),
              'X-RateLimit-Reset': minute.reset.toString(),
              'X-RateLimit-Type': 'minute',
            }
          )
        }
      }
    }
    // ───────────────────────────────────────────────────────────────────────────

    // ── Cloudflare Workers AI (Default, Free) ──────────────────────────────────
    if (provider === 'cloudflare' || !apiKey) {
      if (!env.AI) return errorResponse('AI service temporarily unavailable', 503)

      // Shared headers exposing remaining daily budget to the client
      const rlHeaders: Record<string, string> = {}
      if (dailyRemaining !== null) rlHeaders['X-RateLimit-Daily-Remaining'] = dailyRemaining.toString()

      try {
        if (image) {
          // Vision path: analyze image with Gemma 4, then feed to text model
          const imageDesc = await analyzeImageForPrompt(tags, image, workerHost, env.AI)
          const textMsg = buildTextMessagesWithVision(tags || '', imageDesc, customModel)
          const response = await env.AI.run(textMsg.model, { messages: textMsg.messages }) as any
          return jsonResponse({ result: extractCfAiResult(response) }, 200, rlHeaders)
        } else {
          // Text path
          const textMsg = buildTextMessages(tags!, customModel)
          const response = await env.AI.run(textMsg.model, { messages: textMsg.messages }) as any
          const result = extractCfAiResult(response)
          if (!result) {
            console.error('Empty AI response:', JSON.stringify(response).slice(0, 500))
          }
          return jsonResponse({ result }, 200, rlHeaders)
        }
      } catch (aiErr: unknown) {
        console.error('Cloudflare AI error:', aiErr)
        if (isCfAiQuotaError(aiErr)) {
          return errorResponse(
            'Cloudflare AI daily quota has been reached for today — all free users are affected. Please add your own API key in ⚙️ Settings to continue.',
            503
          )
        }
        throw aiErr // re-throw so the outer catch returns a generic 500
      }
    }

    // ── OpenAI ──
    if (provider === 'openai') {
      let messages: any[]
      if (image) {
        // Native vision: user's key, OpenAI downloads the image
        const imgUrl = isExternalUrl(image) ? proxyImageUrl(image, workerHost) : image
        messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            { type: 'text', text: buildNativeVisionUserContent(tags, image) },
            { type: 'image_url', image_url: { url: imgUrl } }
          ]}
        ]
      } else {
        messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: USER_MESSAGE_TEMPLATE.replace('TAGS_PLACEHOLDER', tags as string) }
        ]
      }
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: customModel || 'gpt-5.4-mini', messages, temperature: 0.7 })
      })
      if (!res.ok) {
        const error = await res.json() as any;
        console.error('OpenAI error:', res.status, error)
        // Pass through user-actionable errors (4xx), generic message for server errors (5xx)
        if (res.status >= 400 && res.status < 500) {
          return errorResponse(error.error?.message || 'Invalid request to OpenAI', res.status)
        }
        return errorResponse('OpenAI service temporarily unavailable', 503)
      }
      const data = await res.json() as any;
      const { content, usage } = extractOpenAICompatibleContent(data, 'openai')
      return jsonResponse({ result: content, usage }, 200)
    }

    // ── Gemini ──
    if (provider === 'gemini') {
      if (!apiKey) {
        return errorResponse('Gemini API key required. Provide your own key in ⚙️ Settings.', 400)
      }

      let userMessage: string
      if (image) {
        // Gemini fileData.fileUri doesn't accept external URLs — use Gemma 4 vision pipeline
        if (!env.AI) return errorResponse('AI service temporarily unavailable', 503)
        const imageDesc = await analyzeImageForPrompt(tags, image, workerHost, env.AI)
        userMessage = buildEnrichedUserMessage(imageDesc, tags as string)
      } else {
        userMessage = USER_MESSAGE_TEMPLATE.replace('TAGS_PLACEHOLDER', tags as string)
      }

      const modelName = customModel || 'gemini-3.5-flash'
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents: [{ role: "user", parts: [{ text: userMessage }] }],
          generationConfig: { temperature: 0.7 }
        })
      })
      if (!res.ok) {
        const error = await res.json() as any;
        console.error('Gemini error:', res.status, error)
        if (res.status >= 400 && res.status < 500) {
          return errorResponse(error.error?.message || 'Invalid request to Gemini', res.status)
        }
        return errorResponse('Gemini service temporarily unavailable', 503)
      }
      const data = await res.json() as any;
      return jsonResponse({
        result: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
        usage: data.usageMetadata || null,
      }, 200)
    }

    // ── Claude (Anthropic) ──
    if (provider === 'claude') {
      let claudeContent: any
      if (image) {
        // Native vision: user's key, Claude downloads the image
        const imgUrl = isExternalUrl(image) ? proxyImageUrl(image, workerHost) : image
        claudeContent = [
          { type: 'text', text: buildNativeVisionUserContent(tags, image) },
          { type: 'image', source: { type: 'url', url: imgUrl } }
        ]
      } else {
        claudeContent = USER_MESSAGE_TEMPLATE.replace('TAGS_PLACEHOLDER', tags as string)
      }
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2024-06-01',
        },
        body: JSON.stringify({
          model: customModel || 'claude-sonnet-4-6',
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: claudeContent }],
          temperature: 0.7, max_tokens: 1024
        })
      })
      if (!res.ok) {
        const error = await res.json() as any;
        console.error('Claude error:', res.status, error)
        if (res.status >= 400 && res.status < 500) {
          return errorResponse(error.error?.message || 'Invalid request to Claude', res.status)
        }
        return errorResponse('Claude service temporarily unavailable', 503)
      }
      const data = await res.json() as any;
      const content = data?.content?.[0]?.text || ''
      if (!content) {
        console.error('Claude: empty content — full response:', JSON.stringify(data).slice(0, 2000))
      }
      return jsonResponse({ result: content, usage: data.usage || null }, 200)
    }

    // ── DeepSeek ──
    if (provider === 'deepseek') {
      let userMessage: string
      if (image) {
        if (!env.AI) return errorResponse('AI service temporarily unavailable', 503)
        const imageDesc = await analyzeImageForPrompt(tags, image, workerHost, env.AI)
        userMessage = buildEnrichedUserMessage(imageDesc, tags as string)
      } else {
        userMessage = USER_MESSAGE_TEMPLATE.replace('TAGS_PLACEHOLDER', tags as string)
      }
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          // deepseek-chat is deprecated as of July 2026; use deepseek-v4-flash (fast) or deepseek-v4-pro (best)
          model: customModel || 'deepseek-v4-flash',
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage }],
          temperature: 0.7
        })
      })
      if (!res.ok) {
        const error = await res.json() as any;
        console.error('DeepSeek error:', res.status, error)
        if (res.status >= 400 && res.status < 500) {
          return errorResponse(error.error?.message || 'Invalid request to DeepSeek', res.status)
        }
        return errorResponse('DeepSeek service temporarily unavailable', 503)
      }
      const data = await res.json() as any;
      const { content, usage } = extractOpenAICompatibleContent(data, 'deepseek')
      return jsonResponse({ result: content, usage }, 200)
    }

    // ── OpenRouter ──
    if (provider === 'openrouter') {
      let messages: any[]
      if (image) {
        // Native vision: user's key, OpenRouter passes through to underlying model
        const imgUrl = isExternalUrl(image) ? proxyImageUrl(image, workerHost) : image
        messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            { type: 'text', text: buildNativeVisionUserContent(tags, image) },
            { type: 'image_url', image_url: { url: imgUrl } }
          ]}
        ]
      } else {
        messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: USER_MESSAGE_TEMPLATE.replace('TAGS_PLACEHOLDER', tags as string) }
        ]
      }
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://booru-prompt-gallery.pages.dev',
          'X-Title': 'Booru Prompt Gallery',
        },
        body: JSON.stringify({
          model: customModel || 'google/gemini-3.5-flash',
          messages, temperature: 0.7
        })
      })
      if (!res.ok) {
        const error = await res.json() as any;
        console.error('OpenRouter error:', res.status, error)
        if (res.status >= 400 && res.status < 500) {
          return errorResponse(error.error?.message || 'Invalid request to OpenRouter', res.status)
        }
        return errorResponse('OpenRouter service temporarily unavailable', 503)
      }
      const data = await res.json() as any;
      const { content, usage } = extractOpenAICompatibleContent(data, 'openrouter')
      return jsonResponse({ result: content, usage }, 200)
    }

    return errorResponse('Invalid provider', 400)
  } catch (error: any) {
    console.error('LLM Convert error:', error)
    // Generic error message — don't leak internal details
    return errorResponse('An unexpected error occurred. Please try again.', 500)
  }
}
