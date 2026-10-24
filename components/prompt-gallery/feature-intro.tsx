"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { safeTrack } from "@/lib/analytics"
import { TOUR_STORAGE_KEY } from "@/components/prompt-gallery/main-tour"

const loadDialog = () => import("@/components/prompt-gallery/feature-intro-dialog")
const FeatureIntroDialog = dynamic(() => loadDialog().then((m) => m.FeatureIntroDialog), { ssr: false, loading: () => null })

/** Release whose feature this dialog presents. It only shows while the site is on this minor version. */
export const FEATURE_INTRO_RELEASE = "10.4"
export const FEATURE_INTRO_POSTER = "/whats-new/10.4.0-prompt-formats-poster.jpg"

const SEEN_KEY = "feature_intro_seen"

/** Wait after the page has loaded, so the dialog never competes with the first paint. */
const START_DELAY_MS = 2500
/** Only open after this long without a click, key press or scroll: never mid-action. */
const QUIET_MS = 2500
const CHECK_EVERY_MS = 1000
/** No chance to open by then: try again on the next visit. */
const GIVE_UP_MS = 5 * 60 * 1000

/** Another dialog, menu, popover or tour on screen, or the user is typing. */
function isBusy(): boolean {
  if (
    document.querySelector(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-expanded="true"], .react-joyride__overlay'
    )
  ) {
    return true
  }
  const el = document.activeElement
  return el instanceof HTMLElement && (el.isContentEditable || el.matches("input, textarea, select"))
}

function shouldOffer(version: string): boolean {
  // The browser extension embeds the site in a frame; it has its own onboarding.
  if (window.self !== window.top) return false
  if (!version.startsWith(`${FEATURE_INTRO_RELEASE}.`)) return false
  try {
    if (localStorage.getItem(SEEN_KEY) === FEATURE_INTRO_RELEASE) return false
    // First visit: the welcome tour runs instead, and this waits for the next visit.
    return localStorage.getItem(TOUR_STORAGE_KEY) === "1"
  } catch {
    // Storage blocked: the dismissal couldn't be remembered, so never show it.
    return false
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, FEATURE_INTRO_RELEASE)
  } catch {}
}

/**
 * Opens the "what's new" dialog once per browser for the release's main
 * feature. It waits until the page has loaded and the user has started using
 * it, then for a pause (no input, nothing else open), and it is marked as seen
 * the moment it opens. The dialog's code and video load only then.
 */
export function FeatureIntro({ version, onTry }: { version: string; onTry: () => void }) {
  const [open, setOpen] = useState<boolean | null>(null)

  useEffect(() => {
    // Dev-only preview: open /?feature-intro to show it right away, without
    // the checks above and without marking it as seen.
    if (process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).has("feature-intro")) {
      const timer = setTimeout(() => setOpen(true), 0)
      return () => clearTimeout(timer)
    }
    if (!shouldOffer(version)) return

    // Waiting for a first click, key press, wheel or touch keeps the dialog out
    // of the page's Largest Contentful Paint: browsers stop measuring it at the
    // first input, and the dialog's video would otherwise become the largest
    // element. Scroll events alone don't count, since the page can scroll itself.
    let interacted = false
    let lastInput = performance.now()
    const onInput = (e: Event) => {
      lastInput = performance.now()
      if (e.type !== "scroll") interacted = true
    }
    // One signal removes every listener below.
    const listeners = new AbortController()
    for (const name of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) {
      window.addEventListener(name, onInput, { capture: true, passive: true, signal: listeners.signal })
    }

    let startTimer: ReturnType<typeof setTimeout> | undefined
    let checkTimer: ReturnType<typeof setInterval> | undefined
    let startedAt = 0

    const stop = () => {
      clearTimeout(startTimer)
      clearInterval(checkTimer)
      listeners.abort()
    }

    let warmed = false
    const tryOpen = () => {
      const now = performance.now()
      if (now - startedAt > GIVE_UP_MS) return stop()
      if (!interacted) return
      if (!warmed) {
        // Fetch the dialog's code and poster during the pause, so it opens
        // without a blank frame.
        warmed = true
        loadDialog().catch(() => {})
        new Image().src = FEATURE_INTRO_POSTER
      }
      if (document.visibilityState !== "visible" || now - lastInput < QUIET_MS || isBusy()) return
      stop()
      markSeen()
      setOpen(true)
      safeTrack("feature_intro_shown", { release: FEATURE_INTRO_RELEASE })
    }

    const start = () => {
      startTimer = setTimeout(() => {
        startedAt = performance.now()
        checkTimer = setInterval(tryOpen, CHECK_EVERY_MS)
        tryOpen()
      }, START_DELAY_MS)
    }

    if (document.readyState === "complete") start()
    else window.addEventListener("load", start, { once: true, signal: listeners.signal })

    return () => {
      clearTimeout(startTimer)
      clearInterval(checkTimer)
      listeners.abort()
    }
  }, [version])

  // null until it first opens; it then stays mounted so the close animation can play.
  if (open === null) return null
  return <FeatureIntroDialog open={open} onOpenChange={setOpen} onTry={onTry} />
}
