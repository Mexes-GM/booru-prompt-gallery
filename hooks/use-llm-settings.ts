import { useState, useEffect, useCallback } from 'react'
import { encryptForStorage, decryptFromStorage } from '@/lib/client-secret-storage'

export type LLMProvider = 'cloudflare' | 'openai' | 'gemini' | 'claude' | 'deepseek' | 'openrouter'

export interface LLMSettings {
  provider: LLMProvider
  apiKey: string
  customModel?: string
  /** When true, persists to localStorage. When false (default), uses sessionStorage (expires on tab close). */
  remember?: boolean
}

const DEFAULT_SETTINGS: LLMSettings = {
  provider: 'cloudflare',
  apiKey: '',
  customModel: '',
  remember: false,
}

const STORAGE_KEY = 'llm-settings'

/** On-disk shape: `apiKey` is replaced by its encrypted form before it ever reaches storage. */
type StoredLLMSettings = Omit<LLMSettings, 'apiKey'> & { encryptedApiKey?: string }

/**
 * API keys are stored in sessionStorage by default (cleared when tab closes).
 * If the user opts in via "Remember", keys persist to localStorage.
 *
 * Security model: keys live client-side only. The worker proxies requests
 * to providers — keys are never stored server-side. The apiKey itself is
 * encrypted at rest (see lib/client-secret-storage.ts) so it isn't sitting
 * in storage as plain text; CSP headers should still be configured to
 * prevent XSS, which remains the real threat to client-side secrets (an
 * attacker who can run JS in the page can decrypt this too).
 */
export function useLLMSettings() {
  const [settings, setSettings] = useState<LLMSettings>(DEFAULT_SETTINGS)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        // 1. Try sessionStorage first (session-scoped keys)
        const sessionStored = sessionStorage.getItem(STORAGE_KEY)
        // 2. Try localStorage (opt-in "Remember" persistence)
        const localStored = !sessionStored ? localStorage.getItem(STORAGE_KEY) : null
        const raw = sessionStored ?? localStored
        if (raw) {
          const parsed: StoredLLMSettings = JSON.parse(raw)
          const apiKey = parsed.encryptedApiKey ? await decryptFromStorage(parsed.encryptedApiKey) : ''
          if (!cancelled) {
            setSettings({ ...DEFAULT_SETTINGS, ...parsed, apiKey, remember: !!localStored })
          }
        }
      } catch (e) {
        console.error('Failed to load LLM settings', e)
      }
      if (!cancelled) setIsLoaded(true)
    }

    load()
    return () => { cancelled = true }
  }, [])

  const saveSettings = useCallback(async (newSettings: LLMSettings) => {
    // Update in-memory state immediately so the UI reflects the change without
    // waiting on the encryption round-trip; only the persisted copy is delayed.
    setSettings(newSettings)
    try {
      // Clear both storages first to avoid stale data
      sessionStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(STORAGE_KEY)

      const { apiKey, ...rest } = newSettings
      const toStore: StoredLLMSettings = {
        ...rest,
        encryptedApiKey: apiKey ? await encryptForStorage(apiKey) : undefined,
      }

      if (newSettings.remember) {
        // Persist to localStorage (survives tab close)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
      } else {
        // Session-only (cleared when tab closes)
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
      }
    } catch (e) {
      console.error('Failed to save LLM settings', e)
    }
  }, [])

  return { settings, saveSettings, isLoaded }
}
