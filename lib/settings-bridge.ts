/**
 * Cross-context settings sync via BroadcastChannel.
 *
 * BroadcastChannel is the browser-native API for same-origin messaging
 * between tabs, iframes, and web workers. More reliable than the 'storage'
 * event (which can be suppressed in extension iframes).
 *
 * Used by both the main web app and the extension iframe to keep
 * preferences in sync in real time.
 */
const CHANNEL_NAME = "booru-settings-sync"

let _channel: BroadcastChannel | null = null
let _listeners: Array<(event: MessageEvent) => void> = []

function getChannel(): BroadcastChannel {
  if (typeof window === "undefined") {
    // SSR guard — return a no-op proxy
    return new Proxy({} as BroadcastChannel, {
      get: () => () => {},
    })
  }
  if (!_channel) {
    _channel = new BroadcastChannel(CHANNEL_NAME)
    _channel.onmessage = (event: MessageEvent) => {
      for (const fn of _listeners) {
        try {
          fn(event)
        } catch {
          // swallow listener errors
        }
      }
    }
  }
  return _channel
}

export type SyncMessage = {
  type: "SETTING_CHANGED"
  key: string
  /** JSON-stringified value (so we can pass primitives and objects uniformly) */
  valueJson: string
}

/**
 * Broadcast a setting change to all same-origin contexts
 * (web app tabs, extension iframes, etc.)
 */
export function broadcastSettingChange(key: string, value: unknown): void {
  try {
    const msg: SyncMessage = {
      type: "SETTING_CHANGED",
      key,
      valueJson: JSON.stringify(value),
    }
    getChannel().postMessage(msg)
  } catch {
    // BroadcastChannel might not be available (e.g., very old browsers)
  }
}

/**
 * Subscribe to settings changes from other contexts.
 * Returns an unsubscribe function.
 */
export function onSettingsChange(
  callback: (key: string, value: unknown) => void
): () => void {
  if (typeof window === "undefined") return () => {}

  const listener = (event: MessageEvent) => {
    const data = event.data
    if (data && typeof data === "object" && data.type === "SETTING_CHANGED") {
      try {
        const value = JSON.parse(data.valueJson)
        callback(data.key, value)
      } catch {
        // malformed message, ignore
      }
    }
  }

  _listeners.push(listener)

  // Ensure channel is initialized
  getChannel()

  return () => {
    _listeners = _listeners.filter((l) => l !== listener)
  }
}
