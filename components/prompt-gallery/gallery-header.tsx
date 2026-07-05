"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { UserNav } from "@/components/auth/user-nav"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sparkles,
  ScrollText,
  ZoomOut,
  ZoomIn,
  List,
  Grid3X3,
  AlertTriangle,
  Shield,
  Activity,
} from "lucide-react"
import { SOCIAL_URLS } from "@/lib/constants"
import { trackViewMode } from "@/lib/analytics"

interface GalleryHeaderProps {
  viewMode: "grid" | "list"
  setViewMode: (mode: "grid" | "list") => void
  scaleValue: number[]
  setScaleValue: (value: number[]) => void
  decreaseScale: () => void
  increaseScale: () => void
  setShowWelcomeModal: (open: boolean) => void
}

/**
 * Top site header: logo/branding, "What's New"/Changelog links, the card-scale
 * slider + grid/list toggle (desktop), theme toggle, user nav, and the "More"
 * dropdown that mirrors those actions for mobile plus static info links.
 */
export function GalleryHeader({
  viewMode,
  setViewMode,
  scaleValue,
  setScaleValue,
  decreaseScale,
  increaseScale,
  setShowWelcomeModal,
}: GalleryHeaderProps) {
  return (
    <header className="w-full border-b glass-effect">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 sm:space-x-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <h1 className="text-lg sm:text-2xl font-bold text-foreground leading-tight sm:leading-normal">
                Booru<span className="hidden sm:inline"> </span><br className="sm:hidden" />Prompt Gallery
              </h1>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-0.5 sm:gap-3">
                <Badge variant="secondary" className="text-[10px] sm:text-xs font-medium bg-muted text-muted-foreground border-0 px-1.5 py-0 sm:px-2 sm:py-1 h-fit">
                  By Mexes
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowWelcomeModal(true)}
                  className="hidden sm:flex text-xs h-7 px-2 gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Sparkles className="h-3 w-3 text-amber-500" />
                  What&apos;s New
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="hidden sm:flex text-xs h-7 px-2 gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <a href={SOCIAL_URLS.CIVITAI_ARTICLE} target="_blank" rel="noopener noreferrer">
                    <ScrollText className="h-3 w-3 text-blue-500" />
                    Changelog
                  </a>
                </Button>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-1 sm:space-x-2">
            {viewMode === "grid" && (
              <div className="hidden sm:flex items-center space-x-2 border-r pr-2 mr-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={decreaseScale}
                      disabled={scaleValue[0] === 1}
                      className="focus-ring h-8 w-8"
                      aria-label="Decrease card size"
                    >
                      <ZoomOut className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Decrease card size</TooltipContent>
                </Tooltip>

                <div className="w-16 px-1">
                  <Slider
                    value={scaleValue}
                    onValueChange={setScaleValue}
                    max={3}
                    min={1}
                    step={1}
                    className="w-full"
                    aria-label="Card scale"
                  />
                </div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={increaseScale}
                      disabled={scaleValue[0] === 3}
                      className="focus-ring h-8 w-8"
                      aria-label="Increase card size"
                    >
                      <ZoomIn className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Increase card size</TooltipContent>
                </Tooltip>
              </div>
            )}

            <span className="hidden md:inline-flex">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const next = viewMode === 'grid' ? 'list' : 'grid'
                      setViewMode(next)
                      trackViewMode(next)
                    }}
                    className="focus-ring"
                    aria-label={`Switch to ${viewMode === "grid" ? "list" : "grid"} view`}
                  >
                    {viewMode === "grid" ? <List className="h-4 w-4" /> : <Grid3X3 className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Switch to {viewMode === "grid" ? "list" : "grid"} view</TooltipContent>
              </Tooltip>
            </span>

            <span className="hidden md:inline-flex">
              <ThemeToggle />
            </span>

            <UserNav />

            <DropdownMenu>
              {/* No Tooltip wrapper here: nesting TooltipTrigger asChild + DropdownMenuTrigger asChild
                  composes 3 refs onto one <button>, which triggers a setState-on-ref-detach loop in
                  Radix (React error #185 "Maximum update depth exceeded"). See SENTRY-FULVOUS-ANCHOR-7.
                  The button's visible "More" label + aria-label already convey the action. */}
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="focus-ring gap-1.5 px-2" aria-label="More options and information">
                  <AlertTriangle className="h-4 w-4 rotate-180" />
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="glass-effect">
                {/* Merged from the former mobile "More" button to free up header space (mobile only) */}
                <DropdownMenuItem onClick={() => setShowWelcomeModal(true)} className="sm:hidden">
                  <Sparkles className="mr-2 h-4 w-4 text-amber-500" />
                  <span>What&apos;s New</span>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="sm:hidden">
                  <a href={SOCIAL_URLS.CIVITAI_ARTICLE} target="_blank" rel="noopener noreferrer">
                    <ScrollText className="mr-2 h-4 w-4 text-blue-500" />
                    <span>Changelog</span>
                  </a>
                </DropdownMenuItem>
                {viewMode === "grid" && (
                  <>
                    <DropdownMenuSeparator className="sm:hidden" />
                    <DropdownMenuLabel className="sm:hidden">Card Size</DropdownMenuLabel>
                    <DropdownMenuItem onClick={decreaseScale} disabled={scaleValue[0] === 1} className="sm:hidden">
                      <ZoomOut className="mr-2 h-4 w-4" />
                      <span>Smaller</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={increaseScale} disabled={scaleValue[0] === 3} className="sm:hidden">
                      <ZoomIn className="mr-2 h-4 w-4" />
                      <span>Larger</span>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator className="sm:hidden" />
                <DropdownMenuLabel>Information</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href="/about" className="cursor-pointer w-full flex items-center">
                    <Sparkles className="mr-2 h-4 w-4" />
                    <span>About Project</span>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href="/privacy" className="cursor-pointer w-full flex items-center">
                    <Shield className="mr-2 h-4 w-4" />
                    <span>Privacy Policy</span>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href="/terms" className="cursor-pointer w-full flex items-center">
                    <Shield className="mr-2 h-4 w-4" />
                    <span>Terms of Service</span>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a
                    href="https://stats.uptimerobot.com/YcL3JPgshk"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cursor-pointer w-full flex items-center"
                  >
                    <Activity className="mr-2 h-4 w-4" />
                    <span>Service Status</span>
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  )
}
