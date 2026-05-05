"use client"

import { useState, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { 
  parseRawPrompt, 
  reconstructPrompt, 
  countClassifiedTags,
  type ParsedRawPrompt 
} from "@/lib/reverse-prompt-parser"
import { useImageExif } from "@/hooks/use-image-exif"
import { PromptImportZone } from "./prompt-import-zone"
import { motion, AnimatePresence } from "framer-motion"
import { Copy, Check, Sparkles, Zap } from "lucide-react"
import { cn } from "@/lib/utils"

interface ReversePromptParserModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport?: (prompt: string) => void
  tagOverrides?: Record<string, string>
}

const categoryConfig = {
  appearance: {
    label: "Appearance",
    color: "bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100",
    borderColor: "border-blue-300 dark:border-blue-700",
  },
  clothing: {
    label: "Clothing",
    color: "bg-purple-100 dark:bg-purple-900 text-purple-900 dark:text-purple-100",
    borderColor: "border-purple-300 dark:border-purple-700",
  },
  pose: {
    label: "Pose",
    color: "bg-green-100 dark:bg-green-900 text-green-900 dark:text-green-100",
    borderColor: "border-green-300 dark:border-green-700",
  },
  scenery: {
    label: "Scenery",
    color: "bg-orange-100 dark:bg-orange-900 text-orange-900 dark:text-orange-100",
    borderColor: "border-orange-300 dark:border-orange-700",
  },
  quality: {
    label: "Quality",
    color: "bg-amber-100 dark:bg-amber-900 text-amber-900 dark:text-amber-100",
    borderColor: "border-amber-300 dark:border-amber-700",
  },
  other: {
    label: "Other",
    color: "bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100",
    borderColor: "border-slate-400 dark:border-slate-500",
  },
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
} as const

const itemVariants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 350, damping: 25 },
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    transition: { duration: 0.2 },
  },
} as const

