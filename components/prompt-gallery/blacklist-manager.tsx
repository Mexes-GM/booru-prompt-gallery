"use client"

import { useState, memo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Tag, Plus, X, RotateCcw, AlertOctagon, Sparkles, Ghost, ShieldAlert, AlertCircle, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Label } from "@/components/ui/label"

interface BlacklistManagerProps {
  blacklist: string[]
  onAdd: (tag: string) => void
  onRemove: (tag: string) => void
  onReset: () => void
}

// --- Animation Variants ---
const containerVariants: any = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.2 }
  }
}

const itemVariants: any = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 400, damping: 25 }
  },
}

const badgeVariants: any = {
  initial: { opacity: 0, scale: 0.8 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.8, transition: { duration: 0.15 } }
}

export function BlacklistManager({ blacklist, onAdd, onRemove, onReset }: BlacklistManagerProps) {
  const [inputValue, setInputValue] = useState("")
  const [isOpen, setIsOpen] = useState(false)

  const handleAdd = () => {
    const tags = inputValue
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0)
    
    if (tags.length > 0) {
      tags.forEach(tag => onAdd(tag))
      setInputValue("")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAdd()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="h-11 rounded-none relative z-10 px-2 sm:px-3 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Tag className="w-3.5 h-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline text-xs font-medium">Blacklist</span>
              {blacklist.length > 0 && (
                <span className="ml-1.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-[10px] font-bold px-1 h-4 min-w-[1rem] flex items-center justify-center rounded-full">
                  {blacklist.length}
                </span>
              )}
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Manage blacklisted tags</TooltipContent>
      </Tooltip>

      <DialogContent className="sm:max-w-[460px] p-0 overflow-hidden gap-0 border-0 shadow-2xl bg-background/95 backdrop-blur-md">
        <div className="relative flex flex-col h-full">
          {/* Decorative Header Background */}
          <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-destructive/5 to-transparent pointer-events-none" />

          <DialogHeader className="p-6 pb-4 z-10">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-destructive/10 rounded-xl shadow-inner">
                <AlertOctagon className="w-5 h-5 text-destructive" />
              </div>
              <DialogTitle className="text-xl font-bold tracking-tight">Content Blacklist</DialogTitle>
            </div>
            <DialogDescription className="text-sm leading-relaxed text-muted-foreground pr-4">
              Posts matching these tags will be hidden from your view.
            </DialogDescription>
            
            {/* Info Section */}
            <div className="mt-4 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 flex gap-3">
              <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
                <p className="font-semibold">Client-side filtering</p>
                <p>Blacklisted tags are filtered after results load. Blocking very common tags may result in few or no images.</p>
              </div>
            </div>
            
            {/* Warning if many tags are blocked */}
            {blacklist.length > 8 && (
              <div className="mt-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 flex gap-3">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
                  <p className="font-semibold">Many tags blocked</p>
                  <p>You have {blacklist.length} tags filtered. This may significantly reduce available images.</p>
                </div>
              </div>
            )}
          </DialogHeader>

          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="p-6 pt-4 space-y-6 z-10"
          >
            {/* Input Section */}
            <motion.div variants={itemVariants} className="space-y-3">
              <Label htmlFor="blacklist-input" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
                Add New Filter
              </Label>
              <div className="relative group">
                <Input
                  id="blacklist-input"
                  placeholder="Enter tag (e.g. gore, spoilers, violence)"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className={cn(
                    "pr-12 h-11 bg-secondary/30 focus:bg-background transition-all duration-200",
                    "border-transparent focus:border-destructive/30 focus:ring-4 focus:ring-destructive/5",
                    "rounded-xl font-medium"
                  )}
                />
                <Button
                  onClick={handleAdd}
                  size="icon"
                  disabled={!inputValue.trim()}
                  className="absolute right-1 top-1 h-9 w-9 rounded-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-30"
                  aria-label="Add tag"
                >
                  <Plus className="w-5 h-5" />
                </Button>
              </div>
            </motion.div>

            {/* Tags Display Section */}
            <motion.div variants={itemVariants} className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Active Filters ({blacklist.length})
                </Label>
                {blacklist.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onReset}
                    className="h-6 px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                  >
                    <RotateCcw className="w-3 h-3 mr-1.5" />
                    Reset
                  </Button>
                )}
              </div>

              <div className="rounded-2xl border bg-muted/20 overflow-hidden backdrop-blur-sm transition-colors group-hover:bg-muted/30">
                <ScrollArea className="h-[220px] w-full">
                  <div className="p-4">
                    <AnimatePresence mode="popLayout" initial={false}>
                      {blacklist.length === 0 ? (
                        <motion.div
                          key="empty"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 0.5 }}
                          exit={{ opacity: 0 }}
                          className="h-[180px] flex flex-col items-center justify-center text-muted-foreground gap-3 select-none"
                        >
                          <Ghost className="w-10 h-10 opacity-20" />
                          <p className="text-xs font-medium tracking-wide">Your blacklist is empty</p>
                        </motion.div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {blacklist.map((tag) => (
                            <motion.div
                              key={tag}
                              variants={badgeVariants}
                              initial="initial"
                              animate="animate"
                              exit="exit"
                              layout
                            >
                              <Badge
                                variant="secondary"
                                className={cn(
                                  "pl-3 pr-1 py-1.5 h-8 flex items-center gap-2 transition-all duration-200",
                                  "bg-background hover:bg-destructive/10 hover:text-destructive group/badge border shadow-sm",
                                  "rounded-lg font-mono text-[11px]"
                                )}
                              >
                                <span>{tag}</span>
                                <button
                                  onClick={() => onRemove(tag)}
                                  className="rounded-md p-1 opacity-40 group-hover/badge:opacity-100 hover:bg-destructive/20 transition-all"
                                  aria-label={`Remove ${tag}`}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </Badge>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </AnimatePresence>
                  </div>
                </ScrollArea>
              </div>
            </motion.div>

            {/* Footer Done Button */}
            <motion.div variants={itemVariants} className="pt-2">
              <Button
                type="button"
                onClick={() => setIsOpen(false)}
                className="w-full h-11 text-sm font-semibold shadow-lg shadow-zinc-500/10 hover:shadow-zinc-500/20 transition-all hover:-translate-y-0.5 rounded-xl"
              >
                Close Manager
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
