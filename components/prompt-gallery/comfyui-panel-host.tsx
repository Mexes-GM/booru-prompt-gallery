"use client"

import dynamic from "next/dynamic"
import { useState, useSyncExternalStore } from "react"
import { getComfyUISettings } from "@/hooks/use-comfyui-settings"
import { getComfyPanelRequest, subscribeComfyPanel, type ComfyPanelReason } from "@/lib/comfyui/panel-request"
import { needsSetup } from "@/lib/comfyui/setup-steps"

const ComfyUIPanel = dynamic(() => import("./comfyui-panel").then((m) => m.ComfyUIPanel), { ssr: false, loading: () => null })
const ComfyUISetupWizard = dynamic(() => import("./comfyui-setup-wizard").then((m) => m.ComfyUISetupWizard), {
  ssr: false,
  loading: () => null,
})

/** Loads both dialogs' code ahead of a click (hover or focus on the button that opens them). */
export function preloadComfyDialogs() {
  void import("./comfyui-panel")
  void import("./comfyui-setup-wizard")
}

type View = { kind: "settings" } | { kind: "setup"; fromStart: boolean }

/** What opening ComfyUI shows now: the setup guide until a test has passed once, the settings after. */
function viewForNow(): View {
  return needsSetup(getComfyUISettings()) ? { kind: "setup", fromStart: false } : { kind: "settings" }
}

export interface ComfyUIDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reason?: ComfyPanelReason | null
  requestId?: number
  returnFocusTo?: HTMLElement | null
}

/**
 * The ComfyUI dialog every entry point opens: the setup guide while setup
 * isn't finished, the settings panel once it is. The choice is made when it
 * opens and kept while it stays open, so passing the test inside the guide
 * doesn't swap it for the panel. The panel's "Run setup again" switches over.
 */
export function ComfyUIDialog({ open, onOpenChange, reason = null, requestId, returnFocusTo }: ComfyUIDialogProps) {
  const [view, setView] = useState<View>(viewForNow)
  const [openedFor, setOpenedFor] = useState<{ open: boolean; requestId?: number }>({ open, requestId })
  if (openedFor.open !== open || openedFor.requestId !== requestId) {
    setOpenedFor({ open, requestId })
    if (open) setView(viewForNow())
  }

  if (view.kind === "setup") {
    return (
      <ComfyUISetupWizard
        open={open}
        onOpenChange={onOpenChange}
        reason={reason}
        returnFocusTo={returnFocusTo}
        startAt={view.fromStart ? "start" : undefined}
      />
    )
  }
  return (
    <ComfyUIPanel
      open={open}
      onOpenChange={onOpenChange}
      reason={reason}
      requestId={requestId}
      returnFocusTo={returnFocusTo}
      onRunSetup={() => setView({ kind: "setup", fromStart: true })}
    />
  )
}

const getServerRequest = () => null

/**
 * Renders the ComfyUI dialog when a Send button asks for it. Mounted once; the
 * dialog's code loads on the first request.
 */
export function ComfyUIPanelHost() {
  const request = useSyncExternalStore(subscribeComfyPanel, getComfyPanelRequest, getServerRequest)
  // Each request opens the dialog until the user closes it. A request made
  // before this host mounted (the mode was off, or an earlier session of it)
  // counts as closed, so turning the mode on doesn't reopen an old dialog.
  const [closedId, setClosedId] = useState<number | null>(() => getComfyPanelRequest()?.id ?? null)

  if (!request) return null
  return (
    <ComfyUIDialog
      open={closedId !== request.id}
      onOpenChange={(open) => setClosedId(open ? null : request.id)}
      reason={request.reason}
      requestId={request.id}
      returnFocusTo={request.returnFocus}
    />
  )
}

export default ComfyUIPanelHost
