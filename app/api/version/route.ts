import { NextResponse } from 'next/server'
import versionData from '@/version.json'

export async function GET() {
  return NextResponse.json(versionData)
}
