"use client"

import { useCallback, useState } from "react"
import { toast } from "@/hooks/use-toast"
import { useComfyEnabled } from "@/hooks/use-comfyui-settings"
import type { ComfySent } from "@/components/prompt-gallery/comfyui-send"

/**
 * Send for one place that shows one job at a time (a footer). Holds the job in
 * memory; sending again replaces it.
 */
export function useComfySend() {
  const enabled = useComfyEnabled()
  const [job, setJob] = useState<ComfySent | null>(null)
  const [sending, setSending] = useState(false)

  const send = useCallback(
    async (prompt: string, onCopyInstead?: () => void): Promise<boolean> => {
      if (!prompt) return false
      setSending(true)
      try {
        const { sendToComfy } = await import("@/components/prompt-gallery/comfyui-send")
        const sent = await sendToComfy({ prompt, previousJobId: job?.jobId, onCopyInstead })
        if (sent) setJob(sent)
        return !!sent
      } catch {
        toast({ description: "Couldn't load Send to ComfyUI. Check your connection and try again.", variant: "destructive", duration: 3000 })
        return false
      } finally {
        setSending(false)
      }
    },
    [job],
  )

  const dismiss = useCallback(() => setJob(null), [])

  return { enabled, job, sending, send, dismiss }
}
