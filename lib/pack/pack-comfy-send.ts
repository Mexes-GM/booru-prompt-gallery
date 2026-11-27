/**
 * Send to ComfyUI from a pack: what one prompt sends, and Send all, which
 * queues the prompts one after another. The sending itself is sendToComfy
 * (components/prompt-gallery/comfyui-send.tsx), the same as on a card.
 */
import type { PackPrompt } from './pack-generator'

/** What sendToComfy gets for one pack prompt. */
export interface PackSendRequest {
  /** The prompt as Copy copies it, in the pack's format. */
  prompt: string
  /** The prompt's suggested size: used when the ComfyUI option to match the size is on. */
  sourceWidth?: number
  sourceHeight?: number
}

/**
 * One pack prompt as ComfyUI gets it. `body` is the prompt in the chosen format, the
 * text Copy copies. The "[WIDTHxHEIGHT] " prefix the copy can add is a line format
 * for the extension's Import List, so it never goes into the prompt: the suggested
 * size goes as the image size instead, as a card's post size does.
 */
export function packSendRequest(p: Pick<PackPrompt, 'width' | 'height'>, body: string): PackSendRequest {
  return p.width && p.height ? { prompt: body, sourceWidth: p.width, sourceHeight: p.height } : { prompt: body }
}

export interface SendAllProgress {
  /** Prompts handed to ComfyUI so far. */
  done: number
  total: number
}

export interface SendAllResult {
  sent: number
  total: number
}

/** Send all's state: sending (how many have gone), or how the last one ended. */
export type SendAllState =
  | { kind: 'idle' }
  | ({ kind: 'sending' } & SendAllProgress)
  | ({ kind: 'ended' } & SendAllResult)

/**
 * Sends `items` in order, one at a time, each after the one before has been
 * queued. Stops at the first that doesn't go (ComfyUI can't be reached, or the
 * workflow isn't ready and the panel opened): the rest would fail the same way,
 * each with its own message. Also stops when `stopped()` turns true (the list
 * went away).
 */
export async function sendInOrder<T>(
  items: readonly T[],
  send: (item: T, index: number) => Promise<boolean>,
  onProgress?: (progress: SendAllProgress) => void,
  stopped?: () => boolean
): Promise<SendAllResult> {
  const total = items.length
  let sent = 0
  onProgress?.({ done: 0, total })
  for (let i = 0; i < total; i++) {
    if (stopped?.()) break
    let ok = false
    try {
      ok = await send(items[i], i)
    } catch {
      ok = false
    }
    if (!ok) break
    sent++
    onProgress?.({ done: sent, total })
  }
  return { sent, total }
}
