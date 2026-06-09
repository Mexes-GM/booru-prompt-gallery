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
- At least 2–3 sentences. Only describe what the tags say.

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

function getRatelimit(env: Env, type: 'free' | 'paid'): Ratelimit | null {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return null
  }
  
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  })

  return type === 'free' 
    ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(15, '1 m'), prefix: 'ratelimit:ai:free' })
    : new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, '1 m'), prefix: 'ratelimit:ai:paid' })
}

const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
// Alternatives:
// '@cf/meta/llama-3.3-70b-instruct-fp8-fast' — 70B, most natural prose
// '@cf/zai-org/glm-4.7-flash' — instruction-following, fast
// '@cf/meta/llama-3.1-8b-instruct-fast' — 8B, fastest
const VISION_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct'

function isExternalUrl(s: string): boolean {
  return s.startsWith('http://') || s.startsWith('https://')
}

function isDataUrl(s: string): boolean {
  return s.startsWith('data:')
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

    if (!tags && !image) {
      return errorResponse('Either tags or image (or both) are required', 400)
    }

    // Worker host for self-referencing the image proxy
    const workerHost = new URL(request.url).host

    // Rate Limiting Check
    const ip = request.headers.get('cf-connecting-ip') || 'unknown'
    const isFreeTier = provider === 'cloudflare' || !apiKey
    const ratelimit = getRatelimit(env, isFreeTier ? 'free' : 'paid')

    if (ratelimit) {
      const { success, limit, remaining, reset } = await ratelimit.limit(ip)
      if (!success) {
        return new Response(JSON.stringify({ error: 'Too Many Requests. Please wait a moment before trying again.' }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
          }
        })
      }
    }

    // ── Cloudflare Workers AI (Default, Free) / Gemini Fallback ──
    if (provider === 'cloudflare' || !apiKey) {
      if (image) {
        if (!env.AI) return errorResponse('Cloudflare AI binding is not configured', 500)
        // Vision path: route image through worker proxy, send to multimodal model
        const vision = buildVisionMessages(tags, image, workerHost)
        const response = await env.AI.run(vision.model, { messages: vision.messages }) as any
        return jsonResponse({ result: response.response || response.choices?.[0]?.message?.content || '' }, 200)
      } else {
        // Text path: Cloudflare AI
        if (!env.AI) return errorResponse('Cloudflare AI binding is not configured', 500)
        const textMsg = buildTextMessages(tags!, customModel)
        const response = await env.AI.run(textMsg.model, { messages: textMsg.messages }) as any
        // Try all known response formats
        const result = response.response 
          || response.choices?.[0]?.message?.content 
          || response.choices?.[0]?.text
          || response.content
          || response.text
          || ''
        if (!result) {
          console.error('Empty AI response:', JSON.stringify(response).slice(0, 500))
        }
        return jsonResponse({ result }, 200)
      }
    }

    // ── OpenAI ──
    if (provider === 'openai') {
      if (image) return errorResponse('Image to prompt conversion is currently only supported with Cloudflare AI', 400)
      const userMessage = USER_MESSAGE_TEMPLATE.replace('TAGS_PLACEHOLDER', tags as string)
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: customModel || 'gpt-5.4-mini',
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage }],
          temperature: 0.7, max_tokens: 300
        })
      })
      if (!res.ok) {
        const error = await res.json() as any;
        return errorResponse(error.error?.message || 'Failed to call OpenAI', res.status)
      }
      const data = await res.json() as any;
      return jsonResponse({ result: data.choices[0].message.content }, 200)
    }

    // ── Gemini ──
    if (provider === 'gemini') {
      if (image) return errorResponse('Image to prompt conversion is currently only supported with Cloudflare AI', 400)
      const userMessage = USER_MESSAGE_TEMPLATE.replace('TAGS_PLACEHOLDER', tags as string)
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${customModel || 'gemini-3.5-flash'}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey as string },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents: [{ role: "user", parts: [{ text: userMessage }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
        })
      })
      if (!res.ok) {
        const error = await res.json() as any;
        return errorResponse(error.error?.message || 'Failed to call Gemini', res.status)
      }
      const data = await res.json() as any;
      return jsonResponse({ result: data.candidates?.[0]?.content?.parts?.[0]?.text || '' }, 200)
    }

    // ── Claude (Anthropic) ──
    if (provider === 'claude') {
      if (image) return errorResponse('Image to prompt conversion is currently only supported with Cloudflare AI', 400)
      const userMessage = USER_MESSAGE_TEMPLATE.replace('TAGS_PLACEHOLDER', tags as string)
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: customModel || 'claude-4.6-sonnet',
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
          temperature: 0.7, max_tokens: 300
        })
      })
      if (!res.ok) {
        const error = await res.json() as any;
        return errorResponse(error.error?.message || 'Failed to call Claude', res.status)
      }
      const data = await res.json() as any;
      return jsonResponse({ result: data.content[0].text }, 200)
    }

    // ── DeepSeek ──
    if (provider === 'deepseek') {
      if (image) return errorResponse('Image to prompt conversion is currently only supported with Cloudflare AI', 400)
      const userMessage = USER_MESSAGE_TEMPLATE.replace('TAGS_PLACEHOLDER', tags as string)
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: customModel || 'deepseek-chat',
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage }],
          temperature: 0.7, max_tokens: 300
        })
      })
      if (!res.ok) {
        const error = await res.json() as any;
        return errorResponse(error.error?.message || 'Failed to call DeepSeek', res.status)
      }
      const data = await res.json() as any;
      return jsonResponse({ result: data.choices[0].message.content }, 200)
    }

    // ── OpenRouter ──
    if (provider === 'openrouter') {
      if (image) return errorResponse('Image to prompt conversion is currently only supported with Cloudflare AI', 400)
      const userMessage = USER_MESSAGE_TEMPLATE.replace('TAGS_PLACEHOLDER', tags as string)
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: customModel || 'google/gemini-3.5-flash',
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage }],
          temperature: 0.7, max_tokens: 300
        })
      })
      if (!res.ok) {
        const error = await res.json() as any;
        return errorResponse(error.error?.message || 'Failed to call OpenRouter', res.status)
      }
      const data = await res.json() as any;
      return jsonResponse({ result: data.choices[0].message.content }, 200)
    }

    return errorResponse('Invalid provider', 400)
  } catch (error: any) {
    console.error('LLM Convert error:', error)
    return errorResponse(error.message || 'Internal server error', 500)
  }
}
