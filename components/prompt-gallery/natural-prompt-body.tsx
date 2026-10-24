import { memo } from "react"
import { PROMPT_FORMAT_INFO, hasWordBudget, type PromptFormat } from "@/lib/prompt/prompt-format"
import type { FormattedPrompt } from "@/lib/prompt/natural-format"
import type { NaturalPromptView } from "@/hooks/use-natural-prompt"

interface NaturalPromptBodyProps {
  format: PromptFormat
  view: NaturalPromptView
  fullDetail: boolean
  /** Expanded cards add a line with the length and the short/full switch. */
  isExpanded: boolean
  onToggleFullDetail: () => void
}

function PromptSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col gap-1.5 py-1" aria-label={`Writing the ${label} prompt`}>
      <span className="h-2.5 w-[94%] rounded-full bg-foreground/10" />
      <span className="h-2.5 w-full rounded-full bg-foreground/10" />
      <span className="h-2.5 w-3/5 rounded-full bg-foreground/10" />
    </div>
  )
}

interface PromptLengthProps {
  prompt: FormattedPrompt
  /** The other length of the same prompt (see NaturalPromptView.alternate). */
  alternate: FormattedPrompt | null
  shortened: boolean
  shortWords?: number
  onToggleFullDetail: () => void
}

/** "80 of 106 words · Show every detail", or "106 words · Shorten" in full detail. */
function PromptLength({ prompt, alternate, shortened, shortWords, onToggleFullDetail }: PromptLengthProps) {
  // In full detail, offer the short version only when it would actually differ.
  const canShorten = !shortened && (alternate?.omitted ?? 0) > 0
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
      <span className="whitespace-nowrap tabular-nums">
        {shortened && alternate ? `${prompt.words} of ${alternate.words} words` : `${prompt.words} words`}
      </span>
      {(shortened || canShorten) && (
        <button
          type="button"
          onClick={onToggleFullDetail}
          className="touch-hit relative ml-auto rounded-sm font-medium text-foreground underline-offset-2 hover:underline focus-ring"
          aria-label={shortened ? "Show every detail in this prompt" : `Shorten this prompt to ${shortWords} words or fewer`}
        >
          {shortened ? "Show every detail" : "Shorten"}
        </button>
      )}
    </div>
  )
}

/**
 * A card's prompt in a natural-language format: plain, selectable text with no
 * visible format label, since the user picked the format. It fills the same
 * box as the tag prompt, so switching
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
  if (view.status === "loading") return <PromptSkeleton label={info.label} />

  const prompt = view.prompt
  if (!prompt) return <p className="text-foreground leading-relaxed italic">No prompt content</p>

  const shortened = !fullDetail && prompt.omitted > 0
  return (
    <div className="text-left">
      <p className="text-foreground leading-relaxed wrap-anywhere text-pretty">
        <span className="sr-only">{`${info.label} prompt${shortened ? ", short version" : ""}: `}</span>
        {prompt.text}
      </p>
      {isExpanded && hasWordBudget(format) && (
        <PromptLength
          prompt={prompt}
          alternate={view.alternate}
          shortened={shortened}
          shortWords={info.shortWords}
          onToggleFullDetail={onToggleFullDetail}
        />
      )}
    </div>
  )
})
