"use client"

/**
 * The ComfyUI dialog: turn Send on, point it at the user's ComfyUI, see what
 * is wrong with the connection in one line, pick or import a workflow, check
 * its roles (and change them in the graph) and run a test. Loaded on demand.
 */
import { useCallback, useId, useState } from "react"
import { Check, CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { useComfyUISettings } from "@/hooks/use-comfyui-settings"
import { useLowMotion } from "@/hooks/use-low-motion"
import { checkNodesAgainstObjectInfo } from "@/lib/comfyui/import"
import type { ComfyPanelReason } from "@/lib/comfyui/panel-request"
import { setupProgress } from "@/lib/comfyui/setup-steps"
import { statusCopy } from "@/lib/comfyui/status"
import type { Diagnosis, ObjectInfo, Roles, SavedComfyWorkflow } from "@/lib/comfyui/types"
import { cn } from "@/lib/utils"
import {
  AddressField,
  BridgeList,
  ComfyUIWorkflowViewer,
  DropZone,
  OptionList,
  RoleSummary,
  SavedList,
  Section,
  StatusLine,
  TestRun,
  loadViewer,
  removeWithUndo,
  useBridgeWorkflows,
  useDiagnosis,
  useObjectInfo,
  useRememberPassedTest,
  useTestJob,
  useWorkflowImport,
  type TestJob,
} from "./comfyui-setup-parts"

function ModeSwitch({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 px-3 py-3">
      <label htmlFor={id} className="flex min-w-0 cursor-pointer flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">Send to ComfyUI</span>
        <span className="text-xs leading-relaxed text-muted-foreground">
          {enabled
            ? "On. Copy buttons are Send buttons and queue the prompt in ComfyUI."
            : "Turns Copy buttons into Send buttons that queue the prompt in ComfyUI."}
        </span>
      </label>
      <Switch id={id} checked={enabled} onCheckedChange={onChange} className="shrink-0" />
    </div>
  )
}

function RolesSection({
  workflow,
  objectInfo,
  missingNodes,
  showGraph,
  onToggleGraph,
  onRolesChange,
  focusPromptRequest,
  labelledBy: id,
}: {
  workflow: SavedComfyWorkflow
  objectInfo: ObjectInfo | null
  missingNodes: string[]
  showGraph: boolean
  onToggleGraph: () => void
  onRolesChange: (roles: Roles) => void
  focusPromptRequest?: number
  labelledBy: string
}) {
  return (
    <Section
      title="Roles"
      labelledBy={id}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onToggleGraph}
          onPointerEnter={() => void loadViewer()}
          onFocus={() => void loadViewer()}
          aria-expanded={showGraph}
          className="h-8 px-3 text-xs"
        >
          {showGraph ? "Hide graph" : "Change in graph"}
        </Button>
      }
    >
      <p className="-mt-1 text-xs leading-relaxed text-muted-foreground">
        Where the site writes into {workflow.name}. Everything else stays as you set it in ComfyUI.
      </p>
      {showGraph ? (
        <>
          <ComfyUIWorkflowViewer
            key={workflow.id}
            workflow={workflow}
            objectInfo={objectInfo}
            onRolesChange={onRolesChange}
            focusPromptRequest={focusPromptRequest}
          />
          {missingNodes.length > 0 && <RoleSummary workflow={workflow} missingNodes={missingNodes} />}
        </>
      ) : (
        <RoleSummary workflow={workflow} missingNodes={missingNodes} />
      )}
    </Section>
  )
}

// --- Setup steps ----------------------------------------------------------------

interface SetupStep {
  key: string
  title: string
  done: boolean
  /** Shown after the title once the step is done. */
  doneText?: string
  /** Shown while this is the step to do. */
  hint: string
  action?: { label: string; onClick: () => void; busy?: boolean } | null
}

/**
 * What is left before Send works, one step at a time: done steps show what
 * was chosen, the first open step says what to do and offers the action, the
 * rest wait. When every step is done it turns into the "all set" state.
 */