export function ReversePromptParserModal({
  open,
  onOpenChange,
  onImport,
  tagOverrides
}: ReversePromptParserModalProps) {
  const [rawInput, setRawInput] = useState("")
  const [copied, setCopied] = useState(false)
  const [selectedCategories, setSelectedCategories] = useState<Record<string, boolean>>({
    appearance: true,
    clothing: true,
    pose: true,
    scenery: true,
    quality: true,
    other: true,
  })
  const [parserOptions, setParserOptions] = useState({
    removeWeights: true,
    removeLoras: true,
  })

  // Image EXIF extraction hook
  const {
    isLoading,
    isDragActive,
    error: exifError,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop: handleExifDrop,
    handleFileInputChange,
    clearError: clearExifError,
  } = useImageExif({
    onSuccess: (result) => {
      if (result.prompt) {
        setRawInput(result.prompt)
      }
    },
  })

  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    void handleExifDrop(e as unknown as React.DragEvent<HTMLDivElement>)
  }

  // Parse the input
  const parsed = useMemo(() => {
    return parseRawPrompt(rawInput, tagOverrides, parserOptions)
  }, [rawInput, tagOverrides, parserOptions])

  const totalTags = countClassifiedTags(parsed.classified, parsed.quality)

  // Generate output prompt based on selected categories
  const outputPrompt = useMemo(() => {
    return reconstructPrompt(parsed.classified, parsed.quality, {
      appearance: selectedCategories.appearance,
      clothing: selectedCategories.clothing,
      pose: selectedCategories.pose,
      scenery: selectedCategories.scenery,
      quality: selectedCategories.quality,
      other: selectedCategories.other,
    })
  }, [parsed.classified, parsed.quality, selectedCategories])

  const handleCopy = () => {
    if (!outputPrompt) return
    navigator.clipboard.writeText(outputPrompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleImport = () => {
    if (!outputPrompt) return
    onImport?.(outputPrompt)
    onOpenChange(false)
    setRawInput("")
  }

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl p-0 gap-0 overflow-hidden border-0 shadow-2xl bg-background">
        {/* Gradient Background */}
        <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-emerald-500/10 via-emerald-500/5 to-transparent pointer-events-none z-0" />

        {/* Header */}
        <div className="relative p-5 pb-3 overflow-hidden z-10 border-b border-border">
          <DialogHeader className="relative z-10">
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 bg-background/80 backdrop-blur-sm shadow-sm rounded-lg border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                <Zap className="h-5 w-5" />
              </div>
              <DialogTitle className="text-xl font-bold tracking-tight">
                Import & Clean Prompt
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground">
              Paste a raw prompt and we&apos;ll clean, categorize, and let you refine it before using.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="relative z-10 p-5 space-y-4 max-h-[calc(100vh-140px)] overflow-y-auto">
          {/* Prompt Import Zone - Two sections: Image Drop & Text Input */}
          <PromptImportZone
            isDragActive={isDragActive}
            isLoading={isLoading}
            error={exifError}
            onDragEnter={handleDragEnter as (e: React.DragEvent<HTMLElement>) => void}
            onDragLeave={handleDragLeave as (e: React.DragEvent<HTMLElement>) => void}
            onDragOver={handleDragOver as (e: React.DragEvent<HTMLElement>) => void}
            onDrop={handleDrop}
            onFileInputChange={handleFileInputChange}
            onErrorDismiss={clearExifError}
            value={rawInput}
            onChange={setRawInput}
          />

          {/* Divider */}
          <div className="h-px bg-border" />

          {/* Parser Options */}
          {rawInput.trim().length > 0 && (
            <div className="space-y-2 pb-1 border-b border-border/50">
              <label className="text-sm font-semibold block">
                Parser Options
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                <button
                  onClick={() => setParserOptions(p => ({ ...p, removeWeights: !p.removeWeights }))}
                  className={cn(
                    "px-3 py-2 rounded-lg border-2 text-xs transition-all flex flex-col items-start gap-0.5 text-left",
                    parserOptions.removeWeights
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                      : "bg-muted text-muted-foreground border-transparent opacity-50"
                  )}
                >
                  <span className="font-semibold">Strip Weights & Brackets</span>
                  <span className="font-normal opacity-80 text-[10px]">
                    Converts <code className="bg-background/50 px-1 py-0.5 rounded leading-none">(elf:1.2)</code> to <code className="bg-background/50 px-1 py-0.5 rounded leading-none">elf</code>
                  </span>
                </button>
                
                <button
                  onClick={() => setParserOptions(p => ({ ...p, removeLoras: !p.removeLoras }))}
                  className={cn(
                    "px-3 py-2 rounded-lg border-2 text-xs transition-all flex flex-col items-start gap-0.5 text-left",
                    parserOptions.removeLoras
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                      : "bg-muted text-muted-foreground border-transparent opacity-50"
                  )}
                >
                  <span className="font-semibold">Remove LoRA Tags</span>
                  <span className="font-normal opacity-80 text-[10px]">
                    Removes <code className="bg-background/50 px-1 py-0.5 rounded leading-none">&lt;lora:...&gt;</code> completely
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Category Toggles */}
          {totalTags > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-semibold block">
                Include Categories
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(Object.entries(categoryConfig) as Array<[keyof typeof categoryConfig, typeof categoryConfig.appearance]>).map(
                  ([key, config]) => (
                    <button
                      key={key}
                      onClick={() => toggleCategory(key)}
                      className={cn(
                        "px-3 py-2 rounded-lg border-2 font-medium text-xs transition-all",
                        selectedCategories[key]
                          ? `${config.color} ${config.borderColor} border-2`
                          : "bg-muted text-muted-foreground border-transparent opacity-50"
                      )}
                    >
                      {config.label}
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {/* Preview Section */}
          {totalTags > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-semibold block">
                Preview by Category
              </label>
              <ScrollArea className="h-48 border rounded-lg p-3 bg-muted/30">
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="space-y-3"
                >
                  {(Object.entries(categoryConfig) as Array<[keyof typeof categoryConfig, typeof categoryConfig.appearance]>).map(
                    ([key, config]) => {
                      const tags = key === "quality" ? parsed.quality : (parsed.classified[key as keyof typeof parsed.classified] as string[])
                      if (tags.length === 0) return null

                      return (
                        <motion.div key={key} variants={itemVariants} className="space-y-2">
                          <div className="text-xs font-semibold text-muted-foreground">
                            {config.label} ({tags.length})
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <AnimatePresence mode="popLayout">
                              {tags.map((tag, idx) => (
                                <motion.div
                                  key={`${key}-${idx}`}
                                  variants={itemVariants}
                                  layout
                                >
                                  <Badge className={cn(config.color, "cursor-default")}>
                                    {tag}
                                  </Badge>
                                </motion.div>
                              ))}
                            </AnimatePresence>
                          </div>
                        </motion.div>
                      )
                    }
                  )}
                </motion.div>
              </ScrollArea>
            </div>
          )}

          {/* Output Prompt */}
          {outputPrompt && (
            <div className="space-y-2">
              <label htmlFor="output-prompt" className="text-sm font-semibold">
                Final Prompt
              </label>
              <div className="relative group">
                <Textarea
                  id="output-prompt"
                  readOnly
                  value={outputPrompt}
                  className="font-mono text-sm pr-14 py-4 min-h-[5rem] resize-none bg-muted/50 border-2"
                />
                <button
                  onClick={handleCopy}
                  className={cn(
                    "absolute right-2 top-1/2 -translate-y-1/2 px-3 py-2 rounded-md font-medium text-xs transition-all",
                    copied
                      ? "bg-green-100 dark:bg-green-900 text-green-900 dark:text-green-100"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  )}
                  title={copied ? "Copied!" : "Copy to clipboard"}
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 inline mr-1" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 inline mr-1" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!rawInput && (
            <div className="py-6 text-center">
              <Sparkles className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">
                Paste a raw prompt to get started
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
