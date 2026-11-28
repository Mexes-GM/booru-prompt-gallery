/**
 * The ComfyUI address check, on its own so the settings code (which every page
 * loads) does not pull in the HTTP client.
 */

export const DEFAULT_COMFY_PORT = 8188

// IPv6 ([::1]) is left out: CSP host sources cannot name an IPv6 address, so
// browsers would block it anyway.
const LOCAL_URL = /^(?:http:\/\/)?(localhost|127\.0\.0\.1)(?::(\d{1,5}))?\/?$/i

/**
 * Accepts only loopback addresses over plain http, because the site's CSP can
 * only allow those. A missing port means 8188 (ComfyUI's default). The scheme
 * is optional ("localhost:8188" works). Returns a normalized origin without a
 * trailing slash, or null when the input is not acceptable (https, LAN IPs,
 * paths, queries, credentials, ports outside 1-65535).
 */
export function normalizeComfyUrl(input: string): string | null {
  const match = LOCAL_URL.exec(input.trim())
  if (!match) return null
  const port = match[2] === undefined ? DEFAULT_COMFY_PORT : Number(match[2])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return `http://${match[1].toLowerCase()}:${port}`
}
