import versionData from '../../version.json'
import { jsonResponse } from '../utils'

export function versionHandler(): Response {
  return jsonResponse(versionData, 200, {
    'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
    'CDN-Cache-Control': 'public, s-maxage=86400',
  })
}
