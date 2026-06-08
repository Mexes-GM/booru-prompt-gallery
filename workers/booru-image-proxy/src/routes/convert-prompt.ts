import { Env } from '../types'
import { jsonResponse, errorResponse } from '../utils'
import { Redis } from '@upstash/redis/cloudflare'
import { Ratelimit } from '@upstash/ratelimit'

const SYSTEM_PROMPT = `You are an expert prompt engineer for generative AI image models (like Midjourney, Stable Diffusion XL).
Your task is to take a list of 'booru tags' and convert them into a cohesive, descriptive natural language paragraph in English.
Prioritize the main subject first, then clothing/appearance, then the setting/environment, and finally the visual style, lighting, or quality tags.
Do not add elements that are not present in the tags, but try to make the sentence flow naturally.`

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

const TEXT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast'
const VISION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct'

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
  const systemPromptVision = `You are an expert prompt engineer for generative AI image models (like Midjourney, Stable Diffusion XL, Anima).
Your task is to analyze the provided image and tags, then produce a cohesive, descriptive natural language prompt in English.
Prioritize the main subject first, then clothing/appearance, then the setting/environment, and finally the visual style, lighting, or quality tags.
Incorporate details you see in the image that match or complement the provided tags.
Do not add elements that are not present in the image or tags, but try to make the sentence flow naturally.
If no tags are provided, describe the image as a prompt for an AI image generator.`

  let userContent: string
  if (tags) {
    userContent = `Convert these tags into a natural language prompt, using the attached image as reference:\n\n${tags}`
  } else {
    userContent = 'Describe this image as a detailed prompt for an AI image generator. Focus on subject, clothing, setting, style, and lighting.'
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

function buildTextMessages(tags: string) {

  return {
    model: TEXT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Convert these tags into a natural language prompt:\n\n${tags}` }
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
    const body = (await request.json()) as { tags?: string, provider?: string, apiKey?: string, image?: string }
    const { tags, provider = 'cloudflare', apiKey, image } = body

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

    // ── Cloudflare Workers AI (Default, Free) ──
    if (provider === 'cloudflare' || !apiKey) {
      if (!env.AI) {
        return errorResponse('Cloudflare AI binding is not configured', 500)
      }

      let model: string
      let input: Record<string, unknown>

      if (image) {
        // Vision path: route image through worker proxy, send to multimodal model
        const vision = buildVisionMessages(tags, image, workerHost)
        model = vision.model
        input = { messages: vision.messages }
      } else {
        const text = buildTextMessages(tags!)
        model = text.model
        input = { messages: text.messages }
      }

      const response = await env.AI.run(model, input) as any
      return jsonResponse({ result: response.response || response.choices?.[0]?.message?.content || '' }, 200)
    }

    // ── OpenAI ──
    if (provider === 'openai') {
      if (image) {
        return errorResponse('Image to prompt conversion is currently only supported with Cloudflare AI', 400)
      }

      const userPrompt = `Convert these tags into a natural language prompt:\n\n${tags}`

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 250
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
      if (image) {
        return errorResponse('Image to prompt conversion is currently only supported with Cloudflare AI', 400)
      }

      const userPrompt = `Convert these tags into a natural language prompt:\n\n${tags}`

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey as string
        },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: SYSTEM_PROMPT + "\n\n" + userPrompt }] }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 250,
          }
        })
      })

      if (!res.ok) {
        const error = await res.json() as any;
        return errorResponse(error.error?.message || 'Failed to call Gemini', res.status)
      }

      const data = await res.json() as any;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return jsonResponse({ result: text }, 200)
    }

    return errorResponse('Invalid provider', 400)
  } catch (error: any) {
    console.error('LLM Convert error:', error)
    return errorResponse(error.message || 'Internal server error', 500)
  }
}
