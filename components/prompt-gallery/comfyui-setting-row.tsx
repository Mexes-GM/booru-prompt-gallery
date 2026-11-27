"use client"

import dynamic from "next/dynamic"
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useComfyUISettings } from "@/hooks/use-comfyui-settings"
import { shortStatusLine, useComfyStatus, type StatusTone } from "@/lib/comfyui/status"
import type { Diagnosis } from "@/lib/comfyui/types"
import { cn } from "@/lib/utils"
import { ComfyStatusDot } from "./comfyui-status"

const loadPanel = () => import("./comfyui-panel")
const ComfyUIPanel = dynamic(() => loadPanel().then((m) => m.ComfyUIPanel), { ssr: false, loading: () => null })

/** The row's status line and dot: why it can't be on, or how the connection is while it is. */
function rowStatus(
  enabled: boolean,
  canTurnOn: boolean,
  workflowName: string | null,
  diagnosis: Diagnosis | null,
  checking: boolean,
): { tone: StatusTone | null; hint: string } {
  if (!enabled) {
    return {
      tone: null,
      hint: canTurnOn ? "Send prompts to ComfyUI on your computer instead of copying" : "Set up a workflow first to turn this on",
    }
  }
  if (!workflowName) return { tone: "problem", hint: "Choose a workflow to start sending" }
  const line = shortStatusLine(diagnosis)
  const tone = checking && !diagnosis ? "checking" : line.tone
  if (line.tone === "ok") return { tone, hint: `Connected · ${workflowName}` }
  if (line.tone === "checking") return { tone, hint: `Checking ComfyUI · ${workflowName}` }
  return { tone, hint: line.text }
}

/**
 * The "Send to ComfyUI" row of Customize prompt's Output column: a switch for
 * the mode, its live status while on, and the button that opens the ComfyUI
 * panel (whose code loads on first use). The switch stays off until a
 * workflow is saved, since Send has nothing to send with before that.
 */
export function ComfyUISettingRow() {
  const { enabled, url, activeWorkflow, workflows, setEnabled } = useComfyUISettings()
  const { diagnosis, checking } = useComfyStatus(url, enabled)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const id = useId()

  const canTurnOn = workflows.length > 0
  const setUp = !enabled && !canTurnOn

  const { tone, hint } = rowStatus(enabled, canTurnOn, activeWorkflow?.name ?? null, diagnosis, checking)

  return (
    <div
      className={cn(
        "flex min-h-[56px] items-center justify-between gap-3 py-2 transition-colors duration-200",
        enabled
          ? cn(
              "-mx-2 my-1 rounded-lg border px-2 sm:-mx-3 sm:px-3",
              // On reads as active; a problem while on asks for attention.
              tone === "problem" ? "border-warning-border bg-warning-soft" : "border-primary/25 bg-primary/[0.07]",
            )
          : "border-t border-border/50",
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={`${id}-switch`} className={cn("text-sm text-foreground", canTurnOn || enabled ? "cursor-pointer" : "cursor-default", enabled && "font-medium")}>
          Send to ComfyUI
        </label>
        <span
          id={`${id}-hint`}
          role={enabled ? "status" : undefined}
          aria-live={enabled ? "polite" : undefined}
          className={cn("flex min-w-0 items-center gap-1.5 text-xs", enabled ? "text-foreground/80" : "text-muted-foreground")}
        >
          {tone && <ComfyStatusDot tone={tone} />}
          <span className="line-clamp-2 text-pretty" title={hint}>{hint}</span>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Button
          type="button"
          variant={setUp ? "default" : "outline"}
          size="sm"
          onPointerEnter={() => void loadPanel()}
          onFocus={() => void loadPanel()}
          onClick={() => {
            setMounted(true)
            setOpen(true)
          }}
          aria-haspopup="dialog"
          aria-label={setUp ? "Set up ComfyUI" : "Edit ComfyUI settings"}
          className={cn(
            "relative h-8 px-2.5 text-xs pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5",
            enabled && "bg-background",
          )}
        >
          {setUp ? "Set up" : "Edit"}
        </Button>
        <Switch
          id={`${id}-switch`}
          checked={enabled}
          disabled={!enabled && !canTurnOn}
          onCheckedChange={(v) => setEnabled(v)}
          aria-describedby={`${id}-hint`}
          className="shrink-0"
        />
      </div>
      {mounted && <ComfyUIPanel open={open} onOpenChange={setOpen} />}
    </div>
  )
}
