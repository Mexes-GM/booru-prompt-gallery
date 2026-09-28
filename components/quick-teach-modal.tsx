"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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
  GraduationCap,
  Sparkles,
  Loader2,
  Undo2,
  SkipForward,
  BookOpenText,
  CheckCircle2,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getProviderWikiUrl } from "@/lib/constants"
import { useLowMotion } from "@/hooks/use-low-motion"
import { toastError } from "@/lib/toast-error"
import {
  submitTeachClassification,
  revertTeachClassification,
  type PreviousTagState,
} from "@/app/actions/teach-queue"
import { useQuickTeachQueue, type QuickTeachCard } from "@/hooks/use-quick-teach-queue"
import { TAG_CATEGORIES, TAG_SUBCATEGORIES, formatSubcategoryLabel, type TagCategory } from "@/lib/tag-taxonomy"
import { TAG_CATEGORY_ICONS } from "@/components/tag-category-icon"

interface QuickTeachModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tagOverrides?: Record<string, string>
  onSuccess?: () => void
}

type Phase = QuickFlowPhase

const CATEGORY_CONFIG: Array<{
  id: TagCategory
  label: string
  key: string
  icon: LucideIcon
  accent: string
  activeAccent: string
}> = [
  {
    id: "appearance",
    label: TAG_CATEGORIES.appearance.label,
    key: "1",
    icon: TAG_CATEGORY_ICONS.appearance,
    accent: "border-cat-appearance-border bg-cat-appearance/5 text-cat-appearance-text hover:border-cat-appearance hover:bg-cat-appearance-soft",
    activeAccent: "border-cat-appearance bg-cat-appearance/20 text-cat-appearance-text font-semibold ring-1 ring-cat-appearance/40",
  },
  {
    id: "clothing",
    label: TAG_CATEGORIES.clothing.label,
    key: "2",
    icon: TAG_CATEGORY_ICONS.clothing,
    accent: "border-cat-clothing-border bg-cat-clothing/5 text-cat-clothing-text hover:border-cat-clothing hover:bg-cat-clothing-soft",
    activeAccent: "border-cat-clothing bg-cat-clothing/20 text-cat-clothing-text font-semibold ring-1 ring-cat-clothing/40",
  },
  {
    id: "equipment",
    label: TAG_CATEGORIES.equipment.label,
    key: "3",
    icon: TAG_CATEGORY_ICONS.equipment,
    accent: "border-cat-equipment-border bg-cat-equipment/5 text-cat-equipment-text hover:border-cat-equipment hover:bg-cat-equipment-soft",
    activeAccent: "border-cat-equipment bg-cat-equipment/20 text-cat-equipment-text font-semibold ring-1 ring-cat-equipment/40",
  },
  {
    id: "pose",
    label: TAG_CATEGORIES.pose.label,
    key: "4",
    icon: TAG_CATEGORY_ICONS.pose,
    accent: "border-cat-pose-border bg-cat-pose/5 text-cat-pose-text hover:border-cat-pose hover:bg-cat-pose-soft",
    activeAccent: "border-cat-pose bg-cat-pose/20 text-cat-pose-text font-semibold ring-1 ring-cat-pose/40",
  },
  {
    id: "scenery",
    label: TAG_CATEGORIES.scenery.label,
    key: "5",
    icon: TAG_CATEGORY_ICONS.scenery,
    accent: "border-cat-scenery-border bg-cat-scenery/5 text-cat-scenery-text hover:border-cat-scenery hover:bg-cat-scenery-soft",
    activeAccent: "border-cat-scenery bg-cat-scenery/20 text-cat-scenery-text font-semibold ring-1 ring-cat-scenery/40",
  },
  {
    id: "creature",
    label: TAG_CATEGORIES.creature.label,
    key: "6",
    icon: TAG_CATEGORY_ICONS.creature,
    accent: "border-cat-creature-border bg-cat-creature/5 text-cat-creature-text hover:border-cat-creature hover:bg-cat-creature-soft",
    activeAccent: "border-cat-creature bg-cat-creature/20 text-cat-creature-text font-semibold ring-1 ring-cat-creature/40",
  },
  {
    id: "other",
    label: TAG_CATEGORIES.other.label,
    key: "7",
    icon: TAG_CATEGORY_ICONS.other,
    accent: "border-border bg-muted/40 text-muted-foreground hover:border-muted-foreground/60 hover:bg-muted",
    activeAccent: "border-muted-foreground/60 bg-muted text-foreground font-semibold ring-1 ring-border",
  },
]

