import { NextResponse } from 'next/server'
import pkg from '@/package.json'

export async function GET() {
  return NextResponse.json({ version: pkg.version, name: pkg.name }, {
    headers: {
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
'CDN-Cache-Control': 'public, s-maxage=86400',
 'Vercel-CDN-Cache-Control': 'public, s-maxage=86400',
 'Netlify-CDN-Cache-Control': 'public, s-maxage=86400',
    },
  })
}
