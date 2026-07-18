"use client"

import * as React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { PlaceholdersAndVanishInput } from "@/components/ui/placeholders-and-vanish-input"
import { searchTags, TagResult } from "@/lib/supabase/client-queries"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"

interface SearchWithAutocompleteProps {
  value: string
  setValue: (value: string) => void
  onSearch: () => void
  placeholders: string[]
  disabled?: boolean
  className?: string
  "aria-label"?: string
}

export function SearchWithAutocomplete({
  value,
  setValue,
  onSearch,
  placeholders,
  disabled,
  className,
  "aria-label": ariaLabel
}: SearchWithAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<TagResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const cursorPositionRef = useRef(0)
  
  const containerRef = useRef<HTMLDivElement>(null)
  // We don't have direct access to the input ref inside PlaceholdersAndVanishInput easily without forwarding ref
  // But we can track the wrapper.
  
  // Debounce logic
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null)

  const getCurrentTag = (text: string, position: number) => {
    // Find the tag boundary around the cursor
    // Tags are separated by commas
    const leftPart = text.slice(0, position)
    const rightPart = text.slice(position)
    
    const lastCommaIndex = leftPart.lastIndexOf(',')
    const nextCommaIndex = rightPart.indexOf(',')
    
    const start = lastCommaIndex + 1
    const end = nextCommaIndex === -1 ? text.length : position + nextCommaIndex
    
    const currentTag = text.slice(start, end).trim()
    
    return {
      tag: currentTag,
      start,
      end
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setValue(newValue)
    cursorPositionRef.current = e.target.selectionStart || 0

    if (debounceTimeout.current) clearTimeout(debounceTimeout.current)

    const { tag } = getCurrentTag(newValue, e.target.selectionStart || 0)

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
  }

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const selectSuggestion = (suggestion: TagResult) => {
    const { start, end } = getCurrentTag(value, cursorPositionRef.current)
    
    const before = value.slice(0, start)
    const after = value.slice(end)
    
    // Add comma if not present at end and there is more text, or just nice formatting
    const newValue = before + suggestion.name + (after.startsWith(',') ? '' : ', ') + after.trimStart()
    
    setValue(newValue)
    setIsOpen(false)
    setSuggestions([])
    
    // Focus logic would ideally go here, but PlaceholdersAndVanishInput manages its own input.
    // We update the state, which updates the input value.
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(prev => (prev + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(prev => (prev - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        e.preventDefault()
        e.stopPropagation() // Prevent form submit
        selectSuggestion(suggestions[activeIndex])
      } else {
        // Let it bubble to submit the form
        setIsOpen(false)
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const getCategoryColor = (category: number) => {
    switch (category) {
      case 0: return "text-blue-500 dark:text-blue-400" // General
      case 1: return "text-red-500 dark:text-red-400" // Artist
      case 3: return "text-purple-500 dark:text-purple-400" // Copyright
      case 4: return "text-green-500 dark:text-green-400" // Character
      case 5: return "text-orange-500 dark:text-orange-400" // Meta
      default: return "text-foreground"
    }
  }

  const getCategoryLabel = (category: number) => {
      switch (category) {
          case 0: return "General"
          case 1: return "Artist"
          case 3: return "Copyright"
          case 4: return "Character"
          case 5: return "Meta"
          default: return "Other"
      }
  }

  return (
    <div ref={containerRef} className="relative w-full" onKeyDown={handleKeyDown}>
      <PlaceholdersAndVanishInput
        placeholders={placeholders}
        value={value}
        setValue={setValue}
        onChange={handleInputChange}
        aria-label={ariaLabel || "Search tags"}
        onSubmit={(e) => {
            e.preventDefault()
            onSearch()
            setIsOpen(false)
        }}
        disableVanish={true}
        className={className}
      />
      
      {isOpen && suggestions.length > 0 && (
        <div
          data-state={isOpen ? "open" : "closed"}
          className="absolute top-full left-0 right-0 mt-2 bg-popover border rounded-md shadow-lg z-50 overflow-hidden max-h-[300px] overflow-y-auto animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150 motion-reduce:animate-in motion-reduce:fade-in-0 motion-reduce:zoom-in-100 motion-reduce:slide-in-from-top-0"
        >
          {isLoading && (
              <div className="p-2 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin"/> Loading...
              </div>
          )}
          <ul className="py-1" role="listbox">
            {suggestions.map((suggestion, index) => (
              <li
                key={`${suggestion.name}-${index}`}
                role="option"
                aria-selected={activeIndex === index}
                className={cn(
                  "px-4 py-2 text-sm cursor-pointer flex justify-between items-center hover:bg-accent hover:text-accent-foreground",
                  activeIndex === index && "bg-accent text-accent-foreground"
                )}
                onClick={() => selectSuggestion(suggestion)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <div className="flex flex-col">
                    <span className={cn("font-medium", getCategoryColor(suggestion.category))}>
                      {suggestion.matchedAlias ? (
                        <>
                          <span className="text-muted-foreground">{suggestion.matchedAlias.replace(/_/g, ' ')}</span>
                          <span className="text-muted-foreground mx-1.5" aria-hidden="true">&rarr;</span>
                          {suggestion.name.replace(/_/g, ' ')}
                        </>
                      ) : (
                        suggestion.name.replace(/_/g, ' ')
                      )}
                    </span>
                    {suggestion.matchedAlias && (
                        <span className="text-xs text-muted-foreground">alias, resolves to this tag</span>
                    )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                   <span className={cn("px-1.5 py-0.5 rounded-full bg-muted uppercase text-[10px]", getCategoryColor(suggestion.category))}>
                       {getCategoryLabel(suggestion.category)}
                   </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

