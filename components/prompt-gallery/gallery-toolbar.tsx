"use client"

import { startTransition, useId, useOptimistic } from "react"
import { usePostHog } from "posthog-js/react"
import { motion, useReducedMotion } from "framer-motion"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, GraduationCap, Heart, History, Sparkles, Wrench } from "lucide-react"
import { SEGMENT_PILL_SPRING } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { CardScaleControl } from "@/components/prompt-gallery/card-scale-control"

type Mode = "browse" | "merge" | "pack"

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "browse", label: "Browse", hint: "Copy prompts one by one" },
  { id: "merge", label: "Merge", hint: "Combine tags from several posts" },
  { id: "pack", label: "Pack", hint: "Build a batch of prompts to export" },
]

interface GalleryToolbarProps {
  showFavorites: boolean
  toggleFavorites: () => void
  favoritesCount: number
  showHistory: boolean
  toggleHistory: () => void
  historyCount?: number
  isMergeMode: boolean
  enableMergeMode: () => void
  disableMergeMode: () => void
  isPackMode: boolean
  enablePackMode: () => void
  disablePackMode: () => void
  onOpenReverseParser: () => void
  onOpenQuickTeach: () => void
  scaleValue: number[]
  setScaleValue: (value: number[]) => void
}

/**
 * Mode bar under the search row. Merge and Pack are mutually exclusive ways
 * of working with the results, so they're one segmented "Mode" choice (with a
 * one-line explanation of the active one) instead of loose colored buttons.
 * Favorites/History are views of the results; Import and Quick Teach are
 * occasional tools, tucked into a menu. (Variations lives inside the Merge
 * sticky footer.)
 */
export function GalleryToolbar({
  showFavorites,
  toggleFavorites,
  favoritesCount,
  showHistory,
  toggleHistory,
  historyCount,
  isMergeMode,
  enableMergeMode,
  disableMergeMode,
  isPackMode,
  enablePackMode,
  disablePackMode,
  onOpenReverseParser,
  onOpenQuickTeach,
  scaleValue,
  setScaleValue,
}: GalleryToolbarProps) {
  const posthog = usePostHog()
  const pillId = useId()
  const reduceMotion = useReducedMotion()

  const committedMode: Mode = isMergeMode ? "merge" : isPackMode ? "pack" : "browse"
  // Entering Merge/Pack re-renders most of the page (sticky footers, cards);
  // the optimistic value moves the pill right away and the real switch runs
  // as a transition, so React yields frames and the pill's spring isn't frozen.
  const [mode, setOptimisticMode] = useOptimistic(committedMode)
  const activeMode = MODES.find((m) => m.id === mode)!

  const selectMode = (next: Mode) => {
    if (next === mode) return
    const prev = committedMode
    startTransition(() => {
      setOptimisticMode(next)
      if (next === "browse") {
        if (isMergeMode) disableMergeMode()
        if (isPackMode) disablePackMode()
      } else if (next === "merge") {
        enableMergeMode()
      } else {
        enablePackMode()
      }
    })
    if (prev === "merge" || next === "merge") {
      posthog.capture('merge_mode_toggled', { action: next === "merge" ? 'enable' : 'disable' })
    }
    if (prev === "pack" || next === "pack") {
      posthog.capture('pack_mode_toggled', { action: next === "pack" ? 'enable' : 'disable' })
    }
  }

  const handleModeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const index = MODES.findIndex((m) => m.id === mode)
    const nextIndex = (index + delta + MODES.length) % MODES.length
    selectMode(MODES[nextIndex].id)
    e.currentTarget.querySelectorAll<HTMLButtonElement>("[role='radio']")[nextIndex]?.focus()
  }

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3" data-tour="modes">
        <span className="hidden text-sm font-medium text-muted-foreground sm:inline">Mode</span>
        <div
          role="radiogroup"
          aria-label="Mode"
          onKeyDown={handleModeKeyDown}
          className="grid h-11 grid-cols-3 gap-0.5 rounded-lg border border-input bg-muted/50 p-[3px] sm:h-10 sm:w-[264px]"
        >
          {MODES.map((m) => {
            const active = m.id === mode
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => selectMode(m.id)}
                className={cn(
                  "relative rounded-md text-sm font-medium transition-[color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {active && (
                  <motion.span
                    layoutId={`${pillId}-mode-pill`}
                    aria-hidden="true"
                    className="absolute inset-0 rounded-md bg-background shadow-sm"
                    transition={reduceMotion ? { duration: 0 } : SEGMENT_PILL_SPRING}
                  />
                )}
                <span className="relative">{m.label}</span>
              </button>
            )
          })}
        </div>
        <span className="text-center text-xs text-muted-foreground sm:text-left">{activeMode.hint}</span>
      </div>

      <div className="grid grid-cols-3 items-center gap-1 sm:flex">
        <Button
          type="button"
          variant="ghost"
          aria-pressed={showFavorites}
          onClick={() => {
            toggleFavorites()
            posthog.capture('favorites_panel_toggled', { action: showFavorites ? 'close' : 'open' })
          }}
          className={cn("h-11 gap-2 px-2 sm:h-10 sm:px-3", showFavorites && "bg-primary/10 text-primary-text hover:bg-primary/15 hover:text-primary-text")}
        >
          <Heart className={cn("h-4 w-4", showFavorites && "fill-current")} />
          Favorites
          <span className="text-xs text-muted-foreground tabular-nums">{favoritesCount}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-pressed={showHistory}
          onClick={() => {
            toggleHistory()
            posthog.capture('history_panel_toggled', { action: showHistory ? 'close' : 'open' })
          }}
          className={cn("h-11 gap-2 px-2 sm:h-10 sm:px-3", showHistory && "bg-primary/10 text-primary-text hover:bg-primary/15 hover:text-primary-text")}
        >
          <History className="h-4 w-4" />
          History
          {!!historyCount && <span className="text-xs text-muted-foreground tabular-nums">{historyCount}</span>}
        </Button>

        <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="h-11 gap-2 px-3 sm:h-10">
              <Wrench className="h-4 w-4" />
              Tools
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onSelect={onOpenReverseParser} className="cursor-pointer items-start gap-3 py-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">Import &amp; clean</span>
                <span className="text-xs text-muted-foreground">Paste a prompt or read one from an image</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onOpenQuickTeach()
                posthog.capture('quick_teach_opened')
              }}
              className="cursor-pointer items-start gap-3 py-2"
            >
              <GraduationCap className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">Quick Teach</span>
                <span className="text-xs text-muted-foreground">Help classify tags for better prompts</span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Mobile picks card size from the corner "⋯" menu (SiteCornerMenu). */}
        <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <CardScaleControl scaleValue={scaleValue} setScaleValue={setScaleValue} className="hidden sm:flex" />
      </div>
    </div>
  )
}
