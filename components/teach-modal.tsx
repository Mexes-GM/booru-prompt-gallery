'use client'

import { useState, useEffect, memo } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  defaultDropAnimationSideEffects,
  DropAnimation
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { Loader2, GripVertical, Info, Check } from "lucide-react"
import { submitTagSuggestions, getExistingSuggestions } from '@/app/actions/suggestions'
import { TagCategory } from '@/lib/tag-classifier'
import { cn } from "@/lib/utils"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { motion, AnimatePresence } from "framer-motion"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// --- Types ---

type ColumnId = TagCategory
type Items = Record<ColumnId, string[]>

interface TeachModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialClassifiedTags: Record<ColumnId, string[]>
  onSuccess?: () => void
}

const COLUMNS: { id: ColumnId; title: string; description: string }[] = [
  { id: 'appearance', title: 'Appearance', description: 'Physical traits like eye color, hair style, skin tone' },
  { id: 'clothing', title: 'Clothing', description: 'Attire, accessories, and footwear' },
  { id: 'pose', title: 'Pose', description: 'Body position, gestures, and angles' },
  { id: 'scenery', title: 'Scenery', description: 'Background, location, and environmental elements' },
  { id: 'other', title: 'Unclassified', description: 'Tags that need categorization' },
]

const CATEGORY_STYLES: Record<string, string> = {
  appearance: "border-blue-500/50 bg-blue-500/5 hover:border-blue-500 hover:bg-blue-500/10",
  clothing: "border-green-500/50 bg-green-500/5 hover:border-green-500 hover:bg-green-500/10",
  pose: "border-purple-500/50 bg-purple-500/5 hover:border-purple-500 hover:bg-purple-500/10",
  scenery: "border-orange-500/50 bg-orange-500/5 hover:border-orange-500 hover:bg-orange-500/10",
  other: "border-muted-foreground/30 bg-muted/30"
}

const COLUMN_HEADER_STYLES: Record<string, string> = {
  appearance: "border-blue-500/20 bg-blue-500/5 text-blue-700 dark:text-blue-300",
  clothing: "border-green-500/20 bg-green-500/5 text-green-700 dark:text-green-300",
  pose: "border-purple-500/20 bg-purple-500/5 text-purple-700 dark:text-purple-300",
  scenery: "border-orange-500/20 bg-orange-500/5 text-orange-700 dark:text-orange-300",
  other: "border-muted-foreground/20 bg-muted/40"
}

// --- Sortable Item Component ---

const SortableItem = memo(function SortableItem({ id, category, suggestedCategory }: { id: string, category: ColumnId, suggestedCategory?: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  // Determine styles
  let itemStyles = "border bg-card text-card-foreground shadow-sm hover:border-primary/50 hover:shadow-md"
  let showSuggestion = false
  let suggestionLabel = ""

  if (category === 'other' && suggestedCategory && suggestedCategory !== 'other') {
    showSuggestion = true
    itemStyles = CATEGORY_STYLES[suggestedCategory] || itemStyles
    // Simple capitalize for label since we removed the map
    suggestionLabel = suggestedCategory.charAt(0).toUpperCase() + suggestedCategory.slice(1)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "group relative inline-flex items-center gap-2 p-2 rounded-lg border transition-all touch-none cursor-grab active:cursor-grabbing",
        isDragging
          ? "opacity-50 ring-2 ring-primary z-50 shadow-xl scale-105 bg-card"
          : itemStyles
      )}
    >
      <div
        className="p-1 -ml-1 rounded text-muted-foreground/50 group-hover:text-foreground transition-colors"
      >
        <GripVertical className="h-5 w-5 md:h-4 md:w-4" />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-base md:text-sm font-medium leading-tight select-none">
          {id}
        </span>
        {showSuggestion && !isDragging && (
          <span className="text-[10px] text-muted-foreground font-normal mt-0.5 flex items-center gap-1">
            {suggestionLabel}
          </span>
        )}
      </div>
    </div>
  )
})

// --- Column Component ---

