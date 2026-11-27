/**
 * Everything the site says about the ComfyUI bridge node, in one place, so the
 * install steps and link can change once it is published.
 */

/** Oldest bridge version the site works with. */
export const MIN_BRIDGE_VERSION = "0.1.0"

export const BRIDGE_NAME = "Booru Prompt Gallery Bridge"

/** Where to read about installing the bridge. Null hides the link until there is one. */
export const BRIDGE_INSTALL_URL: string | null = null

/** One line, shown when ComfyUI answers but blocks the site. */
export const BRIDGE_INSTALL_STEP = `Install the ${BRIDGE_NAME} node in ComfyUI and restart ComfyUI.`

/** Where the publish command lives in ComfyUI: a top-bar button next to Run, and the File menu. */
export const BRIDGE_PUBLISH_STEP =
  "In ComfyUI, click Use in Booru Prompt Gallery in the top bar, next to Run, or find it in the File menu."
