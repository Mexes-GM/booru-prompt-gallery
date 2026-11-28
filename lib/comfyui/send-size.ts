/**
 * Which image size a Send to ComfyUI writes into the workflow, if any.
 * Pure, so the choice can be tested without the ComfyUI client.
 */
import { computeGenerationResolution } from "@/lib/extension/generation-resolution"

export interface SendSizeRequest {
  /** The post's image size: run through the "Match the post's aspect ratio" computation. */
  sourceWidth?: number
  sourceHeight?: number
  /** A size that is already final (Pack's row size): sent as it is, never recomputed. */
  exactWidth?: number
  exactHeight?: number
}

export interface SendSizePrefs {
  maxLongSide: number
  strictCap: boolean
  snapToBucket: boolean
}

/**
 * The size to send, or `{}` when none: the option to match the size is off, or the
 * workflow has no width and height roles, and the workflow keeps its own size.
 * An exact size replaces only the computation, never that gating.
 */
export function chooseSendSize(
  req: SendSizeRequest,
  matchPostResolution: boolean,
  roles: { width?: unknown; height?: unknown },
  prefs: SendSizePrefs,
): { width?: number; height?: number } {
  if (!matchPostResolution || !roles.width || !roles.height) return {}
  if (req.exactWidth && req.exactHeight) return { width: req.exactWidth, height: req.exactHeight }
  return computeGenerationResolution(req.sourceWidth, req.sourceHeight, prefs) ?? {}
}
