/**
 * Copy text to the clipboard. Tries the async Clipboard API first and falls
 * back to a hidden textarea + execCommand("copy") when it is missing or
 * refused: insecure contexts, iframes without the clipboard-write permission,
 * a document that lost focus mid-click, or browsers that reject the write
 * after an awaited step. Throws only when both ways fail.
 */
export async function copyText(text: string): Promise<void> {
  let apiError: unknown
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      apiError = error
    }
  }
  if (!legacyCopy(text)) {
    throw apiError instanceof Error ? apiError : new Error("Clipboard copy failed")
  }
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false
  const active = document.activeElement as HTMLElement | null
  // Inside a modal dialog, a textarea outside it can't take focus (focus trap).
  const host = active?.closest<HTMLElement>("[role=dialog]") ?? document.body
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none"
  host.appendChild(textarea)
  try {
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    textarea.remove()
    active?.focus?.({ preventScroll: true })
  }
}

/** The words every copy uses, so a copy reads the same wherever it happens. */
export const COPIED_TITLE = "Copied"
export const COPY_FAILED_TITLE = "Couldn't copy"
export const COPY_FAILED_TEXT = "Your browser blocked the clipboard. Select the text and copy it yourself."
