/**
 * One shared answer to "does ComfyUI work right now?" for the settings row,
 * the gallery's ComfyUI chip and the panel. Checks run on demand, never on a
 * timer: a caller asks, and a result younger than `STATUS_MAX_AGE_MS` is
 * reused. A check already running is shared instead of starting another. The
 * ComfyUI client loads with the first check, so pages that never check skip it.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react"
import { BRIDGE_INSTALL_STEP, BRIDGE_MANAGER_NAME, BRIDGE_NAME, MIN_BRIDGE_VERSION } from "./bridge"
import type { Diagnosis } from "./types"

/** How long a result counts as current. */
export const STATUS_MAX_AGE_MS = 30_000
const CHECK_TIMEOUT_MS = 4000

export interface ComfyStatus {
  /** The address the result is for. */
  url: string
  /** Null until the first check for `url` finishes. */
  diagnosis: Diagnosis | null
  /** When `diagnosis` was found (ms), 0 when there is none. */
  checkedAt: number
  checking: boolean
}

type Listener = () => void
type Diagnose = (url: string) => Promise<Diagnosis>

const EMPTY: ComfyStatus = { url: "", diagnosis: null, checkedAt: 0, checking: false }

let status: ComfyStatus = EMPTY
let inFlight: { url: string; promise: Promise<Diagnosis> } | null = null
const listeners = new Set<Listener>()

const defaultDiagnose: Diagnose = async (url) => {
  const { diagnose } = await import("./client")
  return diagnose(url, { minBridgeVersion: MIN_BRIDGE_VERSION, timeoutMs: CHECK_TIMEOUT_MS })
}
let runDiagnose: Diagnose = defaultDiagnose
let now: () => number = () => Date.now()

function set(next: ComfyStatus) {
  status = next
  for (const l of Array.from(listeners)) l()
}

export function subscribeComfyStatus(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getComfyStatus(): ComfyStatus {
  return status
}

/**
 * Checks `url` unless a result younger than `maxAgeMs` is already there.
 * Resolves with the result in use.
 */
export function checkComfyStatus(url: string, maxAgeMs: number = STATUS_MAX_AGE_MS): Promise<Diagnosis> {
  if (inFlight && inFlight.url === url) return inFlight.promise
  if (status.url === url && status.diagnosis && now() - status.checkedAt < maxAgeMs) {
    return Promise.resolve(status.diagnosis)
  }
  const keep = status.url === url ? status : { ...EMPTY, url }
  set({ ...keep, checking: true })
  const promise = runDiagnose(url)
    .catch((): Diagnosis => ({ state: "unreachable" }))
    .then((diagnosis) => {
      // A newer check (another address) owns the store now.
      if (inFlight?.promise === promise) {
        inFlight = null
        set({ url, diagnosis, checkedAt: now(), checking: false })
      }
      return diagnosis
    })
  inFlight = { url, promise }
  return promise
}

/** Checks now, whatever the age of the last result. */
export function refreshComfyStatus(url: string): Promise<Diagnosis> {
  return checkComfyStatus(url, 0)
}

/** Stores a result found elsewhere (a failed Send runs its own check). */
export function reportComfyStatus(url: string, diagnosis: Diagnosis): void {
  if (inFlight && inFlight.url === url) inFlight = null
  set({ url, diagnosis, checkedAt: now(), checking: false })
}

/** For tests: swaps the check and the clock, and empties the store. */
export function resetComfyStatusForTests(options: { diagnose?: Diagnose; now?: () => number } = {}): void {
  runDiagnose = options.diagnose ?? defaultDiagnose
  now = options.now ?? (() => Date.now())
  inFlight = null
  status = EMPTY
}

const getServerStatus = () => EMPTY

/**
 * The shared status for `url`. While `active`, it checks on mount and when the
 * tab becomes visible again, both subject to `STATUS_MAX_AGE_MS`.
 */
export function useComfyStatus(url: string, active: boolean) {
  const current = useSyncExternalStore(subscribeComfyStatus, getComfyStatus, getServerStatus)

  useEffect(() => {
    if (!active) return
    void checkComfyStatus(url)
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkComfyStatus(url)
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [active, url])

  const refresh = useCallback(() => refreshComfyStatus(url), [url])
  const mine = current.url === url
  return {
    diagnosis: mine ? current.diagnosis : null,
    checking: mine ? current.checking : active,
    refresh,
  }
}

// --- Copy ---------------------------------------------------------------------

export type StatusTone = "ok" | "problem" | "checking"

/** One short line for the row and the chip: what is wrong, and what to do when it fits. */
export function shortStatusLine(d: Diagnosis | null): { tone: StatusTone; text: string } {
  if (!d) return { tone: "checking", text: "Checking ComfyUI…" }
  switch (d.state) {
    case "ok":
      return { tone: "ok", text: "Connected" }
    case "unsupported-browser":
      return { tone: "problem", text: "This browser can't reach ComfyUI" }
    case "invalid-url":
      return { tone: "problem", text: "The ComfyUI address isn't a local one" }
    case "local-network-denied":
      return { tone: "problem", text: "The browser blocks your local network" }
    case "unreachable":
      return { tone: "problem", text: "ComfyUI isn't answering. Check that it's running" }
    case "bridge-missing":
      return { tone: "problem", text: `ComfyUI blocks this site. Install ${BRIDGE_MANAGER_NAME} from ComfyUI Manager` }
    case "bridge-outdated":
    case "bridge-inactive":
      return { tone: "problem", text: `${BRIDGE_NAME} needs an update` }
  }
}

/** One line per connection state, with what to do about it. */
export function statusCopy(d: Diagnosis): { tone: "ok" | "problem"; text: string } {
  switch (d.state) {
    case "ok":
      return { tone: "ok", text: d.comfyVersion ? `Connected to ComfyUI ${d.comfyVersion}.` : "Connected to ComfyUI." }
    case "unsupported-browser":
      return { tone: "problem", text: "This browser can't reach ComfyUI on your computer. Use Chrome, Edge or Firefox on a desktop." }
    case "invalid-url":
      return { tone: "problem", text: "Use a local address, like http://127.0.0.1:8188." }
    case "local-network-denied":
      return {
        tone: "problem",
        text: "Your browser blocks this site from your local network. Click the icon left of the address bar, allow local network access, then reload the page.",
      }
    case "unreachable":
      return {
        tone: "problem",
        text: d.localNetworkPrompt
          ? "ComfyUI isn't answering. Check that it's running and the address is right. If the browser asks to connect to devices on your local network, choose Allow."
          : "ComfyUI isn't answering. Check that it's running and the address is right.",
      }
    case "bridge-missing":
      return { tone: "problem", text: `ComfyUI is running but blocks this site. ${BRIDGE_INSTALL_STEP}` }
    case "bridge-outdated":
      return { tone: "problem", text: `${BRIDGE_NAME} is out of date (${d.version}). Update it and restart ComfyUI.` }
    case "bridge-inactive":
      return {
        tone: "problem",
        text: `${BRIDGE_NAME} doesn't work with this ComfyUI version. Update it and restart ComfyUI.`,
      }
  }
}
