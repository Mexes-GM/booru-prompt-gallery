"use client"

import type { ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { PartyPopper } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Shared three-phase state machine both "quick flow" modals
 * (`quick-teach-modal.tsx`, `quick-review-modal.tsx`) drive: a welcome screen
 * that explains the controls, a playing screen with the actual rapid-fire
 * loop, and a summary screen with session stats. Exported so each modal's
 * own `useState<Phase>` stays type-compatible with this shell without
 * redeclaring the union.
 */
export type QuickFlowPhase = "welcome" | "playing" | "summary"

interface QuickFlowModalProps {
  open: boolean
  /**
   * Current phase, owned by the caller (each modal's own decisions/queue
   * state lives there too, so the phase can't be owned here without also
   * owning that — this shell only renders based on it and mediates the
   * close gesture below).
   */
  phase: QuickFlowPhase
  onPhaseChange: (phase: QuickFlowPhase) => void
  onOpenChange: (open: boolean) => void
  /** True once at least one decision has been made this session. */
  hasProgress: boolean
  welcome: ReactNode
  playing: ReactNode
  summary: ReactNode
}

/**
 * Dialog shell shared by Quick Teach and Quick Review: identical
 * `Dialog`/`DialogContent` chrome (blur-less overlay, fixed max-width/height,
 * no default close button since each modal's own Finish/Escape handling
 * covers that) and the same "closing mid-play routes to the summary screen
 * instead of actually closing, once at least one decision has been made"
 * gesture. Screen content for each phase is supplied by the caller as
 * render props, since the welcome/playing/summary screens themselves differ
 * enough between the two modals (category grid + keyboard legend vs.
 * verdict legend; classified-tag stats vs. approved/rejected/corrected
 * stats) that folding them in here would just reintroduce per-modal
 * conditionals for what's supposed to be the shared part.
 */
export function QuickFlowModal({
  open,
  phase,
  onPhaseChange,
  onOpenChange,
  hasProgress,
  welcome,
  playing,
  summary,
}: QuickFlowModalProps) {
  const handleClose = (val: boolean) => {
    if (!val && phase === "playing" && hasProgress) {
      onPhaseChange("summary")
      return
    }
    onOpenChange(val)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        overlayClassName="backdrop-blur-none bg-background/60"
        className="max-w-lg w-full max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-xl"
        showCloseButton={false}
      >
        {phase === "welcome" && welcome}
        {phase === "playing" && playing}
        {phase === "summary" && summary}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Shared outer chrome for a quick-flow welcome screen: icon badge, centered
 * title/description header, and a full-width primary CTA. Both modals' own
 * welcome screens supply the icon, copy, and an arbitrary middle section
 * (category grid for Teach, verdict legend for Review) between the header
 * and the keyboard-shortcut legend, plus the CTA label — the actual
 * shortcut legend and CTA button markup live here since they're
 * byte-for-byte identical between the two (same three shortcuts: Skip/Undo/
 * Finish, same button sizing/animation).
 */
export function QuickFlowWelcomeScreen({
  icon: Icon,
  title,
  description,
  middle,
  onStart,
  startLabel,
  startIcon: StartIcon,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: ReactNode
  middle: ReactNode
  onStart: () => void
  startLabel: string
  startIcon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex flex-col items-center text-center p-6 sm:p-8 gap-6">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
        <Icon className="w-8 h-8 text-primary-text" />
      </div>

      <DialogHeader className="items-center gap-2">
        <DialogTitle className="text-xl sm:text-2xl">{title}</DialogTitle>
        <DialogDescription className="text-sm sm:text-base max-w-sm">
          {description}
        </DialogDescription>
      </DialogHeader>

      {middle}

      <div className="text-xs text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1"><kbd className="font-mono bg-muted rounded px-1.5 py-0.5 border">Space</kbd> Skip</span>
        <span className="inline-flex items-center gap-1"><kbd className="font-mono bg-muted rounded px-1.5 py-0.5 border">Z</kbd> Undo</span>
        <span className="inline-flex items-center gap-1"><kbd className="font-mono bg-muted rounded px-1.5 py-0.5 border">Esc</kbd> Finish</span>
      </div>

      <Button size="lg" onClick={onStart} className="w-full max-w-xs gap-2 active:scale-[0.96] transition-transform duration-150">
        <StartIcon className="w-4 h-4" />
        {startLabel}
      </Button>
    </div>
  )
}

/**
 * Shared outer chrome for a quick-flow summary screen: party-popper badge,
 * header, a stat-block grid (caller supplies the blocks themselves, since
 * the count/labels differ — 2 stats for Teach, 4 for Review), and the
 * Keep-going/Done button row.
 */
export function QuickFlowSummaryScreen({
  title,
  description,
  stats,
  onKeepGoing,
  keepGoingLabel,
  onDone,
}: {
  title: string
  description: ReactNode
  stats: ReactNode
  onKeepGoing: () => void
  keepGoingLabel: string
  onDone: () => void
}) {
  return (
    <div className="flex flex-col items-center text-center p-6 sm:p-8 gap-6">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
        <PartyPopperIcon />
      </div>

      <DialogHeader className="items-center gap-2">
        <DialogTitle className="text-xl sm:text-2xl">{title}</DialogTitle>
        <DialogDescription className="text-sm sm:text-base">
          {description}
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
        {stats}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 w-full">
        <Button variant="outline" onClick={onKeepGoing} className="flex-1 active:scale-[0.96] transition-transform duration-150">
          {keepGoingLabel}
        </Button>
        <Button onClick={onDone} className="flex-1 active:scale-[0.97] transition-transform duration-150">
          Done
        </Button>
      </div>
    </div>
  )
}

// Both modals use lucide-react's PartyPopper as the summary screen's icon --
// kept as a fixed inline element (rather than an extra prop) since it never
// varies between the two.
function PartyPopperIcon() {
  return <PartyPopper className="w-8 h-8 text-primary-text" />
}

/** Shared stat-block cell used inside `QuickFlowSummaryScreen`'s `stats` grid. */
export function QuickFlowStatBlock({ value, label, highlight }: { value: number; label: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-3 flex flex-col items-center gap-0.5", highlight ? "border-primary/40 bg-primary/5" : "bg-muted/30")}>
      <span className={cn("text-2xl font-bold tabular-nums", highlight && "text-primary-text")}>{value}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
    </div>
  )
}
