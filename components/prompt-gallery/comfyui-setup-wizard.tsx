"use client"

/**
 * The setup guide for Send to ComfyUI: one task per screen, from "what you
 * need" to a passed test. It reopens on the first step that isn't done, and
 * the install and publish steps watch ComfyUI on their own while they are on
 * screen, so the user never has to press "Check again". Loaded on demand.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"
import { AlertCircle, ArrowLeft, Check, CheckCircle2, ChevronDown, Copy, ExternalLink, Loader2, Monitor, MonitorSmartphone, Puzzle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { getComfyUISettings, useComfyUISettings } from "@/hooks/use-comfyui-settings"
import { useLowMotion } from "@/hooks/use-low-motion"
import { track } from "@/lib/analytics"
import {
  BRIDGE_CLI_COMMAND,
  BRIDGE_CONSOLE_LINE,
  BRIDGE_GIT_COMMAND,
  BRIDGE_INSTALL_URL,
  BRIDGE_MANAGER_NAME,
  BRIDGE_PUBLISH_LABEL,
} from "@/lib/comfyui/bridge"
import { DEFAULT_COMFY_PORT } from "@/lib/comfyui/url"
import { checkNodesAgainstObjectInfo } from "@/lib/comfyui/import"
import type { ComfyPanelReason } from "@/lib/comfyui/panel-request"
import { nodeTitle } from "@/lib/comfyui/role-choices"
import { detectRoles } from "@/lib/comfyui/roles"
import {
  NUMBERED_STEPS,
  canContinue,
  currentDeviceSupport,
  installState,
  promptCertainty,
  resumeStep,
  setupProgress,
  type DeviceSupport,
  type SetupStepId,
} from "@/lib/comfyui/setup-steps"
import { refreshComfyStatus } from "@/lib/comfyui/status"
import type { BridgeWorkflowSummary, Diagnosis, ObjectInfo, Roles, SavedComfyWorkflow } from "@/lib/comfyui/types"
import { cn } from "@/lib/utils"
import { ManagerIllustration, TopBarIllustration } from "./comfyui-setup-illustrations"
import {
  AddressField,
  ComfyUIWorkflowViewer,
  DropZone,
  OptionList,
  RoleSummary,
  StatusLine,
  TestRun,
  loadViewer,
  useBridgeWorkflows,
  useDiagnosis,
  useObjectInfo,
  useRememberPassedTest,
  usePollWhileVisible,
  useTestJob,
  useWorkflowImport,
  type Settings,
  type TestJob,
} from "./comfyui-setup-parts"

/** How often the install and publish steps ask ComfyUI again while on screen. */
const POLL_MS = 3000
/** How long "Found it" stays before the guide moves on. */
const FOUND_PAUSE_MS = 1600

const STEP_TITLE: Record<SetupStepId, string> = {
  start: "Before you start",
  install: "Install the node",
  publish: "Publish your workflow",
  prompt: "Check the prompt input",
  test: "Run a test",
  done: "You're all set",
}

// --- Small parts ------------------------------------------------------------------

function Lead({ children }: { children: ReactNode }) {
  return <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{children}</p>
}

/** The progress strip: one segment per numbered step. */
function Progress({ step }: { step: SetupStepId }) {
  const index = NUMBERED_STEPS.indexOf(step)
  const done = step === "done"
  return (
    <div className="flex items-center gap-3">
      <ol className="flex flex-1 gap-1" aria-label="Setup steps">
        {NUMBERED_STEPS.map((s, i) => {
          const state = done || i < index ? "done" : i === index ? "current" : "waiting"
          return (
            <li key={s} aria-current={state === "current" ? "step" : undefined} className="flex-1">
              <span className="sr-only">
                {STEP_TITLE[s]}
                {state === "done" ? ", done" : state === "current" ? ", current step" : ""}
              </span>
              <span
                aria-hidden
                className={cn(
                  "block h-1 rounded-full transition-colors duration-300 ease-out",
                  state === "waiting" ? "bg-muted" : state === "current" ? "bg-primary" : "bg-primary/45",
                )}
              />
            </li>
          )
        })}
      </ol>
      <span aria-hidden className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {done ? "Done" : `${index + 1} of ${NUMBERED_STEPS.length}`}
      </span>
    </div>
  )
}

