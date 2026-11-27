"use client"

/**
 * ComfyUI's state outside the panel: the status dot, and the chip the gallery
 * shows while Send to ComfyUI is on. The chip opens a small popover with the
 * connection, the workflow in use, jobs in progress and quick actions. With
 * the mode off nothing here mounts, so no check runs.
 */
import { useRef, useState } from "react"
import { Loader2, RefreshCw, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ToastAction } from "@/components/ui/toast"
import { toast } from "@/hooks/use-toast"
import { useComfyEnabled, useComfyUISettings } from "@/hooks/use-comfyui-settings"
import { useComfyJobs } from "@/hooks/use-comfyui-job"
import { openComfyPanel } from "@/lib/comfyui/panel-request"
import { shortStatusLine, statusCopy, useComfyStatus, type StatusTone } from "@/lib/comfyui/status"
import { cn } from "@/lib/utils"

const DOT_TONE: Record<StatusTone, string> = {
  ok: "bg-success",
  problem: "bg-warning",
  checking: "bg-muted-foreground/60 motion-safe:animate-pulse",
}

/** The colored dot next to a status line. Always paired with text. */
export function ComfyStatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT_TONE[tone], className)} />
}

/** Turns the mode off, with a toast that can undo it. */
export function turnComfyOffWithUndo(setEnabled: (enabled: boolean) => boolean) {
  if (!setEnabled(false)) return
  toast({
    title: "Send to ComfyUI is off",
    description: "Copy buttons copy prompts again.",
    action: (
      <ToastAction altText="Turn Send to ComfyUI back on" onClick={() => setEnabled(true)}>
        Undo
      </ToastAction>
    ),
  })
}

type ChipPlacement = "toolbar" | "sticky"

/** The chip, only while the mode is on. */
export function ComfyStatusChip({ placement = "toolbar", className }: { placement?: ChipPlacement; className?: string }) {
  const enabled = useComfyEnabled()
  if (!enabled) return null
  return <StatusChip placement={placement} className={className} />
}

function jobsLine(running: number, waiting: number): string | null {
  const parts = [running > 0 ? `${running} generating` : null, waiting > 0 ? `${waiting} waiting` : null].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : null
}

function StatusChip({ placement, className }: { placement: ChipPlacement; className?: string }) {
  const settings = useComfyUISettings()
  const { url, activeWorkflow } = settings
  const { diagnosis, checking, refresh } = useComfyStatus(url, true)
  const jobs = useComfyJobs()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const running = jobs.filter((j) => j.status === "running").length
  const waiting = jobs.filter((j) => j.status === "queued").length
  const busy = running + waiting
  const line = activeWorkflow
    ? shortStatusLine(diagnosis)
    : { tone: "problem" as const, text: "No workflow chosen" }
  const tone: StatusTone = checking && !diagnosis ? "checking" : line.tone
  const label = [`ComfyUI: ${line.text}`, activeWorkflow?.name, busy > 0 ? jobsLine(running, waiting) : null].filter(Boolean).join(". ")

  const openSettings = () => {
    setOpen(false)
    openComfyPanel(activeWorkflow ? null : "workflow", triggerRef.current)
  }

  return (
    <Popover open={open} onOpenChange={setOpen} closeOnScroll={placement === "toolbar"}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={label}
          className={cn(
            "relative inline-flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5",
            // A problem changes the whole chip, not only its dot.
            tone === "problem"
              ? "border-warning-border bg-warning-soft text-foreground hover:bg-warning/20 data-[state=open]:bg-warning/20"
              : "border-primary/25 bg-primary/10 text-primary-text hover:bg-primary/15 data-[state=open]:bg-primary/15",
            className,
          )}
        >
          <span className="relative flex">
            <Send aria-hidden className="h-3.5 w-3.5" />
            <ComfyStatusDot tone={tone} className="absolute -bottom-0.5 -right-1 ring-2 ring-background" />
          </span>
          <span className={cn(placement === "sticky" && "hidden sm:inline")}>ComfyUI</span>
          {activeWorkflow && placement === "toolbar" && (
            <span className="hidden max-w-[11rem] truncate font-normal text-muted-foreground xl:inline">{activeWorkflow.name}</span>
          )}
          {busy > 0 && (
            <span className="flex items-center gap-1 font-normal tabular-nums text-muted-foreground">
              <Loader2 aria-hidden className="h-3 w-3 motion-safe:animate-spin" />
              {busy}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align={placement === "sticky" ? "end" : "start"} collisionPadding={12} className="w-[min(20rem,calc(100vw-2rem))] p-0">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold text-foreground">Send to ComfyUI is on</p>
            <div className="flex flex-col items-start gap-1.5">
              <p role="status" aria-live="polite" className="flex min-w-0 items-start gap-2 text-sm text-foreground">
                <ComfyStatusDot tone={tone} className="mt-1.5" />
                <span className="text-pretty">
                  {!activeWorkflow
                    ? "Choose a workflow, so Send knows what to queue."
                    : diagnosis
                      ? statusCopy(diagnosis).text
                      : "Checking the connection…"}
                </span>
              </p>
              {diagnosis && diagnosis.state !== "ok" && diagnosis.state !== "unsupported-browser" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void refresh()}
                  disabled={checking}
                  className="-ml-2 h-8 gap-1.5 px-2 text-xs"
                >
                  <RefreshCw aria-hidden className={cn("h-3.5 w-3.5", checking && "motion-safe:animate-spin")} />
                  Check again
                </Button>
              )}
            </div>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t border-border/60 pt-3 text-sm">
            <dt className="text-muted-foreground">Workflow</dt>
            <dd className="min-w-0 truncate text-foreground" title={activeWorkflow?.name}>
              {activeWorkflow?.name ?? "None chosen"}
            </dd>
            {busy > 0 && (
              <>
                <dt className="text-muted-foreground">Prompts</dt>
                <dd className="tabular-nums text-foreground">{jobsLine(running, waiting)}</dd>
              </>
            )}
          </dl>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border/60 px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false)
              turnComfyOffWithUndo(settings.setEnabled)
            }}
            className="h-8 px-3 text-xs"
          >
            Turn off
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={openSettings} className="h-8 px-3 text-xs">
            {activeWorkflow ? "Settings" : "Choose a workflow"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
