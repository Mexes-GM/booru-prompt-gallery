import { memo } from "react"
import { PROMPT_FORMAT_INFO, hasWordBudget, type PromptFormat } from "@/lib/prompt/prompt-format"
import type { NaturalPromptView } from "@/hooks/use-natural-prompt"

interface NaturalPromptBodyProps {
  format: PromptFormat
  view: NaturalPromptView
  fullDetail: boolean
  /** Expanded cards add a line with the length and the short/full switch. */
  isExpanded: boolean
  onToggleFullDetail: () => void
}

/**
 * A card's prompt in a natural-language format: plain, selectable text led by
 * a small format label. It fills the same box as the tag prompt, so switching
 * formats never changes the card's height.
 */
export const NaturalPromptBody = memo(function NaturalPromptBody({
  format,
  view,
  fullDetail,
  isExpanded,
  onToggleFullDetail,
}: NaturalPromptBodyProps) {
  const info = PROMPT_FORMAT_INFO[format]

  if (view.status === "loading") {
    return (
      <div role="status" className="flex flex-col gap-1.5 py-1" aria-label={`Writing the ${info.label} prompt`}>
        <span className="h-2.5 w-[94%] rounded-full bg-foreground/10" />
        <span className="h-2.5 w-full rounded-full bg-foreground/10" />
        <span className="h-2.5 w-3/5 rounded-full bg-foreground/10" />
      </div>
    )
  }

  const prompt = view.prompt
  if (!prompt) return <p className="text-foreground leading-relaxed italic">No prompt content</p>

  const shortened = !fullDetail && prompt.omitted > 0
  // In full detail, offer the short version only when it would actually differ.
  const canShorten = fullDetail && (view.alternate?.omitted ?? 0) > 0
  const showDetails = isExpanded && hasWordBudget(format)

  return (
    <div className="text-left">
      <p className="text-foreground leading-relaxed wrap-anywhere text-pretty">
        <span
          aria-hidden="true"
          className="mr-1.5 inline-block select-none rounded-[5px] px-1 py-px align-[0.08em] text-[0.6875rem] font-medium leading-tight text-muted-foreground ring-1 ring-inset ring-border"
        >
          {info.badge}{shortened ? " · short" : ""}
        </span>
        <span className="sr-only">{`${info.label} prompt${shortened ? ", short version" : ""}: `}</span>
        {prompt.text}
      </p>
      {showDetails && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
          <span className="whitespace-nowrap tabular-nums">
            {shortened && view.alternate ? `${prompt.words} of ${view.alternate.words} words` : `${prompt.words} words`}
          </span>
          {(shortened || canShorten) && (
            <button
              type="button"
              onClick={onToggleFullDetail}
              className="touch-hit relative ml-auto rounded-sm font-medium text-foreground underline-offset-2 hover:underline focus-ring"
              aria-label={shortened ? "Show every detail in this prompt" : `Shorten this prompt to ${info.shortWords} words or fewer`}
            >
              {shortened ? "Show every detail" : "Shorten"}
            </button>
          )}
        </div>
      )}
    </div>
  )
})