/** A disclosure: a quiet button that shows more below it. */
function Disclosure({ label, defaultOpen = false, children }: { label: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="-mx-1 flex min-h-9 items-center gap-1.5 self-start rounded-md px-1 text-sm font-medium text-foreground/90 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown aria-hidden className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200 ease-out", open && "rotate-180")} />
        {label}
      </button>
      {open && (
        <div id={id} className="flex flex-col gap-3 pl-6">
          {children}
        </div>
      )}
    </div>
  )
}

function CopyCommand({ command, note }: { command: string; note: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 py-1 pl-3 pr-1">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1.5 font-mono text-[12.5px] text-foreground [scrollbar-width:thin]">
          {command}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(command).then(
              () => setCopied(true),
              () => {},
            )
          }}
          aria-label={copied ? "Copied" : `Copy: ${command}`}
          className="h-8 shrink-0 gap-1.5 px-2 text-xs"
        >
          {copied ? <Check aria-hidden className="h-3.5 w-3.5 text-success-text" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>
    </div>
  )
}

function Need({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </li>
  )
}

function Notice({ tone, title, children }: { tone: "problem" | "ok"; title: string; children?: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3",
        tone === "ok" ? "border-success-border bg-success-soft" : "border-warning-border bg-warning-soft",
      )}
    >
      {tone === "ok" ? (
        <CheckCircle2 aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-success-text" />
      ) : (
        <AlertCircle aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-warning-text" />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {children && <div className="text-pretty text-sm leading-relaxed text-foreground/85">{children}</div>}
      </div>
    </div>
  )
}

// --- Steps ----------------------------------------------------------------------------

function StartStep({ device }: { device: DeviceSupport }) {
  return (
    <div className="flex flex-col gap-5">
      <Lead>Send to ComfyUI queues a card&apos;s prompt in ComfyUI with one click, instead of copying it. Here&apos;s what it needs.</Lead>
      {device !== "ok" && (
        <div role="alert">
          {device === "mobile" ? (
            <Notice tone="problem" title="Set this up on your computer">
              Phones and tablets can&apos;t reach ComfyUI. Open this site in Chrome, Edge or Firefox on the computer that runs ComfyUI.
            </Notice>
          ) : (
            <Notice tone="problem" title="This browser can't reach ComfyUI">
              Safari blocks sites from connecting to apps on your computer. Open this page in Chrome, Edge or Firefox.
            </Notice>
          )}
        </div>
      )}
      <ul className="flex flex-col gap-4">
        <Need icon={<Monitor className="h-4 w-4" />} title="ComfyUI on this computer">
          The site connects to ComfyUI at a local address, like http://127.0.0.1:{DEFAULT_COMFY_PORT}. It can&apos;t reach other computers.
        </Need>
        <Need icon={<MonitorSmartphone className="h-4 w-4" />} title="Chrome, Edge or Firefox on a desktop">
          Safari and the browsers on iPhone and iPad can&apos;t connect. Chrome may ask once to connect to devices on your local network. Choose Allow.
        </Need>
        <Need icon={<Puzzle className="h-4 w-4" />} title="A small node for ComfyUI">
          ComfyUI blocks other websites by default. The node lets this site through. You&apos;ll install it next.
        </Need>
      </ul>
      <p className="text-xs leading-relaxed text-muted-foreground">Prompts go straight from your browser to ComfyUI. They don&apos;t pass through the site.</p>
    </div>
  )
}

