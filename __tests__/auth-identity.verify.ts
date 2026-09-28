/**
 * Verification script for session-token verification (lib/jwt-verify.ts) and
 * trusted client-IP resolution (lib/client-ip.ts).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/auth-identity.verify.ts
 */
import { verifySupabaseJwt } from '../lib/jwt-verify'
import { getClientIp } from '../lib/client-ip'

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

function b64url(bytes: Uint8Array | string): string {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes)
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const exp = Math.floor(Date.now() / 1000) + 3600

async function signHs256(payload: object, secret: string): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`
}

async function signEs256(payload: object, privateKey: CryptoKey, kid: string): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }))
  const body = b64url(JSON.stringify(payload))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`
}

async function main() {
  // ── HS256 ──
  const secret = 'super-secret-jwt-key'
  const good = await signHs256({ sub: 'user-1', exp }, secret)
  assert((await verifySupabaseJwt(good, { hsSecret: secret })) === 'user-1', 'HS256 valid token → sub')
  assert((await verifySupabaseJwt(good, { hsSecret: 'wrong' })) === null, 'HS256 wrong secret → null')
  assert((await verifySupabaseJwt(good, {})) === null, 'HS256 without secret → null')
  const expired = await signHs256({ sub: 'user-1', exp: 1 }, secret)
  assert((await verifySupabaseJwt(expired, { hsSecret: secret })) === null, 'HS256 expired → null')
  const [h, , s] = good.split('.')
  const forged = `${h}.${b64url(JSON.stringify({ sub: 'admin', exp }))}.${s}`
  assert((await verifySupabaseJwt(forged, { hsSecret: secret })) === null, 'HS256 tampered payload → null')
  assert((await verifySupabaseJwt('not-a-jwt', { hsSecret: secret })) === null, 'malformed → null')

  // ── ES256 via JWKS ──
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1', alg: 'ES256' }
  let jwksFetches = 0
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    jwksFetches++
    assert(String(input) === 'https://proj.supabase.co/auth/v1/.well-known/jwks.json', 'JWKS URL derived from Supabase URL')
    return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
  }) as typeof fetch

  try {
    const es = await signEs256({ sub: 'user-2', exp }, pair.privateKey, 'key-1')
    const opts = { supabaseUrl: 'https://proj.supabase.co/' }
    assert((await verifySupabaseJwt(es, opts)) === 'user-2', 'ES256 valid token → sub')
    assert((await verifySupabaseJwt(es, opts)) === 'user-2', 'ES256 second verify uses cache')
    assert(jwksFetches === 1, 'JWKS fetched once and cached')

    const other = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const wrongKey = await signEs256({ sub: 'user-2', exp }, other.privateKey, 'key-1')
    assert((await verifySupabaseJwt(wrongKey, opts)) === null, 'ES256 signed by another key → null')

    const unknownKid = await signEs256({ sub: 'user-2', exp }, pair.privateKey, 'key-9')
    assert((await verifySupabaseJwt(unknownKid, opts)) === null, 'ES256 unknown kid → null')
    assert(jwksFetches === 2, 'unknown kid forces one JWKS refresh')
  } finally {
    globalThis.fetch = realFetch
  }

  // ── Client IP ──
  const h1 = new Headers({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4', 'x-nf-client-connection-ip': '1.2.3.4' })
  const prevVercel = process.env.VERCEL
  delete process.env.VERCEL
  assert(getClientIp(h1) === '1.2.3.4', 'Netlify: edge header beats spoofable x-forwarded-for')
  assert(getClientIp(new Headers({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' })) === '9.9.9.9', 'no edge header: first x-forwarded-for')
  assert(getClientIp(new Headers()) === 'anonymous', 'no headers: fallback')
  assert(getClientIp(new Headers(), 'unknown') === 'unknown', 'custom fallback')

  process.env.VERCEL = '1'
  const h2 = new Headers({ 'x-real-ip': '5.5.5.5', 'x-nf-client-connection-ip': '6.6.6.6' })
  assert(getClientIp(h2) === '5.5.5.5', 'Vercel: forged Netlify header ignored')
  if (prevVercel === undefined) delete process.env.VERCEL
  else process.env.VERCEL = prevVercel

  console.log(`auth-identity: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
