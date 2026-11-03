"use client"

import { useState, useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Trash2, Plus, Minus, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface GlobalWeightsModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    weights: Record<string, number>
    onRemoveWeight: (tag: string) => void
    onClearWeights: () => void
    onSaveWeight: (tag: string, weight: number) => void
    /** Whether the weights are applied (false = paused). */
    isEnabled: boolean
    /** Pause or resume the weights. Without it the modal only reports a pause. */
    onEnabledChange?: (enabled: boolean) => void
}

// Same range as the weight popover on a card's tags (interactive-prompt.tsx).
const MIN_WEIGHT = 0.1
const MAX_WEIGHT = 3
const STEP = 0.1

const clampWeight = (value: number) =>
    Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, parseFloat(value.toFixed(1))))

export function GlobalWeightsModal({
    open,
    onOpenChange,
    weights,
    onRemoveWeight,
    onClearWeights,
    onSaveWeight,
    isEnabled,
    onEnabledChange,
}: GlobalWeightsModalProps) {
    const hasWeights = Object.keys(weights).length > 0
    const [newTag, setNewTag] = useState("")
    const [newWeight, setNewWeight] = useState(1.1)
    const inputRef = useRef<HTMLInputElement>(null)

    const handleAdd = () => {
        if (!newTag.trim()) return
        onSaveWeight(newTag.trim(), newWeight)
        setNewTag("")
        setNewWeight(1.1)
        // Keep focus for rapid entry
        inputRef.current?.focus()
    }

    // Sort weights alphabetically
    const sortedWeights = useMemo(() => {
        return Object.entries(weights).sort((a, b) => a[0].localeCompare(b[0]))
    }, [weights])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[30rem] gap-5">
                <DialogHeader>
                    <DialogTitle>Tag weights</DialogTitle>
                    <DialogDescription>
                        Raise or lower a tag in every prompt that has it.
                    </DialogDescription>
                </DialogHeader>

                {hasWeights && (onEnabledChange ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
                        <label htmlFor="global-weights-apply" className="flex min-w-0 cursor-pointer flex-col gap-0.5">
                            <span className="text-sm text-foreground">Apply weights</span>
                            <span className="text-xs text-muted-foreground">
                                {isEnabled ? "On for every card with these tags" : "Paused. Saved, but no prompt uses them"}
                            </span>
                        </label>
                        <Switch id="global-weights-apply" checked={isEnabled} onCheckedChange={onEnabledChange} />
                    </div>
                ) : !isEnabled && (
                    <p role="status" className="rounded-lg border border-border/60 px-3 py-2.5 text-xs text-muted-foreground">
                        Paused. These weights are saved, but no prompt uses them.
                    </p>
                ))}

                {/* Add a weight by hand */}
                <form
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                        e.preventDefault()
                        handleAdd()
                    }}
                >
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <label htmlFor="global-weight-new-tag" className="text-xs font-medium text-muted-foreground">Tag</label>
                        <Input
                            id="global-weight-new-tag"
                            ref={inputRef}
                            placeholder="e.g. smile"
                            value={newTag}
                            onChange={(e) => setNewTag(e.target.value)}
                            className="h-10"
                        />
                    </div>
                    <WeightStepper value={newWeight} onChange={setNewWeight} label="New tag weight" />
                    <Button type="submit" disabled={!newTag.trim()} className="h-10 shrink-0 px-3">
                        <Plus className="mr-1.5 h-4 w-4" />
                        Add
                    </Button>
                </form>

                {/* Saved weights */}
                {hasWeights ? (
                    <ul className="-mx-2 flex max-h-[min(22rem,45dvh)] flex-col overflow-y-auto px-2" aria-label="Saved tag weights">
                        {sortedWeights.map(([tag, weight]) => (
                            <li
                                key={tag}
                                className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-b-0"
                            >
                                <span className={cn("min-w-0 flex-1 truncate text-sm", !isEnabled && "text-muted-foreground")} title={tag}>
                                    {tag}
                                </span>
                                <div className="flex shrink-0 items-center gap-1">
                                    <WeightStepper
                                        value={weight}
                                        onChange={(val) => onSaveWeight(tag, val)}
                                        label={`Weight for ${tag}`}
                                        size="sm"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9 text-muted-foreground hover:text-destructive-text hover:bg-destructive/10"
                                        onClick={() => onRemoveWeight(tag)}
                                        aria-label={`Remove weight for ${tag}`}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border/70 px-4 py-6 text-center">
                        <p className="text-sm font-medium text-foreground">No tag weights yet</p>
                        <p className="text-xs text-muted-foreground">
                            Add one above, or click a tag on any card, set its weight and choose the globe.
                        </p>
                    </div>
                )}

                <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between sm:space-x-0">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onClearWeights}
                        disabled={!hasWeights}
                        className="h-9 px-3 text-xs text-muted-foreground hover:text-destructive-text hover:bg-destructive/10"
                    >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        Clear all
                    </Button>
                    <Button type="button" onClick={() => onOpenChange(false)} className="h-9 px-6">
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/**
 * − [value] + : every part is keyboard reachable. The value is a number
 * input (type a weight, or ArrowUp/ArrowDown), committed on blur or Enter.
 */
function WeightStepper({
    value,
    onChange,
    label,
    size = "default",
}: {
    value: number
    onChange: (v: number) => void
    label: string
    size?: "default" | "sm"
}) {
    const [draft, setDraft] = useState<string | null>(null)
    const isSmall = size === "sm"

    const commit = (raw: string) => {
        const parsed = parseFloat(raw.replace(",", "."))
        if (!isNaN(parsed)) onChange(clampWeight(parsed))
        setDraft(null)
    }
    const step = (delta: number) => onChange(clampWeight(value + delta))

    const buttonClass = cn(
        "flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-40",
        isSmall ? "w-8" : "w-9"
    )

    return (
        <div
            role="group"
            aria-label={label}
            className={cn(
                "flex shrink-0 items-stretch overflow-hidden rounded-md border border-input bg-background",
                isSmall ? "h-9" : "h-10"
            )}
        >
            <button
                type="button"
                onClick={() => step(-STEP)}
                disabled={value <= MIN_WEIGHT}
                className={buttonClass}
                aria-label="Decrease weight"
            >
                <Minus className="h-3.5 w-3.5" />
            </button>
            {/* Text, not type="number": the value reads "1.1" in every locale,
                like the weights written into prompts. */}
            <input
                type="text"
                inputMode="decimal"
                role="spinbutton"
                aria-valuemin={MIN_WEIGHT}
                aria-valuemax={MAX_WEIGHT}
                aria-valuenow={value}
                value={draft ?? value.toFixed(1)}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={(e) => commit(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault()
                        commit(e.currentTarget.value)
                    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                        e.preventDefault()
                        setDraft(null)
                        step(e.key === "ArrowUp" ? STEP : -STEP)
                    }
                }}
                aria-label="Weight"
                className={cn(
                    "border-x border-input bg-transparent text-center font-mono text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    isSmall ? "w-12" : "w-14"
                )}
            />
            <button
                type="button"
                onClick={() => step(STEP)}
                disabled={value >= MAX_WEIGHT}
                className={buttonClass}
                aria-label="Increase weight"
            >
                <Plus className="h-3.5 w-3.5" />
            </button>
        </div>
    )
}
