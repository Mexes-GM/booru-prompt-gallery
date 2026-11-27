"use client"

/**
 * The ComfyUI dialog: turn Send on, point it at the user's ComfyUI, see what
 * is wrong with the connection in one line, pick or import a workflow, check
 * its roles (and change them in the graph) and run a test. Loaded on demand.
 */
import dynamic from "next/dynamic"
import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react"
import { AlertCircle, CheckCircle2, FileUp, Loader2, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ToastAction } from "@/components/ui/toast"
import { toast } from "@/hooks/use-toast"
import { useComfyUISettings } from "@/hooks/use-comfyui-settings"
import { useComfyJob } from "@/hooks/use-comfyui-job"
import { useLowMotion } from "@/hooks/use-low-motion"
import {
  BRIDGE_INSTALL_STEP,
  BRIDGE_INSTALL_URL,
  BRIDGE_NAME,
  BRIDGE_PUBLISH_STEP,
  MIN_BRIDGE_VERSION,
} from "@/lib/comfyui/bridge"
import { createComfyClient, diagnose, normalizeComfyUrl } from "@/lib/comfyui/client"
import { checkNodesAgainstObjectInfo, importBridgeRecord, importWorkflowFile, type ImportError, type ImportedWorkflow } from "@/lib/comfyui/import"
import { nodeTitle, rolesFit, testSize } from "@/lib/comfyui/role-choices"
import { detectRoles, randomSeed } from "@/lib/comfyui/roles"
import { getComfySession } from "@/lib/comfyui/session"
import type { ComfyPanelReason } from "@/lib/comfyui/panel-request"
import type {
  BridgeWorkflowSummary,
  ComfyOptions,
  Diagnosis,
  InputRef,
  ObjectInfo,
  Roles,
  SavedComfyWorkflow,
} from "@/lib/comfyui/types"
import { cn } from "@/lib/utils"
import { ROLE_STYLE } from "./comfyui-role-style"

const loadViewer = () => import("./comfyui-workflow-viewer")
const ComfyUIWorkflowViewer = dynamic(loadViewer, {
  ssr: false,
  loading: () => (
    <div className="flex h-72 items-center justify-center rounded-xl sm:h-[min(28rem,60dvh)] border border-border bg-muted/20 text-xs text-muted-foreground">
      Loading the graph…
    </div>
  ),
})

const TEST_PROMPT = "a red apple on a wooden table, soft daylight"

function testDescription(workflow: SavedComfyWorkflow | null): string {
  if (!workflow) return ""
  const small = workflow.roles.width && workflow.roles.height ? " at a small size" : ""
  return workflow.roles.prompt
    ? `Sends “${TEST_PROMPT}” with this workflow${small}.`
    : `Runs this workflow as it is${small}, since it has no prompt input.`
}

// --- Copy ---------------------------------------------------------------------

/** One line per connection state, with what to do about it. */
function statusCopy(d: Diagnosis): { tone: "ok" | "problem"; text: string } {
  switch (d.state) {
    case "ok":
      return { tone: "ok", text: d.comfyVersion ? `Connected to ComfyUI ${d.comfyVersion}.` : "Connected to ComfyUI." }
    case "unsupported-browser":
      return { tone: "problem", text: "This browser can't reach ComfyUI on your computer. Use Chrome, Edge or Firefox on a desktop." }
    case "invalid-url":
      return { tone: "problem", text: "Use a local address, like http://127.0.0.1:8188." }
    case "local-network-denied":
      return {
        tone: "problem",
        text: "Your browser blocks this site from your local network. Click the icon left of the address bar, allow local network access, then reload the page.",
      }
    case "unreachable":
      return {
        tone: "problem",
        text: d.localNetworkPrompt
          ? "ComfyUI isn't answering. Check that it's running and the address is right. If the browser asks to connect to devices on your local network, choose Allow."
          : "ComfyUI isn't answering. Check that it's running and the address is right.",
      }
    case "bridge-missing":
      return { tone: "problem", text: `ComfyUI is running but blocks this site. ${BRIDGE_INSTALL_STEP}` }
    case "bridge-outdated":
      return { tone: "problem", text: `The ${BRIDGE_NAME} node is out of date (${d.version}). Update it in ComfyUI and restart ComfyUI.` }
    case "bridge-inactive":
      return {
        tone: "problem",
        text: `The ${BRIDGE_NAME} node can't let this site in with this ComfyUI version. Update the node and restart ComfyUI.`,
      }
  }
}

