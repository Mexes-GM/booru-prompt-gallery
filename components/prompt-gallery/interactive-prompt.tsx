"use client"

import React, { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { Plus, Minus, RotateCcw, Globe, Search, AlertCircle, Copy, Check } from "lucide-react"
import { usePostHog } from 'posthog-js/react'
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { parseTagString } from "@/lib/weight-utils"
import { useToast } from "@/hooks/use-toast"

interface TagData {
  id: string
  text: string
  weight: number
}

interface InteractivePromptProps {
  initialPrompt: string
  onUpdate: (newPrompt: string) => void
  isEditable?: boolean
  onWeightChange?: (tag: string, weight: number) => void
  onPromoteToGlobal?: (tag: string, weight: number) => void
  globalWeights?: Record<string, number>
  onSearch?: (tag: string) => void
  conflictingTags?: { tag: string; reason: string }[]
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
  isEditable = true,
  onWeightChange,
  onPromoteToGlobal,
  globalWeights = {},
  onSearch,
  conflictingTags = []
}: InteractivePromptProps) {
  const [tags, setTags] = useState<TagData[]>([])

  useEffect(() => {
    if (!initialPrompt) {
      setTags([])
      return
    }
    const splitTags = initialPrompt.split(',').filter(t => t.trim())

    // Use shared parser
    const parsed = splitTags.map((t, i) => {
      const { text, weight } = parseTagString(t)
      return {
        id: `tag-${i}-${text}`,
        text,
        weight
      }
    })
    setTags(parsed)
  }, [initialPrompt])

  const handleCommit = useCallback((id: string, newWeight: number) => {
    setTags(prevTags => {
      const nextTags = prevTags.map(t => {
        if (t.id !== id) return t
        return { ...t, weight: newWeight }
      })
      onUpdate(buildPrompt(nextTags))
      if (onWeightChange) {
        onWeightChange(id.replace(/^tag-\d+-/, ''), newWeight)
      }
      return nextTags
    })
  }, [onUpdate, onWeightChange])

  const handleSearchTag = useCallback((tagText: string) => {
    onSearch?.(tagText)
  }, [onSearch])

  const handlePromoteTag = useCallback((tagText: string, weight: number) => {
    onPromoteToGlobal?.(tagText, weight)
  }, [onPromoteToGlobal])

  if (!tags.length && !conflictingTags.length) return <p className="text-foreground/80 leading-relaxed italic">No prompt content</p>

  return (
    <div className="text-sm text-foreground/80 leading-relaxed break-all text-left">
      <TooltipProvider>
        {tags.map((tag, i) => {
          // Check if this tag is globally weighted
          // Only consider it "Global" (purple) if the weight is NOT 1.0
          // A global weight of 1.0 is treated as "pass-through" or "neutral"
          const globalVal = globalWeights[tag.text.toLowerCase()]
          const isGlobal = globalVal !== undefined && globalVal !== 1.0

          return (
            <React.Fragment key={tag.id}>
              <PromptTag
                tag={tag}
                onCommit={handleCommit}
                isEditable={isEditable}
                isGlobal={isGlobal}
                onPromoteTag={onPromoteToGlobal ? handlePromoteTag : undefined}
                canPromote={!!onPromoteToGlobal}
                onSearchTag={onSearch ? handleSearchTag : undefined}
              />
              {i < tags.length - 1 && <span>, </span>}
            </React.Fragment>
          )
        })}

        {tags.length > 0 && conflictingTags.length > 0 && <span>, </span>}

        {conflictingTags.map((conflict, i) => (
          <React.Fragment key={`conflict-${i}`}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive line-through decoration-destructive/50 cursor-help border border-destructive/20 transition-colors hover:bg-destructive/20 font-medium">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  {conflict.tag}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs font-medium">
                {conflict.reason}
              </TooltipContent>
            </Tooltip>
            {i < conflictingTags.length - 1 && <span>, </span>}
          </React.Fragment>
        ))}
      </TooltipProvider>
    </div>
  )
})

