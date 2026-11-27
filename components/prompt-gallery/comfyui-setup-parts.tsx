"use client"

/**
 * The pieces the ComfyUI settings panel and the setup guide share: the
 * connection check, the address field, the workflow list and file drop, the
 * role summary, the options and the test run. Both load on demand.
 */
import dynamic from "next/dynamic"
import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react"
import { AlertCircle, CheckCircle2, FileUp, Loader2, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ToastAction } from "@/components/ui/toast"
import { toast } from "@/hooks/use-toast"
import type { useComfyUISettings } from "@/hooks/use-comfyui-settings"
import { useComfyJob } from "@/hooks/use-comfyui-job"
import { useLowMotion } from "@/hooks/use-low-motion"
import { BRIDGE_INSTALL_URL, BRIDGE_PUBLISH_STEP } from "@/lib/comfyui/bridge"
import { createComfyClient, normalizeComfyUrl } from "@/lib/comfyui/client"
import { importBridgeRecord, importWorkflowFile, type ImportError, type ImportedWorkflow } from "@/lib/comfyui/import"
import { nodeTitle, rolesFit, testSize } from "@/lib/comfyui/role-choices"
import { detectRoles, randomSeed } from "@/lib/comfyui/roles"
import { errorLine, queueLabel, stepLabel, stepProgress } from "@/lib/comfyui/job-copy"
import { getComfySession, type ComfyJob } from "@/lib/comfyui/session"
import { checkComfyStatus, refreshComfyStatus, statusCopy, useComfyStatus } from "@/lib/comfyui/status"
import type {
  BridgeWorkflowSummary,
  ComfyOptions,
  Diagnosis,
  InputRef,
  ObjectInfo,
  SavedComfyWorkflow,
} from "@/lib/comfyui/types"
import { cn } from "@/lib/utils"
import { ROLE_STYLE } from "./comfyui-role-style"

export const loadViewer = () => import("./comfyui-workflow-viewer")
export const ComfyUIWorkflowViewer = dynamic(loadViewer, {
  ssr: false,
  loading: () => (
    <div className="flex h-72 items-center justify-center rounded-xl sm:h-[min(28rem,60dvh)] border border-border bg-muted/20 text-xs text-muted-foreground">
      Loading the graph…
    </div>
  ),
})

export const TEST_PROMPT = "a red apple on a wooden table, soft daylight"

export function testDescription(workflow: SavedComfyWorkflow | null): string {
  if (!workflow) return ""
  const small = workflow.roles.width && workflow.roles.height ? " at a small size" : ""
  return workflow.roles.prompt
    ? `Sends “${TEST_PROMPT}” with this workflow${small}.`
    : `Runs this workflow as it is${small}, since it has no prompt input.`
}

// --- Copy ---------------------------------------------------------------------

export const IMPORT_ERRORS: Record<ImportError, string> = {
  "ui-format": `This file has an editor workflow, which can't be sent as is. ${BRIDGE_PUBLISH_STEP} Or save it with Export (API) and add the .json here.`,
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
export function toSaved(imported: ImportedWorkflow, objectInfo: ObjectInfo | null, previous?: SavedComfyWorkflow, bridgeId?: string): SavedComfyWorkflow {
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
 * The connection state for `url`, from the status the settings row and the
 * gallery chip share. Opening the panel checks again unless a result is only
 * seconds old; so does coming back to the tab (after installing the add-on,
 * say). A result for an older address counts as "still checking".
 */
const PANEL_STATUS_MAX_AGE_MS = 5000

export function useDiagnosis(url: string, active: boolean) {
  const { diagnosis } = useComfyStatus(url, false)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!active) return
    void checkComfyStatus(url, PANEL_STATUS_MAX_AGE_MS)
    const onFocus = () => void checkComfyStatus(url, PANEL_STATUS_MAX_AGE_MS)
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [active, url])

  /** "Check again": also spins the button while it runs. */
  const check = useCallback(async () => {
    setChecking(true)
    try {
      await refreshComfyStatus(url)
    } finally {
      setChecking(false)
    }
  }, [url])

  return { diagnosis, checking, check }
}

