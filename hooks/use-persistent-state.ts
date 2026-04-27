import { useState, useEffect, useRef, useCallback, Dispatch, SetStateAction } from 'react'
import { STORAGE_EVENT_NAME } from '@/lib/storage'

/**
 * Syncs React state with localStorage via typed getter/setter pairs.
 *
 * - Hydrates synchronously on first render (lazy useState initializer).
 * - Writes back to storage when state changes, skipping redundant writes.
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

  const setState: Dispatch<SetStateAction<T>> = useCallback((action) => {
    setStateRaw(action)
  }, [])

  // Write state back to storage on change
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

    isWritingRef.current = true
    lastJsonRef.current = stateJson
    try {
      setter(state)
    } catch {
      // Silently fail on write errors
    }
    queueMicrotask(() => { isWritingRef.current = false })
  }, [state, setter, getter])

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

    window.addEventListener(STORAGE_EVENT_NAME, handleStorageChange)
    return () => window.removeEventListener(STORAGE_EVENT_NAME, handleStorageChange)
  }, [storageKey, getter])

  return [state, setState]
}
