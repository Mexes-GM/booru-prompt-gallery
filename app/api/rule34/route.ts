import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

/**
 * Rule34 API Endpoint
 * 
 * IMPORTANTE: Rule34.xxx API requiere API Key para el endpoint JSON.
 * Para obtener una API key: https://rule34.xxx/index.php?page=account&s=options
 * 
 * Configuración:
 * 1. Crear cuenta en rule34.xxx
 * 2. Ir a Account > Options
 * 3. Obtener API Key y User ID
 * 4. Configurar en variables de entorno:
 *    - RULE34_API_KEY
 *    - RULE34_USER_ID
 * 
 * Sin API key, se usa el endpoint XML público (sin JSON).
 */

const API_CONFIG = {
  baseUrl: "https://api.rule34.xxx",
  defaultParams: {
    limit: "20",
    page: "dapi",
    s: "post",
    q: "index",
  },
  randomParams: {
    limit: "15",
  },
  timeout: 10000,
  // API credentials (opcional - se obtiene de variables de entorno)
  apiKey: process.env.RULE34_API_KEY || '',
  userId: process.env.RULE34_USER_ID || '',
  // User agents reales para bypasear Cloudflare
  userAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
  ]
}

interface Rule34Post {
  id: number
  file_url: string
  sample_url: string
  preview_url: string
  tags: string
  rating: string
  score: number
  directory: string
  hash: string
  width: number
  height: number
  sample_width: number
  sample_height: number
  preview_width: number
  preview_height: number
  source: string
  change: number
  owner: string
  creator_id: number
  parent_id: number
  has_notes: boolean
  has_comments: boolean
  has_children: boolean
}

// Función para parsear XML de Rule34 a JSON
function parseRule34XML(xmlText: string): Rule34Post[] {
  const posts: Rule34Post[] = []
  
  // Extraer todos los posts del XML usando regex
  const postRegex = /<post([^>]+)\/>/g
  const matches = xmlText.matchAll(postRegex)
  
  for (const match of matches) {
    const attributes = match[1]
    const post: any = {}
    
    // Extraer atributos
    const attrRegex = /(\w+)="([^"]*)"/g
    const attrMatches = attributes.matchAll(attrRegex)
    
    for (const attrMatch of attrMatches) {
      const [, key, value] = attrMatch
      post[key] = value
    }
    
    // Convertir a formato esperado
    if (post.id && post.file_url) {
      posts.push({
        id: parseInt(post.id),
        file_url: post.file_url,
        sample_url: post.sample_url || post.file_url,
        preview_url: post.preview_url || post.preview_file_url || post.file_url,
        tags: post.tags || '',
        rating: post.rating || 'e',
        score: parseInt(post.score) || 0,
        directory: post.directory || '',
        hash: post.hash || post.md5 || '',
        width: parseInt(post.width) || 0,
        height: parseInt(post.height) || 0,
        sample_width: parseInt(post.sample_width) || 0,
        sample_height: parseInt(post.sample_height) || 0,
        preview_width: parseInt(post.preview_width) || 0,
        preview_height: parseInt(post.preview_height) || 0,
        source: post.source || '',
        change: parseInt(post.change) || 0,
        owner: post.owner || '',
        creator_id: parseInt(post.creator_id) || 0,
        parent_id: parseInt(post.parent_id) || 0,
        has_notes: post.has_notes === 'true',
        has_comments: post.has_comments === 'true',
        has_children: post.has_children === 'true',
      })
    }
  }
  
  return posts
}

interface NormalizedPost {
  id: number
  file_url: string
  large_file_url: string
  preview_file_url: string
  tag_string: string
  tag_string_artist: string
  tag_string_character: string
  tag_string_copyright: string
  rating: string
  score: number
}

