import pkg from '../../package.json'
import { jsonResponse } from '../utils'

export function versionHandler(): Response {
  return jsonResponse({ version: pkg.version, name: pkg.name }, 200, {
    'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
    'CDN-Cache-Control': 'public, s-maxage=86400',
  })
}
