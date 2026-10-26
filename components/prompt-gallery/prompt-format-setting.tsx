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

/** Row styles: the main panel's Output column, or the extension's compact settings. */
const VARIANTS = {
  embedded: {
    row: "flex min-h-[56px] items-center justify-between gap-3 border-b border-border/50 py-2",
    label: "text-sm text-foreground",
    hint: "text-xs text-muted-foreground",
    select: "h-8 w-[9.75rem] shrink-0 bg-background text-xs",
    switch: undefined,
    button: "h-8 shrink-0 px-2.5 text-xs",
  },
  compact: {
    row: "flex items-center justify-between gap-2 rounded-lg p-1",
    label: "text-xs text-foreground",
    hint: "text-[10px] leading-tight text-muted-foreground",
    select: "h-7 w-[8.5rem] shrink-0 bg-background text-xs",
    switch: "h-5 w-9 shrink-0 [&>span]:h-4 [&>span]:w-4 data-[state=checked]:[&>span]:translate-x-4",
    button: "h-7 shrink-0 px-2 text-xs",
  },
} as const

interface PromptFormatSettingProps {
  onSettingChange?: (setting: string, value: string | boolean) => void
  variant?: keyof typeof VARIANTS
}

/**
 * "Prompt format" and "Keep every detail" rows. Same row shape as the
 * switches around them: Customize prompt's Output column ("embedded") or the
 * extension's settings ("compact").
 */
export function PromptFormatSetting({ onSettingChange, variant = "embedded" }: PromptFormatSettingProps) {
  const { format, fullDetail, setFormat, setFullDetail } = usePromptFormat()
  const resources = useNaturalPromptResources(format !== "tags")
  const info = PROMPT_FORMAT_INFO[format]
  const failed = format !== "tags" && (resources.status === "error" || resources.phrasesFailed)
  const styles = VARIANTS[variant]
  const formatId = `prompt-format-${variant}`
  const fullDetailId = `prompt-full-detail-${variant}`

  return (
    <>
      <div className={styles.row}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <label htmlFor={formatId} className={`cursor-pointer ${styles.label}`}>Prompt format</label>
          <span id={`${formatId}-hint`} className={styles.hint}>{info.description}</span>
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
            id={formatId}
            aria-describedby={`${formatId}-hint`}
            className={styles.select}
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
        <div className={styles.row}>
          <label htmlFor={fullDetailId} className="flex min-w-0 cursor-pointer flex-col gap-0.5">
            <span className={styles.label}>Keep every detail</span>
            <span className={styles.hint}>When off, prompts stay under {info.shortWords} words</span>
          </label>
          <Switch
            id={fullDetailId}
            checked={fullDetail}
            className={styles.switch}
            onCheckedChange={(value) => {
              onSettingChange?.("promptFullDetail", value)
              setFullDetail(value)
            }}
          />
        </div>
      )}
      {failed && (
        <div role="status" className={`${styles.row} ${styles.hint}`}>
          <span>
            {resources.status === "error"
              ? "The converter didn't load, so cards show tags for now."
              : "The phrase list didn't load, so the wording is simpler for now."}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={retry} className={styles.button}>
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
