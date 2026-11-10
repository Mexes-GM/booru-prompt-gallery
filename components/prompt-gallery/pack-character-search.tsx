"use client"

/**
 * Character-tag search with autocomplete: how a pack starts from a character's
 * name in the entry dialog. Only character tags are offered, and Enter takes
 * the highlighted result, or else the first one.
 */
import { useEffect, useId, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { searchTagsOrThrow, type TagResult } from "@/lib/supabase/client-queries"

const CHARACTER_CATEGORY = 4

export function PackCharacterSearch({
  onPick,
  onSuggestionsOpenChange,
}: {
  /** Gets the tag with spaces, as the pack writes it. */
  onPick: (character: string) => void
  /** Tells the dialog whether the list is open, so its first Escape closes the list and not the dialog. */
  onSuggestionsOpenChange?: (open: boolean) => void
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<TagResult[]>([])
  const [loading, setLoading] = useState(false)
  // The query `results` answers, so "no match" never shows for an older one.
  const [answered, setAnswered] = useState("")
  const [failed, setFailed] = useState("")
  // Escape closes the list until the text changes.
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(-1)
  const requestRef = useRef(0)
  const listId = useId()

  useEffect(() => {
    const q = query.trim()
    const id = ++requestRef.current
    if (q.length < 2) return
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const found = await searchTagsOrThrow(q)
        if (id !== requestRef.current) return
        setResults(found.filter((t) => t.category === CHARACTER_CATEGORY).slice(0, 8))
        setAnswered(q)
        setFailed("")
        setActive(-1)
      } catch {
        if (id === requestRef.current) { setResults([]); setFailed(q) }
      } finally {
        if (id === requestRef.current) setLoading(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  const trimmed = query.trim()
  const shown = trimmed.length < 2 || dismissed || failed === trimmed ? [] : results
  const noMatch = trimmed.length >= 2 && !loading && answered === trimmed && failed !== trimmed && results.length === 0
  const searchFailed = trimmed.length >= 2 && !loading && failed === trimmed
  const listOpen = shown.length > 0
  useEffect(() => {
    onSuggestionsOpenChange?.(listOpen)
    return () => onSuggestionsOpenChange?.(false)
  }, [listOpen, onSuggestionsOpenChange])
  const pick = (name: string) => onPick(name.replace(/_/g, " "))

  return (
    <div>
      <div className="relative">
      <Input
        autoFocus
        value={query}
        onChange={(e) => { setQuery(e.target.value); setDismissed(false) }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && listOpen) setDismissed(true)
          else if (e.key === "ArrowDown" && shown.length) { e.preventDefault(); setActive((i) => (i + 1) % shown.length) }
          else if (e.key === "ArrowUp" && shown.length) { e.preventDefault(); setActive((i) => (i - 1 + shown.length) % shown.length) }
          else if (e.key === "Enter" && shown.length) { e.preventDefault(); pick(shown[Math.max(active, 0)].name) }
        }}
        placeholder="Character tag"
        aria-label="Search a character by tag"
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        className="h-9 pointer-coarse:h-11 pr-8 font-mono text-xs"
      />
      {loading && trimmed.length >= 2 && <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />}
      </div>
      {shown.length > 0 && (
        <ul id={listId} role="listbox" className="mt-1 max-h-44 overflow-y-auto rounded-md border bg-popover py-1">
          {shown.map((result, index) => (
            <li
              key={result.name}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={active === index}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(result.name)}
              onMouseEnter={() => setActive(index)}
              className={cn(
                "cursor-pointer truncate px-3 py-1.5 pointer-coarse:py-3 text-xs font-medium text-tag-character-text",
                active === index ? "bg-accent" : "hover:bg-accent"
              )}
            >
              {result.name.replace(/_/g, " ")}
            </li>
          ))}
        </ul>
      )}
      {noMatch && (
        <p role="status" className="mt-1.5 text-xs text-muted-foreground">
          No character matches this name. Try the tag as the booru spells it.
        </p>
      )}
      {searchFailed && (
        <p role="status" className="mt-1.5 text-xs text-muted-foreground">
          Couldn&apos;t search right now. Keep typing or try again in a moment.
        </p>
      )}
    </div>
  )
}
