"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, Crosshair, Loader2, MousePointerClick, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { cn } from "@/lib/utils"

const TARGET_ORIGIN = "*"

// Verbose logging for the setup wizard, gated to non-production builds so end
// users' consoles stay quiet (mirrors sidepanel.js's dlog() dev-only pattern,
// but that flag lives in the parent frame and isn't reachable from here).
function wlog(...args: unknown[]) {
  if (process.env.NODE_ENV !== "production") console.log("%c[TargetWizard]", "color:#f59e0b;font-weight:bold", ...args)
}

/** targetKind understood by sidepanel.js's startTargeting(targetKind) (Fase 2a). */
type TargetKind = "prompt" | "generate" | "queue"

/** Per-step targeting state, mirrors the TARGET_STATUS values sidepanel.js emits. */
type StepState = "idle" | "arming" | "waiting" | "selected" | "error"

interface WizardStep {
  kind: TargetKind
  title: string
  description: string
}

const STEPS: WizardStep[] = [
  {
    kind: "prompt",
    title: "Prompt field",
    description: "Click Start, then click the box on the page where prompts should be typed.",
  },
  {
    kind: "generate",
    title: "Generate button",
    description: "Click Start, then click the button that starts a generation on the page.",
  },
  {
    kind: "queue",
    title: "Queue (optional)",
    description: "Point at the container that lists running/queued generations, so the extension knows when it's busy.",
  },
]

interface SiteProfileStatus {
  origin: string | null
  builtin: boolean
  promptConfigured: boolean
  generateConfigured: boolean
  queueLevel: 0 | 1 | 2
  queueMode: "none" | "button" | "container"
  hasBusySignal: boolean
  concurrencyLimit: number
  unlimited: boolean
}

function isTrustedSidepanelMessage(event: MessageEvent): boolean {
  if (event.source !== window.parent) return false
  if (typeof event.origin !== "string") return false
  return event.origin.startsWith("chrome-extension://") || event.origin === window.location.origin
}

/**
 * Compact status pill shown in the main panel. Reflects the active tab's
 * SiteProfile (requested from sidepanel.js on mount and refreshed live after
 * every successful Target selection). Opens the setup wizard on click.
 */
export function SiteTargetStatusBadge({ onOpenWizard }: { onOpenWizard: () => void }) {
  const [status, setStatus] = useState<SiteProfileStatus | null>(null)

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!isTrustedSidepanelMessage(event)) return
      if (!event.data || event.data.type !== "SITE_PROFILE_STATUS") return
      wlog("[Badge] received SITE_PROFILE_STATUS", event.data)
      setStatus({
        origin: event.data.origin ?? null,
        builtin: !!event.data.builtin,
        promptConfigured: !!event.data.promptConfigured,
        generateConfigured: !!event.data.generateConfigured,
        queueLevel: event.data.queueLevel ?? 0,
        queueMode: event.data.queueMode ?? "none",
        hasBusySignal: !!event.data.hasBusySignal,
        concurrencyLimit: typeof event.data.concurrencyLimit === "number" ? event.data.concurrencyLimit : 1,
        unlimited: !!event.data.unlimited,
      })
    }
    window.addEventListener("message", handleMessage)
    wlog("[Badge] mounted — requesting initial SITE_PROFILE_STATUS")
    window.parent.postMessage({ type: "REQUEST_SITE_PROFILE_STATUS" }, TARGET_ORIGIN)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  const { label, tone } = useMemo(() => {
    if (!status || !status.origin) return { label: "No page detected", tone: "muted" as const }
    if (status.builtin) return { label: "Using built-in defaults", tone: "info" as const }
    if (status.promptConfigured && status.generateConfigured) {
      return { label: status.queueLevel === 2 ? "Fully configured" : "Configured", tone: "success" as const }
    }
    if (status.promptConfigured) return { label: "Prompt set, generate button missing", tone: "warning" as const }
    return { label: "Not configured for this site", tone: "muted" as const }
  }, [status])

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onOpenWizard}
      title="Configure where prompts go on this site"
      className={cn(
        "h-6 px-2.5 rounded-full text-[11px] gap-1.5 shadow-sm border-dashed",
        tone === "success" && "border-green-500/40 text-green-600 dark:text-green-400",
        tone === "warning" && "border-amber-500/40 text-amber-600 dark:text-amber-400",
        tone === "info" && "border-sky-500/40 text-sky-600 dark:text-sky-400",
        tone === "muted" && "text-muted-foreground"
      )}
    >
      <Sparkles className="w-3 h-3" />
      {label}
    </Button>
  )
}

