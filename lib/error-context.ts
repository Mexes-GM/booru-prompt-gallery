// Diagnostic context for the recurring React #185 ("Maximum update depth
// exceeded") crash, suspected to be caused by browser auto-translation (Google
// Translate mutating the DOM under React) while many favorites load.
//
// Everything here is attached as PostHog super properties (setErrorContext),
// so it rides on every subsequent event — including autocaptured exceptions —
// without sending extra events. The single exception is the one-shot
// `browser_translation_detected` event, fired at most once per page load.

import posthog from "posthog-js"
import { setErrorContext } from "@/lib/error-reporting"

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

/** Snapshot the current browser-translation state. Cheap; safe to call in before_send. */
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
 * Watch for the browser starting to translate the page and record it the
 * moment it happens, so a subsequent #185 crash carries `page_translated`.
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
  setErrorContext({
    nav_language: base.navigatorLanguage || "unknown",
    page_translated: base.detected,
  })

  let reported = base.detected
  let observer: MutationObserver | null = null

  const report = (reason: string) => {
    const state = getTranslationState()
    if (!state.detected) return
    setErrorContext({ page_translated: true })
    if (!reported) {
      reported = true
      try {
        posthog.capture("browser_translation_detected", {
          reason,
          font_node_count: state.fontNodeCount,
          html_classes: state.htmlClasses,
          nav_languages: state.navigatorLanguages,
          translate_attr: state.translateAttr,
        })
      } catch {
        /* non-fatal */
      }
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

// ── Favorites load context ───────────────────────────────────────────────────
// The #185 crash correlates with loading many favorites while signed in. These
// record how far the favorites load got, so a crash event shows the count and
// progress at the time it happened.

export interface FavoritesTrace {
  count: number
  loaded?: number
  total?: number
  provider?: string
  signedIn?: boolean
}

export function setFavoritesContext(state: FavoritesTrace): void {
  setErrorContext({
    favorites_count: state.count,
    ...(state.loaded !== undefined ? { favorites_loaded: state.loaded } : {}),
    ...(state.total !== undefined ? { favorites_total: state.total } : {}),
  })
}

/** Record a favorites-load milestone as session context (no extra event). */
export function addFavoritesBreadcrumb(message: string, _data?: Record<string, unknown>): void {
  setErrorContext({ favorites_last_step: message })
}
