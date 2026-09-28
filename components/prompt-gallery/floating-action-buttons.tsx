"use client"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ChevronUp, FileCheck2, Sparkles } from "lucide-react"

interface FloatingActionButtonsProps {
  isMergeMode: boolean
  isAiConvertMode: boolean
  showBackToTop: boolean
  toggleAiConvertMode: () => void
  handleToggleMergeMode: () => void
  scrollToTop: () => void
}

/**
 * Bottom-right floating action stack: AI-convert mode toggle, merge mode
 * toggle, and scroll-to-top.
 *
 * The mode toggles are ALWAYS visible/usable regardless of scroll position —
 * they used to share `showBackToTop` (scrollY > 400) with the scroll-to-top
 * button, so entering AI Convert or Merge from the FAB was impossible near
 * the top of the page even though neither mode has anything to do with
 * scroll. Only the scroll-to-top button itself still
 * depends on `showBackToTop`. Vertical position still depends on which mode
 * is active so the stack doesn't overlap the sticky footers those modes show.
 */
export function FloatingActionButtons({
  isMergeMode,
  isAiConvertMode,
  showBackToTop,
  toggleAiConvertMode,
  handleToggleMergeMode,
  scrollToTop,
}: FloatingActionButtonsProps) {
  return (
    <div className={`fixed ${isMergeMode ? 'bottom-[220px] sm:bottom-[200px]' : isAiConvertMode ? 'bottom-[200px] sm:bottom-[180px]' : 'bottom-4 sm:bottom-6'} right-4 sm:right-6 z-50 transition-all duration-500 flex flex-col gap-3`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={toggleAiConvertMode}
            variant={isAiConvertMode ? "default" : "secondary"}
            className={`rounded-full shadow-lg h-10 w-10 p-0 ${isAiConvertMode ? "" : "bg-background/80 backdrop-blur border"}`}
            aria-label={isAiConvertMode ? "Disable AI Mode" : "Enable AI Mode"}
          >
            <Sparkles className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {isAiConvertMode ? "Disable AI Mode" : "Enable AI Mode"}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={handleToggleMergeMode}
            variant={isMergeMode ? "default" : "secondary"}
            className={`rounded-full shadow-lg h-10 w-10 p-0 ${isMergeMode ? "" : "bg-background/80 backdrop-blur border"}`}
            aria-label={isMergeMode ? "Disable Merge Mode" : "Enable Merge Mode"}
          >
            <FileCheck2 className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {isMergeMode ? "Disable Merge Mode" : "Enable Merge Mode"}
        </TooltipContent>
      </Tooltip>

      <Button
        onClick={scrollToTop}
        className={`rounded-full shadow-lg h-10 w-10 p-0 transition-all duration-500 ${showBackToTop ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-75 pointer-events-none hidden'}`}
        variant="secondary"
        aria-label="Scroll to top"
      >
        <ChevronUp className="h-5 w-5" />
      </Button>
    </div>
  )
}
