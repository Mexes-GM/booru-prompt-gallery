/**
 * Folder-tab look shared by everything docked on the search panel's top edge
 * (Update Notes, Support, GitHub, Mirror). The tabs should read as tucked
 * *behind* the card: they end exactly at its top edge (so the card's border
 * runs unbroken in front of them), use a slightly recessed fill, and a soft
 * inner shadow at the bottom suggests them sliding under the card.
 */
export const PANEL_TAB_CLASS =
  "group relative inline-flex h-7 items-center gap-1.5 rounded-t-lg border border-b-0 border-border/50 bg-muted/60 shadow-[inset_0_-6px_6px_-6px_rgb(0_0_0/0.18)] px-2.5 sm:px-3 text-xs font-medium text-muted-foreground transition-colors pointer-coarse:after:absolute sm:pointer-coarse:after:inset-x-0 max-sm:pointer-coarse:after:-inset-x-[5px] pointer-coarse:after:bottom-0 pointer-coarse:after:-top-[17px] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
