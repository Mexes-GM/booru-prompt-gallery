"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToastAction } from "@/components/ui/toast"
import { toast } from "@/hooks/use-toast"
import { useNaturalPromptResources, usePromptFormat } from "@/hooks/use-natural-prompt"
import { preloadNaturalPrompt, retryNaturalPrompt } from "@/lib/prompt/natural-prompt-loader"
import { PROMPT_FORMATS, PROMPT_FORMAT_INFO, hasWordBudget, isPromptFormat } from "@/lib/prompt/prompt-format"

const retry = () => {
  retryNaturalPrompt().catch(() => {})
}

/**
 * "Prompt format" and "Keep every detail" rows for the Output column of
 * Customize prompt. Same row shape as the switches below them.
 */
export function PromptFormatSetting({ onSettingChange }: { onSettingChange?: (setting: string, value: string | boolean) => void }) {
  const { format, fullDetail, setFormat, setFullDetail } = usePromptFormat()
  const resources = useNaturalPromptResources(format !== "tags")
  const info = PROMPT_FORMAT_INFO[format]
  const failed = format !== "tags" && (resources.status === "error" || resources.phrasesFailed)

  return (
    <>
      <div className="flex min-h-[56px] items-center justify-between gap-3 border-b border-border/50 py-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor="prompt-format-embedded" className="cursor-pointer text-sm text-foreground">Prompt format</label>
          <span id="prompt-format-embedded-hint" className="text-xs text-muted-foreground">{info.description}</span>
        </div>
        <Select
          value={format}
          onValueChange={(value) => {
            if (!isPromptFormat(value)) return
            onSettingChange?.("promptFormat", value)
            setFormat(value)
          }}
          onOpenChange={(open) => {
            if (open) preloadNaturalPrompt()
          }}
        >
          <SelectTrigger
            id="prompt-format-embedded"
            aria-describedby="prompt-format-embedded-hint"
            className="h-8 w-[9.75rem] shrink-0 bg-background text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROMPT_FORMATS.map((option) => (
              <SelectItem key={option} value={option}>{PROMPT_FORMAT_INFO[option].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {hasWordBudget(format) && (
        <div className="flex min-h-[56px] items-center justify-between gap-3 border-b border-border/50 py-2">
          <label htmlFor="prompt-full-detail-embedded" className="flex min-w-0 cursor-pointer flex-col gap-0.5">
            <span className="text-sm text-foreground">Keep every detail</span>
            <span className="text-xs text-muted-foreground">When off, prompts stay under {info.shortWords} words</span>
          </label>
          <Switch
            id="prompt-full-detail-embedded"
            checked={fullDetail}
            onCheckedChange={(value) => {
              onSettingChange?.("promptFullDetail", value)
              setFullDetail(value)
            }}
          />
        </div>
      )}
      {failed && (
        <div role="status" className="flex items-center justify-between gap-3 border-b border-border/50 py-2 text-xs text-muted-foreground">
          <span>
            {resources.status === "error"
              ? "The converter didn't load, so cards show tags for now."
              : "The phrase list didn't load, so the wording is simpler for now."}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={retry} className="h-8 shrink-0 px-2.5 text-xs">
            Retry
          </Button>
        </div>
      )}
    </>
  )
}

/**
 * Tells the user once when the natural-language formats could not fully
 * load (the cards themselves stay quiet: they fall back on their own).
 */
export function NaturalPromptStatus() {
  const { format } = usePromptFormat()
  const { status, phrasesFailed } = useNaturalPromptResources(format !== "tags")
  const problem = format === "tags" ? null : status === "error" ? "converter" : phrasesFailed ? "phrases" : null

  useEffect(() => {
    if (!problem) return
    toast({
      title: problem === "converter" ? "Couldn't load the prompt converter" : "Couldn't load the phrase list",
      description: problem === "converter"
        ? "Cards show tags until it loads. Check your connection and retry."
        : "Prompts use simpler wording until it loads.",
      action: <ToastAction altText="Retry loading the prompt converter" onClick={retry}>Retry</ToastAction>,
    })
  }, [problem])

  return null
}
