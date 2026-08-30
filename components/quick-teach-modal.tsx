"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { motion, AnimatePresence } from "framer-motion"
import {
  GraduationCap,
  Sparkles,
  Loader2,
  Undo2,
  SkipForward,
  PartyPopper,
  Shirt,
  PersonStanding,
  Mountain,
  Smile,
  Users,
  BookOpenText,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getProviderWikiUrl } from "@/lib/constants"
import { useLowMotion } from "@/hooks/use-low-motion"
import { useToast } from "@/hooks/use-toast"
import { toastError } from "@/lib/toast-error"
import { submitTagSuggestions } from "@/app/actions/suggestions"
import { useQuickTeachQueue, type QuickTeachCard } from "@/hooks/use-quick-teach-queue"
import type { TagCategory } from "@/lib/tag-classifier"
import { TAG_CATEGORIES } from "@/lib/tag-taxonomy"
import { TAG_CATEGORY_ICONS } from "@/components/tag-category-icon"

interface QuickTeachModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tagOverrides: Record<string, string>
  onSuccess?: () => void
}

type Phase = "welcome" | "playing" | "summary"

// Labels and icons come from lib/tag-taxonomy.ts; only what is specific to this
// modal lives here — the keyboard shortcut and the Tailwind accent strings (which
// must stay as literals for Tailwind to keep them in the build).
const CATEGORY_CONFIG: Array<{
  id: TagCategory
  label: string
  key: string
  icon: typeof Shirt
  accent: string
  activeAccent: string
}> = [
  { id: "appearance", label: TAG_CATEGORIES.appearance.label, key: "1", icon: TAG_CATEGORY_ICONS.appearance, accent: "border-blue-500/40 bg-blue-500/5 text-blue-600 dark:text-blue-300 hover:border-blue-500 hover:bg-blue-500/10", activeAccent: "border-blue-500 bg-blue-500/15" },
  { id: "clothing", label: TAG_CATEGORIES.clothing.label, key: "2", icon: TAG_CATEGORY_ICONS.clothing, accent: "border-green-500/40 bg-green-500/5 text-green-600 dark:text-green-300 hover:border-green-500 hover:bg-green-500/10", activeAccent: "border-green-500 bg-green-500/15" },
  { id: "pose", label: TAG_CATEGORIES.pose.label, key: "3", icon: TAG_CATEGORY_ICONS.pose, accent: "border-purple-500/40 bg-purple-500/5 text-purple-600 dark:text-purple-300 hover:border-purple-500 hover:bg-purple-500/10", activeAccent: "border-purple-500 bg-purple-500/15" },
  { id: "scenery", label: TAG_CATEGORIES.scenery.label, key: "4", icon: TAG_CATEGORY_ICONS.scenery, accent: "border-orange-500/40 bg-orange-500/5 text-orange-600 dark:text-orange-300 hover:border-orange-500 hover:bg-orange-500/10", activeAccent: "border-orange-500 bg-orange-500/15" },
]

const REFILL_THRESHOLD = 4
const REFILL_TARGET = 15
// How long the chosen category's color stays visible on the card before the
// next tag replaces it. Long enough to register as "yes, that's the color I
// picked", short enough not to slow down rapid-fire classification.
const GLOW_HOLD_MS = 100

interface Decision {
  tagName: string
  currentCategory: TagCategory
  suggestedCategory: TagCategory
}

/**
 * Gamified, image-free alternative to the per-card Teach modal (`teach-modal.tsx`).
 * Instead of classifying tags harvested from one specific card, this pulls a
 * continuous stream of unclassified tags from random Danbooru posts (tags-only
 * requests — no images fetched) and lets the user rapid-fire classify them one
 * at a time via click or keyboard shortcuts (1-4, Skip, Undo). Decisions are
 * batched locally and submitted together via the same `submitTagSuggestions`
 * server action the per-card modal uses.
 */