export function Section({ title, action, children, labelledBy }: { title: string; action?: ReactNode; children: ReactNode; labelledBy: string }) {
  return (
    <section aria-labelledby={labelledBy} className="flex flex-col gap-3 border-t border-border/60 pt-5">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h3 id={labelledBy} tabIndex={-1} className="scroll-mt-4 text-sm font-semibold text-foreground focus:outline-none">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function AddressField({ url, setUrl }: { url: string; setUrl: (url: string) => boolean }) {
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

export function StatusLine({ diagnosis, checking, onCheck }: { diagnosis: Diagnosis | null; checking: boolean; onCheck: () => void }) {
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

export function BridgeList({
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

export function DropZone({ onFile, error }: { onFile: (file: File) => void; error: string | null }) {
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

export function SavedList({
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
      <span id={`${name}-label`} className="text-xs font-medium text-muted-foreground">Saved in this browser</span>
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

export function RoleSummary({ workflow, missingNodes }: { workflow: SavedComfyWorkflow; missingNodes: string[] }) {
  const { roles } = workflow
  const rows: { role: keyof typeof ROLE_STYLE; value: string }[] = [
    { role: "prompt", value: refText(workflow, roles.prompt) ?? "None. The workflow runs without the card's prompt" },
    { role: "seed", value: refText(workflow, roles.seed) ?? "Kept from the workflow" },
    {
      role: "size",
      value: roles.width && roles.height ? `${nodeTitle(workflow.api, roles.width.nodeId)} · width and height` : "Set by the workflow",
    },
    { role: "output", value: roles.output ? nodeTitle(workflow.api, roles.output) : "None found. Choose it in the graph" },
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

export function OptionList({ options, onChange }: { options: ComfyOptions; onChange: (patch: Partial<ComfyOptions>) => void }) {
  return (
    <div className="flex flex-col">
      {OPTION_ROWS.map((row) => (
        <div key={row.key} className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border/50 py-2 last:border-b-0">
          <label htmlFor={`comfy-${row.key}`} className="flex min-w-0 cursor-pointer flex-col gap-0.5">
            <span className="text-sm text-foreground">{row.label}</span>
            <span className="text-xs text-muted-foreground">{row.hint}</span>
          </label>
          <Switch id={`comfy-${row.key}`} checked={options[row.key]} onCheckedChange={(v) => onChange({ [row.key]: v })} className="shrink-0" />
        </div>
      ))}
    </div>
  )
}

/** The test job: send, cancel, and free it when the panel closes or the address changes. Lives in the panel, so the setup steps can read it. */
export function useTestJob(url: string, workflow: SavedComfyWorkflow | null, options: ComfyOptions, open: boolean) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [sendError, setSendError] = useState(false)
  const [starting, setStarting] = useState(false)
  /** The workflow and roles the current test was sent with. */
  const [ranWith, setRanWith] = useState<{ id: string; roles: string } | null>(null)
  const job = useComfyJob(jobId)
  const jobRef = useRef<string | null>(null)
  useEffect(() => {
    jobRef.current = jobId
  }, [jobId])

  // Closing the panel or changing the address drops the test, as before it ran.
  useEffect(() => {
    if (!open) return
    return () => {
      if (jobRef.current) getComfySession(url).forget(jobRef.current)
      jobRef.current = null
      setJobId(null)
      setSendError(false)
      setRanWith(null)
    }
  }, [url, open])

  const start = async () => {
    if (!workflow) return
    if (jobId) getComfySession(url).forget(jobId)
    setJobId(null)
    setSendError(false)
    setStarting(true)
    setRanWith({ id: workflow.id, roles: JSON.stringify(workflow.roles) })
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
      setSendError(true)
    } finally {
      setStarting(false)
    }
  }

  const cancel = () => {
    if (jobId) void getComfySession(url).cancel(jobId).catch(() => {})
  }

  /** The test's job belongs to the workflow as it is now (same roles). */
  const current =
    !!workflow && ranWith?.id === workflow.id && ranWith.roles === JSON.stringify(workflow.roles)
  const running = starting || job?.status === "queued" || job?.status === "running"
  const failed = current && (sendError || job?.status === "error")
  const passed = current && job?.status === "done"

  return { job, jobId, starting, sendError, start, cancel, running, failed, passed }
}

export type TestJob = ReturnType<typeof useTestJob>

/** A test that passed for the workflow as it is now is remembered with it, and setup counts as finished. */
export function useRememberPassedTest(settings: Pick<Settings, "markTested" | "setSetupDone">, test: TestJob, workflow: SavedComfyWorkflow | null) {
  const { markTested, setSetupDone } = settings
  const passedId = test.passed ? workflow?.id : undefined
  useEffect(() => {
    if (!passedId) return
    markTested(passedId)
    setSetupDone(true)
  }, [passedId, markTested, setSetupDone])
}

/** The test's status line, and whether it reports a failure. */
function testLine(
  job: ComfyJob | null,
  starting: boolean,
  sendError: boolean,
  workflow: SavedComfyWorkflow | null,
): { text: ReactNode; isError: boolean } | null {
  if (starting) return { text: "Sending the test…", isError: false }
  if (sendError) return { text: "Couldn't send the test to ComfyUI. Check that it's running and try again.", isError: true }
  if (!job) return null
  switch (job.status) {
    case "queued":
      return { text: queueLabel(job), isError: false }
    case "running":
      return { text: stepLabel(job), isError: false }
    case "done":
      return { text: "Test passed. This is the image ComfyUI made.", isError: false }
    case "cancelled":
      return { text: "Test canceled.", isError: false }
    case "error":
      return { text: `ComfyUI couldn't run the test. ${sentence(errorLine(job, workflow?.api ?? null))}`, isError: true }
  }
}

function TestStatus({ line, job, lowMotion }: { line: { text: ReactNode; isError: boolean }; job: ComfyJob | null; lowMotion: boolean }) {
  const progress = job ? stepProgress(job) : null
  return (
    <div className="flex flex-col gap-2">
      <p
        role={line.isError ? "alert" : "status"}
        aria-live={line.isError ? undefined : "polite"}
        className={cn("break-words text-sm tabular-nums", line.isError ? "text-destructive-text" : "text-foreground")}
      >
        {line.text}
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
  )
}

/** The live preview while it runs, then the result. */
function TestImage({ image, done }: { image: string | undefined; done: boolean }) {
  return (
    <div className="flex h-56 items-center justify-center overflow-hidden rounded-lg bg-muted/40 sm:h-64">
      {image ? (
        // crossOrigin: ComfyUI only serves the image to an allowed Origin, and a plain <img> sends none.
        // eslint-disable-next-line @next/next/no-img-element -- a local ComfyUI image (blob or loopback URL), not optimizable
        <img crossOrigin="anonymous" src={image} alt={done ? "Test result from ComfyUI" : "Live preview from ComfyUI"} className="h-full w-full object-contain" />
      ) : (
        <span className="text-xs text-muted-foreground">The image shows here once ComfyUI starts.</span>
      )}
    </div>
  )
}

export function TestRun({
  test,
  workflow,
  ready,
  notReadyReason,
  finish,
}: {
  test: TestJob
  workflow: SavedComfyWorkflow | null
  ready: boolean
  notReadyReason: string
  /** Set once everything is ready: what Send does now, and the button that ends setup. */
  finish: { label: string; message: string; onClick: () => void } | null
}) {
  const lowMotion = useLowMotion()
  const { job, jobId, starting, sendError, start, cancel, running } = test
  const done = job?.status === "done"
  const image = done ? job?.imageUrl : job?.previewUrl
  const line = testLine(job, starting, sendError, workflow)
  const showFinish = !!finish && test.passed

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-muted-foreground">{ready ? testDescription(workflow) : notReadyReason}</p>
        {running ? (
          <Button type="button" variant="outline" onClick={cancel} disabled={starting || !jobId} className="h-9 shrink-0 px-4 text-sm">
            Cancel test
          </Button>
        ) : (
          <Button type="button" variant={showFinish ? "outline" : "default"} onClick={() => void start()} disabled={!ready} className="h-9 shrink-0 px-4 text-sm">
            {job || sendError ? "Run again" : "Run a test"}
          </Button>
        )}
      </div>
      {line && <TestStatus line={line} job={job} lowMotion={lowMotion} />}
      {(running || image) && <TestImage image={image} done={done} />}
      {showFinish && finish && (
        <div className="flex flex-col gap-3 rounded-lg border border-success-border bg-success-soft px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm text-foreground">
            <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success-text" />
            <span className="text-pretty">
              <span className="font-medium">You&apos;re all set.</span> {finish.message}
            </span>
          </p>
          <Button type="button" onClick={finish.onClick} className="h-9 shrink-0 px-4 text-sm">
            {finish.label}
          </Button>
        </div>
      )}
    </div>
  )
}

// --- Data from ComfyUI ---------------------------------------------------------

/**
 * Calls `tick` every `ms` while `active` and the tab is visible, and once
 * right away when the tab comes back. Hidden tabs don't poll at all.
 */
export function usePollWhileVisible(active: boolean, ms: number, tick: () => void) {
  const latest = useRef(tick)
  useEffect(() => {
    latest.current = tick
  })
  useEffect(() => {
    if (!active || ms <= 0) return
    const run = () => {
      if (document.visibilityState === "visible") latest.current()
    }
    const timer = window.setInterval(run, ms)
    document.addEventListener("visibilitychange", run)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", run)
    }
  }, [active, ms])
}

/**
 * The workflows published from ComfyUI. Every load takes a ticket; only the
 * newest one may write, so a slow answer for an older address or an earlier
 * Refresh never overwrites (or clears) a newer one.
 */
export function useBridgeWorkflows(url: string, active: boolean, pollMs?: number) {
  const [state, setState] = useState<{ url: string; items: BridgeWorkflowSummary[] | null; failed: boolean }>({ url, items: null, failed: false })
  const [loading, setLoading] = useState(false)
  const ticket = useRef(0)
  const polling = useRef(false)

  /** Fetches the list; only the load holding the newest ticket may write. */
  const load = useCallback(
    (mine: number) =>
      createComfyClient(url)
        .listBridgeWorkflows()
        .then(
          (items) => {
            if (mine === ticket.current) setState({ url, items, failed: false })
          },
          () => {
            if (mine === ticket.current) setState((prev) => ({ url, items: prev.url === url ? prev.items : null, failed: true }))
          },
        ),
    [url],
  )

  useEffect(() => {
    if (!active) return
    const counter = ticket
    void load(++counter.current)
    return () => {
      // Closing the panel or changing the address drops the answer in flight.
      counter.current++
      setLoading(false)
    }
  }, [active, load])

  /** The Refresh button: spins until its own answer is in. */
  const refresh = () => {
    const mine = ++ticket.current
    setLoading(true)
    void load(mine).finally(() => {
      if (mine === ticket.current) setLoading(false)
    })
  }

  // The setup guide polls while its step is on screen, so a workflow published
  // in ComfyUI shows up without a click. A poll never overlaps another load.
  usePollWhileVisible(active && pollMs !== undefined, pollMs ?? 0, () => {
    if (loading || polling.current) return
    polling.current = true
    void load(++ticket.current).finally(() => {
      polling.current = false
    })
  })

  const current = state.url === url ? state : { items: null, failed: false }
  return { items: current.items, failed: current.failed, loading, refresh }
}

/** ComfyUI's node list, to flag nodes this ComfyUI doesn't have. */
export function useObjectInfo(url: string, active: boolean): ObjectInfo | null {
  const [info, setInfo] = useState<{ url: string; info: ObjectInfo } | null>(null)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    createComfyClient(url, { timeoutMs: 15000 })
      .objectInfo()
      .then((result) => {
        if (!cancelled) setInfo({ url, info: result })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [active, url])
  return info?.url === url ? info.info : null
}

// --- Panel parts ----------------------------------------------------------------

export type Settings = ReturnType<typeof useComfyUISettings>

/** Import from the bridge or a file, save it and make it the workflow in use. */
export function useWorkflowImport(settings: Settings, objectInfo: ObjectInfo | null) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** Returns whether the workflow was saved and is now in use. */
  const adopt = (saved: SavedComfyWorkflow, verb: string): boolean => {
    if (!settings.saveWorkflow(saved)) {
      setError("Couldn't save the workflow. The browser's storage for this site is full.")
      return false
    }
    settings.setActiveWorkflow(saved.id)
    setError(null)
    setNotice(`${verb} ${saved.name}.`)
    return true
  }

  /** Both imports resolve to whether the workflow is now in use. */
  const fromBridge = async (item: BridgeWorkflowSummary): Promise<boolean> => {
    setBusyId(item.id)
    setNotice(null)
    try {
      const record = await createComfyClient(settings.url).getBridgeWorkflow(item.id)
      const result = importBridgeRecord(record)
      if (!result.ok) {
        setError(IMPORT_ERRORS[result.error])
        return false
      }
      const previous = settings.workflows.find((w) => w.bridgeId === item.id)
      return adopt(toSaved(result.workflow, objectInfo, previous, item.id), previous ? "Updated" : "Now using")
    } catch {
      setError("Couldn't load this workflow from ComfyUI. Check the connection and try again.")
      return false
    } finally {
      setBusyId(null)
    }
  }

  const fromFile = async (file: File): Promise<boolean> => {
    setNotice(null)
    const result = await importWorkflowFile({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
    if (!result.ok) {
      setError(IMPORT_ERRORS[result.error])
      return false
    }
    return adopt(toSaved(result.workflow, objectInfo), "Now using")
  }

  const select = (id: string) => {
    settings.setActiveWorkflow(id)
    setNotice(null)
  }

  return { busyId, error, notice, fromBridge, fromFile, select }
}

export function removeWithUndo(settings: Settings, w: SavedComfyWorkflow) {
  const wasActive = settings.activeWorkflow?.id === w.id
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
