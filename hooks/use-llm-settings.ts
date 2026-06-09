import { useState, useEffect } from 'react'

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

/**
 * API keys are stored in sessionStorage by default (cleared when tab closes).
 * If the user opts in via "Remember", keys persist to localStorage.
 *
 * Security model: keys live client-side only. The worker proxies requests
 * to providers — keys are never stored server-side. CSP headers should be
 * configured to prevent XSS (the real threat to client-side secrets).
 */
export function useLLMSettings() {
  const [settings, setSettings] = useState<LLMSettings>(DEFAULT_SETTINGS)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    try {
      // 1. Try sessionStorage first (session-scoped keys)
      const sessionStored = sessionStorage.getItem(STORAGE_KEY)
      if (sessionStored) {
        const parsed = JSON.parse(sessionStored)
        setSettings({ ...DEFAULT_SETTINGS, ...parsed, remember: false })
        setIsLoaded(true)
        return
      }

      // 2. Try localStorage (opt-in "Remember" persistence)
      const localStored = localStorage.getItem(STORAGE_KEY)
      if (localStored) {
        const parsed = JSON.parse(localStored)
        setSettings({ ...DEFAULT_SETTINGS, ...parsed, remember: true })
        setIsLoaded(true)
        return
      }
    } catch (e) {
      console.error('Failed to load LLM settings', e)
    }
    setIsLoaded(true)
  }, [])

  const saveSettings = (newSettings: LLMSettings) => {
    try {
      // Clear both storages first to avoid stale data
      sessionStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(STORAGE_KEY)

      if (newSettings.remember) {
        // Persist to localStorage (survives tab close)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings))
      } else {
        // Session-only (cleared when tab closes)
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings))
      }
      setSettings(newSettings)
    } catch (e) {
      console.error('Failed to save LLM settings', e)
    }
  }

  return { settings, saveSettings, isLoaded }
}
