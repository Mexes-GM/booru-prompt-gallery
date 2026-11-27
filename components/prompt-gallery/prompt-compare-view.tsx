"use client"

import { useMemo, useState } from "react"
import { Check, Copy, GitCompare } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { useCopyFeedback } from "@/hooks/use-copy-feedback"
import { copyText } from "@/lib/clipboard"
import { toastCopyFailed } from "@/lib/copy-toast"
import { compareTagLists, parseRawPrompt } from "@/lib/reverse-prompt-parser"
import { cn } from "@/lib/utils"

interface PromptCompareViewProps {
  tagOverrides?: Record<string, string>
}

// Same cleaning the Clean view applies by default, so "(long hair:1.2)",
// "Long_Hair" and "long hair" count as the same tag.
const PARSER_OPTIONS = { removeWeights: true, removeLoras: true }

export function PromptCompareView({ tagOverrides }: PromptCompareViewProps) {
  const [promptA, setPromptA] = useState("")
  const [promptB, setPromptB] = useState("")

  const tagsA = useMemo(() => parseRawPrompt(promptA, tagOverrides, PARSER_OPTIONS).cleanedTags, [promptA, tagOverrides])
  const tagsB = useMemo(() => parseRawPrompt(promptB, tagOverrides, PARSER_OPTIONS).cleanedTags, [promptB, tagOverrides])
  const comparison = useMemo(() => compareTagLists(tagsA, tagsB), [tagsA, tagsB])

  const hasA = tagsA.length > 0
  const hasB = tagsB.length > 0

  let emptyMessage = ""
  if (!hasA && !hasB) emptyMessage = "Paste a prompt in A and another in B to see which tags they share."
  else if (!hasA) emptyMessage = "Paste a prompt in A to compare it with B."
  else if (!hasB) emptyMessage = "Paste a prompt in B to compare it with A."

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PromptField id="compare-prompt-a" label="Prompt A" value={promptA} onChange={setPromptA} />
        <PromptField id="compare-prompt-b" label="Prompt B" value={promptB} onChange={setPromptB} />
      </div>

      {emptyMessage ? (
        <div className="py-6 text-center">
          <GitCompare className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">{emptyMessage}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <TagList
            title="Only in A"
            copyLabel="Copy tags only in A"
            tags={comparison.onlyA}
            emptyText="Every tag in A is also in B."
            badgeClass="bg-muted text-foreground"
          />
          <TagList
            title="In both"
            copyLabel="Copy shared tags"
            tags={comparison.both}
            emptyText="These prompts share no tags."
            badgeClass="bg-mode-reverse-soft text-mode-reverse-text"
          />
          <TagList
            title="Only in B"
            copyLabel="Copy tags only in B"
            tags={comparison.onlyB}
            emptyText="Every tag in B is also in A."
            badgeClass="bg-muted text-foreground"
          />
        </div>
      )}
    </div>
  )
}

function PromptField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste a prompt"
        spellCheck={false}
        className="font-mono text-sm min-h-[7rem] sm:min-h-[9rem] resize-y"
      />
    </div>
  )
}

function TagList({ title, copyLabel, tags, emptyText, badgeClass }: { title: string; copyLabel: string; tags: string[]; emptyText: string; badgeClass: string }) {
  const [copied, triggerCopyFeedback] = useCopyFeedback()

  const handleCopy = async () => {
    if (tags.length === 0) return
    try {
      await copyText(tags.join(", "))
      triggerCopyFeedback()
    } catch {
      toastCopyFailed("copy_text")
    }
  }

  return (
    <section aria-label={`${title}, ${tags.length} ${tags.length === 1 ? "tag" : "tags"}`} className="flex flex-col rounded-lg border bg-muted/30 p-3 gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">
          {title} ({tags.length})
        </h3>
        <button
          type="button"
          onClick={handleCopy}
          disabled={tags.length === 0}
          aria-label={copied ? "Copied" : copyLabel}
          className={cn(
            "relative inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors pointer-coarse:after:absolute pointer-coarse:after:-inset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:pointer-events-none",
            copied ? "bg-success-soft text-success-text" : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
          {tags.map((tag) => (
            <li key={tag}>
              <Badge className={cn(badgeClass, "cursor-default font-normal")}>{tag}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      )}
    </section>
  )
}
