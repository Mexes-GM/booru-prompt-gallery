/**
 * Verification script for the page CSP in next.config.mjs:
 *   - the image/API proxies are allowed by their exact origins (taken from the
 *     NEXT_PUBLIC_* vars), never by *.workers.dev or *.cloudfront.net
 *   - script-src allows no proxy at all: nothing loads scripts from them
 *   - an empty var adds nothing, and a malformed one fails the build
 *
 * next.config.mjs is an ES module that reads env vars at import time, so each
 * case imports it in a fresh Node process.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/csp-proxy-origins.verify.ts
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

const CONFIG_URL = pathToFileURL(join(__dirname, '..', 'next.config.mjs')).href
const SCRIPT = `
const { default: config } = await import(${JSON.stringify(CONFIG_URL)})
const rules = await config.headers()
const page = rules.find((r) => r.source === '/((?!api/|extension).*)')
const csp = page.headers.find((h) => h.key === 'Content-Security-Policy').value
process.stdout.write(JSON.stringify(Object.fromEntries(
  csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...values] = d.split(' ')
    return [name, values]
  })
)))
`

type Directives = Record<string, string[]>

function policyFor(env: Record<string, string>): { directives?: Directives; status: number | null } {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', SCRIPT], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'production',
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      NEXT_PUBLIC_IMAGE_PROXY_URL: '',
      NEXT_PUBLIC_CDN_PROXY_URL: '',
      NEXT_PUBLIC_GELBOORU_CDN_URL: '',
      ...env,
    },
  })
  if (result.status !== 0) return { status: result.status }
  return { directives: JSON.parse(result.stdout), status: 0 }
}

const WORKER = 'https://booru-image-proxy.example.workers.dev'
const DANBOORU_CDN = 'https://danbooru-test.cloudfront.net'
const GELBOORU_CDN = 'https://gelbooru-test.cloudfront.net'

// ── All three proxies configured ────────────────────────────────────────────
{
  const { directives } = policyFor({
    NEXT_PUBLIC_IMAGE_PROXY_URL: `${WORKER}/`,
    NEXT_PUBLIC_CDN_PROXY_URL: DANBOORU_CDN,
    NEXT_PUBLIC_GELBOORU_CDN_URL: `${GELBOORU_CDN}/some/path`,
  })
  assert(directives !== undefined, 'config loads with all proxies set')
  if (directives) {
    for (const name of ['img-src', 'connect-src']) {
      // CSP sources are whole tokens: compare them exactly, never as substrings.
      const values = new Set(directives[name] ?? [])
      assert(values.has(WORKER), `${name} allows the Worker origin`)
      assert(values.has(DANBOORU_CDN), `${name} allows the Danbooru CDN origin`)
      assert(values.has(GELBOORU_CDN), `${name} allows the Gelbooru CDN origin (path dropped)`)
    }
    const all = Object.values(directives).flat()
    assert(!all.some((v) => v.includes('*.workers.dev')), 'no *.workers.dev wildcard anywhere')
    assert(!all.some((v) => v.includes('*.cloudfront.net')), 'no *.cloudfront.net wildcard anywhere')
    const scripts = directives['script-src'] ?? []
    assert(!scripts.some((v) => v.includes('workers.dev') || v.includes('cloudfront')), 'script-src allows no proxy')
    assert(new Set(scripts).has('https://challenges.cloudflare.com'), 'script-src still allows Turnstile')
  }
}

// ── Same origin in two vars is listed once ──────────────────────────────────
{
  const { directives } = policyFor({
    NEXT_PUBLIC_CDN_PROXY_URL: DANBOORU_CDN,
    NEXT_PUBLIC_GELBOORU_CDN_URL: DANBOORU_CDN,
  })
  const count = (directives?.['img-src'] ?? []).filter((v) => v === DANBOORU_CDN).length
  assert(count === 1, 'a shared origin appears once')
}

// ── No proxies configured (local dev) ───────────────────────────────────────
{
  const { directives } = policyFor({})
  assert(directives !== undefined, 'config loads with no proxies set')
  if (directives) {
    const all = Object.values(directives).flat()
    assert(!all.some((v) => v.includes('workers.dev') || v.includes('cloudfront')), 'no proxy origin when unset')
    assert(!all.includes('undefined') && !all.includes(''), 'no empty or undefined source')
  }
}

// ── Malformed URL fails the build instead of widening the policy ────────────
{
  const { status } = policyFor({ NEXT_PUBLIC_IMAGE_PROXY_URL: 'booru-image-proxy.workers.dev' })
  assert(status !== 0, 'a relative/malformed proxy URL throws')
}

console.log(`csp-proxy-origins: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
