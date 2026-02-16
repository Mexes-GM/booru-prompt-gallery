import { NextResponse } from 'next/server'
import versionData from '@/version.json'

export async function GET() {
  return NextResponse.json(versionData, {
    headers: {
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
      'CDN-Cache-Control': 'public, s-maxage=86400',
      'Vercel-CDN-Cache-Control': 'public, s-maxage=86400',
    },
  })
}
