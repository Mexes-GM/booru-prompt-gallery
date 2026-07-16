"use client"

// Centralized error-toast helper.
//
// Wraps the existing `toast()` from hooks/use-toast.ts so every destructive
// toast in the app can optionally offer a one-click "Report" action that
// pre-fills the FeedbackDialog with the error's context (see
// docs/error-toast-reporting-plan.md, Fase 1).
//
// Deliberately NOT auto-submitting the report: /api/feedback rate-limits to
// 3 requests/hour per IP, so silently burning that quota on every toast
// would leave the user with no quota left for a report they actually want
// to add detail to. The action only opens the dialog pre-filled; the user
// still confirms.
import { toast as rawToast } from "@/hooks/use-toast"
import { ToastAction } from "@/components/ui/toast"
import { openPrefilledFeedback } from "@/components/feedback-prefill-context"
import { safeTrack } from "@/lib/analytics"

// The base ToastAction is `border bg-transparent` — on a solid red
// (destructive) toast that reads as a barely-visible outline and blends
// into the background. Override with a solid, high-contrast chip so the
// "Report" action is clearly legible and doesn't get mistaken for decor.
const REPORT_ACTION_CLASSNAME =
  "border-transparent bg-white text-destructive font-semibold hover:bg-white/90 hover:text-destructive focus:ring-white focus:ring-offset-destructive dark:bg-white dark:text-red-700"

export interface ToastErrorOptions {
  /** Toast title shown to the user. */
  title: string
  /** Toast description shown to the user (human-readable error message). */
  description: string
  /**
   * Stable identifier of the call site that raised the error, e.g.
   * "download_image", "copy_to_clipboard", "toggle_favorite". Used both in
   * the pre-filled report content and as feedback metadata.
   */
  errorSource: string
  /**
   * Extra structured context (provider, postId, raw error message, etc.)
   * merged into the feedback metadata when the user reports this error.
   */
  context?: Record<string, unknown>
  /**
   * Set to false to suppress the "Report" action (rare — e.g. toasts that
   * are not really errors, or where reporting would not make sense).
   * Defaults to true.
   */
  reportable?: boolean
}

/**
 * Show a destructive toast with an optional one-click "Report" action that
 * opens the FeedbackDialog pre-filled with the error's context.
 *
 * Use this instead of calling `toast({ variant: "destructive", ... })`
 * directly for any user-facing error.
 */
export function toastError(options: ToastErrorOptions): void {
  const { title, description, errorSource, context, reportable = true } = options

  // Fase 5 (docs/error-toast-reporting-plan.md): denominator for "how many
  // users saw this error" — compared against `feedback_submitted` (already
  // emitted by FeedbackDialog) to measure the report rate. Routed through
  // the existing safeTrack() choke point (lib/analytics.ts) so it's
  // crash-proof and consistent with the rest of the app's telemetry.
  safeTrack('error_shown', { error_source: errorSource, ...context })

  const handleReportClick = () => {
    safeTrack('error_report_clicked', { error_source: errorSource, ...context })
    openPrefilledFeedback({
      type: "bug",
      content: buildReportContent({ title, description, errorSource, context }),
      metadata: {
        error_source: errorSource,
        raw_description: description,
        ...context,
      },
    })
  }

  rawToast({
    title,
    description,
    variant: "destructive",
    action: reportable ? (
      <ToastAction altText="Report this error" onClick={handleReportClick} className={REPORT_ACTION_CLASSNAME}>
        Report
      </ToastAction>
    ) : undefined,
  })
}

function buildReportContent(opts: {
  title: string
  description: string
  errorSource: string
  context?: Record<string, unknown>
}): string {
  const { title, description, errorSource, context } = opts
  const lines = [`[Auto-reported] ${title}: ${description}`, "", `Source: ${errorSource}`]

  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (value === undefined || value === null || value === "") continue
      lines.push(`${key}: ${String(value)}`)
    }
  }

  lines.push("", "(Feel free to add more details about what you were doing.)")
  return lines.join("\n")
}
