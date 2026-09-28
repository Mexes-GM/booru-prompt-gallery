"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  QuickFlowModal,
  QuickFlowWelcomeScreen,
  QuickFlowSummaryScreen,
  QuickFlowStatBlock,
  type QuickFlowPhase,
} from "@/components/quick-flow-modal"
import { motion, AnimatePresence } from "framer-motion"
import {
  ClipboardCheck,
  Sparkles,
  Loader2,
  Undo2,
  SkipForward,
  Check,
  X,
  Wrench,
  Shirt,
  PersonStanding,
  Mountain,
  Smile,
  Tag as TagIcon,
  BookOpenText,
  ArrowRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getProviderWikiUrl } from "@/lib/constants"
import { useLowMotion } from "@/hooks/use-low-motion"
import { toastError } from "@/lib/toast-error"
import {
  approveSuggestion,
  rejectSuggestion,
  correctAndApproveSuggestion,
  revertSuggestionDecision,
  type TagSuggestion,
  type CorrectableCategory,
} from "@/app/actions/admin"
import { useQuickReviewQueue } from "@/hooks/use-quick-review-queue"

interface QuickReviewModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called whenever a decision lands, so the underlying table can be refreshed. */
  onDecision?: () => void
}

type Phase = QuickFlowPhase
type Verdict = "approved" | "rejected" | "corrected"

const CATEGORY_CONFIG: Array<{
  id: CorrectableCategory
  label: string
  icon: typeof Shirt
  accent: string
}> = [
  { id: "appearance", label: "Appearance", icon: Smile, accent: "border-cat-appearance-border bg-cat-appearance/5 text-cat-appearance-text hover:border-cat-appearance hover:bg-cat-appearance-soft" },
  { id: "clothing", label: "Clothing", icon: Shirt, accent: "border-cat-clothing-border bg-cat-clothing/5 text-cat-clothing-text hover:border-cat-clothing hover:bg-cat-clothing-soft" },
  { id: "pose", label: "Pose", icon: PersonStanding, accent: "border-cat-pose-border bg-cat-pose/5 text-cat-pose-text hover:border-cat-pose hover:bg-cat-pose-soft" },
  { id: "scenery", label: "Scenery", icon: Mountain, accent: "border-cat-scenery-border bg-cat-scenery/5 text-cat-scenery-text hover:border-cat-scenery hover:bg-cat-scenery-soft" },
  { id: "other", label: "Unclassified", icon: TagIcon, accent: "border-border bg-muted/40 text-muted-foreground hover:border-muted-foreground/60 hover:bg-muted" },
]

const REFILL_THRESHOLD = 4
// How long the chosen verdict's color stays visible on the card before the
// next suggestion replaces it — mirrors GLOW_HOLD_MS in quick-teach-modal.tsx
// so both "quick" modes feel consistent.
const GLOW_HOLD_MS = 100

interface Decision {
  suggestion: TagSuggestion
  verdict: Verdict
  correctedCategory?: CorrectableCategory
}

/**
 * Rapid-fire alternative to the row-by-row actions in `suggestions-table.tsx`.
 * Pulls the full backlog of pending `tag_suggestions` via `useQuickReviewQueue`
 * and lets an admin approve, reject, or correct-then-approve each one with a
 * single click or keyboard shortcut (A/R/C, Skip, Undo) — same interaction
 * shape as the community-facing `QuickTeachModal`, but each decision here is
 * a real, immediate write (approveSuggestion/rejectSuggestion/
 * correctAndApproveSuggestion) rather than a batch submitted at the end,
 * since these mutate live tag categories instead of creating new suggestions.
 */
