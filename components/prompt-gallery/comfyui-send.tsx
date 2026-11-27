"use client"

/**
 * What every Send button does: check that a workflow is ready, write the
 * prompt (plus seed and size when the options say so) into it and queue it in
 * the user's ComfyUI. Loaded on the first Send, so pages that never send skip
 * the ComfyUI client.
 */
import { ToastAction } from "@/components/ui/toast"
import { toast } from "@/hooks/use-toast"
import { getComfyUISettings } from "@/hooks/use-comfyui-settings"
import { BRIDGE_INSTALL_STEP, BRIDGE_NAME } from "@/lib/comfyui/bridge"
import { openComfyPanel } from "@/lib/comfyui/panel-request"
import { randomSeed } from "@/lib/comfyui/roles"
import { getComfyJobSnapshot, getComfySession, type ComfySession } from "@/lib/comfyui/session"
import { getComfyStatus, refreshComfyStatus } from "@/lib/comfyui/status"
import { ComfyError, type ApiWorkflow, type Diagnosis } from "@/lib/comfyui/types"
import { clampMaxLongSide, computeGenerationResolution } from "@/lib/extension/generation-resolution"
import { userPreferences } from "@/lib/storage"

export interface ComfySendRequest {
  /** Exactly the text Copy would copy. */
  prompt: string
  /** The post's image size, for "Match the post's size". */
  sourceWidth?: number
  sourceHeight?: number
  /**
   * The job this button showed before. Sending again replaces it: a job still
   * in the queue is canceled, one already generating finishes in ComfyUI but
   * is no longer shown.
   */
  previousJobId?: string | null
  /** The toast's fallback when ComfyUI can't be reached. */
  onCopyInstead?: () => void
}

export interface ComfySent {
  jobId: string
  api: ApiWorkflow
}

/** One short line on why the prompt didn't reach ComfyUI. */
function reasonFor(d: Diagnosis): string {
  switch (d.state) {
    case "unsupported-browser":
      return "This browser can't reach ComfyUI on your computer."
    case "invalid-url":
      return "The ComfyUI address isn't a local one."
    case "local-network-denied":
      return "Your browser blocks this site from your local network."
    case "unreachable":
      return "ComfyUI isn't answering. Check that it's running."
    case "bridge-missing":
      return `ComfyUI blocks this site. ${BRIDGE_INSTALL_STEP}`
    case "bridge-outdated":
    case "bridge-inactive":
      return `${BRIDGE_NAME} needs an update.`
    case "ok":
      return "ComfyUI didn't take the prompt. Try again."
  }
}

function showFailure(description: string, onCopyInstead?: () => void) {
  toast({
    title: "Couldn't send to ComfyUI",
    description,
    variant: "destructive",
    duration: 8000,
    action: (
      <div className="flex shrink-0 flex-col gap-1.5">
        <ToastAction altText="Open the ComfyUI settings" onClick={() => openComfyPanel()}>
          Open settings
        </ToastAction>
        {onCopyInstead && (
          <ToastAction altText="Copy the prompt instead" onClick={onCopyInstead}>
            Copy prompt
          </ToastAction>
        )}
      </div>
    ),
  })
}

/** Sending again: a queued job is canceled, a running one finishes in ComfyUI untracked. */
function replacePrevious(session: ComfySession, jobId: string) {
  const previous = getComfyJobSnapshot(jobId)
  if (previous?.status === "queued") {
    void session
      .cancel(jobId)
      .catch(() => {})
      .finally(() => session.forget(jobId))
  } else {
    session.forget(jobId)
  }
}

function sizeFor(req: ComfySendRequest): { width?: number; height?: number } {
  let maxLongSide = 1536
  let strictCap = false
  let snapToBucket = false
  try {
    maxLongSide = clampMaxLongSide(userPreferences.getMatchResolutionMaxLongSide())
    strictCap = userPreferences.getMatchResolutionStrictCap()
    snapToBucket = userPreferences.getMatchResolutionSnapToBucket()
  } catch {
    // Defaults above.
  }
  const size = computeGenerationResolution(req.sourceWidth, req.sourceHeight, { maxLongSide, strictCap, snapToBucket })
  return size ?? {}
}

/**
 * Queues the prompt in ComfyUI. Returns the job, or null when nothing was
 * sent: the panel opened because the workflow isn't ready, or a toast says
 * why ComfyUI couldn't be reached.
 */
export async function sendToComfy(req: ComfySendRequest): Promise<ComfySent | null> {
  const { url, activeWorkflow: workflow, options } = getComfyUISettings()
  if (!workflow) {
    openComfyPanel("workflow")
    return null
  }
  if (!workflow.roles.prompt) {
    openComfyPanel("prompt-role")
    return null
  }

  const { roles } = workflow
  const size = options.matchPostResolution && roles.width && roles.height ? sizeFor(req) : {}
  const session = getComfySession(url)

  try {
    const jobId = await session.send({
      api: workflow.api,
      roles,
      prompt: req.prompt,
      seed: options.randomSeed && roles.seed ? randomSeed() : undefined,
      width: size.width,
      height: size.height,
      preview: options.livePreview,
    })
    if (req.previousJobId && req.previousJobId !== jobId) replacePrevious(session, req.previousJobId)
    // A send that went through proves the connection; refresh a status that says otherwise.
    const known = getComfyStatus()
    if (known.url !== url || known.diagnosis?.state !== "ok") void refreshComfyStatus(url)
    return { jobId, api: workflow.api }
  } catch (error) {
    if (!(error instanceof ComfyError)) {
      // applyRoles refuses roles that no longer point at a typed input.
      showFailure("The workflow's roles no longer match it. Check them in the ComfyUI settings.")
      return null
    }
    // Also updates the status the settings row and the gallery chip show.
    const diagnosis = await refreshComfyStatus(url)
    showFailure(reasonFor(diagnosis), req.onCopyInstead)
    return null
  }
}
