"use client"

import { useEffect, useRef, useState } from "react"
import { Coffee } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { safeTrack, trackExternalLink } from "@/lib/analytics"
import { SOCIAL_URLS } from "@/lib/constants"
import { SUPPORT_PROMPT_EVENT, hasSeenSupportModal, markSupportModalSeen } from "@/lib/support-prompt"

/** Delay between the triggering copy and the modal, so the "Copied!" toast lands first. */
const OPEN_DELAY_MS = 1500

/** True while another dialog or the guided tour is on screen — never stack on top of those. */
function isOtherOverlayOpen(): boolean {
  return !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], .react-joyride__overlay, [data-test-id="overlay"]'
  )
}

/**
 * One-time donation appeal for returning users. Opens right after a copy once
 * the user has used the site on several different days (see
 * lib/support-prompt.ts), i.e. it has proven useful to them, and is
 * marked as seen the moment it opens — however it gets closed, it never
 * shows again.
 */
export function SupportModal() {
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handleTrigger = () => {
      if (timerRef.current || hasSeenSupportModal()) return
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        // Busy with something else — the next copy will try again.
        if (hasSeenSupportModal() || isOtherOverlayOpen()) return
        markSupportModalSeen()
        setOpen(true)
        safeTrack("support_modal_shown")
      }, OPEN_DELAY_MS)
    }
    window.addEventListener(SUPPORT_PROMPT_EVENT, handleTrigger)
    return () => {
      window.removeEventListener(SUPPORT_PROMPT_EVENT, handleTrigger)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // Dev-only preview: open /?support-modal to show the modal right away,
  // bypassing the thresholds and without marking it as seen.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).has("support-modal")) {
      setOpen(true)
    }
  }, [])

  const handleSupport = () => {
    trackExternalLink(SOCIAL_URLS.BUY_ME_A_COFFEE, "support_modal")
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-4 ring-primary/15">
          <Coffee className="h-7 w-7" strokeWidth={2.25} aria-hidden="true" />
        </div>

        <DialogHeader className="sm:text-center">
          <DialogTitle className="text-xl sm:text-center">Thanks for being here!</DialogTitle>
          <DialogDescription className="text-base text-foreground sm:text-center text-balance">
            Booru Prompt Gallery is free, ad-free and needs no account, and I&apos;d love to keep it that way.
          </DialogDescription>
        </DialogHeader>

        {/* Body sits at near-foreground contrast and 15px/1.75 — muted grey at
            text-sm was hard to read across three paragraphs. */}
        <div className="space-y-4 text-[15px] leading-7 text-foreground/80 text-pretty">
          <p>
            Behind it there are servers, databases, APIs, and a lot of hours spent fixing things when a
            booru changes, adding new features and keeping everything fast. Right now I cover all of that myself.
          </p>
          <p>
            If the site has saved you time or helped you create something you love, a small donation keeps
            it online, updated and <strong className="font-semibold text-foreground">free for everyone</strong>.
          </p>
          <p className="font-medium text-foreground">
            Even one coffee makes a real difference. Thank you! <span aria-hidden="true">💚</span>
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 sm:justify-center">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Maybe later
          </Button>
          <Button asChild className="gap-2 rounded-full">
            <a
              href={SOCIAL_URLS.BUY_ME_A_COFFEE}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleSupport}
            >
              <Coffee className="h-4 w-4" aria-hidden="true" />
              Support on Buy Me a Coffee
            </a>
          </Button>
        </DialogFooter>

        <p className="text-center text-xs text-muted-foreground/80">You won&apos;t see this message again.</p>
      </DialogContent>
    </Dialog>
  )
}
