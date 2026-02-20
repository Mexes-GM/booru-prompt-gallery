import { useState, useEffect, useRef, Dispatch, SetStateAction } from 'react'
import { STORAGE_EVENT_NAME } from '@/lib/storage'

/**
 * A hook that syncs state with local storage/userPreferences safely.
 * It prevents the "overwrite on mount" bug by waiting for the client to be ready
 * and the initial load to complete before allowing writes to storage.
 */
export function usePersistentState<T>(
  initialValue: T,
  getter: () => T,
  setter: (value: T) => void,
  keyName: string, // For debug/logging
  storageKey?: string // The actual localStorage key to sync with
): [T, Dispatch<SetStateAction<T>>] {
  // Start with default, but we'll try to load immediately if possible or effect
  const [state, setState] = useState<T>(initialValue)
  const [isLoaded, setIsLoaded] = useState(false)

  // 1. Hydrate from storage on mount
  useEffect(() => {
    try {
      const stored = getter()
      // If stored is undefined/null (depending on getter logic), we might keep initial
      if (stored !== undefined && stored !== null) {
        setState(stored)
      }
    } catch (e) {
      console.error(`Failed to load ${keyName}`, e)
    } finally {
      setIsLoaded(true)
    }
  }, []) // Run once on mount

  // 2. Listen for external updates (e.g. from cloud sync or other tabs)
  useEffect(() => {
    if (!storageKey) return

    const handleStorageChange = (e: Event) => {
      const customEvent = e as CustomEvent
      if (customEvent.detail?.key === storageKey) {
        // Update local state if it differs
        // We use the getter to ensure we parse it correctly same as initial load
        // Or we can use the value from event, but getter is safer if it has logic
        try {
            // Wait, we can't easily use getter here if it reads from localStorage 
            // and we just got the event. LocalStorage is already updated.
            const newValue = getter()
            setState(newValue)
        } catch (err) {
            console.error(`Error processing storage update for ${keyName}`, err)
        }
      }
    }

    window.addEventListener(STORAGE_EVENT_NAME, handleStorageChange)
    return () => window.removeEventListener(STORAGE_EVENT_NAME, handleStorageChange)
  }, [storageKey, getter, keyName])

  // 3. Write to storage when state changes, BUT ONLY after loading
  const isFirstRun = useRef(true)
  
  useEffect(() => {
    if (!isLoaded) return
    
    // Optional: Skip first run if we want to avoid re-writing what we just read
    // But sometimes we want to persist the default if nothing was there. 
    // Given the getter provided a value, we can assume it's safe to write back.
    
    try {
      // Avoid infinite loops: check if value in storage is already same?
      // setter usually writes blindly.
      // But since we listen to events now, writing will trigger event -> listener -> setState -> write... loop!
      // We need to break the loop.
      
      // Strategy: Check if current storage value equals state. If so, don't write.
      // But `setter` is a black box.
      
      // However, `setter` in our app calls `storage.set`, which writes and dispatches.
      // If we write, we get an event.
      // In the event handler, we `setState`.
      // `setState` triggers this effect.
      // This effect calls `setter`.
      // Loop.
      
      // Fix: In the event handler, only `setState` if value is different.
      // But we don't know the previous value easily inside the event handler without ref.
      
      // Actually, if we `setState` to the SAME value, React won't trigger re-render or effects.
      // So if `getter()` returns the same value as `state`, `setState` is a no-op.
      
      // So the loop breaker is React itself, provided `getter()` returns a value that is strict-equal (or deep equal?) to `state`.
      // If `state` is an object, `getter()` usually creates a NEW object.
      // So `setState` will trigger effect.
      
      // We need a deep comparison or JSON stringify comparison.
      
      // Let's rely on JSON stringify for the comparison since it's storage.
      const currentStored = getter()
      if (JSON.stringify(currentStored) !== JSON.stringify(state)) {
         setter(state)
      }
      
    } catch (e) {
      console.error(`Failed to save ${keyName}`, e)
    }
  }, [state, isLoaded, setter, keyName, getter])

  return [state, setState]
}
