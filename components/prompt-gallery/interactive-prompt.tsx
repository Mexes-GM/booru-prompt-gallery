"use client"

import React, { useState, useEffect } from "react"
import { Plus, Minus, RotateCcw } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface TagData {
  id: string
  text: string
  weight: number
}

interface InteractivePromptProps {
  initialPrompt: string
  onUpdate: (newPrompt: string) => void
  isEditable?: boolean
}

// Utility to parse a single tag string into TagData
const parseTag = (rawTag: string, index: number): TagData => {
  const trimmed = rawTag.trim()
  
  const weightMatch = trimmed.match(/^\((.*):([0-9.]+)\)$/)
  if (weightMatch) {
    return {
      id: `tag-${index}-${weightMatch[1]}`,
      text: weightMatch[1],
      weight: parseFloat(weightMatch[2])
    }
  }

  const simpleParenMatch = trimmed.match(/^\((.*)\)$/)
  if (simpleParenMatch && !trimmed.includes(':')) {
     return {
        id: `tag-${index}-${simpleParenMatch[1]}`,
        text: simpleParenMatch[1],
        weight: 1.1
     }
  }

  return {
    id: `tag-${index}-${trimmed}`,
    text: trimmed,
    weight: 1.0
  }
}

const buildPrompt = (tags: TagData[]): string => {
  return tags.map(tag => {
    if (tag.weight === 1.0) return tag.text
    return `(${tag.text}:${tag.weight.toFixed(1)})`
  }).join(", ")
}

export const InteractivePrompt = React.memo(function InteractivePrompt({
  initialPrompt,
  onUpdate,
  isEditable = true
}: InteractivePromptProps) {
  const [tags, setTags] = useState<TagData[]>([])
  
  useEffect(() => {
    if (!initialPrompt) {
        setTags([])
        return
    }
    const splitTags = initialPrompt.split(',').filter(t => t.trim())
    const parsed = splitTags.map((t, i) => parseTag(t, i))
    setTags(parsed)
  }, [initialPrompt])

  const handleCommit = (id: string, newWeight: number) => {
    // Calculate new state based on current tags
    // Since this runs in an event handler, 'tags' is stable enough or we use functional update pattern correctly
    // To be safe and clean, we use the functional pattern for setTags but we need to calculate 'next' 
    // to pass to onUpdate. Best way: calculate from current 'tags' if we trust it's fresh, 
    // or use a temporary variable if we were inside a complex closure. 
    // Here 'tags' is from the render scope.
    
    const nextTags = tags.map(t => {
      if (t.id !== id) return t
      return { ...t, weight: newWeight }
    })
    
    setTags(nextTags)
    onUpdate(buildPrompt(nextTags))
  }

  // Handle immediate visual update for simple reset
  const handleReset = (id: string) => {
    const nextTags = tags.map(t => {
      if (t.id !== id) return t
      return { ...t, weight: 1.0 }
    })
    
    setTags(nextTags)
    onUpdate(buildPrompt(nextTags))
  }

  if (!tags.length) return <p className="text-foreground/80 leading-relaxed italic">No prompt content</p>

  return (
    <div className="text-sm text-foreground/80 leading-relaxed break-words">
      {tags.map((tag, i) => (
        <React.Fragment key={tag.id}>
           <PromptTag 
             tag={tag} 
             onCommit={handleCommit}
             onReset={handleReset}
             isEditable={isEditable}
           />
           {i < tags.length - 1 && <span>, </span>}
        </React.Fragment>
      ))}
    </div>
  )
})

interface PromptTagProps {
  tag: TagData
  onCommit: (id: string, newWeight: number) => void
  onReset: (id: string) => void
  isEditable: boolean
}

const PromptTag = ({ tag, onCommit, onReset, isEditable }: PromptTagProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [draftWeight, setDraftWeight] = useState(tag.weight)

  // Sync draft weight when tag changes externally
  useEffect(() => {
    setDraftWeight(tag.weight)
  }, [tag.weight])

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) {
        // Commit on close
        if (draftWeight !== tag.weight) {
            onCommit(tag.id, draftWeight)
        }
    }
  }

  const handleWeightChange = (delta: number) => {
    setDraftWeight(prev => {
        const next = Math.max(0.1, Math.min(3.0, prev + delta))
        return parseFloat(next.toFixed(1))
    })
  }

  // Determine what text to show: live draft if open, stable prop if closed
  const currentWeight = isOpen ? draftWeight : tag.weight
  const showWeight = currentWeight !== 1.0
  const currentText = showWeight ? `(${tag.text}:${currentWeight})` : tag.text

  const isModified = currentWeight !== 1.0
  const isHeavy = currentWeight > 1.0
  
  const textClass = isModified 
    ? isHeavy 
        ? "text-blue-600 dark:text-blue-400 font-medium" 
        : "text-red-600 dark:text-red-400 font-medium"
    : "text-foreground/80"

  const bgClass = isOpen 
    ? "bg-muted shadow-sm ring-1 ring-ring/20 font-semibold" 
    : isModified
        ? isHeavy ? "bg-blue-500/10" : "bg-red-500/10"
        : "hover:bg-muted"

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <span 
          className={cn(
            "cursor-pointer px-0.5 -mx-0.5 rounded transition-colors duration-200 decoration-clone select-text outline-none inline",
            textClass,
            bgClass
          )}
          onClick={(e) => {
             e.stopPropagation()
             // Trigger handles open, but stopping prop is good
          }}
        >
          {currentText}
        </span>
      </PopoverTrigger>

      {isEditable && (
        <PopoverContent 
          className="w-auto p-1 z-50" 
          side="top" 
          align="center"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-0.5">
            <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 hover:bg-muted"
                onClick={() => handleWeightChange(-0.1)}
            >
                <Minus className="h-3.5 w-3.5" />
            </Button>
            <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 hover:bg-muted"
                onClick={() => handleWeightChange(0.1)}
            >
                <Plus className="h-3.5 w-3.5" />
            </Button>
            
            <div className="h-4 w-[1px] bg-border mx-1" />
            
            <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 hover:text-blue-500 hover:bg-blue-500/10"
                onClick={() => {
                    setDraftWeight(1.0)
                    // Keep open
                }}
                disabled={draftWeight === 1.0}
                title="Reset weight"
            >
                <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}
