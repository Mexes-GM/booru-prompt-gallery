"use client"

/**
 * The inline "Add" editor of the Pack Builder's chips, shared by Scenes (a
 * character's block) and Classic (a category row): tag autocomplete, Add, Done,
 * and a note when people-count tags were refused. Classic's pools use it too,
 * always shown: no Done, no focus on its own.
 */
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { TagAutocompleteTextarea } from "./tag-autocomplete-textarea"

export function AddTagsField({
  label,
  labelHidden = false,
  onAdd,
  onDone,
  refusedMessage,
  placeholder = "e.g. red scarf, glasses",
  autoFocus = true,
}: {
  label: string
  /** Keeps the label for screen readers only (the field sits in a row that already says what it is). */
  labelHidden?: boolean
  /** Adds the typed tags; returns true when some were refused (people counts). */
  onAdd: (text: string) => boolean
  /** Closes the editor; without it there is no Done button. */
  onDone?: () => void
  /** Shown when tags were refused. */
  refusedMessage?: string
  placeholder?: string
  autoFocus?: boolean
}) {
  const id = useId()
  const [draft, setDraft] = useState("")
  const [refused, setRefused] = useState(false)
  const submit = () => {
    if (!draft.trim()) return
    setRefused(onAdd(draft))
    setDraft("")
  }
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={labelHidden ? "sr-only" : "text-xs font-medium text-muted-foreground"}>
        {label}
      </label>
      <div className="flex items-start gap-1.5">
        <TagAutocompleteTextarea
          id={id}
          value={draft}
          onValueChange={(value) => {
            setDraft(value)
            setRefused(false)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.defaultPrevented) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={placeholder}
          rows={1}
          autoFocus={autoFocus}
          onFocus={autoFocus ? (e) => e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" }) : undefined}
          className="text-xs font-mono min-h-[2.25rem] h-9 resize-none py-2"
        />
        <Button type="button" variant="outline" size="sm" onClick={submit} disabled={!draft.trim()} className="h-9 pointer-coarse:h-11 text-xs">
          Add
        </Button>
        {onDone && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft("")
              setRefused(false)
              onDone()
            }}
            className="h-9 pointer-coarse:h-11 text-xs"
          >
            Done
          </Button>
        )}
      </div>
      {refused && refusedMessage && (
        <p className="text-xs text-warning-text" role="status">{refusedMessage}</p>
      )}
    </div>
  )
}
