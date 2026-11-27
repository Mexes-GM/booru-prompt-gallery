"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useComfyUISettings } from "@/hooks/use-comfyui-settings"

const loadPanel = () => import("./comfyui-panel")
const ComfyUIPanel = dynamic(() => loadPanel().then((m) => m.ComfyUIPanel), { ssr: false, loading: () => null })

/**
 * The "Send to ComfyUI" row of Customize prompt's Output column. It shows the
 * mode's state and opens the ComfyUI panel, whose code loads on first use.
 */
export function ComfyUISettingRow() {
  const { enabled, activeWorkflow, workflows } = useComfyUISettings()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  const hint = enabled
    ? activeWorkflow
      ? `On, using ${activeWorkflow.name}`
      : "On, but no workflow is chosen yet"
    : "Send prompts to ComfyUI on your computer instead of copying"

  return (
    <div className="flex min-h-[56px] items-center justify-between gap-3 border-t border-border/50 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-foreground">Send to ComfyUI</span>
        <span className="truncate text-xs text-muted-foreground">{hint}</span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onPointerEnter={() => void loadPanel()}
        onFocus={() => void loadPanel()}
        onClick={() => {
          setMounted(true)
          setOpen(true)
        }}
        aria-haspopup="dialog"
        aria-label={enabled ? "Edit ComfyUI settings" : "Set up ComfyUI"}
        className="relative h-8 shrink-0 px-2.5 text-xs pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5"
      >
        {enabled || workflows.length > 0 ? "Edit" : "Set up"}
      </Button>
      {mounted && <ComfyUIPanel open={open} onOpenChange={setOpen} />}
    </div>
  )
}
