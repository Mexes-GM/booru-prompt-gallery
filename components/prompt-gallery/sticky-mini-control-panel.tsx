"use client"

import React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useLowMotion } from "@/hooks/use-low-motion"
import { DebouncedInput } from "@/components/ui/debounced-input"
import { Button } from "@/components/ui/button"
import { FileCheck2, Sparkles, X } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Sticky quick-access bar shown once the main "Advanced Filters & Options"
 * panel scrolls out of view: a 3-action shortcut (edit "Tags to Add", jump
 * into Merge, jump into AI Convert). Settings stay in tags-management-panel.tsx
 * and prompt-generation-options-panel.tsx; this is not a second settings
 * surface.
 */
interface StickyMiniControlPanelProps {
  isVisible: boolean;
  addInput: string;
  setAddInput: (val: string) => void;
  isMergeMode: boolean;
  isAiConvertMode: boolean;
  onToggleMergeMode: () => void;
  onToggleAiConvertMode: () => void;
}

export function StickyMiniControlPanel({
  isVisible,
  addInput,
  setAddInput,
  isMergeMode,
  isAiConvertMode,
  onToggleMergeMode,
  onToggleAiConvertMode
}: StickyMiniControlPanelProps) {
  const lowMotion = useLowMotion();

  // Count how many tags are in the input
  const tagCount = addInput.trim()
    ? addInput.split(",").filter(t => t.trim()).length
    : 0;

  // ── spring config (respects reduced motion) ──────────────────────────
  const springTransition = lowMotion
    ? { duration: 0.15 }
    : { type: "spring" as const, stiffness: 200, damping: 25, mass: 0.8 };

  // Full transform strings (not the x/y/scale shorthands) so the slide runs
  // off the main thread while the masonry grid scrolls underneath. Hidden =
  // slightly more than its own height, so it tucks under the viewport edge
  // (both strings share one shape so Motion can interpolate them).
  const hiddenAnim = lowMotion
    ? { opacity: 0 }
    : { opacity: 0, transform: "translateY(-130%) scale(0.95)" };

  const shownAnim = lowMotion
    ? { opacity: 1 }
    : { opacity: 1, transform: "translateY(0%) scale(1)" };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="sticky-mini-panel"
          initial={hiddenAnim}
          animate={shownAnim}
          exit={hiddenAnim}
          transition={springTransition}
          className={`fixed top-6 left-0 right-0 mx-auto z-40 w-[95%] max-w-4xl border shadow-2xl rounded-2xl overflow-hidden ring-1 ring-foreground/5 ${lowMotion ? "bg-background/95" : "bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/85"}`}
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          {/* Border Glow Effect (static: this bar stays on screen while
              scrolling, a breathing loop here is noise) */}
          <div className="absolute inset-0 z-[-1] overflow-hidden rounded-2xl pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-[1px] bg-gradient-to-r from-transparent via-foreground/20 to-transparent opacity-50" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--primary)_14%,transparent)_0%,transparent_65%)] opacity-80" />
          </div>

          <div className="p-2 sm:p-3 flex flex-wrap sm:flex-nowrap items-end gap-2 sm:gap-4 relative z-10">
            {/* Tags to Add */}
            <div className="flex-1 min-w-[200px] max-w-[450px] flex flex-col gap-1">
              <label htmlFor="sticky-add-tags-input" className="text-xs font-medium leading-none flex items-center gap-2 text-foreground">
                <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" aria-hidden="true" />
                Tags to Add
                {tagCount > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    ({tagCount} tag{tagCount !== 1 ? "s" : ""})
                  </span>
                )}
                <span className="text-[10px] font-normal text-muted-foreground/70 hidden sm:inline">
                  (Only modify final prompt)
                </span>
              </label>
              <div className="flex h-8 w-full items-center rounded-md border border-input bg-background/50 pl-2 pr-1 text-sm shadow-sm transition-colors focus-within:outline-none focus-within:ring-1 focus-within:ring-ring">
                <DebouncedInput
                  id="sticky-add-tags-input"
                  value={addInput}
                  onChange={setAddInput}
                  placeholder="e.g. 1girl, solo..."
                  className="flex-1 h-full bg-transparent border-none p-0 shadow-none focus-visible:ring-0 text-base sm:text-xs w-full min-w-0"
                  debounceTime={400}
                />
                {addInput && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 hover:bg-muted"
                        onClick={() => setAddInput("")}
                        aria-label="Clear tags"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Clear</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            <div className="w-px h-6 bg-border mx-1 hidden sm:block" aria-hidden="true" />

            {/* Action Buttons */}
            <div className="flex items-center gap-2 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    onClick={onToggleAiConvertMode}
                    variant="secondary"
                    className={`h-8 px-2.5 gap-1.5 transition-colors ${isAiConvertMode
                      ? "bg-mode-convert/25 text-mode-convert-text ring-1 ring-inset ring-mode-convert-border hover:bg-mode-convert/30"
                      : "bg-mode-convert-soft text-mode-convert-text hover:bg-mode-convert/20"
                      }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 fill-current" />
                    <span className="text-xs font-medium hidden sm:inline">Convert</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="sm:hidden">AI Convert</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    onClick={onToggleMergeMode}
                    variant="secondary"
                    className={`h-8 px-2.5 gap-1.5 transition-colors ${isMergeMode
                      ? "bg-mode-merge/25 text-mode-merge-text ring-1 ring-inset ring-mode-merge-border hover:bg-mode-merge/30"
                      : "bg-mode-merge-soft text-mode-merge-text hover:bg-mode-merge/20"
                      }`}
                  >
                    <FileCheck2 className="w-3.5 h-3.5 fill-current" />
                    <span className="text-xs font-medium hidden sm:inline">Merge</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="sm:hidden">Merge Prompts</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