interface PromptTagProps {
  tag: TagData
  onCommit: (id: string, weight: number) => void
  isEditable: boolean
  isGlobal: boolean
  onPromoteTag?: (text: string, weight: number) => void
  canPromote?: boolean
  onSearchTag?: (text: string) => void
}

const PromptTag = React.memo(function PromptTag({ tag, onCommit, isEditable, isGlobal, onPromoteTag, canPromote, onSearchTag }: PromptTagProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [draftWeight, setDraftWeight] = useState(tag.weight)
  const [justCopied, setJustCopied] = useState(false)
  const [badgePos, setBadgePos] = useState<{ top: number; left: number } | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const { toast } = useToast()
  const posthog = usePostHog()

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  const copyTag = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(tag.text)
      
      posthog.capture('dynamic_tag_copied')

      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        setBadgePos({
          top: rect.top,
          left: rect.left + rect.width / 2,
        })
      }
      setJustCopied(true)
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
      copyTimeoutRef.current = setTimeout(() => setJustCopied(false), 1200)
      toast({
        title: "Tag copied",
        description: tag.text,
      })
    } catch {
      toast({
        title: "Copy failed",
        description: "Could not copy tag to clipboard",
        variant: "destructive",
      })
    }
  }, [tag.text, toast])

  // Sync draft weight when tag changes externally
  useEffect(() => {
    setDraftWeight(tag.weight)
  }, [tag.weight])

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (open) {
      posthog.capture('dynamic_tag_clicked')
    }
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
  // We use tag.weight (committed) for the trigger text to prevent layout shift (dancing) while editing
  const currentWeight = tag.weight
  const showWeight = currentWeight !== 1.0
  const currentText = showWeight ? `(${tag.text}:${currentWeight})` : tag.text
  // Display-only: unescape booru parens/brackets (e.g. "\(alien stage\)" -> "(alien stage)").
  // The copied/committed value keeps the escapes (currentText / tag.text) for correct prompt syntax.
  const displayText = currentText.replace(/\\([()[\]])/g, "$1")

  const isModified = currentWeight !== 1.0
  const isHeavy = currentWeight > 1.0

  // Text colors
  let textClass = "text-foreground/80"
  if (isGlobal) {
    textClass = "text-purple-600 dark:text-purple-400 font-medium"
  } else if (isModified) {
    textClass = isHeavy
      ? "text-blue-600 dark:text-blue-400 font-medium"
      : "text-red-600 dark:text-red-400 font-medium"
  }

  // Backgrounds
  let bgClass = "hover:bg-muted"
  if (isOpen) {
    bgClass = "bg-muted shadow-sm ring-1 ring-ring/20 font-semibold"
  } else if (isGlobal) {
    bgClass = "bg-purple-500/10 border-b border-purple-500/30"
  } else if (isModified) {
    bgClass = isHeavy ? "bg-blue-500/10" : "bg-red-500/10"
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <motion.span
          ref={triggerRef}
          role="button"
          tabIndex={0}
          className={cn(
            "cursor-pointer px-0.5 -mx-0.5 rounded transition-colors duration-200 decoration-clone select-text outline-none inline relative border-none bg-transparent font-inherit whitespace-normal text-left break-words",
            textClass,
            justCopied ? "!bg-emerald-500/25 ring-1 ring-emerald-500/50" : bgClass
          )}
          animate={
            justCopied
              ? { scale: [1, 1.12, 1] }
              : { scale: 1 }
          }
          transition={{ duration: 0.45, ease: "easeOut" }}
          onClick={(e) => {
            e.stopPropagation()
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            copyTag()
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              // Let Radix PopoverTrigger handle the keyboard interaction
              // Radix automatically adds click handlers when using asChild
              handleOpenChange(!isOpen)
            }
          }}
          title={isGlobal ? "Global weight applied · Right-click to copy" : "Right-click to copy"}
          aria-label={isGlobal ? `Edit weight for ${tag.text} (Global). Right-click to copy.` : `Edit weight for ${tag.text}. Right-click to copy.`}
        >
          {displayText}
          {isGlobal && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-purple-500 rounded-full shadow-sm" />
          )}
        </motion.span>
      </PopoverTrigger>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {justCopied && badgePos && (
              <motion.span
                key="copied-badge"
                initial={{ opacity: 0, y: 6, scale: 0.85 }}
                animate={{ opacity: 1, y: -10, scale: 1 }}
                exit={{ opacity: 0, y: -18, scale: 0.9 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  position: "fixed",
                  top: badgePos.top,
                  left: badgePos.left,
                  transform: "translate(-50%, -100%)",
                }}
                className="pointer-events-none z-[100] flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-lg shadow-emerald-500/30 whitespace-nowrap"
                aria-hidden="true"
              >
                <Check className="h-2.5 w-2.5" />
                Copied
              </motion.span>
            )}
          </AnimatePresence>,
          document.body
        )}

      {isEditable && (
        <PopoverContent
          className="w-auto p-1 z-50"
          sideOffset={4}
          align="center"
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex flex-col gap-1">
            {isGlobal && (
              <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 rounded-sm mb-0.5">
                <Globe className="h-3 w-3" />
                <span className="font-medium">Global Weight</span>
              </div>
            )}

            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-muted"
                onClick={() => handleWeightChange(-0.1)}
                aria-label="Decrease weight"
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>

              <span className="w-8 text-center font-mono text-sm font-medium" aria-hidden="true">
                {draftWeight.toFixed(1)}
              </span>

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-muted"
                onClick={() => handleWeightChange(0.1)}
                aria-label="Increase weight"
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
                aria-label="Reset weight"
                title="Reset weight"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>

              {canPromote && (
                <>
                  <div className="h-4 w-[1px] bg-border mx-1" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-7 w-7 transition-colors",
                      isGlobal
                        ? "text-destructive hover:text-destructive hover:bg-destructive/10"
                        : "text-purple-600 hover:text-purple-700 hover:bg-purple-100 dark:text-purple-400 dark:hover:bg-purple-900/30"
                    )}
                    onClick={() => {
                      // If currently global, toggle OFF by setting weight to 1.0 (which removes it in the handler)
                      // If NOT global, toggle ON by setting weight to current draftWeight
                      let targetWeight = isGlobal ? 1.0 : draftWeight

                      // UX Enhancement: If user promotes a tag that is currently 1.0, 
                      // assume they want to increase it to 1.1 to make it visible/active as a global weight
                      if (!isGlobal && targetWeight === 1.0) {
                        targetWeight = 1.1
                      }

                      onPromoteTag?.(tag.text, targetWeight)
                      setIsOpen(false)
                    }}
                    aria-label={isGlobal ? "Remove global weight" : "Set as global weight"}
                    title={isGlobal ? "Remove Global Weight" : "Set as Global Weight"}
                  >
                    <Globe className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>

            <div className="flex flex-col gap-1 border-t pt-1 mt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full text-xs font-normal text-muted-foreground hover:text-foreground justify-start"
                onClick={() => {
                  copyTag()
                  setIsOpen(false)
                }}
              >
                <Copy className="h-3 w-3 mr-2" />
                Copy Tag
              </Button>
              
              {onSearchTag && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full text-xs font-normal text-muted-foreground hover:text-foreground justify-start"
                  onClick={() => {
                    onSearchTag(tag.text)
                    setIsOpen(false)
                  }}
                >
                  <Search className="h-3 w-3 mr-2" />
                  Search Tag
                </Button>
              )}
            </div>

          </div>
        </PopoverContent>
      )}
    </Popover>
  )
})
