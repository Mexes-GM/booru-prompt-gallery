import { useSyncExternalStore } from "react"
import {
  DEFAULT_COMFYUI_OPTIONS,
  DEFAULT_COMFYUI_URL,
  STORAGE_EVENT_NAME,
  STORAGE_KEYS,
  getComfyActiveWorkflowId,
  getComfyEnabled,
  getComfyOptions,
  getComfyUrl,
  getComfyWorkflows,
  removeComfyWorkflow,
  saveComfyWorkflow,
  setComfyActiveWorkflow,
  setComfyEnabled,
  setComfyOptions,
  setComfyUrl,
  updateComfyWorkflowRoles,
} from "@/lib/storage"
import { onSettingsChange } from "@/lib/settings-bridge"
import type { ComfyOptions, SavedComfyWorkflow } from "@/lib/comfyui/types"

const COMFY_KEYS: ReadonlySet<string> = new Set([
  STORAGE_KEYS.COMFYUI_ENABLED,
  STORAGE_KEYS.COMFYUI_URL,
  STORAGE_KEYS.COMFYUI_WORKFLOWS,
  STORAGE_KEYS.COMFYUI_ACTIVE_WORKFLOW,
  STORAGE_KEYS.COMFYUI_OPTIONS,
])

/** Same-tab writes, other tabs, and the extension's settings bridge. */
function subscribeComfySettings(onChange: () => void): () => void {
  const onLocal = (e: Event) => {
    if (COMFY_KEYS.has((e as CustomEvent<{ key?: string }>).detail?.key ?? "")) onChange()
  }
  const onOtherTab = (e: StorageEvent) => {
    if (e.key === null || COMFY_KEYS.has(e.key)) onChange()
  }
  window.addEventListener(STORAGE_EVENT_NAME, onLocal)
  window.addEventListener("storage", onOtherTab)
  const offBridge = onSettingsChange((key) => {
    if (COMFY_KEYS.has(key)) onChange()
  })
  return () => {
    window.removeEventListener(STORAGE_EVENT_NAME, onLocal)
    window.removeEventListener("storage", onOtherTab)
    offBridge()
  }
}

export interface ComfyUIState {
  enabled: boolean
  url: string
  workflows: SavedComfyWorkflow[]
  /** The workflow chosen for sending, or null. */
  activeWorkflow: SavedComfyWorkflow | null
  options: ComfyOptions
}

let lastSnapshot: ComfyUIState | null = null

/** Reads everything; returns the previous object while no part has changed. */
function readSnapshot(): ComfyUIState {
  const enabled = getComfyEnabled()
  const url = getComfyUrl()
  const workflows = getComfyWorkflows()
  const activeId = getComfyActiveWorkflowId()
  const activeWorkflow = activeId === null ? null : (workflows.find((w) => w.id === activeId) ?? null)
  const options = getComfyOptions()
  const prev = lastSnapshot
  if (
    prev &&
    prev.enabled === enabled &&
    prev.url === url &&
    prev.workflows === workflows &&
    prev.activeWorkflow === activeWorkflow &&
    prev.options === options
  ) {
    return prev
  }
  lastSnapshot = { enabled, url, workflows, activeWorkflow, options }
  return lastSnapshot
}

const SERVER_STATE: ComfyUIState = {
  enabled: false,
  url: DEFAULT_COMFYUI_URL,
  workflows: [],
  activeWorkflow: null,
  options: DEFAULT_COMFYUI_OPTIONS,
}

/** Current settings for non-React code (reads storage at call time). */
export function getComfyUISettings(): ComfyUIState {
  return typeof window === "undefined" ? SERVER_STATE : readSnapshot()
}

const getServerSnapshot = () => SERVER_STATE

/** Every setter returns false when nothing was stored (invalid input or a full browser storage). */
const actions = {
  setEnabled: setComfyEnabled,
  setUrl: setComfyUrl,
  saveWorkflow: saveComfyWorkflow,
  removeWorkflow: removeComfyWorkflow,
  setActiveWorkflow: setComfyActiveWorkflow,
  updateRoles: updateComfyWorkflowRoles,
  setOptions: setComfyOptions,
}

/** Settings for "Send to ComfyUI", shared by every component and other tabs. */
export function useComfyUISettings(): ComfyUIState & typeof actions {
  const state = useSyncExternalStore(subscribeComfySettings, getComfyUISettings, getServerSnapshot)
  return { ...state, ...actions }
}