const REFILL_THRESHOLD = 4
const REFILL_TARGET = 15
const GLOW_HOLD_MS = 120

interface Decision {
  tagName: string
  category: TagCategory
  subcategory: string
  suggestionId?: string | null
  wasAutoApproved?: boolean
  previousState: PreviousTagState
}

export function QuickTeachModal({ open, onOpenChange, tagOverrides, onSuccess }: QuickTeachModalProps) {
  const [phase, setPhase] = useState<Phase>("welcome")
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [history, setHistory] = useState<Array<{ card: QuickTeachCard; decision: Decision | null }>>([])
  const [flashCategory, setFlashCategory] = useState<TagCategory | null>(null)
  const [expandedCategory, setExpandedCategory] = useState<TagCategory | null>(null)

  const lowMotion = useLowMotion()
  const { current, remainingInBuffer, isLoading, error, refill, dequeue, reset } = useQuickTeachQueue(tagOverrides)

  const reviewedCount = history.length
  const suggestedCount = decisions.length

  // Reset local state when modal closes
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setPhase("welcome")
        setDecisions([])
        setHistory([])
        setFlashCategory(null)
        setExpandedCategory(null)
        setUndoneStack([])
        reset()
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [open, reset])

  // Keep queue topped up while in playing phase
  useEffect(() => {
    if (phase === "playing" && remainingInBuffer <= REFILL_THRESHOLD && !isLoading) {
      refill(REFILL_TARGET)
    }
  }, [phase, remainingInBuffer, isLoading, refill])

  const startGame = useCallback(async () => {
    setPhase("playing")
    await refill(REFILL_TARGET)
  }, [refill])

  const [undoneStack, setUndoneStack] = useState<QuickTeachCard[]>([])
  const displayedCard = undoneStack.length > 0 ? undoneStack[undoneStack.length - 1] : current

  // Reset expanded category whenever card changes
  useEffect(() => {
    setExpandedCategory(null)
  }, [displayedCard?.tag])

  const classify = useCallback((category: TagCategory, subcategory: string) => {
    const cardToClassify = displayedCard
    if (!cardToClassify) return

    const previousState: PreviousTagState = {
      categoryName: cardToClassify.categoryName ?? null,
      subcategory: cardToClassify.subcategory ?? null,
      confidence: cardToClassify.confidence ?? null,
      status: "needs_review",
    }

    const decision: Decision = {
      tagName: cardToClassify.tag,
      category,
      subcategory,
      previousState,
    }

    setDecisions(prev => [...prev, decision])
    setHistory(prev => [...prev, { card: cardToClassify, decision }])
    setFlashCategory(category)
    setExpandedCategory(null)

    if (undoneStack.length > 0) {
      window.setTimeout(() => setUndoneStack(prev => prev.slice(0, -1)), GLOW_HOLD_MS)
    } else {
      window.setTimeout(() => dequeue(), GLOW_HOLD_MS)
    }

    // Persist classification immediately via server action
    void submitTeachClassification(
      decision.tagName,
      category,
      subcategory,
      {
        currentCategory: cardToClassify.categoryName,
        currentSubcategory: cardToClassify.subcategory,
        confidence: cardToClassify.confidence,
      }
    )
      .then(res => {
        if (res.success) {
          decision.suggestionId = res.suggestionId
          decision.wasAutoApproved = res.wasAutoApproved
          onSuccess?.()
        } else {
          toastError({
            title: "Submission Failed",
            description: res.message ?? "Please try again.",
            errorSource: "quick_teach_submission",
          })
        }
      })
      .catch(err => {
        console.error("[QuickTeachModal] submission failed:", err)
        toastError({
          title: "Error",
          description: "An unexpected error occurred while saving classification.",
          errorSource: "quick_teach_submission",
        })
      })
  }, [displayedCard, undoneStack.length, dequeue, onSuccess])

  const skip = useCallback(() => {
    if (!displayedCard) return
    setHistory(prev => [...prev, { card: displayedCard, decision: null }])
    setExpandedCategory(null)
    if (undoneStack.length > 0) {
      setUndoneStack(prev => prev.slice(0, -1))
    } else {
      dequeue()
    }
  }, [displayedCard, undoneStack.length, dequeue])

  const historyRef = useRef(history)
  historyRef.current = history

  const handleUndo = useCallback(() => {
    const currentHistory = historyRef.current
    if (currentHistory.length === 0) return

    const last = currentHistory[currentHistory.length - 1]

    setHistory(prev => prev.slice(0, -1))
    setUndoneStack(prev => [...prev, last.card])
    setExpandedCategory(null)

    if (last.decision) {
      const decToRevert = last.decision
      setDecisions(prev => prev.filter(dec => dec !== decToRevert))

      // Revert database row or pending suggestion
      void revertTeachClassification(decToRevert.tagName, {
        suggestionId: decToRevert.suggestionId,
        wasAutoApproved: decToRevert.wasAutoApproved,
        previousState: decToRevert.previousState,
      }).catch(err => {
        console.error("[QuickTeachModal] undo revert failed:", err)
        toastError({
          title: "Undo Failed",
          description: "Couldn't revert that tag on the server.",
          errorSource: "quick_teach_undo",
        })
      })
    }
  }, [])

  // Clear flash highlight after GLOW_HOLD_MS
  useEffect(() => {
    if (!flashCategory) return
    const timer = setTimeout(() => setFlashCategory(null), GLOW_HOLD_MS)
    return () => clearTimeout(timer)
  }, [flashCategory])

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    if (phase !== "playing" || !displayedCard || flashCategory) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return

      // Enter approves prediction if available
      if (e.key === "Enter" && displayedCard.proposedCategory && displayedCard.proposedSubcategory) {
        e.preventDefault()
        classify(displayedCard.proposedCategory, displayedCard.proposedSubcategory)
        return
      }

      // Subcategories selection or Categories selection based on active state
      if (expandedCategory) {
        const subcategories = TAG_SUBCATEGORIES[expandedCategory] as readonly string[]
        const keyNum = parseInt(e.key, 10)
        if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= subcategories.length) {
          e.preventDefault()
          classify(expandedCategory, subcategories[keyNum - 1])
          return
        }

        // Backspace returns to categories when inside subcategories view
        if (e.key === "Backspace") {
          e.preventDefault()
          setExpandedCategory(null)
          return
        }
      } else {
        // 1-7 enters corresponding category
        const categoryMatch = CATEGORY_CONFIG.find(c => c.key === e.key)
        if (categoryMatch) {
          e.preventDefault()
          setExpandedCategory(categoryMatch.id)
          return
        }

        // Backspace undoes at top level
        if (e.key === "Backspace") {
          e.preventDefault()
          handleUndo()
          return
        }
      }

      // 'z' always undoes
      if (e.key.toLowerCase() === "z") {
        e.preventDefault()
        handleUndo()
        return
      }

      // Space or 's' skips
      if (e.key === " " || e.key.toLowerCase() === "s") {
        e.preventDefault()
        skip()
        return
      }

      // Escape goes back to categories or finishes session
      if (e.key === "Escape") {
        e.preventDefault()
        if (expandedCategory) {
          setExpandedCategory(null)
        } else {
          setPhase("summary")
        }
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [phase, displayedCard, flashCategory, expandedCategory, classify, skip, handleUndo])

  return (
    <QuickFlowModal
      open={open}
      phase={phase}
      onPhaseChange={setPhase}
      onOpenChange={onOpenChange}
      hasProgress={decisions.length > 0}
      welcome={<WelcomeScreen onStart={startGame} />}
      playing={
        <PlayingScreen
          card={displayedCard}
          isLoading={isLoading && !displayedCard}
          error={error}
          reviewedCount={reviewedCount}
          suggestedCount={suggestedCount}
          flashCategory={flashCategory}
          expandedCategory={expandedCategory}
          onSelectCategory={(cat) => setExpandedCategory(prev => prev === cat ? null : cat)}
          isLocked={!!flashCategory}
          lowMotion={lowMotion}
          canUndo={history.length > 0}
          onClassify={classify}
          onSkip={skip}
          onUndo={handleUndo}
          onFinish={() => setPhase("summary")}
        />
      }
      summary={
        <SummaryScreen
          reviewedCount={reviewedCount}
          suggestedCount={suggestedCount}
          onKeepGoing={() => setPhase("playing")}
          onDone={() => onOpenChange(false)}
        />
      }
    />
  )
}