const IMPORT_ERRORS: Record<ImportError, string> = {
  "ui-format": "This is an editor workflow. Publish it from ComfyUI's Workflow menu with Use in Booru Prompt Gallery, or save it with Export (API).",
  "no-workflow": "No workflow found in this file. Use a .png saved by ComfyUI or a .json from Export (API).",
  "invalid-json": "This file couldn't be read as a workflow. Save it again from ComfyUI and retry.",
  "unsupported-file": "Only .png and .json files work here.",
}

// --- Helpers ------------------------------------------------------------------

/** Ends ComfyUI's messages with a period, so they read as sentences. */
function sentence(text: string): string {
  const trimmed = text.trim()
  return !trimmed || /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `w${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

const RELATIVE_TIME = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

function updatedLabel(updated: number | string): string | null {
  const ms = typeof updated === "number" ? (updated < 1e12 ? updated * 1000 : updated) : Date.parse(updated)
  if (!Number.isFinite(ms)) return null
  const seconds = Math.round((ms - Date.now()) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 60) return "Updated just now"
  if (abs < 3600) return `Updated ${RELATIVE_TIME.format(Math.round(seconds / 60), "minute")}`
  if (abs < 86400) return `Updated ${RELATIVE_TIME.format(Math.round(seconds / 3600), "hour")}`
  return `Updated ${RELATIVE_TIME.format(Math.round(seconds / 86400), "day")}`
}

function refText(workflow: SavedComfyWorkflow, ref: InputRef | null): string | null {
  return ref ? `${nodeTitle(workflow.api, ref.nodeId)} · ${ref.input}` : null
}

/** Saves an import as a workflow. A re-import keeps the user's roles while they still fit. */
function toSaved(imported: ImportedWorkflow, objectInfo: ObjectInfo | null, previous?: SavedComfyWorkflow, bridgeId?: string): SavedComfyWorkflow {
  const detected = detectRoles(imported.api, objectInfo ?? undefined).roles
  const roles = previous && rolesFit(imported.api, previous.roles) ? previous.roles : detected
  return {
    id: previous?.id ?? newId(),
    name: imported.name,
    source: imported.source,
    ...(bridgeId ? { bridgeId } : {}),
    api: imported.api,
    ui: imported.ui,
    roles,
    savedAt: Date.now(),
  }
}

// --- Connection ---------------------------------------------------------------

/**
 * The connection state for `url`. A result for an older address counts as
 * "still checking", so changing the address never shows a stale line.
 */
function useDiagnosis(url: string, active: boolean) {
  const [result, setResult] = useState<{ url: string; diagnosis: Diagnosis } | null>(null)
  const [checking, setChecking] = useState(false)
  const run = useRef(0)

  const probe = useCallback(async () => {
    const ticket = ++run.current
    const diagnosis = await diagnose(url, { minBridgeVersion: MIN_BRIDGE_VERSION, timeoutMs: 4000 })
    if (ticket === run.current) setResult({ url, diagnosis })
  }, [url])

  /** "Check again": also spins the button while it runs. */
  const check = useCallback(async () => {
    setChecking(true)
    try {
      await probe()
    } finally {
      setChecking(false)
    }
  }, [probe])

  useEffect(() => {
    if (!active) return
    void probe()
    // Coming back from ComfyUI (after installing the node, say) checks again.
    const onFocus = () => void probe()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [active, probe])

  return { diagnosis: result?.url === url ? result.diagnosis : null, checking, check }
}

function Section({ title, action, children, labelledBy }: { title: string; action?: ReactNode; children: ReactNode; labelledBy: string }) {
  return (
    <section aria-labelledby={labelledBy} className="flex flex-col gap-3 border-t border-border/60 pt-5">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h3 id={labelledBy} className="text-sm font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function AddressField({ url, setUrl }: { url: string; setUrl: (url: string) => boolean }) {
  const id = useId()
  const [draft, setDraft] = useState(url)
  const [error, setError] = useState(false)

  const commit = () => {
    const normalized = normalizeComfyUrl(draft)
    if (!normalized) {
      setError(true)
      return
    }
    setError(false)
    setDraft(normalized)
    if (normalized !== url) setUrl(normalized)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">ComfyUI address</label>
      <Input
        id={id}
        value={draft}
        inputMode="url"
        spellCheck={false}
        autoComplete="off"
        placeholder="http://127.0.0.1:8188"
        aria-invalid={error || undefined}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        onChange={(e) => {
          setDraft(e.target.value)
          if (error) setError(false)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          }
        }}
        className={cn("h-9 font-mono text-[13px]", error && "border-destructive focus-visible:ring-destructive")}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive-text">
          Use a local address, like http://127.0.0.1:8188.
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          Only this computer: localhost or 127.0.0.1, with ComfyUI&apos;s port.
        </p>
      )}
    </div>
  )
}

function StatusLine({ diagnosis, checking, onCheck }: { diagnosis: Diagnosis | null; checking: boolean; onCheck: () => void }) {
  const copy = diagnosis ? statusCopy(diagnosis) : null
  const showLink = diagnosis?.state === "bridge-missing" && BRIDGE_INSTALL_URL
  return (
    <div className="flex items-start gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
      <div role="status" aria-live="polite" className="flex min-w-0 flex-1 items-start gap-2 text-sm">
        {!copy ? (
          <>
            <Loader2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground motion-safe:animate-spin" />
            <span className="text-muted-foreground">Checking the connection…</span>
          </>
        ) : (
          <>
            {copy.tone === "ok" ? (
              <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success-text" />
            ) : (
              <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" />
            )}
            <span className="text-pretty text-foreground">
              {copy.text}
              {showLink && (
                <>
                  {" "}
                  <a href={BRIDGE_INSTALL_URL ?? undefined} target="_blank" rel="noreferrer" className="font-medium text-primary-text underline underline-offset-2">
                    How to install it
                  </a>
                </>
              )}
            </span>
          </>
        )}
      </div>
      {diagnosis?.state !== "unsupported-browser" && (
        <Button type="button" variant="ghost" size="sm" onClick={onCheck} disabled={checking} className="-my-1 h-8 shrink-0 gap-1.5 px-2 text-xs">
          <RefreshCw aria-hidden className={cn("h-3.5 w-3.5", checking && copy && "motion-safe:animate-spin")} />
          Check again
        </Button>
      )}
    </div>
  )
}

// --- Workflows ------------------------------------------------------------------

function BridgeList({
  items,
  loading,
  failed,
  saved,
  busyId,
  onUse,
  onRefresh,
}: {
  items: BridgeWorkflowSummary[] | null
  loading: boolean
  failed: boolean
  saved: SavedComfyWorkflow[]
  busyId: string | null
  onUse: (item: BridgeWorkflowSummary) => void
  onRefresh: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">Published from ComfyUI</span>
        <Button type="button" variant="ghost" size="sm" onClick={onRefresh} disabled={loading} className="-my-1 h-7 gap-1.5 px-2 text-xs">
          <RefreshCw aria-hidden className={cn("h-3.5 w-3.5", loading && "motion-safe:animate-spin")} />
          Refresh
        </Button>
      </div>
      {failed ? (
        <p className="text-xs text-muted-foreground">Couldn&apos;t load the list from ComfyUI. Refresh to try again.</p>
      ) : items === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">Nothing published yet. {BRIDGE_PUBLISH_STEP}</p>
      ) : (
        <ul className="flex flex-col" aria-label="Workflows published from ComfyUI">
          {items.map((item) => {
            const existing = saved.find((w) => w.bridgeId === item.id)
            const when = updatedLabel(item.updated)
            return (
              <li key={item.id} className="flex min-h-11 items-center justify-between gap-3 border-b border-border/50 py-1.5 last:border-b-0">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-foreground">{item.name}</span>
                  {when && <span className="text-xs text-muted-foreground">{when}</span>}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onUse(item)}
                  disabled={busyId !== null}
                  aria-label={existing ? `Update ${item.name} from ComfyUI` : `Use ${item.name}`}
                  className="h-8 shrink-0 px-3 text-xs"
                >
                  {busyId === item.id ? <Loader2 aria-hidden className="h-3.5 w-3.5 motion-safe:animate-spin" /> : existing ? "Update" : "Use"}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function DropZone({ onFile, error }: { onFile: (file: File) => void; error: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const errorId = useId()
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) onFile(file)
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-4 text-center transition-colors sm:flex-row sm:justify-between sm:text-left",
          over ? "border-primary bg-primary/5" : "border-border",
        )}
      >
        <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
          <FileUp aria-hidden className="hidden h-4 w-4 shrink-0 sm:block" />
          <span>Drop a .png made by ComfyUI or an Export (API) .json</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          aria-describedby={error ? errorId : undefined}
          className="h-8 shrink-0 px-3 text-xs"
        >
          Choose a file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".png,.json,image/png,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
            e.target.value = ""
          }}
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs leading-relaxed text-destructive-text">
          {error}
        </p>
      )}
    </div>
  )
}

function SavedList({
  workflows,
  activeId,
  onSelect,
  onRemove,
}: {
  workflows: SavedComfyWorkflow[]
  activeId: string | null
  onSelect: (id: string) => void
  onRemove: (workflow: SavedComfyWorkflow) => void
}) {
  const name = useId()
  if (workflows.length === 0) {
    return <p className="text-xs text-muted-foreground">No workflow saved yet. Use one from ComfyUI or add a file.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <span id={`${name}-label`} className="text-xs font-medium text-muted-foreground">Saved here</span>
      <ul role="radiogroup" aria-labelledby={`${name}-label`} className="flex flex-col">
        {[...workflows].reverse().map((w) => (
          <li key={w.id} className="flex min-h-11 items-center gap-3 border-b border-border/50 py-1 last:border-b-0">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-1.5">
              <input
                type="radio"
                name={name}
                checked={w.id === activeId}
                onChange={() => onSelect(w.id)}
                className="h-4 w-4 shrink-0 accent-primary"
              />
              <span className="min-w-0 truncate text-sm text-foreground">{w.name}</span>
              {w.id === activeId && <span className="shrink-0 text-xs text-muted-foreground">In use</span>}
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(w)}
              aria-label={`Remove ${w.name}`}
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive-text"
            >
              <Trash2 aria-hidden className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RoleSummary({ workflow, missingNodes }: { workflow: SavedComfyWorkflow; missingNodes: string[] }) {
  const { roles } = workflow
  const rows: { role: keyof typeof ROLE_STYLE; value: string }[] = [
    { role: "prompt", value: refText(workflow, roles.prompt) ?? "None. The workflow runs without the card's prompt" },
    { role: "seed", value: refText(workflow, roles.seed) ?? "Kept from the workflow" },
    {
      role: "size",
      value: roles.width && roles.height ? `${nodeTitle(workflow.api, roles.width.nodeId)} · width and height` : "Set by the workflow",
    },
    { role: "output", value: roles.output ? nodeTitle(workflow.api, roles.output) : "None found. Pick the node whose image to show" },
  ]
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.role} className="contents">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span aria-hidden className={cn("h-2.5 w-2.5 rounded-[3px]", ROLE_STYLE[r.role].swatch)} />
              {ROLE_STYLE[r.role].label}
            </dt>
            <dd className="min-w-0 truncate text-foreground" title={r.value}>{r.value}</dd>
          </div>
        ))}
      </dl>
      {missingNodes.length > 0 && (
        <p role="note" className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs leading-relaxed text-foreground">
          <AlertCircle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 text-warning-text" />
          <span>
            This ComfyUI doesn&apos;t have {missingNodes.length === 1 ? "this node" : "these nodes"}: {missingNodes.join(", ")}. Install{" "}
            {missingNodes.length === 1 ? "it" : "them"} in ComfyUI, or it will reject the workflow.
          </span>
        </p>
      )}
    </div>
  )
}

// --- Options and test ---------------------------------------------------------

const OPTION_ROWS: { key: keyof ComfyOptions; label: string; hint: string }[] = [
  { key: "randomSeed", label: "New seed each time", hint: "Use a random seed instead of the workflow's" },
  { key: "matchPostResolution", label: "Match the post's aspect ratio", hint: "Width and height follow the post, at a size models handle well" },
  { key: "livePreview", label: "Live preview", hint: "Show the image on the card while it generates" },
]

function TestRun({
  url,
  workflow,
  options,
  ready,
  notReadyReason,
}: {
  url: string
  workflow: SavedComfyWorkflow | null
  options: ComfyOptions
  ready: boolean
  notReadyReason: string
}) {
  const lowMotion = useLowMotion()
  const [jobId, setJobId] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const job = useComfyJob(jobId)
  const jobRef = useRef<string | null>(null)
  useEffect(() => {
    jobRef.current = jobId
  }, [jobId])

  // Free the job (and its preview images) when the panel closes or the address changes.
  useEffect(() => {
    return () => {
      if (jobRef.current) getComfySession(url).forget(jobRef.current)
    }
  }, [url])

  const start = async () => {
    if (!workflow) return
    if (jobId) getComfySession(url).forget(jobId)
    setJobId(null)
    setSendError(null)
    setStarting(true)
    try {
      const size = testSize(workflow.api, workflow.roles)
      const id = await getComfySession(url).send({
        api: workflow.api,
        roles: workflow.roles,
        prompt: TEST_PROMPT,
        seed: options.randomSeed && workflow.roles.seed ? randomSeed() : undefined,
        width: size?.width,
        height: size?.height,
        preview: options.livePreview,
      })
      setJobId(id)
    } catch {
      setSendError("Couldn't send the test to ComfyUI. Check the connection above and try again.")
    } finally {
      setStarting(false)
    }
  }

  const stop = () => {
    if (jobId) void getComfySession(url).cancel(jobId).catch(() => {})
  }

  const running = starting || job?.status === "queued" || job?.status === "running"
  const progress = job?.status === "running" && job.totalSteps ? Math.min(1, (job.step ?? 0) / job.totalSteps) : null
  const image = job?.status === "done" ? job.imageUrl : job?.previewUrl
  const failedNode = job?.error?.node && workflow ? nodeTitle(workflow.api, job.error.node) : null

  let line: ReactNode = null
  if (starting) line = "Sending the test…"
  else if (sendError) line = sendError
  else if (job?.status === "queued")
    line = job.queuePosition ? `Waiting in ComfyUI's queue, ${job.queuePosition} ahead.` : "Waiting in ComfyUI's queue."
  else if (job?.status === "running")
    line = job.totalSteps ? `Generating, step ${job.step ?? 0} of ${job.totalSteps}.` : "Generating…"
  else if (job?.status === "done") line = "Test finished. This is the image ComfyUI made."
  else if (job?.status === "cancelled") line = "Test stopped."
  else if (job?.status === "error")
    line = (
      <>
        ComfyUI couldn&apos;t run the test. {failedNode ? `${failedNode}: ` : ""}
        {sentence(job.error?.message ?? "")}
      </>
    )

  const isError = !!sendError || job?.status === "error"

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {ready ? testDescription(workflow) : notReadyReason}
        </p>
        {running ? (
          <Button type="button" variant="outline" onClick={stop} disabled={starting || !jobId} className="h-9 shrink-0 px-4 text-sm">
            Stop test
          </Button>
        ) : (
          <Button type="button" onClick={start} disabled={!ready} className="h-9 shrink-0 px-4 text-sm">
            Run a test
          </Button>
        )}
      </div>
      {line && (
        <div className="flex flex-col gap-2">
          <p
            role={isError ? "alert" : "status"}
            aria-live={isError ? undefined : "polite"}
            className={cn("break-words text-sm", isError ? "text-destructive-text" : "text-foreground")}
          >
            {line}
          </p>
          {progress !== null && (
            <div
              role="progressbar"
              aria-label="Test progress"
              aria-valuemin={0}
              aria-valuemax={job?.totalSteps}
              aria-valuenow={job?.step ?? 0}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn("h-full rounded-full bg-primary", !lowMotion && "transition-[width] duration-200 ease-out")}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}
        </div>
      )}
      {(running || image) && (
        <div className="flex h-56 items-center justify-center overflow-hidden rounded-lg bg-muted/40 sm:h-64">
          {image ? (
            // crossOrigin: ComfyUI only serves the image to an allowed Origin, and a plain <img> sends none.
            // eslint-disable-next-line @next/next/no-img-element -- a local ComfyUI image (blob or loopback URL), not optimizable
            <img crossOrigin="anonymous" src={image} alt={job?.status === "done" ? "Test result from ComfyUI" : "Live preview from ComfyUI"} className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">The image shows here once ComfyUI starts.</span>
          )}
        </div>
      )}
    </div>
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
}

