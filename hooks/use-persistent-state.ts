import { useState, useEffect, useRef, useCallback, Dispatch, SetStateAction } from 'react'
import { STORAGE_EVENT_NAME } from '@/lib/storage'
import { onSettingsChange } from '@/lib/settings-bridge'

/**
 * Syncs React state with localStorage via typed getter/setter pairs.
 *
 * - Hydrates synchronously on first render (lazy useState initializer).
 * - Writes back to storage when state changes, batched via 300ms debounce
 *   to avoid blocking the main thread during rapid updates (sliders, toggles).
 * - Listens for external storage events (cloud sync, other tabs) and
 *   updates state only when the new value actually differs.
 * - Prevents infinite loops by tracking own writes via `isWritingRef`
 *   and deduplicating via JSON comparison in `lastJsonRef`.
 */
export function usePersistentState<T>(
  initialValue: T,
  getter: () => T,
  setter: (value: T) => void,
  keyName: string,
  storageKey?: string
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setStateRaw] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue
    try {
      const stored = getter()
      if (stored !== undefined && stored !== null) return stored
    } catch {
      // Fall through to initialValue
    }
    return initialValue
  })

  const isWritingRef = useRef(false)
  const lastJsonRef = useRef<string>(JSON.stringify(state))
  const pendingWriteRef = useRef<T | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const setState: Dispatch<SetStateAction<T>> = useCallback((action) => {
    setStateRaw(action)
  }, [])

  // Batched write to localStorage: collects rapid changes and flushes after 300ms idle
  useEffect(() => {
    const stateJson = JSON.stringify(state)
    if (stateJson === lastJsonRef.current) return

    try {
      const storedJson = JSON.stringify(getter())
      if (storedJson === stateJson) {
        lastJsonRef.current = stateJson
        return
      }
    } catch {
      // Proceed with write if getter fails
    }

    // Debounce: queue the latest state and flush after 300ms of no changes
    pendingWriteRef.current = state

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(() => {
      const toWrite = pendingWriteRef.current
      if (toWrite === null) return

      const json = JSON.stringify(toWrite)
      if (json === lastJsonRef.current) return

      isWritingRef.current = true
      lastJsonRef.current = json
      try {
        setter(toWrite)
      } catch {
        // Silently fail on write errors
      }
      queueMicrotask(() => { isWritingRef.current = false })
      pendingWriteRef.current = null
    }, 300)

    return () => {
      // Flush pending write on unmount or before next effect
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [state, setter, getter])

  // Flush pending writes on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (pendingWriteRef.current !== null) {
        const json = JSON.stringify(pendingWriteRef.current)
        if (json !== lastJsonRef.current) {
          try {
            setter(pendingWriteRef.current)
          } catch {
            // Last-chance write
          }
        }
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [setter])

  // Listen for external storage changes (cloud sync, other tabs)
  useEffect(() => {
    if (!storageKey) return

    const handleStorageChange = (e: Event) => {
      if (isWritingRef.current) return

      const detail = (e as CustomEvent).detail
      if (detail?.key !== storageKey) return

      try {
        const newValue = getter()
        const newJson = JSON.stringify(newValue)
        if (newJson !== lastJsonRef.current) {
          lastJsonRef.current = newJson
          setStateRaw(newValue)
        }
      } catch {
        // Ignore malformed storage data
      }
    }

    const handleNativeStorageChange = (e: StorageEvent) => {
      if (e.key !== storageKey) return
      if (isWritingRef.current) return

      try {
        const newValue = getter()
        const newJson = JSON.stringify(newValue)
        if (newJson !== lastJsonRef.current) {
          lastJsonRef.current = newJson
          setStateRaw(newValue)
        }
      } catch {
        // Ignore malformed storage data
      }
    }

    window.addEventListener(STORAGE_EVENT_NAME, handleStorageChange)
    window.addEventListener('storage', handleNativeStorageChange)

    // Also listen via BroadcastChannel for cross-context sync (web app ↔ extension)
    const unsubBC = onSettingsChange((key) => {
      if (key !== storageKey) return
      if (isWritingRef.current) return
      try {
        const newValue = getter()
        const newJson = JSON.stringify(newValue)
        if (newJson !== lastJsonRef.current) {
          lastJsonRef.current = newJson
          setStateRaw(newValue)
        }
      } catch {
        // Ignore malformed storage data
      }
    })

    return () => {
      window.removeEventListener(STORAGE_EVENT_NAME, handleStorageChange)
      window.removeEventListener('storage', handleNativeStorageChange)
      unsubBC()
    }
  }, [storageKey, getter])

  return [state, setState]
}