// --- Welcome Screen ---

function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <QuickFlowWelcomeScreen
      icon={GraduationCap}
      title="Quick Teach"
      description={
        <>
          Review prioritized tags that need classification. Each tag shows its prediction
          and confidence level. Confirm the prediction or choose the right category and
          subcategory. Rapid-fire through as many as you like.
        </>
      }
      middle={
        <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
          {CATEGORY_CONFIG.map(cat => (
            <div
              key={cat.id}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium",
                cat.id === "other" && "col-span-2",
                cat.accent
              )}
            >
              <cat.icon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{cat.label}</span>
              <kbd className="ml-auto text-[10px] font-mono bg-background/70 rounded px-1.5 py-0.5 border">{cat.key}</kbd>
            </div>
          ))}
        </div>
      }
      onStart={onStart}
      startLabel="Start Teaching"
      startIcon={Sparkles}
    />
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
  expandedCategory: TagCategory | null
  onSelectCategory: (cat: TagCategory) => void
  isLocked: boolean
  lowMotion: boolean
  canUndo: boolean
  onClassify: (category: TagCategory, subcategory: string) => void
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
  expandedCategory,
  onSelectCategory,
  isLocked,
  lowMotion,
  canUndo,
  onClassify,
  onSkip,
  onUndo,
  onFinish,
}: PlayingScreenProps) {
  return (
    <div className="flex flex-col h-[85vh] max-h-[720px] overflow-y-auto">
      {/* Top bar: progress + finish */}
      <div className="flex items-center justify-between gap-3 p-4 pb-3 border-b bg-muted/20 shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="secondary" className="font-mono">{reviewedCount} reviewed</Badge>
          <Badge variant="secondary" className="font-mono text-primary-text">{suggestedCount} classified</Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onFinish}
          className="h-7 text-xs text-muted-foreground active:scale-[0.96] transition-transform duration-150"
        >
          Finish
        </Button>
      </div>

      {/* Card stage */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 gap-4 relative overflow-y-auto">
        <span className="sr-only" aria-live="polite" role="status">
          {card ? `Current tag: ${card.tag}` : isLoading ? "Loading more tags" : error ?? "No more tags right now"}
        </span>

        <AnimatePresence mode="wait">
          {card ? (
            <motion.div
              key={card.tag}
              initial={lowMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={lowMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -6 }}
              transition={
                lowMotion
                  ? { duration: 0.12 }
                  : { duration: 0.2, ease: [0.23, 1, 0.32, 1] }
              }
              className={cn(
                "relative w-full max-w-sm rounded-2xl border-2 bg-card shadow-lg px-6 py-6 sm:py-7 flex flex-col items-center justify-center gap-3 text-center select-none transition-colors duration-150",
                flashCategory ? CATEGORY_CONFIG.find(c => c.id === flashCategory)?.activeAccent : "border-border"
              )}
            >
              {/* Tag Name in Large Typography */}
              <span className="text-2xl sm:text-3xl font-semibold leading-tight break-words">
                {card.tag}
              </span>

              {/* Tag Post Count Badge */}
              <Badge variant="outline" className="text-xs font-mono font-normal text-muted-foreground">
                {card.postCount.toLocaleString()} posts
              </Badge>

              {/* Prediction & Confidence Line (Zero mention of AI / Jev) */}
              {card.proposedCategory && card.proposedSubcategory && (
                <div className="flex flex-col items-center gap-2 mt-1 w-full">
                  <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">Prediction:</span>
                    <Badge variant="outline" className="font-mono text-xs px-2 py-0.5 border-primary/30 bg-primary/5 text-primary-text">
                      {card.proposedCategory} › {formatSubcategoryLabel(card.proposedSubcategory)}
                    </Badge>
                    {card.confidence !== null && (
                      <span className="text-[11px] text-muted-foreground/80 font-mono">
                        · {Math.round(card.confidence * 100)}% confidence
                      </span>
                    )}
                  </div>

                  {/* 1-Click Accept Prediction Shortcut */}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => onClassify(card.proposedCategory!, card.proposedSubcategory!)}
                    disabled={isLocked}
                    className="h-7 text-xs gap-1.5 bg-primary/10 hover:bg-primary/20 text-primary-text border border-primary/25 active:scale-[0.96] transition-all"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Accept prediction
                    <kbd className="ml-1 text-[10px] font-mono opacity-70 bg-background/80 px-1 py-0.5 rounded border">↵ Enter</kbd>
                  </Button>
                </div>
              )}

              {/* Booru Wiki lookup link */}
              <Button
                asChild
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground active:scale-[0.96] transition-transform duration-150 mt-1"
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
                  <span className="text-sm">Fetching tags for review…</span>
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
          <p className="text-xs text-muted-foreground text-center">
            Accept prediction or choose a primary category below to select its subcategory.
          </p>
        )}
      </div>

      {/* Category / Subcategory Stage (In-place replacement with smooth transition) */}
      <div className="p-4 pt-2 shrink-0 min-h-[240px] flex flex-col justify-end">
        <AnimatePresence mode="wait" initial={false}>
          {!expandedCategory ? (
            <motion.div
              key="categories-grid"
              initial={lowMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={lowMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              className="grid grid-cols-2 gap-2"
            >
              {CATEGORY_CONFIG.map(cat => (
                <Button
                  key={cat.id}
                  type="button"
                  variant="outline"
                  disabled={!card || isLocked}
                  onClick={() => onSelectCategory(cat.id)}
                  className={cn(
                    "h-14 flex-col gap-1 transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.96]",
                    cat.id === "other" && "col-span-2",
                    cat.accent
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <cat.icon className="w-4 h-4" />
                    <span className="text-sm font-medium">{cat.label}</span>
                  </div>
                  <kbd className="text-[10px] font-mono opacity-60">{cat.key}</kbd>
                </Button>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key={`subcategories-${expandedCategory}`}
              initial={lowMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={lowMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              className="flex flex-col gap-2.5"
            >
              {/* Header with Back button and Active Category pill */}
              <div className="flex items-center justify-between px-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onSelectCategory(expandedCategory)}
                  className="h-7 -ml-2 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground active:scale-[0.96]"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Categories</span>
                  <kbd className="text-[10px] font-mono opacity-60 ml-0.5 bg-muted rounded px-1 py-0.2 border">Esc</kbd>
                </Button>

                {(() => {
                  const activeCat = CATEGORY_CONFIG.find(c => c.id === expandedCategory)
                  if (!activeCat) return null
                  return (
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <activeCat.icon className="w-4 h-4 text-primary-text" />
                      <span className="capitalize">{activeCat.label}</span>
                    </div>
                  )
                })()}
              </div>

              {/* Subcategories Grid */}
              <div className={cn(
                "grid gap-2 max-h-[240px] overflow-y-auto pr-0.5",
                TAG_SUBCATEGORIES[expandedCategory].length > 4 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"
              )}>
                {TAG_SUBCATEGORIES[expandedCategory].map((subcat, idx) => {
                  const activeCat = CATEGORY_CONFIG.find(c => c.id === expandedCategory)
                  const shortcutKey = idx < 9 ? String(idx + 1) : null
                  return (
                    <Button
                      key={subcat}
                      type="button"
                      variant="outline"
                      disabled={isLocked}
                      onClick={() => onClassify(expandedCategory, subcat)}
                      className={cn(
                        "h-12 sm:h-13 flex items-center justify-between px-3 text-xs sm:text-sm font-medium transition-all active:scale-[0.96]",
                        activeCat?.accent
                      )}
                    >
                      <span className="truncate capitalize">{formatSubcategoryLabel(subcat)}</span>
                      {shortcutKey && (
                        <kbd className="text-[10px] font-mono opacity-60 ml-1.5 shrink-0 bg-background/80 rounded px-1.5 py-0.5 border">
                          {shortcutKey}
                        </kbd>
                      )}
                    </Button>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Bar: Skip & Undo */}
      <div className="flex items-center gap-2 p-4 pt-1 shrink-0">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!card || isLocked}
          onClick={onSkip}
          className="flex-1 gap-1.5 active:scale-[0.96] transition-transform duration-150"
        >
          <SkipForward className="w-3.5 h-3.5" />
          Skip
          <kbd className="ml-1 text-[10px] font-mono opacity-60">Space</kbd>
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!canUndo}
          onClick={onUndo}
          className="flex-1 gap-1.5 active:scale-[0.96] transition-transform duration-150"
        >
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
  onKeepGoing,
  onDone,
}: {
  reviewedCount: number
  suggestedCount: number
  onKeepGoing: () => void
  onDone: () => void
}) {
  return (
    <QuickFlowSummaryScreen
      title="Thank you!"
      description={
        suggestedCount > 0
          ? `${suggestedCount} tag${suggestedCount !== 1 ? "s" : ""} classified.`
          : "Here's what you got through this session."
      }
      stats={
        <>
          <QuickFlowStatBlock value={reviewedCount} label="Reviewed" />
          <QuickFlowStatBlock value={suggestedCount} label="Classified" highlight />
        </>
      }
      onKeepGoing={onKeepGoing}
      keepGoingLabel="Keep Teaching"
      onDone={onDone}
    />
  )
}
