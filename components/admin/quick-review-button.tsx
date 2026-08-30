'use client'

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ClipboardCheck } from "lucide-react"
import { useRouter } from "next/navigation"
import { QuickReviewModal } from "@/components/quick-review-modal"

/**
 * Opens the Quick Review modal (`components/quick-review-modal.tsx`) for
 * rapid-fire triage of the pending suggestion backlog. Placed next to
 * `AutoSuggestButton` on `/admin/suggestions` so the two "bulk" workflows
 * (generate proposals, then review them) sit side by side.
 */
export function QuickReviewButton() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-2">
        <ClipboardCheck className="h-4 w-4" />
        Quick Review
      </Button>
      <QuickReviewModal
        open={open}
        onOpenChange={(val) => {
          setOpen(val)
          // Only refresh the table once the modal actually closes — refreshing
          // on every single decision would re-run the page's server component
          // mid-session while the admin is rapid-firing through the backlog.
          if (!val) router.refresh()
        }}
      />
    </>
  )
}