function SetupSteps({
  steps,
  enabled,
  workflowName,
  onFinish,
}: {
  steps: SetupStep[]
  enabled: boolean
  workflowName: string | null
  onFinish: () => void
}) {
  const headingId = useId()
  const currentIndex = steps.findIndex((step) => !step.done)
  const doneCount = steps.filter((step) => step.done).length

  if (currentIndex === -1) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-3 rounded-lg border border-success-border bg-success-soft px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <CheckCircle2 aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-success-text" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-semibold text-foreground">You&apos;re all set</p>
            <p className="text-pretty text-xs leading-relaxed text-foreground/80">
              {enabled
                ? `Send buttons now queue prompts in ComfyUI${workflowName ? ` with ${workflowName}` : ""}.`
                : "Everything works. Start sending to turn Copy buttons into Send buttons."}
            </p>
          </div>
        </div>
        <Button type="button" onClick={onFinish} className="h-9 shrink-0 px-4 text-sm">
          {enabled ? "Done" : "Start sending"}
        </Button>
      </div>
    )
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg border border-border/70 px-3 py-3 sm:px-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">Set up Send</h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {doneCount} of {steps.length} done
        </span>
      </div>
      <ol className="flex flex-col gap-2.5">
        {steps.map((step, index) => {
          const state = step.done ? "done" : index === currentIndex ? "current" : "waiting"
          return (
            <li key={step.key} aria-current={state === "current" ? "step" : undefined} className="flex gap-3">
              <span
                aria-hidden
                className={cn(
                  "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                  state === "done" && "bg-success-soft text-success-text ring-1 ring-inset ring-success-border",
                  state === "current" && "bg-primary text-primary-foreground",
                  state === "waiting" && "text-muted-foreground ring-1 ring-inset ring-border",
                )}
              >
                {state === "done" ? <Check className="h-3 w-3" strokeWidth={3} /> : index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <p className={cn("min-w-0 text-sm", state === "waiting" ? "text-muted-foreground" : "text-foreground", state === "current" && "font-medium")}>
                  <span className="sr-only">{state === "done" ? "Done: " : state === "current" ? "Next: " : "Later: "}</span>
                  {step.title}
                  {state === "done" && step.doneText && (
                    <span className="font-normal text-muted-foreground"> · {step.doneText}</span>
                  )}
                </p>
                {state === "current" && (
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-pretty text-xs leading-relaxed text-muted-foreground">{step.hint}</p>
                    {step.action && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={step.action.onClick}
                        disabled={step.action.busy}
                        className="h-8 gap-1.5 px-3 text-xs"
                      >
                        {step.action.busy && <Loader2 aria-hidden className="h-3.5 w-3.5 motion-safe:animate-spin" />}
                        {step.action.label}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

// --- Panel --------------------------------------------------------------------

export interface ComfyUIPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Why a Send button opened the panel, shown as a hint while it still applies. */
  reason?: ComfyPanelReason | null
  /** Changes each time a Send button opens the panel. */
  requestId?: number
  /** Gets focus back when the panel closes (the Send button that opened it). */
  returnFocusTo?: HTMLElement | null
  /** Opens the setup guide from the start, in place of this panel. */
  onRunSetup?: () => void
}

const REASON_HINT: Record<ComfyPanelReason, string> = {
  workflow: "Choose a workflow to send prompts with.",
  "prompt-role": "Choose the Prompt input, so Send knows where to write the card's prompt.",
}

function reasonHintFor(reason: ComfyPanelReason | null, workflow: SavedComfyWorkflow | null): string | null {
  if (reason === "workflow" && !workflow) return REASON_HINT.workflow
  if (reason === "prompt-role" && workflow && !workflow.roles.prompt) return REASON_HINT["prompt-role"]
  return null
}

function notReadyReasonFor(connected: boolean, workflow: SavedComfyWorkflow | null): string {
  if (!connected) return "Connect to ComfyUI to run a test."
  if (!workflow) return "Choose a workflow to run a test."
  return "Choose the Output node in Roles to run a test."
}

/** The setup steps for the panel as it is now. `go` holds what each step's button does. */
function setupSteps({
  diagnosis,
  checking,
  workflow,
  test,
  ready,
  go,
}: {
  diagnosis: Diagnosis | null
  checking: boolean
  workflow: SavedComfyWorkflow | null
  test: Pick<TestJob, "running" | "failed">
  ready: boolean
  go: Record<"check" | "workflows" | "promptInGraph" | "outputInGraph" | "runTest" | "showTest", () => void>
}): SetupStep[] {
  const progress = setupProgress(diagnosis, workflow)
  const { connected } = progress
  const waiting = checking || !diagnosis
  const connect: SetupStep = {
    key: "connect",
    title: "Connect to ComfyUI",
    done: progress.connected,
    doneText: diagnosis?.state === "ok" && diagnosis.comfyVersion ? `ComfyUI ${diagnosis.comfyVersion}` : undefined,
    hint: diagnosis ? statusCopy(diagnosis).text : "Checking the connection…",
    action: diagnosis?.state === "unsupported-browser" ? null : { label: waiting ? "Checking…" : "Check again", onClick: go.check, busy: waiting },
  }
  const choose: SetupStep = {
    key: "workflow",
    title: "Choose a workflow",
    done: progress.hasWorkflow,
    doneText: workflow?.name,
    hint: connected
      ? "Use one from your ComfyUI, or add a .png or .json file."
      : "Add a .png or .json file, or connect to use one from your ComfyUI.",
    action: { label: "Show workflows", onClick: go.workflows },
  }
  const prompt: SetupStep | null =
    workflow && !progress.hasPrompt
      ? {
          key: "prompt",
          title: "Choose the Prompt input",
          done: false,
          hint: REASON_HINT["prompt-role"],
          action: { label: "Choose in graph", onClick: go.promptInGraph },
        }
      : null
  const run: SetupStep = {
    key: "test",
    title: "Run a test",
    done: progress.tested && !test.failed,
    doneText: "Passed",
    hint: testStepHint(test, ready, connected, workflow),
    action: test.running
      ? { label: "Show the test", onClick: go.showTest }
      : ready
        ? { label: test.failed ? "Run again" : "Run a test", onClick: go.runTest }
        : workflow && !workflow.roles.output
          ? { label: "Choose in graph", onClick: go.outputInGraph }
          : null,
  }
  return prompt ? [connect, choose, prompt, run] : [connect, choose, run]
}

function testStepHint(test: Pick<TestJob, "running" | "failed">, ready: boolean, connected: boolean, workflow: SavedComfyWorkflow | null): string {
  if (test.running) return "The test is running. Its progress shows under Test."
  if (test.failed) return "The last test didn't work. The reason shows under Test."
  if (ready) return "Sends a sample prompt and shows the image ComfyUI makes."
  return notReadyReasonFor(connected, workflow)
}

export function ComfyUIPanel({ open, onOpenChange, reason = null, requestId, returnFocusTo, onRunSetup }: ComfyUIPanelProps) {
  const settings = useComfyUISettings()
  const { enabled, url, workflows, activeWorkflow, options } = settings
  const { diagnosis, checking, check } = useDiagnosis(url, open)
  const connected = diagnosis?.state === "ok"
  const bridge = useBridgeWorkflows(url, open && connected)
  const objectInfo = useObjectInfo(url, open && connected)
  const importer = useWorkflowImport(settings, objectInfo)
  const [showGraph, setShowGraph] = useState(reason === "prompt-role")

  // Opened by Send for a missing prompt input: show the graph, where it is picked.
  const [graphRequest, setGraphRequest] = useState(requestId)
  if (requestId !== graphRequest) {
    setGraphRequest(requestId)
    if (reason === "prompt-role") setShowGraph(true)
  }

  const { updateRoles } = settings
  const activeId = activeWorkflow?.id
  const onRolesChange = useCallback(
    (roles: Roles) => {
      if (activeId) updateRoles(activeId, roles)
    },
    [activeId, updateRoles],
  )

  const missingNodes = activeWorkflow && objectInfo ? checkNodesAgainstObjectInfo(activeWorkflow.api, objectInfo) : []
  const ready = connected && !!activeWorkflow && !!activeWorkflow.roles.output
  const reasonHint = reasonHintFor(reason, activeWorkflow)
  const ids = { connection: useId(), workflows: useId(), roles: useId(), options: useId(), test: useId() }
  const lowMotion = useLowMotion()
  const test = useTestJob(url, activeWorkflow, options, open)

  useRememberPassedTest(settings, test, activeWorkflow)

  // "Choose in graph" from the steps: open the graph on the Prompt input.
  const [promptFocus, setPromptFocus] = useState<number | null>(null)

  /** Scrolls a section into view and moves focus to its heading. */
  const jumpTo = (headingId: string) => {
    // Wait a frame: the section may only now be rendering (the graph opening).
    requestAnimationFrame(() => {
      const heading = document.getElementById(headingId)
      if (!heading) return
      heading.scrollIntoView({ block: "start", behavior: lowMotion ? "auto" : "smooth" })
      heading.focus({ preventScroll: true })
    })
  }

  const chooseInGraph = () => {
    setShowGraph(true)
    setPromptFocus((n) => (n ?? 0) + 1)
    jumpTo(ids.roles)
  }

  const finish = () => {
    if (!enabled) settings.setEnabled(true)
    onOpenChange(false)
  }

  const steps = setupSteps({
    diagnosis,
    checking,
    workflow: activeWorkflow,
    test,
    ready,
    go: {
      check: () => void check(),
      workflows: () => jumpTo(ids.workflows),
      promptInGraph: chooseInGraph,
      outputInGraph: () => {
        setShowGraph(true)
        jumpTo(ids.roles)
      },
      runTest: () => {
        void test.start()
        jumpTo(ids.test)
      },
      showTest: () => jumpTo(ids.test),
    },
  })
  const allSet = steps.every((step) => step.done)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Start on the dialog itself, not on the first switch.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.focus()
        }}
        onCloseAutoFocus={(e) => {
          if (returnFocusTo?.isConnected) {
            e.preventDefault()
            returnFocusTo.focus()
          }
        }}
        className={cn(
          "flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 focus:outline-none sm:max-h-[min(56rem,calc(100dvh-3rem))]",
          showGraph ? "sm:max-w-[min(68rem,calc(100vw-3rem))]" : "sm:max-w-[38rem]",
        )}
      >
        <DialogHeader className="px-4 pb-4 pt-5 text-left sm:px-6 sm:pt-6">
          <DialogTitle>ComfyUI</DialogTitle>
          <DialogDescription className="text-pretty pr-6">
            Send prompts to ComfyUI on your computer. Everything stays between your browser and ComfyUI.
            {onRunSetup && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={onRunSetup}
                  className="rounded-sm font-medium text-primary-text underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Run setup again
                </button>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 overflow-y-auto overscroll-contain px-4 pb-6 sm:px-6">
          <SetupSteps steps={steps} enabled={enabled} workflowName={activeWorkflow?.name ?? null} onFinish={finish} />
          <ModeSwitch enabled={enabled} onChange={(v) => settings.setEnabled(v)} />

          <Section title="Connection" labelledBy={ids.connection}>
            {/* Keyed by the saved address, so a change from another tab resets the draft. */}
            <AddressField key={url} url={url} setUrl={settings.setUrl} />
            <StatusLine diagnosis={diagnosis} checking={checking} onCheck={() => void check()} />
          </Section>

          <Section title="Workflow" labelledBy={ids.workflows}>
            {connected && (
              <BridgeList
                items={bridge.items}
                loading={bridge.loading}
                failed={bridge.failed}
                saved={workflows}
                busyId={importer.busyId}
                onUse={(item) => void importer.fromBridge(item)}
                onRefresh={bridge.refresh}
              />
            )}
            <DropZone onFile={(f) => void importer.fromFile(f)} error={importer.error} />
            {importer.notice && !importer.error && (
              <p role="status" className="text-xs text-success-text">{importer.notice}</p>
            )}
            <SavedList
              workflows={workflows}
              activeId={activeWorkflow?.id ?? null}
              onSelect={importer.select}
              onRemove={(w) => removeWithUndo(settings, w)}
            />
          </Section>

          {activeWorkflow && (
            <RolesSection
              workflow={activeWorkflow}
              objectInfo={objectInfo}
              missingNodes={missingNodes}
              showGraph={showGraph}
              onToggleGraph={() => setShowGraph((v) => !v)}
              onRolesChange={onRolesChange}
              focusPromptRequest={promptFocus ?? (reasonHint && reason === "prompt-role" ? requestId : undefined)}
              labelledBy={ids.roles}
            />
          )}

          <Section title="Options" labelledBy={ids.options}>
            <OptionList options={options} onChange={(patch) => settings.setOptions(patch)} />
          </Section>

          <Section title="Test" labelledBy={ids.test}>
            <TestRun
              test={test}
              workflow={activeWorkflow}
              ready={ready}
              notReadyReason={notReadyReasonFor(connected, activeWorkflow)}
              finish={
                allSet
                  ? {
                      label: enabled ? "Done" : "Start sending",
                      message: enabled ? "Send buttons now queue prompts in ComfyUI." : "Start sending to turn Copy buttons into Send buttons.",
                      onClick: finish,
                    }
                  : null
              }
            />
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ComfyUIPanel
