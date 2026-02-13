import { useState, useEffect, useRef, Dispatch, SetStateAction } from 'react'

/**
 * A hook that syncs state with local storage/userPreferences safely.
 * It prevents the "overwrite on mount" bug by waiting for the client to be ready
 * and the initial load to complete before allowing writes to storage.
 */
export function usePersistentState<T>(
  initialValue: T,
  getter: () => T,
  setter: (value: T) => void,
  keyName: string // For debug/logging
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

  // 2. Write to storage when state changes, BUT ONLY after loading
  const isFirstRun = useRef(true)
  
  useEffect(() => {
    if (!isLoaded) return
    
    // Optional: Skip first run if we want to avoid re-writing what we just read
    // But sometimes we want to persist the default if nothing was there. 
    // Given the getter provided a value, we can assume it's safe to write back.
    
    try {
      setter(state)
    } catch (e) {
      console.error(`Failed to save ${keyName}`, e)
    }
  }, [state, isLoaded, setter, keyName])

  return [state, setState]
}
