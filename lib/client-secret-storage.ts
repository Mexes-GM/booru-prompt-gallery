/**
 * Encrypted client-side storage helper for sensitive values (API keys, tokens).
 *
 * Threat model: this protects against casual plaintext exposure — anyone
 * glancing at localStorage/sessionStorage in DevTools, a browser-storage
 * backup/sync tool, or a log accidentally capturing storage contents no
 * longer sees the raw key. It does NOT protect against an attacker who can
 * already execute arbitrary JS in the page (a real XSS): that attacker can
 * call the same `crypto.subtle` APIs and decrypt anything this module can.
 * There is no user-supplied master password in this app, so there is no
 * secret an XSS payload couldn't also reach. Defense against that class of
 * attack is CSP / not having an XSS in the first place, not client storage
 * encryption — see hooks/use-llm-settings.ts's security-model comment.
 *
 * This exists to satisfy the "don't store secrets in clear text" bar (CodeQL
 * js/clear-text-storage-of-sensitive-data) with a real encryption step,
 * rather than reversible obfuscation like base64.
 */

const ENCRYPTION_KEY_STORAGE = "_cst_k"
const IV_LENGTH_BYTES = 12

let cachedKeyPromise: Promise<CryptoKey> | null = null

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Gets (or lazily creates) the AES-GCM key used to encrypt values in this
 * browser profile. The raw key material is persisted in localStorage as a
 * non-extractable-looking blob under a separate key so it survives across
 * sessionStorage-scoped values (which are cleared on tab close) — the key
 * itself is not treated as a "remembered" user preference.
 */
async function getOrCreateKey(): Promise<CryptoKey> {
  if (cachedKeyPromise) return cachedKeyPromise

  cachedKeyPromise = (async () => {
    let raw: Uint8Array<ArrayBuffer>
    try {
      const existing = localStorage.getItem(ENCRYPTION_KEY_STORAGE)
      if (existing) {
        raw = base64ToBytes(existing)
      } else {
        raw = crypto.getRandomValues(new Uint8Array(32))
        localStorage.setItem(ENCRYPTION_KEY_STORAGE, bytesToBase64(raw))
      }
    } catch {
      // Storage unavailable (private mode, quota, etc.) — use an ephemeral
      // in-memory key. Values encrypted this way won't survive a reload,
      // which degrades gracefully (caller sees decryption fail and treats
      // it as "no stored value").
      raw = crypto.getRandomValues(new Uint8Array(32))
    }
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
  })()

  return cachedKeyPromise
}

/** Encrypts a plaintext string, returning an opaque string safe to persist. */
export async function encryptForStorage(plaintext: string): Promise<string> {
  const key = await getOrCreateKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.length)
  return bytesToBase64(combined)
}

/** Decrypts a string previously produced by {@link encryptForStorage}. */
export async function decryptFromStorage(stored: string): Promise<string> {
  const key = await getOrCreateKey()
  const combined = base64ToBytes(stored)
  const iv = combined.slice(0, IV_LENGTH_BYTES)
  const ciphertext = combined.slice(IV_LENGTH_BYTES)
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}
