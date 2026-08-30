"use client"

/**
 * Multi-line counterpart to SearchWithAutocomplete: a plain <Textarea> with
 * the same comma-separated tag-boundary detection + Supabase tag suggestions
 * dropdown, but usable anywhere a free-text tag list needs autocomplete
 * (e.g. Pack Mode's "Full Setup" custom base prompt) instead of the single-line
 * "vanish" search input.
 */
import * as React from "react"
import { useState, useRef, useCallback } from "react"
import { Textarea } from "@/components/ui/textarea"
import { searchTags, TagResult } from "@/lib/supabase/client-queries"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"

interface TagAutocompleteTextareaProps
  extends Omit<React.ComponentProps<"textarea">, "value" | "onChange"> {
  value: string
  onValueChange: (value: string) => void
}

function getCurrentTag(text: string, position: number) {
  const leftPart = text.slice(0, position)
  const rightPart = text.slice(position)

  const lastCommaIndex = leftPart.lastIndexOf(",")
  const nextCommaIndex = rightPart.indexOf(",")

  const start = lastCommaIndex + 1
  const end = nextCommaIndex === -1 ? text.length : position + nextCommaIndex

  const currentTag = text.slice(start, end).trim()

  return { tag: currentTag, start, end }
}

function getCategoryColor(category: number) {
  switch (category) {
    case 0: return "text-blue-500 dark:text-blue-400" // General
    case 1: return "text-red-500 dark:text-red-400" // Artist
    case 3: return "text-purple-500 dark:text-purple-400" // Copyright
    case 4: return "text-green-500 dark:text-green-400" // Character
    case 5: return "text-orange-500 dark:text-orange-400" // Meta
    default: return "text-foreground"
  }
}

function getCategoryLabel(category: number) {
  switch (category) {
    case 0: return "General"
    case 1: return "Artist"
    case 3: return "Copyright"
    case 4: return "Character"
    case 5: return "Meta"
    default: return "Other"
  }
}

export function TagAutocompleteTextarea({
  value,
  onValueChange,
  className,
  onKeyDown,
  onBlur,
  ...props
}: TagAutocompleteTextareaProps) {
  const [suggestions, setSuggestions] = useState<TagResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const cursorPositionRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const debounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    onValueChange(newValue)
    cursorPositionRef.current = e.target.selectionStart ?? 0

    if (debounceTimeout.current) clearTimeout(debounceTimeout.current)

    const { tag } = getCurrentTag(newValue, e.target.selectionStart ?? 0)

    if (tag.length < 2) {
      setSuggestions([])
      setIsOpen(false)
      return
    }

    setIsLoading(true)
    debounceTimeout.current = setTimeout(async () => {
      try {
        const results = await searchTags(tag)
        setSuggestions(results)
        setIsOpen(results.length > 0)
        setActiveIndex(-1)
      } catch (error) {
        console.error("Autosuggest error:", error)
      } finally {
        setIsLoading(false)
      }
    }, 300)
  }, [onValueChange])

  const selectSuggestion = useCallback((suggestion: TagResult) => {
    const { start, end } = getCurrentTag(value, cursorPositionRef.current)

    const before = value.slice(0, start)
    const after = value.slice(end)

    const newValue = before + suggestion.name + (after.startsWith(",") ? "" : ", ") + after.trimStart()

    onValueChange(newValue)
    setIsOpen(false)
    setSuggestions([])

    // Refocus + place the cursor right after the inserted tag, same as a
    // native autocomplete would — otherwise focus stays wherever it last
    // was while the value changes underneath it.
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      const cursorPos = before.length + suggestion.name.length + 2
      el.setSelectionRange(cursorPos, cursorPos)
    })
  }, [value, onValueChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIndex((prev) => (prev + 1) % suggestions.length)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length)
      } else if (e.key === "Enter" && activeIndex >= 0 && activeIndex < suggestions.length) {
        e.preventDefault()
        selectSuggestion(suggestions[activeIndex])
      } else if (e.key === "Escape") {
        setIsOpen(false)
      }
    }
    onKeyDown?.(e)
  }, [isOpen, suggestions, activeIndex, selectSuggestion, onKeyDown])

  const handleBlur = useCallback((e: React.FocusEvent<HTMLTextAreaElement>) => {
    // Delay so a click on a suggestion (which blurs the textarea first)
    // still registers before the dropdown unmounts.
    setTimeout(() => setIsOpen(false), 150)
    onBlur?.(e)
  }, [onBlur])

  return (
    <div ref={containerRef} className="relative w-full">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={className}
        {...props}
      />

      {isOpen && suggestions.length > 0 && (
        <div
          data-state={isOpen ? "open" : "closed"}
          className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg z-50 overflow-hidden max-h-[220px] overflow-y-auto animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150 motion-reduce:animate-in motion-reduce:fade-in-0 motion-reduce:zoom-in-100 motion-reduce:slide-in-from-top-0"
        >
          {isLoading && (
            <div className="p-2 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading...
            </div>
          )}
          <ul className="py-1" role="listbox">
            {suggestions.map((suggestion, index) => (
              <li
                key={`${suggestion.name}-${index}`}
                role="option"
                aria-selected={activeIndex === index}
                className={cn(
                  "px-3 py-1.5 text-xs cursor-pointer flex justify-between items-center hover:bg-accent hover:text-accent-foreground",
                  activeIndex === index && "bg-accent text-accent-foreground"
                )}
                onClick={() => selectSuggestion(suggestion)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className={cn("font-medium", getCategoryColor(suggestion.category))}>
                  {suggestion.matchedAlias ? (
                    <>
                      <span className="text-muted-foreground">{suggestion.matchedAlias.replace(/_/g, " ")}</span>
                      <span className="text-muted-foreground mx-1.5" aria-hidden="true">&rarr;</span>
                      {suggestion.name.replace(/_/g, " ")}
                    </>
                  ) : (
                    suggestion.name.replace(/_/g, " ")
                  )}
                </span>
                <span className={cn("px-1.5 py-0.5 rounded-full bg-muted uppercase text-[10px]", getCategoryColor(suggestion.category))}>
                  {getCategoryLabel(suggestion.category)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
