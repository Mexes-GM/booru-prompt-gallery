"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { UserNav } from "@/components/auth/user-nav"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Activity, HelpCircle, Info, MessageSquarePlus, MoreHorizontal, Shield } from "lucide-react"
import { CARD_SCALE_STEPS } from "@/components/prompt-gallery/card-scale-control"

const FeedbackDialog = dynamic(() => import("@/components/feedback-dialog").then(m => m.FeedbackDialog), { ssr: false, loading: () => null })

interface SiteCornerMenuProps {
  scaleValue: number[]
  setScaleValue: (value: number[]) => void
  onOpenTour: () => void
}

/**
 * Replaces the old top site header. Floats in the top-right corner of the
 * page (it scrolls away with the hero, same as the header did): the account
 * button plus one "⋯" menu for everything used rarely — theme, tour replay,
 * feedback and the info/legal links. Branding moved into the hero and update
 * notes into the panel's "Update Notes" tab; card size lives in the mode bar
 * (desktop) and in this menu on mobile.
 *
 * The legal links stay here rather than only in the footer because infinite
 * scroll means almost nobody reaches the footer.
 */
export function SiteCornerMenu({ scaleValue, setScaleValue, onOpenTour }: SiteCornerMenuProps) {
  const { theme, setTheme } = useTheme()
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  return (
    <div className="absolute right-4 top-3 z-30 flex items-center gap-1 sm:right-6 sm:top-4">
      <UserNav />

      <DropdownMenu>
        {/* No Tooltip wrapper: nesting TooltipTrigger asChild + DropdownMenuTrigger
            asChild on one <button> triggers a Radix ref loop (React #185, see
            SENTRY-FULVOUS-ANCHOR-7). The aria-label names the button. */}
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="focus-ring" aria-label="Settings and information" data-tour="help">
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
            <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>

          {/* Desktop has the segmented control in the mode bar. */}
          <div className="sm:hidden">
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Card size</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={String(scaleValue[0])} onValueChange={(v) => setScaleValue([Number(v)])}>
              {CARD_SCALE_STEPS.map((step) => (
                <DropdownMenuRadioItem key={step.value} value={String(step.value)}>{step.label}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </div>

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenTour} className="cursor-pointer">
            <HelpCircle className="mr-2 h-4 w-4" />
            <span>Replay tour</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setFeedbackOpen(true)} className="cursor-pointer">
            <MessageSquarePlus className="mr-2 h-4 w-4" />
            <span>Send feedback</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Information</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <a href="/about" className="cursor-pointer">
              <Info className="mr-2 h-4 w-4" />
              <span>About Project</span>
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="/privacy" className="cursor-pointer">
              <Shield className="mr-2 h-4 w-4" />
              <span>Privacy Policy</span>
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="/terms" className="cursor-pointer">
              <Shield className="mr-2 h-4 w-4" />
              <span>Terms of Service</span>
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="https://stats.uptimerobot.com/YcL3JPgshk" target="_blank" rel="noopener noreferrer" className="cursor-pointer">
              <Activity className="mr-2 h-4 w-4" />
              <span>Service Status</span>
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Always mounted: toastError() "Report" buttons open it pre-filled. */}
      <FeedbackDialog triggerVariant="none" open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  )
}