// Helper function to normalize Rule34 post to our standard format
function normalizeRule34Post(post: Rule34Post): NormalizedPost {
  // Rule34 doesn't separate tags by category like Danbooru
  // All tags come in a single 'tags' field
  // We'll let cleanPrompt handle the filtering using its tag database
  
  return {
    id: post.id,
    file_url: post.file_url,
    large_file_url: post.sample_url || post.file_url,
    preview_file_url: post.preview_url,
    tag_string: post.tags, // All tags in one field
    tag_string_artist: '', // Rule34 doesn't separate these
    tag_string_character: '', // cleanPrompt will identify them
    tag_string_copyright: '', // using its tag database (tags.json)
    rating: post.rating || 'e', // Rule34 is mostly explicit
    score: post.score || 0,
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const page = searchParams.get('page') || '1'
  const tags = searchParams.get('tags') || ''
  const order = searchParams.get('order') || 'popular'
  
  // Convert 1-based page to 0-based pid for Rule34 API
  const pageNum = parseInt(page, 10)
  const pid = Math.max(0, pageNum - 1).toString()
  
  const cacheKey = `rule34-${tags}-${pid}-${order}`
  const cacheDuration = 600
  
  try {
    let finalTags = tags
    
    // Rule34 doesn't have built-in ordering like Danbooru
    // We can use sort:score for popular, or just recent posts
    if (order === 'popular') {
      finalTags = tags ? `${tags} sort:score` : 'sort:score'
    } else if (order === 'random') {
      // Rule34 supports random via sort:random
      finalTags = tags ? `${tags} sort:random` : 'sort:random'
    }
    
    // Construir parámetros base
    const params: Record<string, string> = {
      ...API_CONFIG.defaultParams,
      pid: pid, // Page ID (0-based)
      tags: finalTags,
    }
    
    // Si tenemos API key, usar JSON endpoint
    const hasApiKey = API_CONFIG.apiKey && API_CONFIG.userId
    if (hasApiKey) {
      params.json = '1'
      params.api_key = API_CONFIG.apiKey
      params.user_id = API_CONFIG.userId
    }
    
    const urlParams = new URLSearchParams(params)
    const url = new URL(`${API_CONFIG.baseUrl}/index.php`)
    url.search = urlParams.toString()

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout)

    // Seleccionar un User-Agent aleatorio para simular un navegador real
    const randomUserAgent = API_CONFIG.userAgents[Math.floor(Math.random() * API_CONFIG.userAgents.length)]

    // Primera solicitud: intentar obtener datos directamente
    let response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': randomUserAgent,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Referer': 'https://rule34.xxx/',
        'Origin': 'https://rule34.xxx',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      // Seguir redirects automáticamente
      redirect: 'follow',
      // Incluir credenciales para manejar cookies de Cloudflare
      credentials: 'include',
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      if (response.status === 429) {
        return NextResponse.json(
          { error: 'Rate limit exceeded' },
          { status: 429, headers: { 'Retry-After': '60' } }
        )
      }
      
      return NextResponse.json(
        { error: 'Failed to fetch from Rule34' },
        { status: response.status }
      )
    }

    // Obtener el texto de la respuesta
    const responseText = await response.text()
    
    // Verificar si es una respuesta de Cloudflare challenge
    if (responseText.includes('challenge-platform') || responseText.includes('Just a moment')) {
      return NextResponse.json(
        { error: 'Cloudflare protection detected. Rule34 API is temporarily unavailable. Please try again later or use a different provider.' },
        { status: 503 }
      )
    }
    
    // Verificar si es mensaje de autenticación
    if (responseText.includes('Missing authentication')) {
      return NextResponse.json(
        { error: 'Rule34 API requires authentication. Please configure RULE34_API_KEY and RULE34_USER_ID environment variables.' },
        { status: 401 }
      )
    }
    
    let posts: Rule34Post[] = []
    const useJsonEndpoint = API_CONFIG.apiKey && API_CONFIG.userId
    
    // Si usamos API key, esperamos JSON
    if (useJsonEndpoint) {
      // Manejar respuestas vacías
      if (!responseText || responseText.trim() === '') {
        return NextResponse.json([], {
          headers: {
            'Cache-Control': `public, s-maxage=${cacheDuration}, stale-while-revalidate=${cacheDuration * 2}`,
            'X-Total-Count': '0',
          },
        })
      }
      
      try {
        const jsonData = JSON.parse(responseText)
        
        if (Array.isArray(jsonData)) {
          posts = jsonData
        } else if (jsonData.post) {
          posts = Array.isArray(jsonData.post) ? jsonData.post : [jsonData.post]
        }
      } catch (error) {
        console.error('[Rule34 API] Failed to parse JSON:', error)
        
        // Si el parseo falla, retornar array vacío en lugar de error
        return NextResponse.json([], {
          headers: {
            'Cache-Control': `public, s-maxage=${cacheDuration}, stale-while-revalidate=${cacheDuration * 2}`,
            'X-Total-Count': '0',
          },
        })
      }
    } else {
      // Sin API key, parseamos XML
      if (responseText.includes('<?xml') || responseText.includes('<posts')) {
        posts = parseRule34XML(responseText)
      } else {
        return NextResponse.json([], {
          headers: {
            'Cache-Control': `public, s-maxage=${cacheDuration}, stale-while-revalidate=${cacheDuration * 2}`,
            'X-Total-Count': '0',
          },
        })
      }
    }
    
    // Filter valid posts (exclude video files and deleted)
    const validPosts = posts.filter((post: Rule34Post) => 
      post && 
      post.file_url && 
      !post.file_url.includes("deleted") && 
      post.id && 
      post.tags &&
      !post.file_url.match(/\.(mp4|webm|avi|mov|mkv)$/i)
    )

    // Normalize posts to our standard format
    const normalizedPosts = validPosts.map(normalizeRule34Post)

    return NextResponse.json(normalizedPosts, {
      headers: {
        'Cache-Control': `public, s-maxage=${cacheDuration}, stale-while-revalidate=${cacheDuration * 2}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheDuration}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheDuration * 2}`,
        'ETag': `"${cacheKey}"`,
        'X-Content-Type-Options': 'nosniff',
        'X-API-Version': '1.0',
        'X-Total-Count': normalizedPosts.length.toString(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })

  } catch (error) {
    
    let errorMessage = 'Internal server error'
    if (error instanceof Error) {
      errorMessage = error.message
    }
    
    return NextResponse.json(
      { error: errorMessage, timestamp: new Date().toISOString() },
      { status: 500, headers: { 'Cache-Control': 'no-cache' } }
    )
  }
}
