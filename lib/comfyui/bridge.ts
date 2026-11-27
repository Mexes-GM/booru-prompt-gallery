/**
 * Everything the site says about the Booru Prompt Gallery for ComfyUI add-on, in one place, so the
 * install steps and link can change once it is published.
 */

/** Oldest add-on version the site works with. */
export const MIN_BRIDGE_VERSION = "0.1.0"

export const BRIDGE_NAME = "Booru Prompt Gallery for ComfyUI"

/** Where to read about installing the add-on. Null hides the link until there is one. */
export const BRIDGE_INSTALL_URL: string | null = "https://github.com/Mexes-GM/comfyui-booru-prompt-gallery#install"

/** One line, shown when ComfyUI answers but blocks the site. */
export const BRIDGE_INSTALL_STEP = `Install ${BRIDGE_NAME} and restart ComfyUI.`

/** Where the publish command lives in ComfyUI: a top-bar button next to Run, and the File menu. */
export const BRIDGE_PUBLISH_STEP =
  "In ComfyUI, click Use in Booru Prompt Gallery in the top bar, next to Run, or find it in the File menu."