export function QuickTeachModal({ open, onOpenChange, tagOverrides, onSuccess }: QuickTeachModalProps) {
  const [phase, setPhase] = useState<Phase>("welcome")
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [history, setHistory] = useState<Array<{ card: QuickTeachCard; decision: Decision | null }>>([])
  const [flashCategory, setFlashCategory] = useState<TagCategory | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const lowMotion = useLowMotion()
  const { toast } = useToast()
  const { current, remainingInBuffer, isLoading, error, refill, dequeue, reset } = useQuickTeachQueue(tagOverrides)

  const reviewedCount = history.length
  const suggestedCount = decisions.length

  // Reset all local game state when the modal closes, after the exit animation.
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setPhase("welcome")
        setDecisions([])
        setHistory([])
        setFlashCategory(null)
        setIsSubmitting(false)
        reset()
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [open, reset])

  // Keep the buffer topped up while playing.
  useEffect(() => {
    if (phase === "playing" && remainingInBuffer <= REFILL_THRESHOLD && !isLoading) {
      refill(REFILL_TARGET)
    }
  }, [phase, remainingInBuffer, isLoading, refill])

  const startGame = useCallback(async () => {
    setPhase("playing")
    await refill(REFILL_TARGET)
  }, [refill])

  const classify = useCallback((category: TagCategory) => {
    if (!current) return
    const decision: Decision = { tagName: current.tag, currentCategory: "other", suggestedCategory: category }
    setDecisions(prev => [...prev, decision])
    setHistory(prev => [...prev, { card: current, decision }])
    setFlashCategory(category)
    // Let the card visibly hold the chosen category's color BEFORE it's
    // replaced by the next tag. Advancing the queue in the same tick as the
    // color state update would change `key={card.tag}` before the color
    // transition ever painted a frame — AnimatePresence would tear the card
    // down and mount the next one instantly, so the highlight would never
    // actually show up on the card that was just classified.
    window.setTimeout(() => dequeue(), GLOW_HOLD_MS)
  }, [current, dequeue])

  const skip = useCallback(() => {
    if (!current) return
    setHistory(prev => [...prev, { card: current, decision: null }])
    dequeue()
  }, [current, dequeue])

  // The undone card needs to reappear as "current". Since useQuickTeachQueue
  // owns the FIFO queue, we track an explicit "put back" slot for the one
  // most recently undone card instead of reaching into the hook's internals.
  const [undoneCard, setUndoneCard] = useState<QuickTeachCard | null>(null)
  const handleUndo = useCallback(() => {
    setHistory(prev => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      if (last.decision) {
        setDecisions(d => d.filter(dec => dec !== last.decision))
      }
      setUndoneCard(last.card)
      return prev.slice(0, -1)
    })
  }, [])

  const displayedCard = undoneCard ?? current

  const classifyDisplayed = useCallback((category: TagCategory) => {
    if (undoneCard) {
      const decision: Decision = { tagName: undoneCard.tag, currentCategory: "other", suggestedCategory: category }
      setDecisions(prev => [...prev, decision])
      setHistory(prev => [...prev, { card: undoneCard, decision }])
      setFlashCategory(category)
      // Same hold-before-advance as classify() above, applied to the undone
      // card slot instead of the live queue.
      window.setTimeout(() => setUndoneCard(null), GLOW_HOLD_MS)
      return
    }
    classify(category)
  }, [undoneCard, classify])

  const skipDisplayed = useCallback(() => {
    if (undoneCard) {
      setHistory(prev => [...prev, { card: undoneCard, decision: null }])
      setUndoneCard(null)
      return
    }
    skip()
  }, [undoneCard, skip])

  // --- Keyboard shortcuts ---
  useEffect(() => {
    if (phase !== "playing" || !displayedCard || flashCategory) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return

      const categoryMatch = CATEGORY_CONFIG.find(c => c.key === e.key)
      if (categoryMatch) {
        e.preventDefault()
        classifyDisplayed(categoryMatch.id)
        return
      }
      if (e.key === " " || e.key.toLowerCase() === "s") {
        e.preventDefault()
        skipDisplayed()
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
  }, [phase, displayedCard, flashCategory, classifyDisplayed, skipDisplayed, handleUndo])

  // Clears the flash highlight once the held card has actually been swapped
  // out (dequeue/setUndoneCard(null) above already advances the queue after
  // the same GLOW_HOLD_MS delay) — this just resets the color state itself.
  useEffect(() => {
    if (!flashCategory) return
    const timer = setTimeout(() => setFlashCategory(null), GLOW_HOLD_MS)
    return () => clearTimeout(timer)
  }, [flashCategory])

  const handleFinishReview = useCallback(() => {
    setPhase("summary")
  }, [])

  const handleSubmitAll = useCallback(async () => {
    if (decisions.length === 0) {
      onOpenChange(false)
      return
    }
    setIsSubmitting(true)
    try {
      const result = await submitTagSuggestions(decisions)
      if (result.success) {
        toast({
          title: "Thanks for teaching!",
          description: `${decisions.length} tag${decisions.length !== 1 ? "s" : ""} submitted for review.`,
        })
        onSuccess?.()
        onOpenChange(false)
      } else {
        toastError({
          title: "Submission Failed",
          description: result.message,
          errorSource: "quick_teach_submission",
        })
      }
    } catch (err) {
      console.error(err)
      toastError({
        title: "Error",
        description: "An unexpected error occurred.",
        errorSource: "quick_teach_submission",
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [decisions, onOpenChange, onSuccess, toast])

  const handleClose = useCallback((val: boolean) => {
    if (!val && phase === "playing" && decisions.length > 0) {
      setPhase("summary")
      return
    }
    onOpenChange(val)
  }, [phase, decisions.length, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        overlayClassName="backdrop-blur-none bg-background/60"
        className="max-w-lg w-full max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-xl"
        showCloseButton={false}
      >
        {phase === "welcome" && (
          <WelcomeScreen onStart={startGame} />
        )}

        {phase === "playing" && (
          <PlayingScreen
            card={displayedCard}
            isLoading={isLoading && !displayedCard}
            error={error}
            reviewedCount={reviewedCount}
            suggestedCount={suggestedCount}
            flashCategory={flashCategory}
            isLocked={!!flashCategory}
            lowMotion={lowMotion}
            canUndo={history.length > 0}
            onClassify={classifyDisplayed}
            onSkip={skipDisplayed}
            onUndo={handleUndo}
            onFinish={handleFinishReview}
          />
        )}

        {phase === "summary" && (
          <SummaryScreen
            reviewedCount={reviewedCount}
            suggestedCount={suggestedCount}
            isSubmitting={isSubmitting}
            onKeepGoing={() => setPhase("playing")}
            onSubmit={handleSubmitAll}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// --- Welcome Screen ---

function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center text-center p-6 sm:p-8 gap-6">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
        <GraduationCap className="w-8 h-8 text-primary" />
      </div>

      <DialogHeader className="items-center gap-2">
        <DialogTitle className="text-xl sm:text-2xl">Quick Teach</DialogTitle>
        <DialogDescription className="text-sm sm:text-base max-w-sm">
          A faster way to help classify tags. We&apos;ll show you one tag at a time from
          random posts — no images, just tags — and you sort each one into a category.
          Rapid-fire through as many as you like.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
        {CATEGORY_CONFIG.map(cat => (
          <div key={cat.id} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium", cat.accent)}>
            <cat.icon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{cat.label}</span>
            <kbd className="ml-auto text-[10px] font-mono bg-background/70 rounded px-1.5 py-0.5 border">{cat.key}</kbd>
          </div>
        ))}
      </div>

      <div className="text-xs text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1"><kbd className="font-mono bg-muted rounded px-1.5 py-0.5 border">Space</kbd> Skip</span>
        <span className="inline-flex items-center gap-1"><kbd className="font-mono bg-muted rounded px-1.5 py-0.5 border">Z</kbd> Undo</span>
        <span className="inline-flex items-center gap-1"><kbd className="font-mono bg-muted rounded px-1.5 py-0.5 border">Esc</kbd> Finish</span>
      </div>

      <Button size="lg" onClick={onStart} className="w-full max-w-xs gap-2 active:scale-[0.96] transition-transform duration-150">
        <Sparkles className="w-4 h-4" />
        Start Teaching
      </Button>
    </div>
  )
}

// --- Playing Screen ---

interface PlayingScreenProps {
  card: QuickTeachCard | null
  isLoading: boolean
  error: string | null
  reviewedCount: number
  suggestedCount: number
  flashCategory: TagCategory | null
  isLocked: boolean
  lowMotion: boolean
  canUndo: boolean
  onClassify: (category: TagCategory) => void
  onSkip: () => void
  onUndo: () => void
  onFinish: () => void
}

function PlayingScreen({
  card,
  isLoading,
  error,
  reviewedCount,
  suggestedCount,
  flashCategory,
  isLocked,
  lowMotion,
  canUndo,
  onClassify,
  onSkip,
  onUndo,
  onFinish,
}: PlayingScreenProps) {
  return (
    <div className="flex flex-col h-[80vh] max-h-[640px]">
      {/* Top bar: progress + finish. The dialog's own close (X) button already
          sits top-right on DialogContent, so this uses a plain text action
          instead of a second X icon to avoid two visually identical
          close-ish controls stacked in the same corner. */}
      <div className="flex items-center justify-between gap-3 p-4 pb-3 border-b bg-muted/20 shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="secondary" className="font-mono">{reviewedCount} reviewed</Badge>
          <Badge variant="secondary" className="font-mono text-primary">{suggestedCount} classified</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onFinish} className="h-7 text-xs text-muted-foreground active:scale-[0.96] transition-transform duration-150">
          Finish
        </Button>
      </div>

      {/* Card stage */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 relative overflow-hidden">
        {/* Screen-reader announcement of the current tag — the visual card below is
            re-keyed per AnimatePresence exit/enter, which VoiceOver/NVDA don't reliably
            pick up as new content without an explicit live region. */}
        <span className="sr-only" aria-live="polite" role="status">
          {card ? `Current tag: ${card.tag}` : isLoading ? "Loading more tags" : error ?? "No more tags right now"}
        </span>
        <AnimatePresence mode="wait">
          {card ? (
            <motion.div
              key={card.tag}
              initial={lowMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={lowMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -6 }}
              transition={
                lowMotion
                  ? { duration: 0.12 }
                  : {
                    // Asymmetric enter/exit: entering is the moment the user is
                    // watching, so it gets the fuller motion + a strong custom
                    // ease-out curve. Exiting (after the user already acted by
                    // clicking/pressing a key) is faster and more subtle — the
                    // system just needs to get out of the way.
                    duration: 0.2,
                    ease: [0.23, 1, 0.32, 1],
                  }
              }
              className={cn(
                "relative w-full max-w-sm rounded-2xl border-2 bg-card shadow-lg px-6 py-8 flex flex-col items-center justify-center gap-3 text-center select-none transition-colors duration-150",
                flashCategory ? CATEGORY_CONFIG.find(c => c.id === flashCategory)?.activeAccent : "border-border"
              )}
            >
              <span className="text-2xl sm:text-3xl font-semibold leading-tight break-words">
                {card.tag}
              </span>

              {card.voteCounts && Object.keys(card.voteCounts).length > 0 && (
                <div className="flex flex-col items-center gap-1.5 w-full">
                  <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    Other users have suggested:
                  </span>
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {Object.entries(card.voteCounts)
                      .sort(([, a], [, b]) => b - a)
                      .map(([category, count]) => {
                        const cfg = CATEGORY_CONFIG.find(c => c.id === category)
                        return (
                          <Badge
                            key={category}
                            variant="outline"
                            className={cn("text-[11px] font-normal gap-1", cfg?.accent)}
                          >
                            {cfg?.label ?? category}
                            <span className="font-mono font-semibold">{count}</span>
                          </Badge>
                        )
                      })}
                  </div>
                </div>
              )}

              <Button
                asChild
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground active:scale-[0.96] transition-transform duration-150"
              >
                <a
                  href={getProviderWikiUrl("danbooru", card.tag)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <BookOpenText className="w-3.5 h-3.5" />
                  Look up on Booru Wiki
                </a>
              </Button>
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
                  <span className="text-sm">Fetching tags from Danbooru…</span>
                </>
              ) : error ? (
                <span className="text-sm text-center max-w-xs">{error}</span>
              ) : (
                <span className="text-sm">All caught up for now!</span>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {card && (
          <p className="text-xs text-muted-foreground">Click a category or use the number keys.</p>
        )}
      </div>

      {/* Category buttons */}
      <div className="grid grid-cols-2 gap-2 p-4 pt-2 shrink-0">
        {CATEGORY_CONFIG.map(cat => (
          <Button
            key={cat.id}
            type="button"
            variant="outline"
            disabled={!card || isLocked}
            onClick={() => onClassify(cat.id)}
            className={cn("h-14 flex-col gap-1 transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.96]", cat.accent)}
          >
            <div className="flex items-center gap-1.5">
              <cat.icon className="w-4 h-4" />
              <span className="text-sm font-medium">{cat.label}</span>
            </div>
            <kbd className="text-[10px] font-mono opacity-60">{cat.key}</kbd>
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-2 p-4 pt-0 shrink-0">
        <Button type="button" variant="secondary" size="sm" disabled={!card || isLocked} onClick={onSkip} className="flex-1 gap-1.5 active:scale-[0.96] transition-transform duration-150">
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
    </div>
  )
}

// --- Summary Screen ---

function SummaryScreen({
  reviewedCount,
  suggestedCount,
  isSubmitting,
  onKeepGoing,
  onSubmit,
}: {
  reviewedCount: number
  suggestedCount: number
  isSubmitting: boolean
  onKeepGoing: () => void
  onSubmit: () => void
}) {
  return (
    <div className="flex flex-col items-center text-center p-6 sm:p-8 gap-6">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
        <PartyPopper className="w-8 h-8 text-primary" />
      </div>

      <DialogHeader className="items-center gap-2">
        <DialogTitle className="text-xl sm:text-2xl">Nice work!</DialogTitle>
        <DialogDescription className="text-sm sm:text-base">
          Here&apos;s what you got through this session.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
        <StatBlock value={reviewedCount} label="Reviewed" />
        <StatBlock value={suggestedCount} label="Classified" highlight />
      </div>

      <div className="flex flex-col sm:flex-row gap-2 w-full">
        <Button variant="outline" onClick={onKeepGoing} className="flex-1 active:scale-[0.96] transition-transform duration-150" disabled={isSubmitting}>
          Keep Teaching
        </Button>
        <Button onClick={onSubmit} className="flex-1 active:scale-[0.97] transition-transform duration-150" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {suggestedCount > 0 ? `Submit ${suggestedCount} Suggestion${suggestedCount !== 1 ? "s" : ""}` : "Close"}
        </Button>
      </div>
    </div>
  )
}

function StatBlock({ value, label, highlight }: { value: number; label: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-3 flex flex-col items-center gap-0.5", highlight ? "border-primary/40 bg-primary/5" : "bg-muted/30")}>
      <span className={cn("text-2xl font-bold tabular-nums", highlight && "text-primary")}>{value}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
    </div>
  )
}
