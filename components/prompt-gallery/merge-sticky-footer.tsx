import { useRef, useEffect, useState, memo, useCallback, useMemo } from 'react'
import { Button } from "@/components/ui/button"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { X, Copy, Trash2, Check, Shuffle, Type } from "lucide-react"
import { BooruPost } from '@/lib/booru/types'
import { SelectedPostParts, MergeModeType } from '@/hooks/use-merge-mode'
import { TagCategory } from '@/lib/tag-classifier'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

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
}

const ExplodingTag = memo(({
    text,
    category,
    onRemove,
    getCategoryClass
}: {
    text: string
    category: TagCategory
    onRemove: () => void
    getCategoryClass: (c: TagCategory) => string
}) => {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{
                opacity: 0,
                scale: 2,
                filter: "blur(4px)",
                transition: { duration: 0.3 }
            }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="relative z-0 hover:z-10"
        >
            <motion.button
                onClick={onRemove}
                className={`transform-gpu hover:scale-110 active:scale-95 transition-all duration-200 px-2.5 py-1.5 sm:py-0.5 rounded border text-xs font-medium font-mono cursor-pointer select-none relative overflow-hidden group ${getCategoryClass(category)}`}
            >
                <span className="block relative z-10 transition-transform duration-300 group-hover:-translate-x-1.5 truncate max-w-[150px]">
                    {text}
                </span>

                <span className="absolute inset-0 bg-red-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

                <span className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                    <X className="w-3 h-3" />
                </span>
            </motion.button>
        </motion.div>
    )
})
ExplodingTag.displayName = "ExplodingTag"

const SymbolTag = memo(({ 
    symbol, 
    category, 
    getCategoryTextColor, 
    getCategoryBorderColor 
}: { 
    symbol: string
    category: TagCategory
    getCategoryTextColor: (c: TagCategory) => string
    getCategoryBorderColor: (c: TagCategory) => string 
}) => {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5, filter: "blur(4px)" }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className={`flex items-center justify-center px-1.5 py-1.5 sm:py-0.5 rounded border border-dashed ${getCategoryBorderColor(category)} bg-background/30 font-mono text-xs font-medium opacity-80 ${getCategoryTextColor(category)} select-none`}
        >
            <span className="relative">{symbol}</span>
        </motion.div>
    )
})
SymbolTag.displayName = "SymbolTag"