const Column = memo(function Column({ id, title, description, items, suggestions }: { id: ColumnId, title: string, description: string, items: string[], suggestions: Record<string, string> }) {
  const { setNodeRef } = useSortable({ id })

  const headerStyle = COLUMN_HEADER_STYLES[id] || COLUMN_HEADER_STYLES.other

  return (
    <div className={cn("flex flex-col h-auto md:h-full w-full md:w-auto flex-none md:flex-1 min-w-0 rounded-xl border p-1 transition-colors", headerStyle)}>
      <div className="flex items-center justify-between p-3 shrink-0 gap-2">
        <div className="flex items-center gap-2 overflow-hidden min-w-0">
          <h3 className="font-semibold text-base md:text-sm truncate">{title}</h3>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 md:h-3 md:w-3 opacity-50 hover:opacity-100 transition-opacity cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{description}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Badge variant="secondary" className="text-xs font-mono bg-background/50 hover:bg-background/80">
          {items.length}
        </Badge>
      </div>

      <div className="flex-1 px-2 pb-2 min-h-0 flex flex-col">
        <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
          <div ref={setNodeRef} className="min-h-full flex flex-wrap gap-2 content-start pb-4">
            <SortableContext
              id={id}
              items={items}
              strategy={rectSortingStrategy}
            >
              {items.map((item) => (
                <SortableItem
                  key={item}
                  id={item}
                  category={id}
                  suggestedCategory={suggestions[item]}
                />
              ))}
              {items.length === 0 && (
                <div className="w-full h-24 rounded-lg border-2 border-dashed border-muted-foreground/20 flex items-center justify-center text-xs text-muted-foreground/50">
                  Drop items here
                </div>
              )}
            </SortableContext>
          </div>
        </div>
      </div>
    </div>
  )
})

// --- Success Animation Component ---

const SuccessAnimation = memo(function SuccessAnimation() {
  const particles = Array.from({ length: 20 })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-md"
    >
      <div className="relative flex flex-col items-center justify-center">
        {/* Particles */}
        {particles.map((_, i) => (
          <motion.div
            key={i}
            initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
            animate={{
              x: (Math.random() - 0.5) * 300,
              y: (Math.random() - 0.5) * 300,
              scale: [0, Math.random() + 0.5, 0],
              opacity: [1, 1, 0],
              rotate: Math.random() * 360
            }}
            transition={{
              duration: 1.5 + Math.random(),
              ease: "easeOut",
              delay: Math.random() * 0.2
            }}
            className={cn(
              "absolute w-2 h-2 rounded-full",
              i % 3 === 0 ? "bg-blue-500" : i % 3 === 1 ? "bg-purple-500" : "bg-primary"
            )}
          />
        ))}

        {/* Main Icon Circle */}
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{
            type: "spring",
            stiffness: 260,
            damping: 20,
            delay: 0.1
          }}
          className="w-24 h-24 bg-gradient-to-br from-primary to-primary/60 rounded-full flex items-center justify-center shadow-lg shadow-primary/25 z-10"
        >
          <motion.div
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            <Check className="w-12 h-12 text-primary-foreground stroke-[3px]" />
          </motion.div>
        </motion.div>

        {/* Text */}
        <div className="text-center mt-6 space-y-2 z-10">
          <motion.h3
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="text-2xl font-bold tracking-tight"
          >
            Thank You!
          </motion.h3>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="text-muted-foreground font-medium"
          >
            Your suggestions help improve the gallery.
          </motion.p>
        </div>
      </div>
    </motion.div>
  )
})

// --- Main Modal Component ---

