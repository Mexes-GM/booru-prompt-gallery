import { useRef, useEffect, useState, memo, useCallback, useMemo } from 'react'
import { Button } from "@/components/ui/button"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { X, Copy, Trash2, Check, Shuffle, Type, Dices, Settings2 } from "lucide-react"
import { BooruPost } from '@/lib/booru/types'
import { SelectedPostParts, MergeModeType, RandomSettings } from '@/hooks/use-merge-mode'
import { TagCategory } from '@/lib/tag-classifier'
import { usePostHog } from 'posthog-js/react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLowMotion } from '@/hooks/use-low-motion'
import { useCopyFeedback } from '@/hooks/use-copy-feedback'
import Image from 'next/image'
import { getDanbooruProxyUrl } from "@/lib/proxy-url"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { RemovableTagChip } from './removable-tag-chip'
import { CATEGORY_TEXT_CLASS, CATEGORY_BORDER_CLASS, CATEGORY_ACTIVE_CLASS } from './category-chip-styles'
import { PACK_AXES, TAG_CATEGORY_IDS } from '@/lib/tag-taxonomy'

interface MergeStickyFooterProps {
    isOpen: boolean
    selectedPosts: Map<number, SelectedPostParts>
    mergedPrompt: string
    mergedPromptSegments: { text: string, display: string, category: TagCategory, postId?: number }[]
    onRemovePost: (id: number) => void
    onClearAll: () => void
    onExit: () => void
    onCopy: (text: string) => void
    onRemoveTag: (tag: string) => void
    globalWeights?: Record<string, number>
    onGlobalWeightChange?: (tag: string, weight: number) => void
    isGlobalWeightsEnabled?: boolean
    mergeModeType: MergeModeType
    onToggleMergeModeType: () => void
    onRandomize?: () => void
    randomSettings: RandomSettings
    setRandomSettings: (settings: RandomSettings | ((prev: RandomSettings) => RandomSettings)) => void
}

const SymbolTag = memo(({ 
    symbol, 
    category, 
}: { 
    symbol: string
    category: TagCategory
}) => {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5, filter: "blur(4px)" }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className={`flex items-center justify-center px-1.5 py-1.5 sm:py-0.5 rounded border border-dashed ${CATEGORY_BORDER_CLASS[category]} bg-background/30 font-mono text-xs font-medium opacity-80 ${CATEGORY_TEXT_CLASS[category]} select-none`}
        >
            <span className="relative">{symbol}</span>
        </motion.div>
    )
})
SymbolTag.displayName = "SymbolTag"

const PARTICLES_MAP = {
    green: "bg-success",
    red: "bg-destructive"
}
const PARTICLES = Array.from({ length: 12 })

const Particles = memo(({ color = "green" }: { color?: "green" | "red" }) => {
    const colorClass = PARTICLES_MAP[color]

    return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
            {PARTICLES.map((_, i) => (
                <motion.div
                    key={i}
                    initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                    animate={{
                        x: Math.cos(i * (360 / PARTICLES.length) * (Math.PI / 180)) * 40,
                        y: Math.sin(i * (360 / PARTICLES.length) * (Math.PI / 180)) * 40,
                        scale: [0, 1, 0],
                        opacity: [1, 0]
                    }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className={`absolute w-1 h-1 rounded-full ${colorClass}`}
                />
            ))}
        </div>
    )
})
Particles.displayName = "Particles"

