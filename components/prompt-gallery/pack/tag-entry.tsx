"use client"

/**
 * The field at the end of a card row. Enter or a comma adds what was typed (a pasted
 * list is split on its commas); the arrow keys walk the suggestions and Enter takes
 * the highlighted one. On an empty field, Backspace picks the row's last chip and a
 * second Backspace removes it. Escape closes the suggestions and stops there, so a
 * drawer or dialog around the card stays open.
 *
 * It does not fetch: the parent hears the query through `onQueryChange` and passes
 * back `suggestions` and their `suggestionStatus`.
 */
import { memo, useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react"
import { Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { showTag, splitTyped, type SuggestionStatus, type TagSuggestion } from "./slots"

export interface TagEntryProps {
  /** Id of the visible label that names the field (the row's label). */
  labelledBy: string
  placeholder: string
  /** The row has nothing yet: the field is drawn as an open, dashed slot. */
  empty?: boolean
  suggestions?: readonly TagSuggestion[]
  suggestionStatus?: SuggestionStatus
  onQueryChange?: (query: string) => void
  onAdd: (tags: string[]) => void
  /** The row's last chip, which Backspace on an empty field picks and then removes. */
  lastChipLabel?: string
  onPickLast?: (picked: boolean) => void
  onRemoveLast?: () => void
  disabled?: boolean
  className?: string
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })

export const TagEntry = memo(function TagEntry({
  labelledBy,
  placeholder,
  empty = false,
  suggestions = [],
  suggestionStatus = "idle",
  onQueryChange,
  onAdd,
  lastChipLabel,
  onPickLast,
  onRemoveLast,
  disabled = false,
  className,
}: TagEntryProps) {
  const listId = useId()
  const [draft, setDraft] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [armed, setArmed] = useState(false)

  const query = draft.trim()
  const hasList = suggestions.length > 0
  const showList = open && query.length > 0 && (hasList || suggestionStatus !== "idle")
  const activeId = showList && active >= 0 && active < suggestions.length ? `${listId}-${active}` : undefined
  const inputRef = useRef<HTMLInputElement>(null)

  // Dialogs and drawers listen for Escape on the document in the capture phase, before the
  // field hears it. While the list is open, catch Escape on the window first and keep it here.
  useEffect(() => {
    if (!showList) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.target !== inputRef.current) return
      e.stopPropagation()
      e.preventDefault()
      setOpen(false)
      setActive(-1)
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [showList])

  const disarm = () => {
    if (!armed) return
    setArmed(false)
    onPickLast?.(false)
  }

  const setQuery = (value: string) => {
    setDraft(value)
    setActive(-1)
    setOpen(true)
    onQueryChange?.(value.trim())
  }

  const commit = (tags: string[]) => {
    if (tags.length === 0) return
    onAdd(tags)
    setQuery("")
    setOpen(false)
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    disarm()
    const value = e.target.value
    if (!value.includes(",")) return setQuery(value)
    // A pasted list, or a comma typed mid-text: everything before the last comma is done.
    const cut = value.lastIndexOf(",")
    const done = splitTyped(value.slice(0, cut))
    if (done.length) onAdd(done)
    setQuery(value.slice(cut + 1).trimStart())
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === "Backspace" && draft === "") {
      if (!lastChipLabel) return
      e.preventDefault()
      if (armed) {
        setArmed(false)
        onPickLast?.(false)
        onRemoveLast?.()
      } else {
        setArmed(true)
        onPickLast?.(true)
      }
      return
    }
    if (e.key === "Escape") {
      if (showList) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        setActive(-1)
      } else if (armed) {
        e.stopPropagation()
        disarm()
      }
      return
    }
    disarm()
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!hasList) return
      e.preventDefault()
      setOpen(true)
      const step = e.key === "ArrowDown" ? 1 : -1
      // Cycles through -1 (back in the field, nothing highlighted) and every suggestion.
      const n = suggestions.length
      setActive((i) => ((i + 1 + step + n + 1) % (n + 1)) - 1)
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      if (activeId) commit([suggestions[active].name])
      else commit(splitTyped(draft))
      return
    }
    if (e.key === ",") {
      e.preventDefault()
      commit(splitTyped(draft))
    }
  }

  return (
    <div className={cn("relative min-w-[7.5rem] flex-1", className)}>
      <div
        className={cn(
          "flex h-7 items-center gap-1 rounded-md border px-2 pointer-coarse:h-11",
          "transition-[border-color,background-color] duration-150 ease-out-strong",
          "focus-within:border-border focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/40",
          empty
            ? "border-dashed border-border hover:border-foreground/30"
            : "border-transparent hover:border-border",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        {!empty && <Plus className="size-3.5 shrink-0 text-faint-foreground" aria-hidden />}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-labelledby={labelledBy}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={activeId}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          disabled={disabled}
          value={draft}
          placeholder={placeholder}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false)
            setActive(-1)
            disarm()
          }}
          className={cn(
            "h-full w-full min-w-0 text-sm text-foreground outline-none",
            "placeholder:text-faint-foreground",
          )}
        />
      </div>

      <ul
        id={listId}
        role="listbox"
        aria-labelledby={labelledBy}
        hidden={!showList}
        className={cn(
          "absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto overscroll-contain rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
          "min-w-[12rem]",
        )}
      >
        {suggestions.map((s, i) => (
          <li
            key={s.name}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            // Keeps focus in the field, so the click lands before the blur closes the list.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => commit([s.name])}
            onMouseMove={() => i !== active && setActive(i)}
            className={cn(
              "flex cursor-pointer items-baseline gap-2 rounded-sm px-2 py-1.5 text-[13px] pointer-coarse:py-3",
              i === active ? "bg-accent text-accent-foreground" : "text-foreground",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{showTag(s.name)}</span>
            {s.kind && <span className="shrink-0 text-xs text-muted-foreground">{s.kind}</span>}
            {s.count !== undefined && (
              <span className="shrink-0 font-mono text-xs tabular-nums text-faint-foreground">{compact.format(s.count)}</span>
            )}
          </li>
        ))}
        {!hasList && suggestionStatus === "loading" && (
          <li role="presentation" className="px-2 py-1.5 text-xs text-muted-foreground">
            Looking up tags…
          </li>
        )}
        {!hasList && suggestionStatus === "error" && (
          <li role="presentation" className="px-2 py-1.5 text-xs text-muted-foreground">
            Couldn&apos;t load suggestions. Press Enter to add it as typed.
          </li>
        )}
      </ul>

      <span className="sr-only" aria-live="polite">
        {armed && lastChipLabel ? `${lastChipLabel} selected. Press Backspace again to remove it.` : ""}
      </span>
    </div>
  )
})