const REASON_HINT: Record<ComfyPanelReason, string> = {
  workflow: "Choose a workflow to send prompts with.",
  "prompt-role": "Pick the Prompt input in Roles so Send can write the card's prompt.",
}

export function ComfyUIPanel({ open, onOpenChange, reason = null, requestId, returnFocusTo }: ComfyUIPanelProps) {
  const settings = useComfyUISettings()
  const { enabled, url, workflows, activeWorkflow, options } = settings
  const { diagnosis, checking, check } = useDiagnosis(url, open)
  const connected = diagnosis?.state === "ok"

  const [bridgeItems, setBridgeItems] = useState<BridgeWorkflowSummary[] | null>(null)
  const [bridgeLoading, setBridgeLoading] = useState(false)
  const [bridgeFailed, setBridgeFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [objectInfo, setObjectInfo] = useState<ObjectInfo | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showGraph, setShowGraph] = useState(reason === "prompt-role")

  // Opened by Send for a missing prompt input: show the graph, where it is picked.
  const [graphRequest, setGraphRequest] = useState(requestId)
  if (requestId !== graphRequest) {
    setGraphRequest(requestId)
    if (reason === "prompt-role") setShowGraph(true)
  }

  const fetchBridge = useCallback(async () => {
    try {
      const items = await createComfyClient(url).listBridgeWorkflows()
      setBridgeItems(items)
      setBridgeFailed(false)
    } catch {
      setBridgeFailed(true)
    }
  }, [url])

  /** The Refresh button: also spins while it runs. */
  const loadBridge = useCallback(async () => {
    setBridgeLoading(true)
    try {
      await fetchBridge()
    } finally {
      setBridgeLoading(false)
    }
  }, [fetchBridge])

  useEffect(() => {
    if (!open || !connected) return
    let cancelled = false
    createComfyClient(url)
      .listBridgeWorkflows()
      .then((items) => {
        if (cancelled) return
        setBridgeItems(items)
        setBridgeFailed(false)
      })
      .catch(() => {
        if (!cancelled) setBridgeFailed(true)
      })
    createComfyClient(url, { timeoutMs: 15000 })
      .objectInfo()
      .then((info) => {
        if (!cancelled) setObjectInfo(info)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, connected, url])

  const adopt = (saved: SavedComfyWorkflow, verb: string) => {
    if (!settings.saveWorkflow(saved)) {
      setImportError("Couldn't save the workflow. The browser's storage for this site is full.")
      return
    }
    settings.setActiveWorkflow(saved.id)
    setImportError(null)
    setNotice(`${verb} ${saved.name}.`)
  }

  const importFromBridge = async (item: BridgeWorkflowSummary) => {
    setBusyId(item.id)
    try {
      const record = await createComfyClient(url).getBridgeWorkflow(item.id)
      const result = importBridgeRecord(record)
      if (!result.ok) {
        setImportError(IMPORT_ERRORS[result.error])
        return
      }
      const previous = workflows.find((w) => w.bridgeId === item.id)
      adopt(toSaved(result.workflow, objectInfo, previous, item.id), previous ? "Updated" : "Now using")
    } catch {
      setImportError("Couldn't load this workflow from ComfyUI. Check the connection and try again.")
    } finally {
      setBusyId(null)
    }
  }

  const importFile = async (file: File) => {
    setNotice(null)
    const result = await importWorkflowFile({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
    if (!result.ok) {
      setImportError(IMPORT_ERRORS[result.error])
      return
    }
    adopt(toSaved(result.workflow, objectInfo), "Now using")
  }

  const remove = (w: SavedComfyWorkflow) => {
    const wasActive = activeWorkflow?.id === w.id
    if (!settings.removeWorkflow(w.id)) return
    toast({
      title: `Removed ${w.name}`,
      action: (
        <ToastAction
          altText={`Undo removing ${w.name}`}
          onClick={() => {
            settings.saveWorkflow(w)
            if (wasActive) settings.setActiveWorkflow(w.id)
          }}
        >
          Undo
        </ToastAction>
      ),
    })
  }

  const onRolesChange = useCallback(
    (roles: Roles) => {
      if (activeWorkflow) settings.updateRoles(activeWorkflow.id, roles)
    },
    [activeWorkflow, settings],
  )

  const missingNodes = activeWorkflow && objectInfo ? checkNodesAgainstObjectInfo(activeWorkflow.api, objectInfo) : []
  const ready = connected && !!activeWorkflow && !!activeWorkflow.roles.output
  const notReadyReason = !connected
    ? "Connect to ComfyUI to run a test."
    : !activeWorkflow
      ? "Choose a workflow to run a test."
      : "Pick the node whose image to show to run a test."

  const reasonHint =
    reason === "workflow" && !activeWorkflow
      ? REASON_HINT.workflow
      : reason === "prompt-role" && activeWorkflow && !activeWorkflow.roles.prompt
        ? REASON_HINT["prompt-role"]
        : null

  const ids = { connection: useId(), workflows: useId(), roles: useId(), options: useId(), test: useId() }
  const switchId = useId()

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
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 overflow-y-auto overscroll-contain px-4 pb-6 sm:px-6">
          {reasonHint && (
            <p role="status" className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-foreground">
              <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" />
              <span className="text-pretty">{reasonHint}</span>
            </p>
          )}
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 px-3 py-3">
            <label htmlFor={switchId} className="flex min-w-0 cursor-pointer flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">Send to ComfyUI</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {enabled
                  ? "On. Copy buttons are Send buttons and queue the prompt in ComfyUI."
                  : "Turns Copy buttons into Send buttons that queue the prompt in ComfyUI."}
              </span>
            </label>
            <Switch id={switchId} checked={enabled} onCheckedChange={(v) => settings.setEnabled(v)} className="shrink-0" />
          </div>

          <Section title="Connection" labelledBy={ids.connection}>
            {/* Keyed by the saved address, so a change from another tab resets the draft. */}
            <AddressField key={url} url={url} setUrl={settings.setUrl} />
            <StatusLine diagnosis={diagnosis} checking={checking} onCheck={() => void check()} />
          </Section>

          <Section title="Workflow" labelledBy={ids.workflows}>
            {connected && (
              <BridgeList
                items={bridgeItems}
                loading={bridgeLoading}
                failed={bridgeFailed}
                saved={workflows}
                busyId={busyId}
                onUse={(item) => void importFromBridge(item)}
                onRefresh={() => void loadBridge()}
              />
            )}
            <DropZone onFile={(f) => void importFile(f)} error={importError} />
            {notice && !importError && (
              <p role="status" className="text-xs text-success-text">{notice}</p>
            )}
            <SavedList
              workflows={workflows}
              activeId={activeWorkflow?.id ?? null}
              onSelect={(id) => {
                settings.setActiveWorkflow(id)
                setNotice(null)
              }}
              onRemove={remove}
            />
          </Section>

          {activeWorkflow && (
            <Section
              title="Roles"
              labelledBy={ids.roles}
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowGraph((v) => !v)}
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
                Where the site writes into {activeWorkflow.name}. Everything else stays as you set it in ComfyUI.
              </p>
              {showGraph ? (
                <>
                  <ComfyUIWorkflowViewer key={activeWorkflow.id} workflow={activeWorkflow} objectInfo={objectInfo} onRolesChange={onRolesChange} />
                  {missingNodes.length > 0 && <RoleSummary workflow={activeWorkflow} missingNodes={missingNodes} />}
                </>
              ) : (
                <RoleSummary workflow={activeWorkflow} missingNodes={missingNodes} />
              )}
            </Section>
          )}

          <Section title="Options" labelledBy={ids.options}>
            <div className="flex flex-col">
              {OPTION_ROWS.map((row) => (
                <div key={row.key} className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border/50 py-2 last:border-b-0">
                  <label htmlFor={`comfy-${row.key}`} className="flex min-w-0 cursor-pointer flex-col gap-0.5">
                    <span className="text-sm text-foreground">{row.label}</span>
                    <span className="text-xs text-muted-foreground">{row.hint}</span>
                  </label>
                  <Switch
                    id={`comfy-${row.key}`}
                    checked={options[row.key]}
                    onCheckedChange={(v) => settings.setOptions({ [row.key]: v })}
                    className="shrink-0"
                  />
                </div>
              ))}
            </div>
          </Section>

          <Section title="Test" labelledBy={ids.test}>
            <TestRun url={url} workflow={activeWorkflow} options={options} ready={ready} notReadyReason={notReadyReason} />
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ComfyUIPanel