/** The live connection card on the install step. */
function InstallStatus({ diagnosis, url }: { diagnosis: Diagnosis | null; url: string }) {
  const lowMotion = useLowMotion()
  const state = installState(diagnosis)
  const ok = state.tone === "ok"
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3.5 transition-colors duration-300",
        ok ? "border-success-border bg-success-soft" : state.tone === "blocked" ? "border-warning-border bg-warning-soft" : "border-border bg-muted/30",
      )}
    >
      <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        {ok ? (
          <CheckCircle2 className={cn("h-5 w-5 text-success-text", !lowMotion && "comfy-found-pop")} />
        ) : state.tone === "blocked" ? (
          <AlertCircle className="h-5 w-5 text-warning-text" />
        ) : (
          <span className="relative flex h-2.5 w-2.5">
            {!lowMotion && <span className="absolute inset-0 rounded-full bg-primary/50 motion-safe:animate-ping" />}
            <span className="relative h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
        )}
      </span>
      <div role="status" aria-live="polite" aria-atomic="true" className="flex min-w-0 flex-col gap-1">
        <p className={cn("text-sm font-semibold text-foreground")}>{state.title}</p>
        {state.text && <p className="text-pretty text-sm leading-relaxed text-foreground/85">{state.text}</p>}
        {state.poll && !ok && (
          <p className="text-xs text-muted-foreground">
            Checking <span className="font-mono">{url.replace(/^https?:\/\//, "")}</span> every few seconds.
          </p>
        )}
      </div>
    </div>
  )
}

