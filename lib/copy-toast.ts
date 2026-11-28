"use client"

import { toast } from "@/hooks/use-toast"
import { COPIED_TITLE, COPY_FAILED_TEXT, COPY_FAILED_TITLE } from "@/lib/clipboard"
import { toastError } from "@/lib/toast-error"

/** "Copied", with a short line only when it says what was copied. */
export function toastCopied(description?: string): void {
  toast({ title: COPIED_TITLE, description })
}

/** The one message for a copy the browser refused. `errorSource` tells reports apart. */
export function toastCopyFailed(errorSource: string, context?: Record<string, unknown>): void {
  toastError({ title: COPY_FAILED_TITLE, description: COPY_FAILED_TEXT, errorSource, context })
}
