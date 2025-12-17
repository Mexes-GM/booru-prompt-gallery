'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { 
  DndContext, 
  DragOverlay, 
  closestCorners, 
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
  verticalListSortingStrategy,
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
import { Loader2 } from "lucide-react"
import { submitTagSuggestions } from '@/app/actions/suggestions'
import { TagCategory } from '@/lib/tag-classifier'

// --- Types ---

type ColumnId = TagCategory
type Items = Record<ColumnId, string[]>

interface TeachModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialClassifiedTags: Record<ColumnId, string[]>
}

const COLUMNS: { id: ColumnId; title: string }[] = [
  { id: 'appearance', title: 'Appearance' },
  { id: 'clothing', title: 'Clothing' },
  { id: 'pose', title: 'Pose' },
  { id: 'scenery', title: 'Scenery' },
  { id: 'other', title: 'Unclassified' },
]

// --- Sortable Item Component ---

function SortableItem({ id, category }: { id: string, category: ColumnId }) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`
        p-2 mb-2 rounded border bg-card shadow-sm cursor-grab active:cursor-grabbing text-sm break-words
        ${isDragging ? 'opacity-50 ring-2 ring-primary' : 'hover:border-primary/50'}
      `}
    >
      {id}
    </div>
  )
}

// --- Column Component ---

function Column({ id, title, items }: { id: ColumnId, title: string, items: string[] }) {
  const { setNodeRef } = useSortable({ id })

  return (
    <div className="flex flex-col h-full min-w-[160px] w-48 bg-muted/30 rounded-lg p-2 mx-1 shrink-0">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm truncate pr-2" title={title}>{title}</h3>
        <Badge variant="secondary" className="text-xs px-1.5 h-5 min-w-[1.25rem] justify-center">{items.length}</Badge>
      </div>
      <div className="flex-1 overflow-y-auto pr-2 -mr-2 scrollbar-thin scrollbar-thumb-rounded-md scrollbar-thumb-muted-foreground/20">
        <div ref={setNodeRef} className="min-h-[100px]">
          <SortableContext 
            id={id}
            items={items} 
            strategy={verticalListSortingStrategy}
          >
            {items.map((item) => (
              <SortableItem key={item} id={item} category={id} />
            ))}
          </SortableContext>
        </div>
      </div>
    </div>
  )
}

// --- Main Modal Component ---

export function TeachModal({ open, onOpenChange, initialClassifiedTags }: TeachModalProps) {
  const [items, setItems] = useState<Items>(initialClassifiedTags)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { toast } = useToast()

  // Reset items when modal opens or props change
  useEffect(() => {
    if (open) {
      setItems(initialClassifiedTags)
    }
  }, [open, initialClassifiedTags])

  const sensors = useSensors(
    useSensor(PointerSensor),
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
      const activeIndex = activeItems.indexOf(active.id as string)
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
          items[activeContainer][activeIndex],
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
        const overIndex = overItems.indexOf(over.id as string)

        let newIndex
        if (over.id in prev) {
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
    const suggestions = []
    
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
            currentCategory: originalCategory,
            suggestedCategory: category
          })
        }
      }
    }

    try {
      const result = await submitTagSuggestions(suggestions)
      
      if (result.success) {
        toast({
          title: "Suggestions Submitted",
          description: "Thank you for helping improve the tag classification!",
        })
        onOpenChange(false)
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
      if (window.confirm("You have unsaved changes. Are you sure you want to discard them?")) {
        onOpenChange(false)
      }
    } else {
      onOpenChange(false)
    }
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
    <Dialog open={open} onOpenChange={(val) => !val ? handleCancel() : onOpenChange(val)}>
      {/* 
         Using !important modifiers to force centering and override any conflicting styles 
         from the base component or animations.
      */}
      <DialogContent className="!fixed !left-[50%] !top-[50%] !-translate-x-[50%] !-translate-y-[50%] z-[100] max-w-[95vw] w-fit max-h-[90vh] flex flex-col p-0 gap-0 border bg-background shadow-lg sm:rounded-lg overflow-hidden">
        <DialogHeader className="p-6 pb-2 shrink-0">
          <DialogTitle>Suggest Tag Categories</DialogTitle>
          <DialogDescription>
            Drag and drop tags to their correct categories. Your suggestions will be reviewed by the community.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-x-auto overflow-y-hidden p-6 pt-2 h-[70vh] min-h-[400px]">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <div className="flex h-full pb-4">
              {COLUMNS.map((col) => (
                <Column 
                  key={col.id} 
                  id={col.id} 
                  title={col.title} 
                  items={items[col.id]} 
                />
              ))}
            </div>
            {mounted && createPortal(
              <DragOverlay dropAnimation={dropAnimation} zIndex={10000}>
                {activeId ? (
                  <div className="p-2 rounded border bg-card shadow-lg cursor-grabbing opacity-90 w-[200px] ring-2 ring-primary">
                    {activeId}
                  </div>
                ) : null}
              </DragOverlay>,
              document.body
            )}
          </DndContext>
        </div>

        <DialogFooter className="p-6 pt-2 shrink-0 border-t bg-background">
          <Button variant="outline" onClick={handleCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!hasChanges() || isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit Suggestions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
