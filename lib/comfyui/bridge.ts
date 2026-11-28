/**
 * Everything the site says about the Booru Prompt Gallery for ComfyUI add-on, in one place, so the
 * install steps and link can change once it is published.
 */

/** Oldest add-on version the site works with. */
export const MIN_BRIDGE_VERSION = "0.1.0"

export const BRIDGE_NAME = "Booru Prompt Gallery for ComfyUI"

/** The name ComfyUI Manager lists the add-on under, for people searching there. */
export const BRIDGE_MANAGER_NAME = "Booru Prompt Gallery"

/** Where to read about installing the add-on. Null hides the link until there is one. */
export const BRIDGE_INSTALL_URL: string | null = "https://github.com/Mexes-GM/comfyui-booru-prompt-gallery#install"

/** One line, shown when ComfyUI answers but blocks the site. */
export const BRIDGE_INSTALL_STEP = `Install ${BRIDGE_MANAGER_NAME} from ComfyUI Manager, then restart ComfyUI.`

/** Where the publish command lives in ComfyUI: a top-bar button next to Run, and the File menu. */
export const BRIDGE_PUBLISH_STEP =
  "In ComfyUI, click Use in Booru Prompt Gallery in the top bar, next to Run, or find it in the File menu."

/** The add-on's id in the ComfyUI registry (comfy-cli and Manager). */
export const BRIDGE_REGISTRY_ID = "comfyui-booru-prompt-gallery"

/** Install with comfy-cli. */
export const BRIDGE_CLI_COMMAND = `comfy node install ${BRIDGE_REGISTRY_ID}`

/** Install by hand, inside ComfyUI/custom_nodes. */
export const BRIDGE_GIT_COMMAND = "git clone https://github.com/Mexes-GM/comfyui-booru-prompt-gallery"

/** What ComfyUI's console prints once the add-on loaded. */
export const BRIDGE_CONSOLE_LINE = "Booru Prompt Gallery bridge installed"

/** The publish command's label in ComfyUI. */
export const BRIDGE_PUBLISH_LABEL = "Use in Booru Prompt Gallery"

/** Shown where people add a workflow from ComfyUI: nothing is uploaded, the site reads it through the add-on. */
export const BRIDGE_LOCAL_NOTE = "Your workflow stays on your computer. The site reads it from ComfyUI."