function InstallStep({
  diagnosis,
  url,
  setUrl,
  onFound,
}: {
  diagnosis: Diagnosis | null
  url: string
  setUrl: (url: string) => boolean
  /** Called once when the node starts answering while this step is open. */
  onFound: () => void
}) {
  const ok = diagnosis?.state === "ok"
  // Moving on by itself only makes sense when the user saw it fail first:
  // coming Back to an already-working step must not bounce them forward.
  const [sawProblem, setSawProblem] = useState(!ok)
  if (!ok && !sawProblem) setSawProblem(true)
  const latest = useRef(onFound)
  useEffect(() => {
    latest.current = onFound
  })
  useEffect(() => {
    if (!ok || !sawProblem) return
    const timer = window.setTimeout(() => latest.current(), FOUND_PAUSE_MS)
    return () => window.clearTimeout(timer)
  }, [ok, sawProblem])

  const unusualAddress = url !== `http://127.0.0.1:${DEFAULT_COMFY_PORT}` || diagnosis?.state === "invalid-url"

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <Lead>In ComfyUI:</Lead>
        <ol className="flex list-none flex-col gap-2.5 text-sm text-foreground [counter-reset:step]">
          {[
            <>Open <strong className="font-semibold">Manager</strong>, then <strong className="font-semibold">Custom Nodes Manager</strong>.</>,
            <>Search for <strong className="font-semibold">{BRIDGE_MANAGER_NAME}</strong> and click <strong className="font-semibold">Install</strong>.</>,
            <>Restart ComfyUI. Its console then shows “{BRIDGE_CONSOLE_LINE}”.</>,
          ].map((text, i) => (
            <li key={i} className="flex gap-3">
              <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-foreground/80">
                {i + 1}
              </span>
              <span className="text-pretty leading-relaxed">{text}</span>
            </li>
          ))}
        </ol>
      </div>
      <ManagerIllustration />
      <InstallStatus diagnosis={diagnosis} url={url} />
      <div className="flex flex-col gap-1 border-t border-border/60 pt-3">
        <Disclosure label="Other ways to install">
          <CopyCommand command={BRIDGE_CLI_COMMAND} note="With comfy-cli. Restart ComfyUI afterwards." />
          <CopyCommand command={BRIDGE_GIT_COMMAND} note="Run it inside ComfyUI/custom_nodes, then restart ComfyUI." />
          {BRIDGE_INSTALL_URL && (
            <a
              href={BRIDGE_INSTALL_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 self-start rounded-sm text-sm font-medium text-primary-text underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Install guide on GitHub
              <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </Disclosure>
        <Disclosure label="ComfyUI isn't at the usual address?" defaultOpen={unusualAddress}>
          {/* Keyed by the saved address, so a change from another tab resets the draft. */}
          <AddressField key={url} url={url} setUrl={setUrl} />
        </Disclosure>
      </div>
    </div>
  )
}

function PublishedList({
  items,
  failed,
  activeBridgeId,
  busyId,
  onUse,
}: {
  items: BridgeWorkflowSummary[] | null
  failed: boolean
  activeBridgeId: string | null
  busyId: string | null
  onUse: (item: BridgeWorkflowSummary) => void
}) {
  // What was already published when the step opened; anything after that is new.
  const [baseline, setBaseline] = useState<Set<string> | null>(null)
  if (items && baseline === null) setBaseline(new Set(items.map((i) => i.id)))
  const fresh = items && baseline ? items.filter((i) => !baseline.has(i.id)) : []

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/70 px-3 py-3 sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">Published from ComfyUI</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
          Watching for new ones
        </span>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {fresh.length > 0 ? `New from ComfyUI: ${fresh.map((i) => i.name).join(", ")}.` : ""}
      </p>
      {failed && !items ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load the list from ComfyUI. Trying again…</p>
      ) : items === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="h-4 w-4 motion-safe:animate-spin" />
          Loading…
        </p>
      ) : items.length === 0 ? (
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">Nothing yet. Your workflow shows up here as soon as you publish it.</p>
      ) : (
        <ul className="flex flex-col" aria-label="Workflows published from ComfyUI">
          {[...items].reverse().map((item) => {
            const isNew = fresh.some((f) => f.id === item.id)
            const inUse = item.id === activeBridgeId
            return (
              <li
                key={item.id}
                className={cn(
                  "flex min-h-12 items-center justify-between gap-3 border-b border-border/50 py-1.5 last:border-b-0",
                  isNew && "comfy-row-in",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm text-foreground">{item.name}</span>
                  {isNew && (
                    <span className="shrink-0 rounded-full bg-primary/12 px-1.5 py-0.5 text-[11px] font-medium text-primary-text">New</span>
                  )}
                </span>
                {inUse ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success-text">
                    <Check aria-hidden className="h-3.5 w-3.5" />
                    In use
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant={isNew ? "default" : "outline"}
                    size="sm"
                    onClick={() => onUse(item)}
                    disabled={busyId !== null}
                    aria-label={`Use ${item.name}`}
                    className="h-8 shrink-0 px-3 text-xs"
                  >
                    {busyId === item.id ? <Loader2 aria-hidden className="h-3.5 w-3.5 motion-safe:animate-spin" /> : "Use"}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function PublishStep({
  url,
  diagnosis,
  checking,
  onCheck,
  workflow,
  importer,
  onPicked,
}: {
  url: string
  diagnosis: Diagnosis | null
  checking: boolean
  onCheck: () => void
  workflow: SavedComfyWorkflow | null
  importer: ReturnType<typeof useWorkflowImport>
  onPicked: () => void
}) {
  const connected = diagnosis?.state === "ok"
  const bridge = useBridgeWorkflows(url, connected, POLL_MS)

  return (
    <div className="flex flex-col gap-5">
      <Lead>
        Open the workflow you want to use in ComfyUI. Then click <strong className="font-semibold text-foreground">{BRIDGE_PUBLISH_LABEL}</strong> in
        the top bar, next to Run. It&apos;s also in the File menu.
      </Lead>
      <TopBarIllustration />
      {connected ? (
        <PublishedList
          items={bridge.items}
          failed={bridge.failed}
          activeBridgeId={workflow?.bridgeId ?? null}
          busyId={importer.busyId}
          onUse={(item) => {
            void importer.fromBridge(item).then((ok) => {
              if (ok) onPicked()
            })
          }}
        />
      ) : (
        <StatusLine diagnosis={diagnosis} checking={checking} onCheck={onCheck} />
      )}
      {workflow && (
        <p className="flex items-center gap-2 text-sm text-foreground">
          <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0 text-success-text" />
          <span className="min-w-0 truncate">
            Using <span className="font-medium">{workflow.name}</span>
          </span>
        </p>
      )}
      <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
        <p className="text-sm font-medium text-foreground">Or add a file</p>
        <DropZone
          onFile={(file) => {
            void importer.fromFile(file).then((ok) => {
              if (ok) onPicked()
            })
          }}
          error={importer.error}
        />
      </div>
    </div>
  )
}

/** The prompt step opens on the graph when the prompt or output still has to be picked. */
function graphNeeded(workflow: SavedComfyWorkflow | null): boolean {
  return !!workflow && (!workflow.roles.prompt || !workflow.roles.output)
}

function PromptStep({
  workflow,
  objectInfo,
  settings,
  showGraph,
  onToggleGraph,
}: {
  workflow: SavedComfyWorkflow
  objectInfo: ObjectInfo | null
  settings: Settings
  showGraph: boolean
  onToggleGraph: () => void
}) {
  const detection = useMemo(() => detectRoles(workflow.api, objectInfo ?? undefined), [workflow.api, objectInfo])
  const certainty = promptCertainty(workflow, detection.candidates.prompt.length)
  const missingNodes = objectInfo ? checkNodesAgainstObjectInfo(workflow.api, objectInfo) : []
  const { updateRoles } = settings
  const onRolesChange = (roles: Roles) => {
    updateRoles(workflow.id, roles)
  }
  const promptRef = workflow.roles.prompt

  return (
    <div className="flex flex-col gap-5">
      <div role="status" aria-live="polite" className="flex flex-col gap-1.5">
        {certainty === "missing" || !promptRef ? (
          <Notice tone="problem" title="No prompt input picked yet">
            Choose the input you type the prompt into in ComfyUI. Send writes the card&apos;s prompt there.
          </Notice>
        ) : (
          <>
            <p className="text-pretty text-base leading-relaxed text-foreground">
              The card&apos;s prompt goes into{" "}
              <span className="font-semibold">{nodeTitle(workflow.api, promptRef.nodeId)}</span>{" "}
              <span className="text-muted-foreground">({promptRef.input})</span>.
            </p>
            {certainty === "check" && (
              <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
                This workflow has other text inputs too. If the prompt belongs in another one, change it in the graph.
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Where the site writes</p>
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
        </div>
        {showGraph && (
          <ComfyUIWorkflowViewer
            key={workflow.id}
            workflow={workflow}
            objectInfo={objectInfo}
            onRolesChange={onRolesChange}
          />
        )}
        {/* The graph lists the roles beside it; the summary stays for missing nodes. */}
        {(!showGraph || missingNodes.length > 0) && <RoleSummary workflow={workflow} missingNodes={missingNodes} />}
      </div>

      <div className="flex flex-col gap-1 border-t border-border/60 pt-4">
        <p className="text-sm font-medium text-foreground">Each time you send</p>
        <OptionList options={settings.options} onChange={(patch) => settings.setOptions(patch)} />
      </div>
    </div>
  )
}

function TestStep({ test, workflow, ready, connected }: { test: TestJob; workflow: SavedComfyWorkflow | null; ready: boolean; connected: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <Lead>This sends a sample prompt to ComfyUI and shows the image it makes. It&apos;s the last check before you start sending.</Lead>
      <TestRun
        test={test}
        workflow={workflow}
        ready={ready}
        notReadyReason={!connected ? "Connect to ComfyUI to run a test." : "Go back and choose the Output node to run a test."}
        finish={null}
      />
      {test.passed && (
        <p role="status" className="flex items-center gap-2 text-sm font-medium text-success-text">
          <CheckCircle2 aria-hidden className="h-4 w-4" />
          It works. One more screen.
        </p>
      )}
    </div>
  )
}

function DoneStep({ workflowName, enabled }: { workflowName: string | null; enabled: boolean }) {
  const lowMotion = useLowMotion()
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <CheckCircle2 aria-hidden className={cn("mt-0.5 h-6 w-6 shrink-0 text-success-text", !lowMotion && "comfy-found-pop")} />
        <p className="text-pretty text-base leading-relaxed text-foreground">
          {enabled ? "Send buttons queue prompts in ComfyUI" : "Start sending to turn Copy buttons into Send buttons that queue prompts in ComfyUI"}
          {workflowName ? (
            <>
              {" "}with <span className="font-semibold">{workflowName}</span>.
            </>
          ) : (
            "."
          )}
        </p>
      </div>
      <div className="flex flex-col gap-1.5 rounded-xl bg-muted/40 px-4 py-3">
        <p className="text-sm font-medium text-foreground">To change things later</p>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          Open Customize prompt, then Output, then Send to ComfyUI. While sending is on, the ComfyUI chip at the top of Customize prompt opens the settings too.
        </p>
      </div>
    </div>
  )
}

// --- Guide ----------------------------------------------------------------------------

export interface ComfyUISetupWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Why a Send button opened it. The guide already opens on the step that fixes it. */
  reason?: ComfyPanelReason | null
  /** Gets focus back when the guide closes. */
  returnFocusTo?: HTMLElement | null
  /** Start on this step instead of the first one not done ("Run setup again"). */
  startAt?: SetupStepId
}

export function ComfyUISetupWizard({ open, onOpenChange, returnFocusTo, startAt }: ComfyUISetupWizardProps) {
  const settings = useComfyUISettings()
  const { enabled, url, workflows, activeWorkflow, options } = settings
  const [device] = useState<DeviceSupport>(() => currentDeviceSupport())
  const reachable = open && device === "ok"
  const { diagnosis, checking, check } = useDiagnosis(url, reachable)
  const progress = setupProgress(diagnosis, activeWorkflow)
  const objectInfo = useObjectInfo(url, reachable && progress.connected)
  const importer = useWorkflowImport(settings, objectInfo)
  const test = useTestJob(url, activeWorkflow, options, open)
  useRememberPassedTest(settings, test, activeWorkflow)

  // The step is picked once the first check is in (or right away when told
  // where to start), so a working setup doesn't flash the earlier steps.
  const initialStep = startAt ?? (device !== "ok" ? "start" : null)
  const [step, setStep] = useState<SetupStepId | null>(initialStep)
  const [showGraph, setShowGraph] = useState(false)
  // Reopening picks the step again: things may have changed in ComfyUI meanwhile.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setStep(initialStep)
  }
  if (step === null && open && diagnosis) {
    const resumed = resumeStep({ device, diagnosis, workflow: activeWorkflow, savedCount: workflows.length })
    setStep(resumed)
    if (resumed === "prompt") setShowGraph(graphNeeded(activeWorkflow))
  }

  const current = step ?? "start"
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Each new step: focus its heading (screen readers hear where they are) and record it.
  const firstFocus = useRef(true)
  useEffect(() => {
    if (!open || step === null) return
    track("comfyui_setup_step_viewed", { step })
    if (firstFocus.current) {
      firstFocus.current = false
      return
    }
    headingRef.current?.focus({ preventScroll: true })
    headingRef.current?.scrollIntoView({ block: "nearest" })
  }, [open, step])

  // The install step keeps checking while it is on screen and the tab is visible.
  const install = installState(diagnosis)
  usePollWhileVisible(reachable && current === "install" && install.poll, POLL_MS, () => void refreshComfyStatus(url))

  const index = NUMBERED_STEPS.indexOf(current)
  const go = (next: SetupStepId) => {
    // Opening the prompt step shows the graph when there is something to pick
    // there. Read fresh settings: a workflow picked a moment ago isn't in this render yet.
    if (next === "prompt") setShowGraph(graphNeeded(getComfyUISettings().activeWorkflow))
    setStep(next)
  }
  const back = () => {
    if (index > 0) go(NUMBERED_STEPS[index - 1])
    else if (current === "done") go("test")
  }
  const nextStep = (): SetupStepId => (current === "done" ? "done" : (NUMBERED_STEPS[index + 1] ?? "done"))

  const ready = progress.connected && progress.hasWorkflow && progress.hasOutput
  const allowed = canContinue(current, device, { ...progress, tested: progress.tested && !test.failed })

  const finish = () => {
    if (!enabled) settings.setEnabled(true)
    settings.setSetupDone(true)
    track("comfyui_setup_completed", { turned_on: !enabled })
    onOpenChange(false)
  }

  const nextLabel =
    current === "start"
      ? "Start"
      : current === "prompt" && allowed
        ? "Looks right"
        : current === "done"
          ? enabled
            ? "Done"
            : "Start sending"
          : "Next"

  const wide = current === "prompt" && showGraph && !!activeWorkflow

  // A passed test swaps the Cancel button for Run again, which drops focus:
  // hand it to Next, the one thing left to do on this step.
  const nextRef = useRef<HTMLButtonElement>(null)
  const passedNow = current === "test" && test.passed
  useEffect(() => {
    if (passedNow) nextRef.current?.focus({ preventScroll: true })
  }, [passedNow])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          headingRef.current?.focus()
        }}
        onCloseAutoFocus={(e) => {
          if (returnFocusTo?.isConnected) {
            e.preventDefault()
            returnFocusTo.focus()
          }
        }}
        className={cn(
          "flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 focus:outline-none sm:max-h-[min(52rem,calc(100dvh-3rem))]",
          wide ? "sm:max-w-[min(68rem,calc(100vw-3rem))]" : "sm:max-w-[36rem]",
        )}
      >
        <div className="flex flex-col gap-4 px-4 pb-4 pt-5 pr-12 sm:px-6 sm:pr-14 sm:pt-6">
          <Progress step={current} />
          <DialogTitle asChild>
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="text-balance text-xl font-semibold leading-tight tracking-[-0.01em] text-foreground focus:outline-none"
            >
              {STEP_TITLE[current]}
            </h2>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Setup for Send to ComfyUI.{" "}
            {current === "done" ? "Finished." : `Step ${index + 1} of ${NUMBERED_STEPS.length}.`}
          </DialogDescription>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6 sm:px-6">
          {step === null ? (
            <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="h-4 w-4 motion-safe:animate-spin" />
              Checking your setup…
            </p>
          ) : (
            <div key={current} className="comfy-step-in">
              {current === "start" && <StartStep device={device} />}
              {current === "install" && (
                <InstallStep diagnosis={diagnosis} url={url} setUrl={settings.setUrl} onFound={() => go("publish")} />
              )}
              {current === "publish" && (
                <PublishStep
                  url={url}
                  diagnosis={diagnosis}
                  checking={checking}
                  onCheck={() => void check()}
                  workflow={activeWorkflow}
                  importer={importer}
                  onPicked={() => go("prompt")}
                />
              )}
              {current === "prompt" &&
                (activeWorkflow ? (
                  <PromptStep
                    key={activeWorkflow.id}
                    workflow={activeWorkflow}
                    objectInfo={objectInfo}
                    settings={settings}
                    showGraph={showGraph}
                    onToggleGraph={() => setShowGraph((v) => !v)}
                  />
                ) : (
                  <Lead>Go back and choose a workflow first.</Lead>
                ))}
              {current === "test" && <TestStep test={test} workflow={activeWorkflow} ready={ready} connected={progress.connected} />}
              {current === "done" && <DoneStep workflowName={activeWorkflow?.name ?? null} enabled={enabled} />}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3 sm:px-6">
          {index > 0 || current === "done" ? (
            <Button type="button" variant="ghost" onClick={back} className="h-10 gap-1.5 px-3">
              <ArrowLeft aria-hidden className="h-4 w-4" />
              Back
            </Button>
          ) : (
            <span />
          )}
          {current === "start" && device !== "ok" ? (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-10 px-5">
              Close
            </Button>
          ) : (
            <Button
              ref={nextRef}
              type="button"
              onClick={current === "done" ? finish : () => go(nextStep())}
              disabled={step === null || !allowed}
              className="h-10 px-5"
            >
              {nextLabel}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ComfyUISetupWizard