/**
 * 3-step setup wizard: prompt field → generate button → queue (optional).
 * Each step drives sidepanel.js's Target flow with a specific targetKind
 * (Fase 2a) and shows live feedback from TARGET_STATUS. Configuring a site
 * persists into its SiteProfile (Fase 1c/2a/2d) so it survives reloads.
 */
export function TargetSetupWizard({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [activeStep, setActiveStep] = useState(0)
  const [stepStates, setStepStates] = useState<Record<TargetKind, StepState>>({
    prompt: "idle",
    generate: "idle",
    queue: "idle",
  })
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [status, setStatus] = useState<SiteProfileStatus | null>(null)
  // Concrete evidence of what got selected per step (tag/text/placeholder),
  // shown next to the "Set" badge so the user can verify the RIGHT element
  // was picked instead of just trusting a checkmark.
  const [selectedInfo, setSelectedInfo] = useState<Record<TargetKind, { tag?: string; text?: string; placeholder?: string } | null>>({
    prompt: null,
    generate: null,
    queue: null,
  })
  // Fase 5a: "learn the busy signal live" sub-flow for step 3.
  const [captureStage, setCaptureStage] = useState<"idle" | "awaiting_idle" | "awaiting_busy" | "done">("idle")
  const [captureMessage, setCaptureMessage] = useState<string | null>(null)
  // How many simultaneous generations this site's queue tolerates before
  // being treated as "busy" (persisted as queue.concurrencyLimit). Local
  // input state mirrors status.concurrencyLimit once it arrives, then is
  // edited freely and pushed to sidepanel.js on blur/Enter — permissive/
  // parallel queues (e.g. TensorArt) need this raised above the 1-slot
  // default, while strict single-slot queues (SeaArt) keep it at 1.
  const [concurrencyInput, setConcurrencyInput] = useState("1")
  const concurrencyHydratedRef = useRef(false)
  // (Fase 6) "No wait" override: true skips ALL queue waiting for this site
  // (Level 0/1/2 and even the platform-specific SeaArt/TensorArt path). For
  // fast/permissive/parallel queues (e.g. TensorArt) where waiting is pure
  // wasted time. Persisted alongside concurrencyLimit; toggling it back off
  // restores whatever numeric limit was configured.
  const [unlimitedInput, setUnlimitedInput] = useState(false)

  const refreshStatus = useCallback(() => {
    wlog("[Wizard] refreshStatus() → requesting SITE_PROFILE_STATUS")
    window.parent.postMessage({ type: "REQUEST_SITE_PROFILE_STATUS" }, TARGET_ORIGIN)
  }, [])

  useEffect(() => {
    if (!open) return
    wlog("[Wizard] opened — refreshing status")
    refreshStatus()
    concurrencyHydratedRef.current = false
  }, [open, refreshStatus])

  // Hydrate the concurrency input from the persisted profile exactly once per
  // wizard open, so it reflects the site's saved value without fighting the
  // user's in-progress edits on every subsequent SITE_PROFILE_STATUS refresh
  // (which fires after every Target selection and busy-signal capture).
  useEffect(() => {
    if (!open || !status || concurrencyHydratedRef.current) return
    setConcurrencyInput(String(status.concurrencyLimit))
    setUnlimitedInput(status.unlimited)
    concurrencyHydratedRef.current = true
  }, [open, status])

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!isTrustedSidepanelMessage(event)) return
      if (!event.data) return

      if (event.data.type === "SITE_PROFILE_STATUS") {
        wlog("[Wizard] received SITE_PROFILE_STATUS", event.data)
        setStatus({
          origin: event.data.origin ?? null,
          builtin: !!event.data.builtin,
          promptConfigured: !!event.data.promptConfigured,
          generateConfigured: !!event.data.generateConfigured,
          queueLevel: event.data.queueLevel ?? 0,
          queueMode: event.data.queueMode ?? "none",
          hasBusySignal: !!event.data.hasBusySignal,
          concurrencyLimit: typeof event.data.concurrencyLimit === "number" ? event.data.concurrencyLimit : 1,
          unlimited: !!event.data.unlimited,
        })
        return
      }

      if (event.data.type !== "TARGET_STATUS") return
      const { state, detail } = event.data
      const kind: TargetKind = detail?.targetKind ?? STEPS[activeStep].kind
      wlog(`[Wizard] received TARGET_STATUS state="${state}" kind="${kind}"`, detail)

      switch (state) {
        case "arming":
          setStepStates((prev) => ({ ...prev, [kind]: "arming" }))
          setSelectedInfo((prev) => ({ ...prev, [kind]: null }))
          setErrorMessage(null)
          break
        case "waiting":
          setStepStates((prev) => ({ ...prev, [kind]: "waiting" }))
          break
        case "selected":
          setStepStates((prev) => ({ ...prev, [kind]: "selected" }))
          setSelectedInfo((prev) => ({
            ...prev,
            [kind]: {
              tag: detail?.tag,
              text: detail?.locator?.meta?.text || undefined,
              placeholder: detail?.placeholder || undefined,
            },
          }))
          setErrorMessage(null)
          wlog(`[Wizard]   selected for kind="${kind}": tag="${detail?.tag}" placeholder="${detail?.placeholder}"`)
          refreshStatus()
          break
        case "none":
        case "error":
          setStepStates((prev) => ({ ...prev, [kind]: "error" }))
          setErrorMessage(detail?.message || "Could not select an element on the page. Try again.")
          wlog(`[Wizard]   ⚠ error/none for kind="${kind}": reason="${detail?.reason}" message="${detail?.message}"`)
          break
        case "cancelled":
          setStepStates((prev) => ({ ...prev, [kind]: "idle" }))
          break
        case "busy_signal_idle_captured":
          setCaptureStage("awaiting_busy")
          setCaptureMessage("Idle snapshot saved. Now trigger a generation on the page, then capture again.")
          wlog(`[Wizard]   busy signal idle snapshot captured, classCount=${detail?.classCount}`)
          break
        case "busy_signal_learned":
          setCaptureStage("done")
          setCaptureMessage("Busy signal learned from the page. The queue will now watch for it automatically.")
          wlog(`[Wizard]   busy signal learned: selector="${detail?.selector}" candidateCount=${detail?.candidateCount}`)
          refreshStatus()
          break
        default:
          break
      }
    }
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [activeStep, refreshStatus])

  const startStep = useCallback((kind: TargetKind) => {
    wlog(`[Wizard] startStep("${kind}") — posting QUEUE_ACTION target`)
    setErrorMessage(null)
    setStepStates((prev) => ({ ...prev, [kind]: "arming" }))
    window.parent.postMessage({ type: "QUEUE_ACTION", action: "target", targetKind: kind }, TARGET_ORIGIN)
  }, [])

  const captureBusySignal = useCallback((step: "idle" | "busy") => {
    wlog(`[Wizard] captureBusySignal("${step}") — posting QUEUE_ACTION capture_busy_signal`)
    setCaptureMessage(null)
    if (step === "idle") setCaptureStage("awaiting_idle")
    window.parent.postMessage({ type: "QUEUE_ACTION", action: "capture_busy_signal", step }, TARGET_ORIGIN)
  }, [])

  const commitConcurrencyLimit = useCallback((overrideUnlimited?: boolean) => {
    const parsed = Number.parseInt(concurrencyInput, 10)
    const value = Number.isFinite(parsed) && parsed > 0 ? parsed : 1
    const unlimited = overrideUnlimited ?? unlimitedInput
    setConcurrencyInput(String(value))
    wlog(`[Wizard] commitConcurrencyLimit(value=${value}, unlimited=${unlimited}) — posting QUEUE_ACTION set_concurrency_limit`)
    window.parent.postMessage({ type: "QUEUE_ACTION", action: "set_concurrency_limit", value, unlimited }, TARGET_ORIGIN)
  }, [concurrencyInput, unlimitedInput])

  const toggleUnlimited = useCallback((checked: boolean) => {
    setUnlimitedInput(checked)
    // Commit immediately on toggle (no blur/Enter needed like the numeric
    // input) since a switch has no intermediate "still typing" state.
    commitConcurrencyLimit(checked)
  }, [commitConcurrencyLimit])

  const current = STEPS[activeStep]
  const currentState = stepStates[current.kind]
  const isLastStep = activeStep === STEPS.length - 1
  const canAdvance = current.kind === "queue" || currentState === "selected" || !!status?.builtin

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="text-base font-bold">Set up this site</DialogTitle>
            {status?.builtin && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                Built-in
              </Badge>
            )}
          </div>
          <DialogDescription className="text-xs">
            {status?.origin ? `Configuring ${status.origin}` : "Open a generation page to configure it."}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1.5" aria-label={`Step ${activeStep + 1} of ${STEPS.length}`}>
          {STEPS.map((step, i) => {
            const done = stepStates[step.kind] === "selected" || (step.kind === "queue" && (status?.queueLevel ?? 0) >= 2)
            return (
              <button
                key={step.kind}
                type="button"
                onClick={() => setActiveStep(i)}
                className={cn(
                  "flex-1 h-1.5 rounded-full transition-colors",
                  i === activeStep ? "bg-primary" : done ? "bg-green-500/70" : "bg-muted"
                )}
                aria-label={`Go to step ${i + 1}: ${step.title}`}
                aria-current={i === activeStep}
              />
            )
          })}
        </div>

        {/* Active step content */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Step {activeStep + 1} of {STEPS.length}: {current.title}
            </h3>
            {currentState === "selected" && (
              <Badge className="text-[10px] px-1.5 py-0 h-5 gap-1 bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30">
                <Check className="w-2.5 h-2.5" /> Set
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{current.description}</p>

          {/* Built-in sites work without this step, but the button stays idle
              until the user explicitly clicks Start — make that unambiguous
              instead of leaving a blank "Start" button with no context. */}
          {status?.builtin && currentState === "idle" && current.kind !== "queue" && (
            <Alert className="py-2 border-sky-500/30 bg-sky-500/5">
              <AlertDescription className="text-xs text-sky-700 dark:text-sky-400">
                This site already works out of the box for this step. Nothing is selected yet, only click
                Start if the default detection stops working and you need to point it manually.
              </AlertDescription>
            </Alert>
          )}

          {errorMessage && (
            <Alert variant="destructive" className="py-2">
              <AlertDescription className="text-xs">{errorMessage}</AlertDescription>
            </Alert>
          )}

          <Button
            type="button"
            onClick={() => startStep(current.kind)}
            disabled={currentState === "arming" || currentState === "waiting"}
            variant={currentState === "selected" ? "outline" : "default"}
            className="h-9 text-xs font-semibold gap-1.5"
          >
            {currentState === "arming" ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Preparing page...
              </>
            ) : currentState === "waiting" ? (
              <>
                <MousePointerClick className="w-3.5 h-3.5 animate-nudge" /> Click the element on the page
              </>
            ) : currentState === "selected" ? (
              <>
                <Crosshair className="w-3.5 h-3.5" /> Re-select
              </>
            ) : (
              <>
                <Crosshair className="w-3.5 h-3.5" /> Start
              </>
            )}
          </Button>

          {/* Concrete evidence of what was actually clicked, so a checkmark is
              never the only signal that something was configured correctly. */}
          {currentState === "selected" && selectedInfo[current.kind] && (
            <div className="rounded-md border border-green-500/30 bg-green-500/5 px-2.5 py-2 text-[11px] text-green-700 dark:text-green-400">
              Selected: <code className="font-mono">{`<${(selectedInfo[current.kind]?.tag || "element").toLowerCase()}>`}</code>
              {selectedInfo[current.kind]?.text && <> &ldquo;{selectedInfo[current.kind]?.text}&rdquo;</>}
              {!selectedInfo[current.kind]?.text && selectedInfo[current.kind]?.placeholder && (
                <> placeholder &ldquo;{selectedInfo[current.kind]?.placeholder}&rdquo;</>
              )}
            </div>
          )}

          {/* Concurrency: how many simultaneous generations this site's queue
              tolerates before being treated as "busy". Always visible on this
              step (not gated on having a queue container selected) because it
              also matters for Level 0/1 sites with no container configured —
              e.g. TensorArt runs generations in parallel and almost never
              actually queues, so the single-slot default makes the extension
              wait for no reason. Raising this lets fast/permissive sites move
              at their real pace instead of the conservative default. */}
          {current.kind === "queue" && (
            <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="wizard-unlimited-queue" className="text-xs font-medium">
                    Don&apos;t wait (near-unlimited queue)
                  </Label>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    For fast, permissive, parallel sites (e.g. TensorArt) that almost never queue. Skips all
                    queue waiting entirely.
                  </p>
                </div>
                <Switch
                  id="wizard-unlimited-queue"
                  checked={unlimitedInput}
                  onCheckedChange={toggleUnlimited}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wizard-concurrency-limit" className="text-xs font-medium">
                  Concurrent generations allowed
                </Label>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  How many generations this site can run at once before the extension waits. Keep at 1 for
                  strict single-slot queues. Raise it for fast/permissive sites that process several
                  requests in parallel.
                </p>
                <Input
                  id="wizard-concurrency-limit"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={concurrencyInput}
                  onChange={(e) => setConcurrencyInput(e.target.value)}
                  onBlur={() => commitConcurrencyLimit()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      commitConcurrencyLimit()
                    }
                  }}
                  disabled={unlimitedInput}
                  className="h-8 w-24 text-xs"
                />
              </div>
            </div>
          )}

          {/* Fase 5a: optional queue container + busy-signal learning, step 3 only */}
          {current.kind === "queue" && currentState === "selected" && (
            <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
              <p className="text-xs font-medium">Teach it what &ldquo;busy&rdquo; looks like (optional)</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Capture the queue while it&apos;s empty, start a generation yourself, then capture again. The
                extension learns the difference automatically.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => captureBusySignal("idle")}
                  disabled={captureStage === "awaiting_idle"}
                  className="h-7 text-[11px] flex-1"
                >
                  1. Capture idle
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => captureBusySignal("busy")}
                  disabled={captureStage !== "awaiting_busy"}
                  className="h-7 text-[11px] flex-1"
                >
                  2. Capture busy
                </Button>
              </div>
              {captureMessage && (
                <p className={cn(
                  "text-[11px] leading-relaxed",
                  captureStage === "done" ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                )}>
                  {captureMessage}
                </p>
              )}
              {status?.hasBusySignal && captureStage === "idle" && (
                <p className="text-[11px] text-green-600 dark:text-green-400">
                  A busy signal is already saved for this site.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs"
            disabled={activeStep === 0}
            onClick={() => setActiveStep((s) => Math.max(0, s - 1))}
          >
            Back
          </Button>
          {isLastStep ? (
            <Button type="button" size="sm" className="text-xs" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="text-xs"
              disabled={!canAdvance}
              onClick={() => setActiveStep((s) => Math.min(STEPS.length - 1, s + 1))}
            >
              Next
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
