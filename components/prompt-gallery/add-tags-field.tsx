"use client"

/**
 * The inline "Add" editor of the Pack Builder's chips, shared by Scenes (a
 * character's block) and Classic (a category row): tag autocomplete, Add, Done,
 * and a note when people-count tags were refused.
 */
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { TagAutocompleteTextarea } from "./tag-autocomplete-textarea"

export function AddTagsField({
  label,
  onAdd,
  onDone,
  refusedMessage,
  placeholder = "e.g. red scarf, glasses",
}: {
  label: string
  /** Adds the typed tags; returns true when some were refused (people counts). */
  onAdd: (text: string) => boolean
  onDone: () => void
  /** Shown when tags were refused. */
  refusedMessage: string
  placeholder?: string
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
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
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
          autoFocus
          onFocus={(e) => e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })}
          className="text-xs font-mono min-h-[2.25rem] h-9 resize-none py-2"
        />
        <Button type="button" variant="outline" size="sm" onClick={submit} disabled={!draft.trim()} className="h-9 pointer-coarse:h-11 text-xs">
          Add
        </Button>
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
      </div>
      {refused && (
        <p className="text-xs text-warning-text" role="status">{refusedMessage}</p>
      )}
    </div>
  )
}