export function TeachModal({ open, onOpenChange, initialClassifiedTags, onSuccess }: TeachModalProps) {
  const [items, setItems] = useState<Items>(initialClassifiedTags)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [existingSuggestions, setExistingSuggestions] = useState<Record<string, string>>({})
  const [showExitAlert, setShowExitAlert] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [activeMobileTab, setActiveMobileTab] = useState<ColumnId>('other')
  const { toast } = useToast()

  // Reset states when modal is closed
  useEffect(() => {
    if (!open) {
      // Small delay to allow exit animation to finish
      const timer = setTimeout(() => {
        setIsSuccess(false)
        setIsSubmitting(false)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [open])

  // Reset items when modal opens or props change
  useEffect(() => {
    if (open) {
      // Only update if the tags actually changed and we are not in success state
      // This prevents UI jumping while the success animation is playing
      if (isSuccess) return

      const currentTagsJson = JSON.stringify(items)
      const newTagsJson = JSON.stringify(initialClassifiedTags)

      if (currentTagsJson !== newTagsJson) {
        setItems(initialClassifiedTags)
        setIsReady(false)

        // Delay rendering of heavy content to allow modal animation to start
        const timer = setTimeout(() => {
          setIsReady(true)
        }, 50)

        // Fetch existing suggestions
        const allTags = Object.values(initialClassifiedTags).flat()
        if (allTags.length > 0) {
          getExistingSuggestions(allTags).then(suggestions => {
            setExistingSuggestions(suggestions)
          })
        }

        return () => clearTimeout(timer)
      } else if (!isReady) {
        // Ensure isReady is true if we didn't reset
        setIsReady(true)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialClassifiedTags, isReady, isSuccess])

  // Timer for closing modal after success animation
  useEffect(() => {
    if (isSuccess) {
      const timer = setTimeout(() => {
        onOpenChange(false)
        // Refresh parent overrides when closing after success
        if (onSuccess) onSuccess()
        // Small delay to reset success state after modal close animation starts
        setTimeout(() => setIsSuccess(false), 300)
      }, 2500)
      return () => clearTimeout(timer)
    }
  }, [isSuccess, onOpenChange, onSuccess])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const findContainer = (id: string): ColumnId | undefined => {
    if (id in items) {
      return id as ColumnId
    }
    return Object.keys(items).find((key) => items[key as ColumnId].includes(id)) as ColumnId | undefined
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    const overId = over?.id

    if (!overId || active.id === overId) {
      return
    }

    const activeContainer = findContainer(active.id as string)
    const overContainer = findContainer(overId as string)

    if (
      !activeContainer ||
      !overContainer ||
      activeContainer === overContainer
    ) {
      return
    }

    setItems((prev) => {
      const activeItems = prev[activeContainer]
      const overItems = prev[overContainer]

      // Safety check: Ensure item is actually in the source container in the current state
      // This prevents infinite loops caused by stale closure state in handleDragOver
      const activeIndex = activeItems.indexOf(active.id as string)
      if (activeIndex === -1) {
        return prev
      }

      const overIndex = overItems.indexOf(overId as string)

      let newIndex
      if (overId in prev) {
        newIndex = overItems.length + 1
      } else {
        const isBelowOverItem =
          over &&
          active.rect.current.translated &&
          active.rect.current.translated.top >
          over.rect.top + over.rect.height

        const modifier = isBelowOverItem ? 1 : 0
        newIndex = overIndex >= 0 ? overIndex + modifier : overItems.length + 1
      }

      return {
        ...prev,
        [activeContainer]: [
          ...prev[activeContainer].filter((item) => item !== active.id),
        ],
        [overContainer]: [
          ...prev[overContainer].slice(0, newIndex),
          activeItems[activeIndex],
          ...prev[overContainer].slice(newIndex, prev[overContainer].length),
        ],
      }
    })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    const activeContainer = findContainer(active.id as string)
    const overContainer = over ? findContainer(over.id as string) : null

    if (
      activeContainer &&
      overContainer &&
      activeContainer !== overContainer
    ) {
      setItems((prev) => {
        const activeItems = prev[activeContainer]
        const overItems = prev[overContainer]
        const activeIndex = activeItems.indexOf(active.id as string)
        const overIndex = overItems.indexOf(over!.id as string)

        let newIndex
        if (over!.id in prev) {
          newIndex = overItems.length + 1
        } else {
          const isBelowOverItem =
            over! &&
            active.rect.current.translated &&
            active.rect.current.translated.top >
            over!.rect.top + over!.rect.height

          const modifier = isBelowOverItem ? 1 : 0
          newIndex = overIndex >= 0 ? overIndex + modifier : overItems.length + 1
        }

        return {
          ...prev,
          [activeContainer]: [
            ...prev[activeContainer].filter((item) => item !== active.id),
          ],
          [overContainer]: [
            ...prev[overContainer].slice(0, newIndex),
            items[activeContainer][activeIndex],
            ...prev[overContainer].slice(newIndex, prev[overContainer].length),
          ],
        }
      })
    }

    setActiveId(null)
  }

  const hasChanges = () => {
    for (const key of Object.keys(initialClassifiedTags) as ColumnId[]) {
      const initialSet = new Set(initialClassifiedTags[key])
      const currentSet = new Set(items[key])

      // Simple length check first
      if (initialSet.size !== currentSet.size) return true

      // Check content
      for (const item of currentSet) {
        if (!initialSet.has(item)) return true
      }
    }
    return false
  }

  const handleSubmit = async () => {
    if (!hasChanges()) return

    setIsSubmitting(true)

    // Calculate diffs
    const suggestions: Array<{ tagName: string; currentCategory: TagCategory; suggestedCategory: TagCategory }> = []

    // For each item in the current state, check if its category changed from initial
    for (const [category, tags] of Object.entries(items)) {
      for (const tag of tags) {
        // Find where it was originally
        const originalCategory = Object.keys(initialClassifiedTags).find(key =>
          initialClassifiedTags[key as ColumnId].includes(tag)
        )

        if (originalCategory && originalCategory !== category) {
          suggestions.push({
            tagName: tag,
            currentCategory: originalCategory as TagCategory,
            suggestedCategory: category as TagCategory
          })
        }
      }
    }

    try {
      const result = await submitTagSuggestions(suggestions)

      if (result.success) {
        setIsSuccess(true)

        // Update local suggestions state immediately so UI shows badges/styles
        setExistingSuggestions(prev => {
          const next = { ...prev }
          suggestions.forEach(s => {
            next[s.tagName] = s.suggestedCategory
          })
          return next
        })

        // Removed immediate onSuccess() to avoid parent re-render cutting the animation
      } else {
        toast({
          title: "Submission Failed",
          description: result.message,
          variant: "destructive"
        })
      }
    } catch (error) {
      console.error(error)
      toast({
        title: "Error",
        description: "An unexpected error occurred.",
        variant: "destructive"
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    if (hasChanges()) {
      setShowExitAlert(true)
    } else {
      onOpenChange(false)
    }
  }

  const handleConfirmExit = () => {
    setShowExitAlert(false)
    onOpenChange(false)
  }

  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: '0.5',
        },
      },
    }),
  }

  // Use Portal for DragOverlay to avoid z-index/overflow clipping issues
  // and fix the "disappearing" item bug
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <>
      <Dialog open={open} onOpenChange={(val) => !val ? handleCancel() : onOpenChange(val)}>
        <DialogContent
          overlayClassName="backdrop-blur-none bg-background/60"
          className="max-w-[95vw] w-full lg:max-w-7xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-xl"
        >
          <AnimatePresence>
            {isSuccess && <SuccessAnimation />}
          </AnimatePresence>

          <DialogHeader className="p-4 md:p-6 pb-3 md:pb-4 shrink-0 border-b bg-muted/20">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1.5">
                <DialogTitle className="text-lg md:text-xl">Suggest Tag Categories</DialogTitle>
                <DialogDescription className="text-sm md:text-base">
                  Drag and drop tags to their correct categories to help improve our classification system.
                </DialogDescription>
              </div>
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground bg-background/50 p-2 rounded-md border shrink-0">
                <Info className="h-4 w-4 text-blue-500" />
                <p className="max-w-[200px] leading-tight">Colored tags in <span className="font-medium">Unclassified</span> are pending suggestions.</p>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-hidden bg-background/50 relative">
            {!isReady ? (
              <div className="h-[65vh] w-full flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={pointerWithin}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
              >
                <div className="h-[65vh] w-full overflow-y-auto md:overflow-hidden">
                  {/* Mobile Tab Bar */}
                  <div className="md:hidden sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b px-2 py-1.5">
                    <ScrollArea className="w-full whitespace-nowrap">
                      <div className="flex gap-1.5 pb-1">
                        {COLUMNS.map((col) => {
                          const count = items[col.id]?.length || 0
                          const isActive = activeMobileTab === col.id
                          return (
                            <button
                              key={col.id}
                              type="button"
                              onClick={() => setActiveMobileTab(col.id)}
                              className={cn(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all shrink-0",
                                isActive
                                  ? "bg-primary text-primary-foreground shadow-sm"
                                  : "bg-muted text-muted-foreground hover:bg-muted/80 border border-border/50"
                              )}
                            >
                              {col.title}
                              <span className={cn(
                                "text-[10px] px-1 py-0 rounded-full font-mono",
                                isActive ? "bg-black/20" : "bg-background/80"
                              )}>{count}</span>
                            </button>
                          )
                        })}
                      </div>
                      <ScrollBar orientation="horizontal" className="h-1.5" />
                    </ScrollArea>
                  </div>

                  <div className="flex flex-col md:flex-row h-auto md:h-full gap-3 md:gap-4 w-full p-2 md:p-6">
                    {COLUMNS.map((col) => (
                      <div
                        key={col.id}
                        className={cn(
                          "md:flex-1 md:w-auto",
                          "md:block",
                          activeMobileTab === col.id ? "block" : "hidden md:block"
                        )}
                      >
                        <Column
                          id={col.id}
                          title={col.title}
                          description={col.description}
                          items={items[col.id]}
                          suggestions={existingSuggestions}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {mounted && createPortal(
                  <DragOverlay dropAnimation={dropAnimation} zIndex={10000}>
                    {activeId ? (
                      <div className="group relative flex items-center gap-2 p-3 rounded-lg border bg-card text-card-foreground shadow-xl ring-2 ring-primary opacity-90 scale-105 w-[260px] md:w-[280px]">
                        <div className="p-1 -ml-1 text-muted-foreground">
                          <GripVertical className="h-4 w-4" />
                        </div>
                        <span className="text-sm font-medium leading-tight break-all">
                          {activeId}
                        </span>
                      </div>
                    ) : null}
                  </DragOverlay>,
                  document.body
                )}
              </DndContext>
            )}
          </div>

          <DialogFooter className="p-3 md:p-4 shrink-0 border-t bg-muted/20 gap-2 sm:gap-0">
            <div className="flex items-center gap-2 mr-auto text-xs text-muted-foreground hidden sm:flex">
              <Info className="h-3 w-3" />
              <span>Changes are auto-saved locally until submission</span>
            </div>
            <div className="flex gap-2 w-full sm:w-auto justify-end">
              <Button variant="outline" onClick={handleCancel} disabled={isSubmitting} className="flex-1 sm:flex-none">
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!hasChanges() || isSubmitting} className="flex-1 sm:flex-none">
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit Suggestions
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showExitAlert} onOpenChange={setShowExitAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to leave?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. If you leave now, your tag classification suggestions will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Editing</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmExit} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