export function QuickReviewModal({ open, onOpenChange, onDecision }: QuickReviewModalProps) {
  const [phase, setPhase] = useState<Phase>("welcome")
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [flashVerdict, setFlashVerdict] = useState<Verdict | null>(null)
  const [isCorrecting, setIsCorrecting] = useState(false)
  const [isActing, setIsActing] = useState(false)

  const lowMotion = useLowMotion()
  const {
    current,
    remainingInBuffer,
    totalPending,
    isLoading,
    error,
    isExhausted,
    refill,
    dequeue,
    requeueFront,
    reset,
  } = useQuickReviewQueue()

  const reviewedCount = decisions.length
  const approvedCount = decisions.filter(d => d.verdict === "approved").length
  const rejectedCount = decisions.filter(d => d.verdict === "rejected").length
  const correctedCount = decisions.filter(d => d.verdict === "corrected").length

  // Reset all local game state when the modal closes, after the exit animation.
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setPhase("welcome")
        setDecisions([])
        setFlashVerdict(null)
        setIsCorrecting(false)
        setIsActing(false)
        reset()
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [open, reset])

  // Keep the buffer topped up while playing.
  useEffect(() => {
    if (phase === "playing" && remainingInBuffer <= REFILL_THRESHOLD && !isLoading && !isExhausted) {
      refill()
    }
  }, [phase, remainingInBuffer, isLoading, isExhausted, refill])

  const startReview = useCallback(async () => {
    setPhase("playing")
    await refill()
  }, [refill])

  const runDecision = useCallback(async (verdict: Verdict, correctedCategory?: CorrectableCategory) => {
    if (!current || isActing) return
    setIsActing(true)
    try {
      if (verdict === "approved") {
        await approveSuggestion(current.id)
      } else if (verdict === "rejected") {
        await rejectSuggestion(current.id)
      } else if (correctedCategory) {
        await correctAndApproveSuggestion(current.id, correctedCategory)
      }
      setDecisions(prev => [...prev, { suggestion: current, verdict, correctedCategory }])
      onDecision?.()
      setFlashVerdict(verdict)
      setIsCorrecting(false)
      // Hold the color on the card for one beat before it's swapped out, same
      // timing rationale as GLOW_HOLD_MS in quick-teach-modal.tsx.
      window.setTimeout(() => dequeue(), GLOW_HOLD_MS)
    } catch (err) {
      console.error("[QuickReviewModal] decision failed:", err)
      toastError({
        title: "Action Failed",
        description: err instanceof Error ? err.message : "Something went wrong",
        errorSource: "quick_review_decision",
      })
    } finally {
      setIsActing(false)
    }
  }, [current, isActing, onDecision, dequeue])

  const skip = useCallback(() => {
    if (!current) return
    dequeue()
  }, [current, dequeue])

  const handleUndo = useCallback(() => {
    setDecisions(prev => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      // Put the suggestion back at the front of the queue immediately so it
      // reappears without waiting on the network, then best-effort revert
      // the write we made on the server (pending status + restored category).
      requeueFront(last.suggestion)
      void revertSuggestionDecision(last.suggestion.id).catch(err => {
        console.error("[QuickReviewModal] undo revert failed:", err)
        toastError({
          title: "Undo Failed",
          description: "Couldn't revert that decision on the server. Refresh to check its real state.",
          errorSource: "quick_review_undo",
        })
      })
      onDecision?.()
      return prev.slice(0, -1)
    })
  }, [requeueFront, onDecision])

  // --- Keyboard shortcuts ---
  useEffect(() => {
    if (phase !== "playing" || !current || flashVerdict || isActing) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return

      if (isCorrecting) {
        const catMatch = CATEGORY_CONFIG.find((c, idx) => String(idx + 1) === e.key)
        if (catMatch) {
          e.preventDefault()
          runDecision("corrected", catMatch.id)
        }
        if (e.key === "Escape") {
          e.preventDefault()
          setIsCorrecting(false)
        }
        return
      }

      if (e.key.toLowerCase() === "a") {
        e.preventDefault()
        runDecision("approved")
        return
      }
      if (e.key.toLowerCase() === "r") {
        e.preventDefault()
        runDecision("rejected")
        return
      }
      if (e.key.toLowerCase() === "c") {
        e.preventDefault()
        setIsCorrecting(true)
        return
      }
      if (e.key === " " || e.key.toLowerCase() === "s") {
        e.preventDefault()
        skip()
        return
      }
      if (e.key === "Backspace" || e.key.toLowerCase() === "z") {
        e.preventDefault()
        handleUndo()
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setPhase("summary")
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [phase, current, flashVerdict, isActing, isCorrecting, runDecision, skip, handleUndo])

  // Clears the flash highlight once the held card has actually been swapped out.
  useEffect(() => {
    if (!flashVerdict) return
    const timer = setTimeout(() => setFlashVerdict(null), GLOW_HOLD_MS)
    return () => clearTimeout(timer)
  }, [flashVerdict])

  return (
    <QuickFlowModal
      open={open}
      phase={phase}
      onPhaseChange={setPhase}
      onOpenChange={onOpenChange}
      hasProgress={decisions.length > 0}
      welcome={<WelcomeScreen totalPending={totalPending} onStart={startReview} />}
      playing={
        <PlayingScreen
          suggestion={current}
          isLoading={isLoading && !current}
          isExhausted={isExhausted}
          error={error}
          reviewedCount={reviewedCount}
          approvedCount={approvedCount}
          rejectedCount={rejectedCount}
          correctedCount={correctedCount}
          flashVerdict={flashVerdict}
          isLocked={!!flashVerdict || isActing}
          isCorrecting={isCorrecting}
          lowMotion={lowMotion}
          canUndo={decisions.length > 0}
          onApprove={() => runDecision("approved")}
          onReject={() => runDecision("rejected")}
          onStartCorrect={() => setIsCorrecting(true)}
          onCancelCorrect={() => setIsCorrecting(false)}
          onCorrect={(cat) => runDecision("corrected", cat)}
          onSkip={skip}
          onUndo={handleUndo}
          onFinish={() => setPhase("summary")}
        />
      }
      summary={
        <SummaryScreen
          reviewedCount={reviewedCount}
          approvedCount={approvedCount}
          rejectedCount={rejectedCount}
          correctedCount={correctedCount}
          onKeepGoing={() => setPhase("playing")}
          onDone={() => onOpenChange(false)}
        />
      }
    />
  )
}

// --- Welcome Screen ---

function WelcomeScreen({ totalPending, onStart }: { totalPending: number | null; onStart: () => void }) {
  return (
    <QuickFlowWelcomeScreen
      icon={ClipboardCheck}
      title="Quick Review"
      description={
        <>
          Rip through the pending suggestion backlog one at a time.
          {typeof totalPending === "number" && totalPending > 0 && (
            <> There {totalPending === 1 ? "is" : "are"} currently <strong>{totalPending}</strong> pending.</>
          )}
        </>
      }
      middle={
        <div className="grid grid-cols-1 gap-2 w-full max-w-xs">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium border-success-border bg-success/5 text-success-text">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Approve</span>
            <kbd className="ml-auto text-[10px] font-mono bg-background/70 rounded px-1.5 py-0.5 border">A</kbd>
          </div>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium border-destructive-border bg-destructive/5 text-destructive-text">
            <X className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Reject</span>
            <kbd className="ml-auto text-[10px] font-mono bg-background/70 rounded px-1.5 py-0.5 border">R</kbd>
          </div>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium border-warning-border bg-warning/5 text-warning-text">
            <Wrench className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Correct the category, then approve</span>
            <kbd className="ml-auto text-[10px] font-mono bg-background/70 rounded px-1.5 py-0.5 border">C</kbd>
          </div>
        </div>
      }
      onStart={onStart}
      startLabel="Start Reviewing"
      startIcon={Sparkles}
    />
  )
}

// --- Playing Screen ---

interface PlayingScreenProps {
  suggestion: TagSuggestion | null
  isLoading: boolean
  isExhausted: boolean
  error: string | null
  reviewedCount: number
  approvedCount: number
  rejectedCount: number
  correctedCount: number
  flashVerdict: Verdict | null
  isLocked: boolean
  isCorrecting: boolean
  lowMotion: boolean
  canUndo: boolean
  onApprove: () => void
  onReject: () => void
  onStartCorrect: () => void
  onCancelCorrect: () => void
  onCorrect: (category: CorrectableCategory) => void
  onSkip: () => void
  onUndo: () => void
  onFinish: () => void
}

const VERDICT_ACCENT: Record<Verdict, string> = {
  approved: "border-success bg-success-soft",
  rejected: "border-destructive bg-destructive-soft",
  corrected: "border-warning bg-warning-soft",
}

function PlayingScreen({
  suggestion,
  isLoading,
  isExhausted,
  error,
  reviewedCount,
  approvedCount,
  rejectedCount,
  correctedCount,
  flashVerdict,
  isLocked,
  isCorrecting,
  lowMotion,
  canUndo,
  onApprove,
  onReject,
  onStartCorrect,
  onCancelCorrect,
  onCorrect,
  onSkip,
  onUndo,
  onFinish,
}: PlayingScreenProps) {
  const tagName = suggestion?.tags?.name ?? "Unknown tag"
  const categoryChanged = suggestion && suggestion.suggested_category !== suggestion.current_category

  return (
    <div className="flex flex-col h-[80vh] max-h-[640px]">
      {/* Top bar: progress + finish. */}
      <div className="flex items-center justify-between gap-3 p-4 pb-3 border-b bg-muted/20 shrink-0">
        <div className="flex items-center gap-1.5 text-sm flex-wrap">
          <Badge variant="secondary" className="font-mono">{reviewedCount} reviewed</Badge>
          <Badge variant="secondary" className="font-mono text-success-text">{approvedCount} approved</Badge>
          <Badge variant="secondary" className="font-mono text-destructive-text">{rejectedCount} rejected</Badge>
          {correctedCount > 0 && (
            <Badge variant="secondary" className="font-mono text-warning-text">{correctedCount} corrected</Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onFinish} className="h-7 text-xs text-muted-foreground active:scale-[0.96] transition-transform duration-150">
          Finish
        </Button>
      </div>

      {/* Card stage */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 relative overflow-hidden">
        <span className="sr-only" aria-live="polite" role="status">
          {suggestion
            ? `Current tag: ${tagName}, suggested category ${suggestion.suggested_category}`
            : isLoading
              ? "Loading more suggestions"
              : error ?? (isExhausted ? "No more pending suggestions" : "Loading")}
        </span>
        <AnimatePresence mode="wait">
          {suggestion ? (
            <motion.div
              key={suggestion.id}
              initial={lowMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={lowMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -6 }}
              transition={
                lowMotion
                  ? { duration: 0.12 }
                  : { duration: 0.2, ease: [0.23, 1, 0.32, 1] }
              }
              className={cn(
                "relative w-full max-w-sm rounded-2xl border-2 bg-card shadow-lg px-6 py-8 flex flex-col items-center justify-center gap-4 text-center select-none transition-colors duration-150",
                flashVerdict ? VERDICT_ACCENT[flashVerdict] : "border-border"
              )}
            >
              <span className="text-2xl sm:text-3xl font-semibold leading-tight break-words">
                {tagName}
              </span>

              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline">{suggestion.current_category}</Badge>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                <Badge
                  variant={categoryChanged ? "secondary" : "outline"}
                  className={categoryChanged ? "bg-info-soft text-info-text hover:bg-info/25" : ""}
                >
                  {suggestion.suggested_category}
                </Badge>
              </div>

              {!isCorrecting && (
                <Button
                  asChild
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground active:scale-[0.96] transition-transform duration-150"
                >
                  <a
                    href={getProviderWikiUrl("danbooru", tagName)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <BookOpenText className="w-3.5 h-3.5" />
                    Look up on Booru Wiki
                  </a>
                </Button>
              )}

              {isCorrecting && (
                <div className="w-full flex flex-col gap-2 pt-1">
                  <p className="text-xs text-muted-foreground">Pick the correct category:</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {CATEGORY_CONFIG.map((cat, idx) => (
                      <Button
                        key={cat.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isLocked}
                        onClick={() => onCorrect(cat.id)}
                        className={cn("h-10 gap-1.5 justify-start transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.96]", cat.accent)}
                      >
                        <cat.icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-xs font-medium truncate">{cat.label}</span>
                        <kbd className="ml-auto text-[10px] font-mono opacity-60">{idx + 1}</kbd>
                      </Button>
                    ))}
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={onCancelCorrect} className="h-7 text-xs text-muted-foreground">
                    Cancel
                  </Button>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-3 text-muted-foreground"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-8 h-8 animate-spin" />
                  <span className="text-sm">Loading pending suggestions…</span>
                </>
              ) : error ? (
                <span className="text-sm text-center max-w-xs">{error}</span>
              ) : (
                <span className="text-sm">All caught up — no pending suggestions left!</span>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {suggestion && !isCorrecting && (
          <p className="text-xs text-muted-foreground">Click an action below or use the keyboard shortcuts.</p>
        )}
      </div>

      {!isCorrecting && (
        <>
          {/* Verdict buttons */}
          <div className="grid grid-cols-3 gap-2 p-4 pt-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              disabled={!suggestion || isLocked}
              onClick={onApprove}
              className="h-14 flex-col gap-1 border-success-border bg-success/5 text-success-text hover:border-success hover:bg-success-soft transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.96]"
            >
              <div className="flex items-center gap-1.5">
                <Check className="w-4 h-4" />
                <span className="text-sm font-medium">Approve</span>
              </div>
              <kbd className="text-[10px] font-mono opacity-60">A</kbd>
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!suggestion || isLocked}
              onClick={onReject}
              className="h-14 flex-col gap-1 border-destructive-border bg-destructive/5 text-destructive-text hover:border-destructive hover:bg-destructive-soft transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.96]"
            >
              <div className="flex items-center gap-1.5">
                <X className="w-4 h-4" />
                <span className="text-sm font-medium">Reject</span>
              </div>
              <kbd className="text-[10px] font-mono opacity-60">R</kbd>
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!suggestion || isLocked}
              onClick={onStartCorrect}
              className="h-14 flex-col gap-1 border-warning-border bg-warning/5 text-warning-text hover:border-warning hover:bg-warning-soft transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.96]"
            >
              <div className="flex items-center gap-1.5">
                <Wrench className="w-4 h-4" />
                <span className="text-sm font-medium">Correct</span>
              </div>
              <kbd className="text-[10px] font-mono opacity-60">C</kbd>
            </Button>
          </div>

          <div className="flex items-center gap-2 p-4 pt-0 shrink-0">
            <Button type="button" variant="secondary" size="sm" disabled={!suggestion || isLocked} onClick={onSkip} className="flex-1 gap-1.5 active:scale-[0.96] transition-transform duration-150">
              <SkipForward className="w-3.5 h-3.5" />
              Skip
              <kbd className="ml-1 text-[10px] font-mono opacity-60">Space</kbd>
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={!canUndo} onClick={onUndo} className="flex-1 gap-1.5 active:scale-[0.96] transition-transform duration-150">
              <Undo2 className="w-3.5 h-3.5" />
              Undo
              <kbd className="ml-1 text-[10px] font-mono opacity-60">Z</kbd>
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// --- Summary Screen ---

function SummaryScreen({
  reviewedCount,
  approvedCount,
  rejectedCount,
  correctedCount,
  onKeepGoing,
  onDone,
}: {
  reviewedCount: number
  approvedCount: number
  rejectedCount: number
  correctedCount: number
  onKeepGoing: () => void
  onDone: () => void
}) {
  return (
    <QuickFlowSummaryScreen
      title="Nice work!"
      description="Here's what you got through this session."
      stats={
        <>
          <QuickFlowStatBlock value={reviewedCount} label="Reviewed" />
          <QuickFlowStatBlock value={approvedCount} label="Approved" highlight />
          <QuickFlowStatBlock value={rejectedCount} label="Rejected" />
          <QuickFlowStatBlock value={correctedCount} label="Corrected" />
        </>
      }
      onKeepGoing={onKeepGoing}
      keepGoingLabel="Keep Reviewing"
      onDone={onDone}
    />
  )
}
