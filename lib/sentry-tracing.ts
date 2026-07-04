// ─────────────────────────────────────────────────────────────────────────────
// Sentry tracing helpers focused on the recurring React #185 ("Maximum update
// depth exceeded") crash. Root-cause investigation (SENTRY-FULVOUS-ANCHOR-7)
// pointed at browser auto-translation (Chrome / Google Translate on mobile,
// es-419 locale) mutating the DOM under React. These helpers capture the exact
// translation + favorites state so the NEXT occurrence carries definitive
// evidence instead of a bare minified stack.
//
// Everything here is quota-friendly: breadcrumbs, tags and contexts ride inside
// the error event Sentry already sends — no extra events, no `enableLogs`.
// ─────────────────────────────────────────────────────────────────────────────

import * as Sentry from "@sentry/nextjs"

export interface TranslationState {
  /** Best-effort "is the page currently being auto-translated" verdict. */
  detected: boolean
  htmlLang: string | null
  /** The `translate` attribute on <html> — should be "no" after our fix. */
  translateAttr: string | null
  htmlClasses: string
  /** Google Translate wraps translated text in <font> tags; a high count is a strong signal. */
  fontNodeCount: number
  hasSkipTranslate: boolean
  hasGoogleWidget: boolean
  navigatorLanguage: string | null
  navigatorLanguages: string
}

const EMPTY_STATE: TranslationState = {
  detected: false,
  htmlLang: null,
  translateAttr: null,
  htmlClasses: "",
  fontNodeCount: 0,
  hasSkipTranslate: false,
  hasGoogleWidget: false,
  navigatorLanguage: null,
  navigatorLanguages: "",
}

/** Snapshot the current browser-translation state. Cheap; safe to call in beforeSend. */
export function getTranslationState(): TranslationState {
  if (typeof document === "undefined") return { ...EMPTY_STATE }

  const html = document.documentElement
  const fontNodeCount = document.getElementsByTagName("font").length
  const hasSkipTranslate = !!document.querySelector("ins.skiptranslate, .skiptranslate")
  const hasGoogleWidget = !!document.querySelector(
    ".goog-te-banner-frame, .goog-te-menu-frame, #goog-gt-tt, #google_translate_element",
  )
  const translatedClass =
    html.classList.contains("translated-ltr") || html.classList.contains("translated-rtl")

  return {
    detected: translatedClass || hasSkipTranslate || hasGoogleWidget || fontNodeCount > 0,
    htmlLang: html.getAttribute("lang"),
    translateAttr: html.getAttribute("translate"),
    htmlClasses: html.className,
    fontNodeCount,
    hasSkipTranslate,
    hasGoogleWidget,
    navigatorLanguage: typeof navigator !== "undefined" ? navigator.language : null,
    navigatorLanguages:
      typeof navigator !== "undefined" && navigator.languages ? navigator.languages.join(",") : "",
  }
}

let tracingStarted = false

/**
 * Watch for the browser starting to translate the page and drop a Sentry
 * breadcrumb + tag the moment it happens, so a subsequent #185 crash shows the
 * translation event immediately before it in the timeline.
 *
 * Cost control: we only observe `<html>` class/lang changes (Google Translate
 * toggles `translated-ltr`/`translated-rtl` there) plus direct `<body>` child
 * insertions (its `<ins class="skiptranslate">` banner). We do NOT observe the
 * whole subtree, and we disconnect after the first detection.
 */
export function initTranslationTracing(): void {
  if (tracingStarted || typeof window === "undefined" || typeof MutationObserver === "undefined") return
  tracingStarted = true

  const base = getTranslationState()
  // Baseline tags on every event from this session.
  Sentry.setTag("nav_language", base.navigatorLanguage || "unknown")
  Sentry.setTag("page_translated", String(base.detected))
  if (base.detected) {
    Sentry.setContext("translation", base as unknown as Record<string, unknown>)
  }

  let reported = base.detected
  let observer: MutationObserver | null = null

  const report = (reason: string) => {
    const state = getTranslationState()
    if (!state.detected) return
    Sentry.setTag("page_translated", "true")
    Sentry.setContext("translation", state as unknown as Record<string, unknown>)
    if (!reported) {
      reported = true
      Sentry.addBreadcrumb({
        category: "browser.translation",
        level: "warning",
        message: `Browser translation detected (${reason})`,
        data: {
          fontNodeCount: state.fontNodeCount,
          htmlClasses: state.htmlClasses,
          navLanguages: state.navigatorLanguages,
          translateAttr: state.translateAttr,
        },
      })
      // One-shot: translation is a sticky state toggle, so stop observing.
      observer?.disconnect()
    }
  }

  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes" && m.target === document.documentElement) {
        report("html-attr")
        return
      }
      if (m.type === "childList" && m.addedNodes.length) {
        for (const node of Array.from(m.addedNodes)) {
          const el = node as Element
          if (node.nodeName === "INS" || el.classList?.contains?.("skiptranslate")) {
            report("skiptranslate-node")
            return
          }
        }
      }
    }
  })

  // <html> attributes (translated-ltr/rtl, lang) — reliable + cheap.
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "lang"],
  })
  // <body> direct children only (Google Translate banner) — no subtree.
  if (document.body) {
    observer.observe(document.body, { childList: true })
  }
}

// ── Favorites lifecycle breadcrumbs/context ──────────────────────────────────
// The #185 crash correlates with loading many favorites while signed in. These
// helpers record how far the favorites load got, so the crash event shows the
// exact count/progress + a load timeline.

export interface FavoritesTrace {
  count: number
  loaded?: number
  total?: number
  provider?: string
  signedIn?: boolean
}

export function setFavoritesContext(state: FavoritesTrace): void {
  try {
    Sentry.setContext("favorites", state as unknown as Record<string, unknown>)
    Sentry.setTag("favorites_count", String(state.count))
  } catch {
    /* non-fatal: tracing is best-effort */
  }
}

export function addFavoritesBreadcrumb(message: string, data?: Record<string, unknown>): void {
  try {
    Sentry.addBreadcrumb({ category: "favorites", level: "info", message, data })
  } catch {
    /* non-fatal */
  }
}
