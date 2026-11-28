/**
 * What setting up Send to ComfyUI takes, step by step, and how far along it is.
 * Shared by the setup guide (one step per screen) and the settings panel's
 * checklist, so both agree on what is done. Plain functions, no React.
 */
import { BRIDGE_MANAGER_NAME } from "./bridge"
import type { Diagnosis, SavedComfyWorkflow } from "./types"

/** The guide's screens, in order. "done" is the closing screen, not a numbered step. */
export const SETUP_STEPS = ["start", "install", "publish", "prompt", "test", "done"] as const
export type SetupStepId = (typeof SETUP_STEPS)[number]

/** The numbered steps the progress indicator counts. */
export const NUMBERED_STEPS: readonly SetupStepId[] = SETUP_STEPS.filter((s) => s !== "done")

// --- Device ---------------------------------------------------------------------

/**
 * WebKit blocks http://localhost from an https page. That covers desktop Safari
 * and every iOS browser (Chrome and Firefox on iOS are WebKit too), so iOS user
 * agents are unsupported whatever their brand.
 */
export function isWebKitOnly(userAgent: string): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|Edg|Firefox/i.test(userAgent)
}

export type DeviceSupport = "ok" | "webkit" | "mobile"

/**
 * Whether this device can reach ComfyUI. Phones and tablets can't: ComfyUI
 * runs on a computer, and the site only talks to this device's own address.
 * iPadOS reports a Mac user agent, so touch points tell it apart.
 */
export function deviceSupport(userAgent: string, maxTouchPoints = 0): DeviceSupport {
  if (/iPhone|iPad|iPod|Android|Mobile/i.test(userAgent)) return "mobile"
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "mobile"
  if (isWebKitOnly(userAgent)) return "webkit"
  return "ok"
}

export function currentDeviceSupport(): DeviceSupport {
  if (typeof navigator === "undefined") return "ok"
  return deviceSupport(navigator.userAgent, navigator.maxTouchPoints ?? 0)
}

// --- Progress ---------------------------------------------------------------------

export interface SetupProgress {
  connected: boolean
  hasWorkflow: boolean
  hasPrompt: boolean
  hasOutput: boolean
  /** A test passed with the workflow as it is now. */
  tested: boolean
}

export function setupProgress(diagnosis: Diagnosis | null, workflow: SavedComfyWorkflow | null): SetupProgress {
  return {
    connected: diagnosis?.state === "ok",
    hasWorkflow: !!workflow,
    hasPrompt: !!workflow?.roles.prompt,
    hasOutput: !!workflow?.roles.output,
    tested: !!workflow?.testedAt,
  }
}

/**
 * Whether opening ComfyUI should show the setup guide instead of the settings:
 * nothing saved yet, or no test has ever passed in this browser.
 */
export function needsSetup(state: { workflows: readonly SavedComfyWorkflow[]; setupDone: boolean }): boolean {
  if (state.workflows.length === 0) return true
  return !state.setupDone && !state.workflows.some((w) => !!w.testedAt)
}

/**
 * Where the guide opens: the first step that isn't done. A first visit, or a
 * device that can't connect, starts at the beginning.
 */
export function resumeStep(input: {
  device: DeviceSupport
  diagnosis: Diagnosis | null
  workflow: SavedComfyWorkflow | null
  /** Saved workflows; none means nobody got past the start yet. */
  savedCount: number
}): SetupStepId {
  if (input.device !== "ok") return "start"
  const p = setupProgress(input.diagnosis, input.workflow)
  if (!p.connected) return input.savedCount === 0 ? "start" : "install"
  if (!p.hasWorkflow) return "publish"
  if (!p.hasPrompt || !p.hasOutput) return "prompt"
  if (!p.tested) return "test"
  return "done"
}

/** Whether Next is available on a step. The start step only stops a device that can't connect. */
export function canContinue(step: SetupStepId, device: DeviceSupport, p: SetupProgress): boolean {
  switch (step) {
    case "start":
      return device === "ok"
    case "install":
      return p.connected
    case "publish":
      return p.connected && p.hasWorkflow
    case "prompt":
      return p.hasPrompt && p.hasOutput
    case "test":
      return p.tested
    case "done":
      return true
  }
}

// --- Install step copy ---------------------------------------------------------------

export interface InstallState {
  tone: "checking" | "waiting" | "blocked" | "ok"
  title: string
  text: string | null
  /** Whether the guide keeps checking on its own in this state. */
  poll: boolean
}

/** What the install step says about the connection, and whether it keeps checking. */
export function installState(d: Diagnosis | null): InstallState {
  if (!d) return { tone: "checking", title: "Looking for ComfyUI…", text: null, poll: true }
  switch (d.state) {
    case "ok":
      return {
        tone: "ok",
        title: "Found it",
        text: d.comfyVersion ? `ComfyUI ${d.comfyVersion} is connected and the node is ready.` : "ComfyUI is connected and the node is ready.",
        poll: false,
      }
    case "unreachable":
      return {
        tone: "waiting",
        title: "ComfyUI isn't answering",
        text: d.localNetworkPrompt
          ? "Start ComfyUI on this computer. If the browser asks to connect to devices on your local network, choose Allow."
          : "Start ComfyUI on this computer. If it's already running, check its address below.",
        poll: true,
      }
    case "bridge-missing":
      return {
        tone: "waiting",
        title: "ComfyUI is running, but the node isn't installed",
        text: d.localNetworkPrompt
          ? "Install it with the steps above, then restart ComfyUI. If the browser asks to connect to devices on your local network, choose Allow."
          : "Install it with the steps above, then restart ComfyUI.",
        poll: true,
      }
    case "bridge-outdated":
      return {
        tone: "waiting",
        title: "The node needs an update",
        text: `You have version ${d.version}. Update ${BRIDGE_MANAGER_NAME} in Manager, then restart ComfyUI.`,
        poll: true,
      }
    case "bridge-inactive":
      return {
        tone: "waiting",
        title: "The node needs an update",
        text: `This version doesn't work with your ComfyUI. Update ${BRIDGE_MANAGER_NAME} in Manager, then restart ComfyUI.`,
        poll: true,
      }
    case "local-network-denied":
      return {
        tone: "blocked",
        title: "The browser blocks your local network",
        text: "Click the icon left of the address bar, allow local network access, then reload this page.",
        poll: true,
      }
    case "invalid-url":
      return {
        tone: "blocked",
        title: "That address isn't on this computer",
        text: "Use localhost or 127.0.0.1 with ComfyUI's port, like http://127.0.0.1:8188.",
        poll: false,
      }
    case "unsupported-browser":
      return {
        tone: "blocked",
        title: "This browser can't reach ComfyUI",
        text: "Use Chrome, Edge or Firefox on a desktop.",
        poll: false,
      }
  }
}

// --- Prompt step ----------------------------------------------------------------------

/**
 * How sure the prompt input is: none chosen, chosen with other text inputs
 * that could also be it, or the only candidate.
 */
export function promptCertainty(workflow: SavedComfyWorkflow, promptCandidates: number): "missing" | "check" | "sure" {
  if (!workflow.roles.prompt) return "missing"
  return promptCandidates > 1 ? "check" : "sure"
}
