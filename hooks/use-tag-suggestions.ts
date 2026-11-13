"use client"

/**
 * Tag suggestions while a slot of the pack's brief is typed in: the same lookup,
 * wait and minimum length as the app's other tag fields (SearchWithAutocomplete,
 * TagAutocompleteTextarea: searchTagsOrThrow after 300 ms from two characters), kept
 * to characters in Who and to general tags elsewhere. An answer to an older query
 * never replaces a newer one.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { slotSuggestions } from "@/lib/pack/brief-pack"
import { searchTagsOrThrow } from "@/lib/supabase/client-queries"
import type { SlotId, SuggestionStatus, TagSuggestion } from "@/components/prompt-gallery/pack/slots"

/** Same wait as the app's other tag fields. */
const TAG_LOOKUP_DELAY_MS = 300
/** Results asked of the lookup (its own most), so filtering by category still leaves some. */
const LOOKUP_LIMIT = 20

export interface UseTagSuggestionsResult {
  suggestions: readonly TagSuggestion[]
  status: SuggestionStatus
  onQueryChange: (query: string, slot: SlotId) => void
}

const NONE: TagSuggestion[] = []

export function useTagSuggestions(): UseTagSuggestionsResult {
  const [state, setState] = useState<{ slot: SlotId | null; suggestions: TagSuggestion[]; status: SuggestionStatus }>({
    slot: null,
    suggestions: NONE,
    status: "idle",
  })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestId = useRef(0)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    requestId.current++
  }, [])

  const onQueryChange = useCallback((query: string, slot: SlotId) => {
    if (timer.current) clearTimeout(timer.current)
    const id = ++requestId.current
    const text = query.trim()
    if (text.length < 2) {
      setState({ slot, suggestions: NONE, status: "idle" })
      return
    }
    // The last list stays while the next one loads, unless it belongs to another slot.
    setState((prev) => ({ slot, suggestions: prev.slot === slot ? prev.suggestions : NONE, status: "loading" }))
    timer.current = setTimeout(() => {
      timer.current = null
      searchTagsOrThrow(text, LOOKUP_LIMIT)
        .then((found) => {
          if (id !== requestId.current) return
          const suggestions = slotSuggestions(found, slot === "who" ? "who" : "other")
          setState({ slot, suggestions, status: suggestions.length > 0 ? "idle" : "empty" })
        })
        .catch(() => {
          if (id !== requestId.current) return
          setState({ slot, suggestions: NONE, status: "error" })
        })
    }, TAG_LOOKUP_DELAY_MS)
  }, [])

  return { suggestions: state.suggestions, status: state.status, onQueryChange }
}
