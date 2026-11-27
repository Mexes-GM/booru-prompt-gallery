/**
 * Which localStorage keys go into the cloud preferences blob. Large or
 * machine-local values must stay out: the blob has a 128 KB cap and going over
 * it drops the whole push.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/preferences-sync-keys.verify.ts
 */
import assert from 'node:assert/strict'
import { EXCLUDED_FROM_CLOUD_SYNC, SYNCED_KEYS } from '../hooks/use-preferences-sync'
import { STORAGE_KEYS } from '../lib/storage'
import { PAGE_COUNT_CACHE_KEY } from '../lib/booru/page-count-cache'

let passed = 0
const check = (fn: () => void) => { fn(); passed++ }

check(() => {
  for (const key of EXCLUDED_FROM_CLOUD_SYNC) assert.ok(!SYNCED_KEYS.includes(key), `${key} is excluded but still synced`)
})

check(() => {
  const mustStayLocal = [
    STORAGE_KEYS.PACK_SAVED_CURRENT,
    STORAGE_KEYS.COMFYUI_WORKFLOWS,
    STORAGE_KEYS.COMFYUI_ACTIVE_WORKFLOW,
    STORAGE_KEYS.COMFYUI_URL,
    STORAGE_KEYS.COMFYUI_ENABLED,
    STORAGE_KEYS.COMFYUI_SETUP_DONE,
  ]
  for (const key of mustStayLocal) {
    assert.ok(EXCLUDED_FROM_CLOUD_SYNC.has(key), `${key} must be excluded`)
    assert.ok(!SYNCED_KEYS.includes(key), `${key} must not be synced`)
  }
})

check(() => {
  // The page-count cache is not a STORAGE_KEYS entry, so it never reaches the blob.
  assert.ok(!SYNCED_KEYS.includes(PAGE_COUNT_CACHE_KEY))
})

check(() => {
  // Small preferences added with Pack and Send to ComfyUI still sync.
  for (const key of [STORAGE_KEYS.PACK_PREFERENCES, STORAGE_KEYS.PACK_TIPS_SEEN, STORAGE_KEYS.COMFYUI_OPTIONS]) {
    assert.ok(SYNCED_KEYS.includes(key), `${key} should sync`)
  }
})

console.log(`preferences-sync-keys: ${passed} checks passed`)
