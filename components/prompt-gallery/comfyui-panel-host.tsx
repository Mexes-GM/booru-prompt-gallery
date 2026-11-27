"use client"

import dynamic from "next/dynamic"
import { useState, useSyncExternalStore } from "react"
import { getComfyPanelRequest, subscribeComfyPanel } from "@/lib/comfyui/panel-request"

const ComfyUIPanel = dynamic(() => import("./comfyui-panel").then((m) => m.ComfyUIPanel), { ssr: false, loading: () => null })

const getServerRequest = () => null

/**
 * Renders the ComfyUI panel when a Send button asks for it. Mounted once; the
 * panel's code loads on the first request.
 */
export function ComfyUIPanelHost() {
  const request = useSyncExternalStore(subscribeComfyPanel, getComfyPanelRequest, getServerRequest)
  // Each request opens the panel until the user closes it. A request made
  // before this host mounted (the mode was off, or an earlier session of it)
  // counts as closed, so turning the mode on doesn't reopen an old panel.
  const [closedId, setClosedId] = useState<number | null>(() => getComfyPanelRequest()?.id ?? null)

  if (!request) return null
  return (
    <ComfyUIPanel
      open={closedId !== request.id}
      onOpenChange={(open) => setClosedId(open ? null : request.id)}
      reason={request.reason}
      requestId={request.id}
      returnFocusTo={request.returnFocus}
    />
  )
}

export default ComfyUIPanelHost