const PARTICLES_MAP = {
    green: "bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.8)]",
    red: "bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.8)]"
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
    onToggleMergeModeType
}: MergeStickyFooterProps) => {

    const [isCopied, setIsCopied] = useState(false)
    const [isCleared, setIsCleared] = useState(false)

    const handleCopy = (text: string) => {
        onCopy(text)
        setIsCopied(true)
        setTimeout(() => setIsCopied(false), 2000)
    }

    const handleClear = () => {
        if (selectedPosts.size === 0) return
        setIsCleared(true)
        onClearAll()
        setTimeout(() => setIsCleared(false), 2000)
    }

    // Helper for category colors
    const getCategoryClass = useCallback((category: TagCategory) => {
        switch (category) {
            case 'appearance': return 'text-blue-500 bg-blue-500/10 border-blue-500/20'
            case 'pose': return 'text-purple-500 bg-purple-500/10 border-purple-500/20'
            case 'clothing': return 'text-green-500 bg-green-500/10 border-green-500/20'
            case 'scenery': return 'text-orange-500 bg-orange-500/10 border-orange-500/20'
            default: return 'text-muted-foreground bg-muted border-transparent'
        }
    }, [])

    const getCategoryTextColor = useCallback((category: TagCategory) => {
        switch (category) {
            case 'appearance': return 'text-blue-500'
            case 'pose': return 'text-purple-500'
            case 'clothing': return 'text-green-500'
            case 'scenery': return 'text-orange-500'
            default: return 'text-muted-foreground'
        }
    }, [])

    const getCategoryBorderColor = useCallback((category: TagCategory) => {
        switch (category) {
            case 'appearance': return 'border-blue-500/30 bg-blue-500/5'
            case 'pose': return 'border-purple-500/30 bg-purple-500/5'
            case 'clothing': return 'border-green-500/30 bg-green-500/5'
            case 'scenery': return 'border-orange-500/30 bg-orange-500/5'
            default: return 'border-border/50 bg-muted/30'
        }
    }, [])

    // Process variations data structure for UI rendering
    const variationsOutput = useMemo(() => {
        if (mergeModeType !== 'variations') return null;

        const commonTags = mergedPromptSegments.filter(s => !s.postId);
        const categories: TagCategory[] = ['appearance', 'clothing', 'pose', 'scenery', 'other'];
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
                    initial={{ y: 200, opacity: 0, scale: 0.95 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    exit={{ y: 200, opacity: 0, scale: 0.95 }}
                    transition={{
                        type: "spring",
                        stiffness: 200,
                        damping: 25,
                        mass: 0.8
                    }}
                    className="fixed bottom-6 left-0 right-0 mx-auto z-50 w-[95%] max-w-3xl bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/85 border shadow-2xl rounded-2xl overflow-hidden ring-1 ring-white/10"
                    style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
                >
                    {/* Border Glow Effect */}
                    <div className="absolute inset-0 z-[-1] overflow-hidden rounded-2xl pointer-events-none">
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-[1px] bg-gradient-to-r from-transparent via-white/50 to-transparent opacity-50" />
                        <motion.div
                            animate={{
                                background: [
                                    "radial-gradient(circle at 50% 0%, rgba(120,119,198,0.1) 0%, transparent 50%)",
                                    "radial-gradient(circle at 50% 0%, rgba(120,119,198,0.15) 0%, transparent 70%)",
                                    "radial-gradient(circle at 50% 0%, rgba(120,119,198,0.1) 0%, transparent 50%)"
                                ]
                            }}
                            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                            className="absolute inset-0"
                        />
                    </div>
                    <div className="p-4 flex flex-col gap-4">

                        {/* Header / Controls */}
                        <div className="flex items-center justify-between">
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
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleClear}
                                    disabled={selectedPosts.size === 0 || isCleared}
                                    className={`relative overflow-visible transition-all duration-300 ${isCleared ? 'bg-red-500 text-white ring-2 ring-red-500/50' : 'bg-red-500/10 hover:bg-red-500/20 text-red-600 hover:text-red-700'}`}
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
                                <Button variant="ghost" size="icon" onClick={onExit} className="h-8 w-8 rounded-full hover:bg-muted">
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
                                                    src={post.preview_file_url || post.file_url}
                                                    alt={`Selected post ${post.id}`}
                                                    fill
                                                    className="object-cover opacity-90 group-hover:opacity-100 transition-opacity duration-300"
                                                    unoptimized
                                                />
                                                <motion.button
                                                    whileHover={{ scale: 1.1 }}
                                                    whileTap={{ scale: 0.9 }}
                                                    onClick={() => onRemovePost(post.id)}
                                                    className="absolute top-1 right-1 bg-black/60 hover:bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 backdrop-blur-sm"
                                                >
                                                    <X className="w-3 h-3" />
                                                </motion.button>
                                                <div className="absolute bottom-0 left-0 right-0 flex gap-0.5 justify-center p-1 bg-gradient-to-t from-black/80 to-transparent">
                                                    {/* Tiny indicators for what parts are selected */}
                                                    {parts.has('appearance') && <motion.span layoutId={`dot-app-${post.id}`} className="w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_4px_rgba(96,165,250,0.8)]" title="Appearance" />}
                                                    {parts.has('clothing') && <motion.span layoutId={`dot-clo-${post.id}`} className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.8)]" title="Attire" />}
                                                    {parts.has('pose') && <motion.span layoutId={`dot-pos-${post.id}`} className="w-1.5 h-1.5 rounded-full bg-purple-400 shadow-[0_0_4px_rgba(192,132,252,0.8)]" title="Pose" />}
                                                    {parts.has('scenery') && <motion.span layoutId={`dot-sce-${post.id}`} className="w-1.5 h-1.5 rounded-full bg-orange-400 shadow-[0_0_4px_rgba(251,146,60,0.8)]" title="Scene" />}
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
                            <div className="min-h-[80px] max-h-[200px] w-full rounded-md border border-input bg-muted/50 px-3 py-3 text-sm shadow-sm overflow-y-auto overflow-x-hidden flex flex-col gap-2">
                                {mergeModeType === 'variations' && variationsOutput ? (
                                    <div className="flex flex-wrap gap-1.5 min-h-[2rem] content-start items-center">
                                        <AnimatePresence mode="popLayout">
                                            {variationsOutput.commonTags.map((segment, index) => (
                                                <ExplodingTag
                                                    key={`common-${segment.text}-${index}`}
                                                    text={segment.display}
                                                    category={segment.category}
                                                    onRemove={() => onRemoveTag(segment.text)}
                                                    getCategoryClass={getCategoryClass}
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
                                                            getCategoryTextColor={getCategoryTextColor}
                                                            getCategoryBorderColor={getCategoryBorderColor}
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
                                                                getCategoryTextColor={getCategoryTextColor}
                                                                getCategoryBorderColor={getCategoryBorderColor}
                                                            />
                                                        );
                                                    }

                                                    variation.tags.forEach((segment, tagIndex) => {
                                                        elements.push(
                                                            <ExplodingTag
                                                                key={`var-${variation.postId}-${segment.text}-${tagIndex}`}
                                                                text={segment.display}
                                                                category={segment.category}
                                                                onRemove={() => onRemoveTag(segment.text)}
                                                                getCategoryClass={getCategoryClass}
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
                                                            getCategoryTextColor={getCategoryTextColor}
                                                            getCategoryBorderColor={getCategoryBorderColor}
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
                                                    <ExplodingTag
                                                        key={`${segment.text}-${index}`}
                                                        text={segment.display}
                                                        category={segment.category}
                                                        onRemove={() => onRemoveTag(segment.text)}
                                                        getCategoryClass={getCategoryClass}
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
                                    className={`relative overflow-visible shadow-sm transition-all duration-300 ${isCopied ? 'bg-green-500 hover:bg-green-600 text-white ring-2 ring-green-500/50' : 'opacity-90 hover:opacity-100'}`}
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
