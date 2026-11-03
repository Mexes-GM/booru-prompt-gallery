/** Loaders for the dialogs GalleryModals renders, shared with the menus that open them. */
export const loadQuickTeachModal = () => import("@/components/quick-teach-modal")
export const loadReversePromptParserModal = () => import("@/components/prompt-gallery/reverse-prompt-parser-modal")
export const loadGlobalWeightsModal = () => import("@/components/prompt-gallery/global-weights-modal")

/** Fetches the Tools menu's dialogs (Import & clean, Quick Teach) while the menu is open. */
export function preloadToolDialogs() {
  void loadReversePromptParserModal()
  void loadQuickTeachModal()
}