const MergeStickyFooterComponent = ({
    isOpen,
    selectedPosts,
    mergedPrompt,
    mergedPromptSegments,
    onRemovePost,
    onClearAll,
    onExit,
    onCopy,
    onRemoveTag,
    globalWeights,
    onGlobalWeightChange,
    isGlobalWeightsEnabled,
    mergeModeType,
    onToggleMergeModeType,
    onRandomize,
    randomSettings,
    setRandomSettings
}: MergeStickyFooterProps) => {

    const lowMotion = useLowMotion()
    const [isCopied, triggerCopyFeedback] = useCopyFeedback()
    const [isCleared, setIsCleared] = useState(false)
    const posthog = usePostHog()
    
    const handleCopy = (text: string) => {
        onCopy(text)
        triggerCopyFeedback()
        
        if (mergeModeType === 'variations') {
            posthog.capture('variant_mode_used', {
                merged_posts_count: selectedPosts.size
            })
        } else {
            posthog.capture('merge_mode_used', {
                merged_posts_count: selectedPosts.size
            })
        }
    }

    const handleClear = () => {
        if (selectedPosts.size === 0) return
        setIsCleared(true)
        onClearAll()
        setTimeout(() => setIsCleared(false), 2000)
    }

    // Process variations data structure for UI rendering
    const variationsOutput = useMemo(() => {
        if (mergeModeType !== 'variations') return null;

        const commonTags = mergedPromptSegments.filter(s => !s.postId);
        const categories = TAG_CATEGORY_IDS;
        const dynamicBlocks: { category: TagCategory, variations: { postId: number, tags: typeof mergedPromptSegments }[] }[] = [];
        
        categories.forEach(cat => {
            const catSegments = mergedPromptSegments.filter(s => s.postId && s.category === cat);
            if (catSegments.length === 0) return;
            
            const postGroups = new Map<number, typeof mergedPromptSegments>();
            catSegments.forEach(s => {
                if (!postGroups.has(s.postId!)) postGroups.set(s.postId!, []);
                postGroups.get(s.postId!)!.push(s);
            });
            
            if (postGroups.size > 0) {
                const variations = Array.from(postGroups.entries()).map(([postId, tags]) => ({ postId, tags }));
                dynamicBlocks.push({ category: cat, variations });
            }
        });

        return { commonTags, dynamicBlocks };
    }, [mergedPromptSegments, mergeModeType]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="merge-footer"
                    initial={lowMotion ? { opacity: 0 } : { y: 200, opacity: 0, scale: 0.95 }}
                    animate={lowMotion ? { opacity: 1 } : { y: 0, opacity: 1, scale: 1 }}
                    exit={lowMotion ? { opacity: 0 } : { y: 200, opacity: 0, scale: 0.95 }}
                    transition={lowMotion ? { duration: 0.15 } : {
                        type: "spring",
                        stiffness: 200,
                        damping: 25,
                        mass: 0.8
                    }}
                    className={`fixed bottom-6 left-0 right-0 mx-auto z-50 w-[95%] max-w-3xl border shadow-2xl rounded-2xl overflow-hidden ring-1 ring-foreground/5 sm:max-h-[400px] max-h-[320px] ${lowMotion ? "bg-background/95" : "bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/85"}`}
                    style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
                >
                    {/* Border Glow Effect */}
                    <div className="absolute inset-0 z-[-1] overflow-hidden rounded-2xl pointer-events-none">
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-[1px] bg-gradient-to-r from-transparent via-foreground/20 to-transparent opacity-50" />
                        {!lowMotion && (
                            <motion.div
                                animate={{ opacity: [0.6, 1, 0.6] }}
                                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                                className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--primary)_14%,transparent)_0%,transparent_65%)]"
                            />
                        )}
                    </div>
                    <div className="p-3 sm:p-4 flex flex-col gap-3 sm:gap-4">

                        {/* Header / Controls */}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-sm sm:text-base">
                                    {mergeModeType === 'merge' ? 'Merge Prompt' : 'Variations Mode'}
                                </span>
                                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                    {selectedPosts.size} posts
                                </span>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={onToggleMergeModeType}
                                            className="ml-2 h-7 px-2 text-xs font-medium"
                                        >
                                            {mergeModeType === 'merge' ? (
                                                <><Shuffle className="w-3 h-3 mr-1" /> To Variations</>
                                            ) : (
                                                <><Type className="w-3 h-3 mr-1" /> To Merge</>
                                            )}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {mergeModeType === 'merge' 
                                            ? 'Switch to Variations Mode ({ tagA | tagB })' 
                                            : 'Switch to Merge Mode (combines tags into one prompt)'}
                                    </TooltipContent>
                                </Tooltip>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={onRandomize}
                                        className="relative overflow-visible h-8 text-xs font-medium bg-primary/10 text-primary-text hover:bg-primary/20 border-primary/20 rounded-r-none border-r-0"
                                        title="Randomize selections from visible posts"
                                    >
                                        <Dices className="w-3.5 h-3.5 mr-1.5" />
                                        Random
                                    </Button>
                                    {/* closeOnScroll off: the footer is fixed, so the trigger never moves with the page. */}
                                    <Popover closeOnScroll={false}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-8 px-2 rounded-l-none bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary-text"
                                            >
                                                <Settings2 className="w-3.5 h-3.5" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-72 p-0 overflow-hidden border-primary/20 shadow-2xl" align="end" sideOffset={8}>
                                            <div className="bg-gradient-to-r from-primary/10 to-transparent p-3 border-b border-primary/10 flex items-center gap-2">
                                                <Dices className="w-4 h-4 text-primary-text" />
                                                <span className="text-sm font-semibold text-primary-text">Randomizer Settings</span>
                                            </div>
                                            
                                            <div className="p-4 space-y-6">
                                                <div className="space-y-4">
                                                    <div className="flex items-center justify-between">
                                                        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Posts to combine</Label>
                                                        <motion.span 
                                                            key={randomSettings.postCount}
                                                            initial={{ scale: 0.8, opacity: 0 }}
                                                            animate={{ scale: 1, opacity: 1 }}
                                                            className="text-xs font-bold text-primary-text bg-primary/10 px-2 py-0.5 rounded-full"
                                                        >
                                                            {randomSettings.postCount}
                                                        </motion.span>
                                                    </div>
                                                    <div className="px-1 relative">
                                                        <Slider
                                                            min={1}
                                                            max={10}
                                                            step={1}
                                                            value={[randomSettings.postCount]}
                                                            onValueChange={([val]) => setRandomSettings(prev => ({ ...prev, postCount: val }))}
                                                            className="[&_[role=slider]]:border-primary [&_[role=slider]]:focus-visible:ring-primary/50 [&_.relative>.absolute]:bg-primary cursor-grab active:cursor-grabbing"
                                                        />
                                                    </div>
                                                    <div className="flex justify-between text-[10px] text-muted-foreground font-mono px-1">
                                                        <span>1</span>
                                                        <span>10</span>
                                                    </div>
                                                </div>
                                                
                                                <div className="space-y-3">
                                                    <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Categories to roll</Label>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {PACK_AXES.map(cat => {
                                                            const isSelected = randomSettings.allowedCategories.includes(cat);

                                                            return (
                                                                <button
                                                                    type="button"
                                                                    key={cat}
                                                                    onClick={() => {
                                                                        setRandomSettings(prev => ({
                                                                            ...prev,
                                                                            allowedCategories: isSelected
                                                                                ? prev.allowedCategories.filter(c => c !== cat)
                                                                                : [...prev.allowedCategories, cat]
                                                                        }))
                                                                    }}
                                                                    className={`relative overflow-hidden flex items-center justify-center py-2.5 text-xs font-medium rounded-md border transition-all duration-200 ${
                                                                        isSelected 
                                                                            ? CATEGORY_ACTIVE_CLASS[cat] 
                                                                            : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                                                                    }`}
                                                                >
                                                                    <span className="capitalize z-10 flex items-center gap-1.5">
                                                                        {isSelected && <Check className="w-3 h-3" />}
                                                                        {cat}
                                                                    </span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleClear}
                                    disabled={selectedPosts.size === 0 || isCleared}
                                    className={`relative overflow-visible transition-all duration-300 ${isCleared ? 'bg-destructive text-destructive-foreground ring-2 ring-destructive/50' : 'bg-destructive-soft hover:bg-destructive/20 text-destructive-text'}`}
                                >
                                    <AnimatePresence>
                                        {isCleared && <Particles color="red" />}
                                    </AnimatePresence>
                                    <div className="grid place-items-center">
                                        <motion.div
                                            className="flex items-center font-bold col-start-1 row-start-1"
                                            initial={{ opacity: 0, scale: 0.5 }}
                                            animate={{
                                                opacity: isCleared ? 1 : 0,
                                                scale: isCleared ? 1 : 0.5,
                                                pointerEvents: isCleared ? "auto" : "none"
                                            }}
                                            transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                        >
                                            <Check className="w-4 h-4 mr-2 stroke-[3px]" />
                                            Cleared!
                                        </motion.div>
                                        <motion.div
                                            className="flex items-center col-start-1 row-start-1"
                                            initial={{ opacity: 1, scale: 1 }}
                                            animate={{
                                                opacity: isCleared ? 0 : 1,
                                                scale: isCleared ? 0.5 : 1,
                                                pointerEvents: isCleared ? "none" : "auto"
                                            }}
                                            transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                        >
                                            <Trash2 className="w-4 h-4 mr-2" />
                                            <span className="hidden sm:inline">Clear</span>
                                        </motion.div>
                                    </div>
                                </Button>
                                <Button variant="ghost" size="icon" onClick={onExit} className="h-8 w-8 rounded-full hover:bg-muted" aria-label="Exit merge mode">
                                    <X className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        {/* Selection Thumbnails */}
                        {selectedPosts.size > 0 && (
                            <ScrollArea className="w-full whitespace-nowrap pb-2">
                                <div className="flex gap-2 p-1">
                                    <AnimatePresence mode='popLayout'>
                                        {Array.from(selectedPosts.values()).map(({ post, parts }) => (
                                            <motion.div
                                                layout
                                                key={post.id}
                                                initial={{ scale: 0.8, opacity: 0 }}
                                                animate={{ scale: 1, opacity: 1 }}
                                                exit={{ scale: 0.5, opacity: 0 }}
                                                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                                className="relative group w-16 h-24 flex-shrink-0 rounded-md overflow-hidden bg-muted border ring-offset-background transition-all hover:ring-2 hover:ring-primary/50"
                                            >
                                                <Image
                                                    src={(() => {
                                                        const rawUrl = post.preview_file_url || post.file_url
                                                        const provider = post._provider || 'danbooru'
                                                        if (provider === 'danbooru' && rawUrl) {
                                                            return getDanbooruProxyUrl(rawUrl)
                                                        }
                                                        return rawUrl
                                                    })()}
                                                    alt={`Selected post ${post.id}`}
                                                    fill
                                                    className="object-cover opacity-90 group-hover:opacity-100 transition-opacity duration-300"
                                                    unoptimized
                                                />
                                                <motion.button
                                                    whileHover={lowMotion ? undefined : { scale: 1.1 }}
                                                    whileTap={{ scale: 0.9 }}
                                                    onClick={() => onRemovePost(post.id)}
                                                    className="absolute top-1 right-1 bg-overlay/60 hover:bg-destructive text-overlay-foreground hover:text-destructive-foreground rounded-full p-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10 backdrop-blur-sm"
                                                >
                                                    <X className="w-3 h-3" />
                                                </motion.button>
                                                <div className="absolute bottom-0 left-0 right-0 flex gap-0.5 dark justify-center p-1 bg-gradient-to-t from-overlay/80 to-transparent">
                                                    {/* Tiny indicators for what parts are selected */}
                                                    {parts.has('appearance') && <motion.span layoutId={`dot-app-${post.id}`} className="w-1.5 h-1.5 rounded-full bg-cat-appearance" title="Appearance" />}
                                                    {parts.has('clothing') && <motion.span layoutId={`dot-clo-${post.id}`} className="w-1.5 h-1.5 rounded-full bg-cat-clothing" title="Attire" />}
                                                    {parts.has('equipment') && <motion.span layoutId={`dot-eqp-${post.id}`} className="w-1.5 h-1.5 rounded-full bg-cat-equipment" title="Equipment" />}
                                                    {parts.has('pose') && <motion.span layoutId={`dot-pos-${post.id}`} className="w-1.5 h-1.5 rounded-full bg-cat-pose" title="Pose" />}
                                                    {parts.has('scenery') && <motion.span layoutId={`dot-sce-${post.id}`} className="w-1.5 h-1.5 rounded-full bg-cat-scenery" title="Scene" />}
                                                    {parts.has('creature') && <motion.span layoutId={`dot-cre-${post.id}`} className="w-1.5 h-1.5 rounded-full bg-cat-creature" title="Creature" />}
                                                </div>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </div>
                                <ScrollBar orientation="horizontal" />
                            </ScrollArea>
                        )}

                        {/* Prompt Output */}
                        <div className="relative">
                            <div className="min-h-[60px] max-h-[120px] sm:max-h-[200px] w-full rounded-md border border-input bg-muted/50 px-3 py-3 text-sm shadow-sm overflow-y-auto overflow-x-hidden flex flex-col gap-2">
                                {mergeModeType === 'variations' && variationsOutput ? (
                                    <div className="flex flex-wrap gap-1.5 min-h-[2rem] content-start items-center">
                                        <AnimatePresence mode="popLayout">
                                            {variationsOutput.commonTags.map((segment, index) => (
                                                <RemovableTagChip
                                                    key={`common-${segment.text}-${index}`}
                                                    text={segment.display}
                                                    category={segment.category}
                                                    onRemove={() => onRemoveTag(segment.text)}
                                                />
                                            ))}

                                            {variationsOutput.dynamicBlocks.flatMap((block, blockIndex) => {
                                                const isVariation = block.variations.length > 1;
                                                const elements: any[] = [];

                                                if (isVariation) {
                                                    elements.push(
                                                        <SymbolTag 
                                                            key={`start-${block.category}-${blockIndex}`} 
                                                            symbol="{" 
                                                            category={block.category} 
                                                        />
                                                    );
                                                }

                                                block.variations.forEach((variation, varIndex) => {
                                                    if (isVariation && varIndex > 0) {
                                                        elements.push(
                                                            <SymbolTag 
                                                                key={`pipe-${block.category}-${blockIndex}-${varIndex}`} 
                                                                symbol="|" 
                                                                category={block.category} 
                                                            />
                                                        );
                                                    }

                                                    variation.tags.forEach((segment, tagIndex) => {
                                                        elements.push(
                                                            <RemovableTagChip
                                                                key={`var-${variation.postId}-${segment.text}-${tagIndex}`}
                                                                text={segment.display}
                                                                category={segment.category}
                                                                onRemove={() => onRemoveTag(segment.text)}
                                                            />
                                                        );
                                                    });
                                                });

                                                if (isVariation) {
                                                    elements.push(
                                                        <SymbolTag 
                                                            key={`end-${block.category}-${blockIndex}`} 
                                                            symbol="}" 
                                                            category={block.category} 
                                                        />
                                                    );
                                                }

                                                return elements;
                                            })}
                                        </AnimatePresence>
                                        
                                        {mergedPromptSegments.length === 0 && (
                                            <motion.span
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                exit={{ opacity: 0 }}
                                                className="text-muted-foreground italic block mt-1"
                                            >
                                                Select posts to generate dynamic variations...
                                            </motion.span>
                                        )}
                                    </div>
                                ) : (
                                    mergedPromptSegments.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5 min-h-[2rem] content-start">
                                            <AnimatePresence mode="popLayout">
                                                {mergedPromptSegments.map((segment, index) => (
                                                    <RemovableTagChip
                                                        key={`${segment.text}-${index}`}
                                                        text={segment.display}
                                                        category={segment.category}
                                                        onRemove={() => onRemoveTag(segment.text)}
                                                    />
                                                ))}
                                            </AnimatePresence>
                                        </div>
                                    ) : (
                                        <motion.span
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            className="text-muted-foreground italic block mt-1"
                                        >
                                            Select posts to merge prompt parts...
                                        </motion.span>
                                    )
                                )}
                            </div>

                            <div className="absolute bottom-2 right-2 flex gap-2 z-10">
                                <Button
                                    size="sm"
                                    onClick={() => handleCopy(mergedPrompt)}
                                    disabled={!mergedPrompt}
                                    className={`relative overflow-visible shadow-sm transition-all duration-300 ${isCopied ? 'bg-success hover:bg-success/90 text-success-foreground ring-2 ring-success/50' : 'opacity-90 hover:opacity-100'}`}
                                >
                                    <div className="grid place-items-center">
                                        <motion.div
                                            className="flex items-center font-bold col-start-1 row-start-1"
                                            initial={{ opacity: 0, scale: 0.5 }}
                                            animate={{
                                                opacity: isCopied ? 1 : 0,
                                                scale: isCopied ? 1 : 0.5,
                                                pointerEvents: isCopied ? "auto" : "none"
                                            }}
                                            transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                        >
                                            <Check className="w-4 h-4 mr-2 stroke-[3px]" />
                                            Copied!
                                        </motion.div>
                                        <motion.div
                                            className="flex items-center col-start-1 row-start-1"
                                            initial={{ opacity: 1, scale: 1 }}
                                            animate={{
                                                opacity: isCopied ? 0 : 1,
                                                scale: isCopied ? 0.5 : 1,
                                                pointerEvents: isCopied ? "none" : "auto"
                                            }}
                                            transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                        >
                                            <Copy className="w-4 h-4 mr-2" />
                                            Copy
                                        </motion.div>
                                    </div>
                                    <AnimatePresence>
                                        {isCopied && <Particles color="green" />}
                                    </AnimatePresence>
                                </Button>
                            </div>
                        </div>

                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

export const MergeStickyFooter = memo(MergeStickyFooterComponent)
