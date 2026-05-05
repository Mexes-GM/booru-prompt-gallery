"use client"

import { useState, useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Trash2, Plus, Minus, Tag, Scale, Sparkles, X, Check } from "lucide-react"
import { motion, AnimatePresence, Variants } from "framer-motion"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface GlobalWeightsModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    weights: Record<string, number>
    onRemoveWeight: (tag: string) => void
    onClearWeights: () => void
    onSaveWeight: (tag: string, weight: number) => void
}

// Animation Variants
const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.05,
            delayChildren: 0.1,
        },
    },
}

const itemVariants: Variants = {
    hidden: { opacity: 0, y: 10, scale: 0.95 },
    visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { type: "spring", stiffness: 350, damping: 25 }
    },
    exit: {
        opacity: 0,
        scale: 0.9,
        transition: { duration: 0.2 }
    }
}

export function GlobalWeightsModal({
    open,
    onOpenChange,
    weights,
    onRemoveWeight,
    onClearWeights,
    onSaveWeight,
}: GlobalWeightsModalProps) {
    const hasWeights = Object.keys(weights).length > 0
    const [newTag, setNewTag] = useState("")
    const [newWeight, setNewWeight] = useState("1.1")
    const inputRef = useRef<HTMLInputElement>(null)

    const handleAdd = () => {
        if (!newTag.trim()) return
        const weight = parseFloat(newWeight)
        if (isNaN(weight)) return

        onSaveWeight(newTag.trim(), weight)
        setNewTag("")
        setNewWeight("1.1")
        // Keep focus for rapid entry
        inputRef.current?.focus()
    }

    // Sort weights alphabetically
    const sortedWeights = useMemo(() => {
        return Object.entries(weights).sort((a, b) => a[0].localeCompare(b[0]))
    }, [weights])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px] p-0 gap-0 overflow-hidden border-0 shadow-2xl bg-background">

                {/* Unified Background Gradient */}
                <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent pointer-events-none z-0" />

                {/* Header */}
                <div className="relative p-6 pb-6 overflow-hidden z-10">
                    <DialogHeader className="relative z-10">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2.5 bg-background/80 backdrop-blur-sm shadow-sm rounded-xl border border-primary/10 text-primary">
                                <Scale className="h-5 w-5" />
                            </div>
                            <DialogTitle className="text-xl font-bold tracking-tight">Global Weights</DialogTitle>
                        </div>
                        <DialogDescription className="text-muted-foreground/90 max-w-[360px]">
                            Define tags that should be automatically emphasized or de-emphasized across all generated images.
                        </DialogDescription>
                    </DialogHeader>
                </div>

                {/* Input Section */}
                <div className="px-6 pb-2 relative z-20">
                    <div className="bg-secondary/40 p-1.5 rounded-xl border border-border/50 flex gap-2 shadow-sm focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50 transition-all duration-200">
                        <div className="relative flex-1">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                                <Tag className="h-4 w-4" />
                            </div>
                            <Input
                                ref={inputRef}
                                placeholder="Enter tag (e.g. masterpiece)"
                                value={newTag}
                                onChange={(e) => setNewTag(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                                aria-label="Enter tag for global weight"
                                className="pl-9 h-11 border-none shadow-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/60"
                            />
                        </div>

                        <div className="flex items-center gap-2">
                            <WeightStepper
                                value={parseFloat(newWeight)}
                                onChange={(v) => setNewWeight(v.toString())}
                            />
                            <Button
                                onClick={handleAdd}
                                size="icon"
                                className="h-11 w-11 shrink-0 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
                                disabled={!newTag.trim()}
                                aria-label="Add global weight"
                            >
                                <Plus className="h-5 w-5" />
                            </Button>
                        </div>
                    </div>
                </div>

                {/* List Section */}
                <ScrollArea className="h-[360px] relative">
                    <div className="p-6 pt-2 flex flex-col gap-2.5">
                        <AnimatePresence mode="popLayout" initial={false}>
                            {!hasWeights && (
                                <motion.div
                                    key="empty"
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                                    className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground/50 space-y-4"
                                >
                                    <div className="w-20 h-20 rounded-full bg-secondary/50 flex items-center justify-center mb-2">
                                        <Scale className="h-10 w-10 opacity-20" />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium text-foreground/80">No active weights</p>
                                        <p className="text-xs max-w-[220px] mx-auto">
                                            Tags added here will override prompt defaults.
                                        </p>
                                    </div>
                                </motion.div>
                            )}

                            {sortedWeights.map(([tag, weight]) => (
                                <motion.div
                                    key={tag}
                                    layout
                                    initial="hidden"
                                    animate="visible"
                                    exit="exit"
                                    variants={itemVariants}
                                    className="group relative flex items-center justify-between p-2 pl-3 rounded-xl border border-transparent bg-secondary/20 hover:bg-secondary/40 hover:border-border/50 transition-all duration-200"
                                >
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className={cn(
                                            "w-1 h-8 rounded-full transition-colors",
                                            weight > 1 ? "bg-blue-500/50" : weight < 1 ? "bg-red-500/50" : "bg-muted"
                                        )} />
                                        <span className="font-medium text-sm truncate" title={tag}>
                                            {tag}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <WeightStepper
                                            value={weight}
                                            onChange={(val) => onSaveWeight(tag, val)}
                                            size="sm"
                                            tagName={tag}
                                        />

                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                                            onClick={() => onRemoveWeight(tag)}
                                            aria-label={`Remove weight for ${tag}`}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </ScrollArea>

                {/* Footer */}
                <div className="p-4 bg-secondary/20 border-t border-border/50 flex justify-between items-center z-10">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClearWeights}
                        disabled={!hasWeights}
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 px-3 text-xs font-medium"
                    >
                        <Trash2 className="w-3.5 h-3.5 mr-2" />
                        Clear All
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => onOpenChange(false)}
                        className="px-6 h-9 font-medium shadow-sm"
                    >
                        Done
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

// Compact Stepper Component
function WeightStepper({
    value,
    onChange,
    size = "default",
    tagName
}: {
    value: number
    onChange: (v: number) => void
    size?: "default" | "sm"
    tagName?: string
}) {
    const update = (delta: number) => {
        const next = parseFloat((value + delta).toFixed(1))
        if (next > 0) onChange(next)
    }

    const isSmall = size === "sm"
    const decreaseLabel = tagName ? `Decrease weight for ${tagName}` : "Decrease weight"
    const increaseLabel = tagName ? `Increase weight for ${tagName}` : "Increase weight"

    return (
        <div className={cn(
            "flex items-center bg-background rounded-lg border border-border/50 shadow-sm transition-all",
            isSmall ? "h-8" : "h-11"
        )}>
            <button
                onClick={() => update(-0.1)}
                className={cn(
                    "h-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-l-lg transition-colors focus:outline-none focus:bg-secondary/50",
                    isSmall ? "w-6" : "w-8"
                )}
                tabIndex={-1}
                aria-label={decreaseLabel}
            >
                <Minus className={cn("shrink-0", isSmall ? "h-3 w-3" : "h-3.5 w-3.5")} />
            </button>

            <div className={cn(
                "h-full flex items-center justify-center border-x border-border/30 bg-secondary/10",
                isSmall ? "w-10" : "w-12"
            )}>
                <span className={cn(
                    "font-mono font-semibold",
                    isSmall ? "text-xs" : "text-sm",
                    value > 1 ? "text-blue-600 dark:text-blue-400" :
                        value < 1 ? "text-red-600 dark:text-red-400" :
                            "text-foreground"
                )} aria-hidden="true">
                    {value.toFixed(1)}
                </span>
            </div>

            <button
                onClick={() => update(0.1)}
                className={cn(
                    "h-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-r-lg transition-colors focus:outline-none focus:bg-secondary/50",
                    isSmall ? "w-6" : "w-8"
                )}
                tabIndex={-1}
                aria-label={increaseLabel}
            >
                <Plus className={cn("shrink-0", isSmall ? "h-3 w-3" : "h-3.5 w-3.5")} />
            </button>
        </div>
    )
}
