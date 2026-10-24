"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { safeTrack } from "@/lib/analytics"
import { MAIN_TOUR_STORAGE_KEY, isFeatureIntroPreview, isOverlayOpen } from "@/lib/onboarding"

const loadDialog = () => import("@/components/prompt-gallery/feature-intro-dialog")
const FeatureIntroDialog = dynamic(() => loadDialog().then((m) => m.FeatureIntroDialog), { ssr: false, loading: () => null })

/** Release whose feature this dialog presents. It only shows while the site is on this minor version. */
export const FEATURE_INTRO_RELEASE = "10.4"
export const FEATURE_INTRO_POSTER = "/whats-new/10.4.0-prompt-formats-poster.jpg"

const SEEN_KEY = "feature_intro_seen"

/** Wait this long after the page has loaded, so the dialog never competes with the first paint. */
const START_DELAY_MS = 500
/** Only open after this long without a click, key press or scroll: never mid-action. */
const QUIET_MS = 1000
const CHECK_EVERY_MS = 250
/** No chance to open this long after the gallery mounted: try again on the next visit. */
const GIVE_UP_MS = 5 * 60 * 1000

/** Another dialog, menu, popover or tour on screen, or the user is typing. */
function isBusy(): boolean {
  if (isOverlayOpen()) return true
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
    return localStorage.getItem(MAIN_TOUR_STORAGE_KEY) === "1"
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
 * feature, as soon as the page has loaded, unless the user is mid-action or
 * something else is open; then it waits for a pause. It is marked as seen the
 * moment it opens. The dialog's code and video load only after the page.
 */
export function FeatureIntro({ version, onTry }: { version: string; onTry: () => void }) {
  const [open, setOpen] = useState<boolean | null>(null)

  useEffect(() => {
    // Dev-only preview: open /?feature-intro to show it right away, without
    // the checks above and without marking it as seen (the tour stays off).
    if (isFeatureIntroPreview()) {
      const timer = setTimeout(() => setOpen(true), 0)
      return () => clearTimeout(timer)
    }
    if (!shouldOffer(version)) return

    // It opens without waiting for a first input, so on that one visit the
    // dialog's poster can become the page's Largest Contentful Paint.
    const mountedAt = performance.now()
    let loadedAt = document.readyState === "complete" ? mountedAt : Infinity
    let lastInput = -Infinity
    let warmed = false
    const onInput = () => {
      lastInput = performance.now()
    }
    // One signal removes every listener below.
    const listeners = new AbortController()
    for (const name of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) {
      window.addEventListener(name, onInput, { capture: true, passive: true, signal: listeners.signal })
    }
    if (loadedAt === Infinity) {
      window.addEventListener("load", () => { loadedAt = performance.now() }, { once: true, signal: listeners.signal })
    }

    const check = setInterval(() => {
      const now = performance.now()
      if (now - mountedAt > GIVE_UP_MS) return stop()
      if (loadedAt === Infinity) return
      if (!warmed) {
        // Fetch the dialog's code and poster during the delay, so it opens
        // without a blank frame.
        warmed = true
        loadDialog().catch(() => {})
        new Image().src = FEATURE_INTRO_POSTER
      }
      if (now - loadedAt < START_DELAY_MS) return
      if (document.visibilityState !== "visible" || now - lastInput < QUIET_MS || isBusy()) return
      stop()
      markSeen()
      setOpen(true)
      safeTrack("feature_intro_shown", { release: FEATURE_INTRO_RELEASE })
    }, CHECK_EVERY_MS)

    const stop = () => {
      clearInterval(check)
      listeners.abort()
    }
    return () => {
      clearInterval(check)
      listeners.abort()
    }
  }, [version])

  // null until it first opens; it then stays mounted so the close animation can play.
  if (open === null) return null
  return <FeatureIntroDialog open={open} onOpenChange={setOpen} onTry={onTry} />
}
