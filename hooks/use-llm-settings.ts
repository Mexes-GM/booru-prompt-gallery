import { useState, useEffect } from 'react'

export type LLMProvider = 'cloudflare' | 'openai' | 'gemini'

export interface LLMSettings {
  provider: LLMProvider
  apiKey: string
}

const DEFAULT_SETTINGS: LLMSettings = {
  provider: 'cloudflare',
  apiKey: '',
}

// NOTE: API keys are stored in localStorage in plaintext.
// This is fine for a personal tool, but is not secure for shared environments.
export function useLLMSettings() {
  const [settings, setSettings] = useState<LLMSettings>(DEFAULT_SETTINGS)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('llm-settings')
      if (stored) {
        setSettings(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Failed to load LLM settings', e)
    }
    setIsLoaded(true)
  }, [])

  const saveSettings = (newSettings: LLMSettings) => {
    try {
      localStorage.setItem('llm-settings', JSON.stringify(newSettings))
      setSettings(newSettings)
    } catch (e) {
      console.error('Failed to save LLM settings', e)
    }
  }

  return { settings, saveSettings, isLoaded }
}
