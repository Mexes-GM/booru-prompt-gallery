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
  /** Id of a hint that describes the field. */
  describedBy?: string
  placeholder: string
  /** The row has nothing yet: the field is drawn as an open, dashed slot. */
  empty?: boolean
  suggestions?: readonly TagSuggestion[]
  suggestionStatus?: SuggestionStatus
  onQueryChange?: (query: string) => void
  /** `picked`: the suggestion chosen, when the tag came from one. */
  onAdd: (tags: string[], picked?: TagSuggestion) => void
  /** The row's last chip, which Backspace on an empty field picks and then removes. */
  lastChipLabel?: string
  onPickLast?: (picked: boolean) => void
  onRemoveLast?: () => void
  disabled?: boolean
  /** Marks the field as the one for this card row, so focus can be sent back to it. */
  slotId?: string
  /**
   * Choices that aren't tags (Wearing's outfit styles): listed first, all of them while the field
   * is empty and those whose label matches while typing.
   */
  options?: readonly EntryOption[]
  className?: string
}

/** A choice of the field that isn't a tag. */
export interface EntryOption {
  id: string
  label: string
  /** Quiet, after the label ("52 outfits"). */
  detail?: string
  onPick: () => void
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
const NO_OPTIONS: readonly EntryOption[] = []

export const TagEntry = memo(function TagEntry({
  labelledBy,
  describedBy,
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
  slotId,
  options = NO_OPTIONS,
  className,
}: TagEntryProps) {
  const listId = useId()
  const [draft, setDraft] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [armed, setArmed] = useState(false)

  const query = draft.trim()
  const lower = query.toLowerCase()
  const shownOptions = query ? options.filter((o) => o.label.toLowerCase().includes(lower)) : options
  // One list for the keyboard: the options first, then the tags.
  const items: Array<{ key: string; label: string; kind?: string; count?: number; detail?: string; pick: () => void }> = [
    ...shownOptions.map((o) => ({ key: `option:${o.id}`, label: o.label, detail: o.detail, pick: () => { o.onPick(); setQuery(""); setOpen(false) } })),
    ...suggestions.map((sg) => ({ key: sg.name, label: showTag(sg.name), kind: sg.kind, count: sg.count, pick: () => commit([sg.name], sg) })),
  ]
  const hasList = suggestions.length > 0
  const showList = open && ((query.length > 0 && (hasList || suggestionStatus !== "idle")) || shownOptions.length > 0)
  const activeId = showList && active >= 0 && active < items.length ? `${listId}-${active}` : undefined
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

  const commit = (tags: string[], picked?: TagSuggestion) => {
    if (tags.length === 0) return
    onAdd(tags, picked)
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
      if (items.length === 0) return
      e.preventDefault()
      setOpen(true)
      const step = e.key === "ArrowDown" ? 1 : -1
      // Cycles through -1 (back in the field, nothing highlighted) and every item.
      const n = items.length
      setActive((i) => ((i + 1 + step + n + 1) % (n + 1)) - 1)
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      if (activeId) items[active].pick()
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
          // A soft well, not a box: it reads as a place to write and lights up with focus.
          "flex h-8 items-center gap-1.5 rounded-lg px-2.5 pointer-coarse:h-11",
          "transition-[background-color,box-shadow] duration-150 ease-out-strong",
          "focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/60",
          empty ? "bg-muted/55 hover:bg-muted" : "hover:bg-muted/55",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        {!empty && <Plus className="size-3.5 shrink-0 text-faint-foreground" aria-hidden />}
        <input
          ref={inputRef}
          data-slot-entry={slotId}
          type="text"
          role="combobox"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
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
          onFocus={(e) => {
            setOpen(true)
            const field = e.currentTarget
            // After the on-screen keyboard has opened (coarse pointers only).
            if (window.matchMedia("(pointer: coarse)").matches) {
              window.setTimeout(() => field.isConnected && field.scrollIntoView({ block: "center", behavior: "smooth" }), 300)
            }
          }}
          onBlur={() => {
            setOpen(false)
            setActive(-1)
            disarm()
          }}
          className={cn(
            "h-full w-full min-w-0 text-sm text-foreground outline-none",
            "placeholder:text-muted-foreground",
          )}
        />
      </div>

      <ul
        id={listId}
        role="listbox"
        aria-labelledby={labelledBy}
        hidden={!showList}
        className={cn(
          "absolute inset-x-0 top-full z-50 mt-1.5 max-h-64 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg",
          "min-w-[12rem]",
        )}
      >
        {items.map((s, i) => (
          <li
            key={s.key}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            // Keeps focus in the field, so the click lands before the blur closes the list.
            onMouseDown={(e) => e.preventDefault()}
            onClick={s.pick}
            onMouseMove={() => i !== active && setActive(i)}
            className={cn(
              "flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-[13px] pointer-coarse:py-3",
              i === active ? "bg-accent text-accent-foreground" : "text-foreground",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            {s.detail && <span className="shrink-0 text-xs text-muted-foreground">{s.detail}</span>}
            {s.kind && <span className="shrink-0 text-xs text-muted-foreground">{s.kind}</span>}
            {s.count !== undefined && (
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{compact.format(s.count)}</span>
            )}
          </li>
        ))}
        {!hasList && suggestionStatus === "loading" && (
          <li role="presentation" className="px-2 py-1.5 text-xs text-muted-foreground">
            Looking up tags…
          </li>
        )}
        {!hasList && suggestionStatus === "empty" && (
          <li role="presentation" className="px-2 py-1.5 text-xs text-muted-foreground">
            No matching tags. Press Enter to add it as typed.
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
