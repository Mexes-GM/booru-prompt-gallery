import { MetadataRoute } from 'next'

export async function GET(): Promise<Response> {
  const manifest: MetadataRoute.Manifest = {
    name: 'Booru Prompt Gallery - AI Art Prompt Generator',
    short_name: 'Booru Prompt Gallery',
    description: 'Generate prompts from Booru image tags. Extract and format tags from posts, removing unnecessary metadata to create clean, ready-to-use prompts for AI art generation.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#000000',
    orientation: 'portrait-primary',
    categories: ['productivity', 'utilities', 'art'],
    lang: 'en',
    icons: [
      {
        src: '/favicon.ico',
        sizes: '48x48',
        type: 'image/x-icon'
      },
      {
        src: '/icon.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ]
  }

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200',
    },
  })
}