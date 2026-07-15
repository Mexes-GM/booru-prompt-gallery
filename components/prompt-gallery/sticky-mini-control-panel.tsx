"use client"

import React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useLowMotion } from "@/hooks/use-low-motion"
import { DebouncedInput } from "@/components/ui/debounced-input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { FileCheck2, Dices, Settings2, Sparkles, X } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface StickyMiniControlPanelProps {
  isVisible: boolean;
  addInput: string;
  setAddInput: (val: string) => void;
  includeCharacters: boolean;
  setIncludeCharacters: (val: boolean) => void;
  optimizeTags: boolean;
  setOptimizeTags: (val: boolean) => void;
  smartTagExclusion: boolean;
  setSmartTagExclusion: (val: boolean) => void;
  backgroundMode: string;
  setBackgroundMode: (val: any) => void;
  simpleBackgroundReplacementTags: string;
  setSimpleBackgroundReplacementTags: (val: string) => void;
  randomBackgroundPatterns: boolean;
  setRandomBackgroundPatterns: (val: boolean) => void;
  randomBackgroundIncludeGradients: boolean;
  setRandomBackgroundIncludeGradients: (val: boolean) => void;
  isMergeMode: boolean;
  mergeModeType: string;
  isAiConvertMode: boolean;
  onToggleMergeMode: () => void;
  onToggleVariationMode: () => void;
  onToggleAiConvertMode: () => void;
}

export function StickyMiniControlPanel({
  isVisible,
  addInput,
  setAddInput,
  includeCharacters,
  setIncludeCharacters,
  optimizeTags,
  setOptimizeTags,
  smartTagExclusion,
  setSmartTagExclusion,
  backgroundMode,
  setBackgroundMode,
  simpleBackgroundReplacementTags,
  setSimpleBackgroundReplacementTags,
  randomBackgroundPatterns,
  setRandomBackgroundPatterns,
  randomBackgroundIncludeGradients,
  setRandomBackgroundIncludeGradients,
  isMergeMode,
  mergeModeType,
  isAiConvertMode,
  onToggleMergeMode,
  onToggleVariationMode,
  onToggleAiConvertMode
}: StickyMiniControlPanelProps) {
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const lowMotion = useLowMotion();

  // Close popover when panel hides (before exit animation starts)
  React.useEffect(() => {
    if (!isVisible && isSettingsOpen) {
      setIsSettingsOpen(false);
    }
  }, [isVisible, isSettingsOpen]);

  // Count how many tags are in the input
  const tagCount = addInput.trim()
    ? addInput.split(",").filter(t => t.trim()).length
    : 0;

  // ── spring config (respects reduced motion) ──────────────────────────
  const springTransition = lowMotion
    ? { duration: 0.15 }
    : { type: "spring" as const, stiffness: 200, damping: 25, mass: 0.8 };

  const enterAnim = lowMotion
    ? { opacity: 0 }
    : { y: -100, opacity: 0, scale: 0.95 };

  const exitAnim = lowMotion
    ? { opacity: 0 }
    : { y: -100, opacity: 0, scale: 0.95 };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="sticky-mini-panel"
          initial={enterAnim}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={exitAnim}
          transition={springTransition}
          className={`fixed top-6 left-0 right-0 mx-auto z-[60] w-[95%] max-w-4xl border shadow-2xl rounded-2xl overflow-hidden ring-1 ring-white/10 ${lowMotion ? "bg-background/95" : "bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/85"}`}
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          {/* Border Glow Effect */}
          <div className="absolute inset-0 z-[-1] overflow-hidden rounded-2xl pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-[1px] bg-gradient-to-r from-transparent via-white/50 to-transparent opacity-50" />
            {!lowMotion ? (
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
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(120,119,198,0.1)_0%,transparent_50%)]" />
            )}
          </div>

          <div className="p-2 sm:p-3 flex flex-wrap sm:flex-nowrap items-end gap-2 sm:gap-4 relative z-10">
            {/* Tags to Add */}
            <div className="flex-1 min-w-[200px] max-w-[450px] flex flex-col gap-1">
              <label htmlFor="sticky-add-tags-input" className="text-xs font-medium leading-none flex items-center gap-2 text-foreground">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" aria-hidden="true" />
                Tags to Add
                {tagCount > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    ({tagCount} tag{tagCount !== 1 ? "s" : ""})
                  </span>
                )}
                <span className="text-[10px] font-normal text-muted-foreground/70 hidden sm:inline">
                  (Only modify final prompt)
                </span>
              </label>
              <div className="flex h-8 w-full items-center rounded-md border border-input bg-background/50 pl-2 pr-1 text-sm shadow-sm transition-colors focus-within:outline-none focus-within:ring-1 focus-within:ring-ring">
                <DebouncedInput
                  id="sticky-add-tags-input"
                  value={addInput}
                  onChange={setAddInput}
                  placeholder="e.g. 1girl, solo..."
                  className="flex-1 h-full bg-transparent border-none p-0 shadow-none focus-visible:ring-0 text-xs w-full min-w-0"
                  debounceTime={400}
                />
                {addInput && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 hover:bg-muted"
                        onClick={() => setAddInput("")}
                        aria-label="Clear tags"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Clear</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            {/* Prompt Generation Options */}
            <Popover open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-2 shrink-0">
                  <Settings2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Settings</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end" sideOffset={8}>
                <div className="space-y-4">
                  <h4 className="font-medium text-sm leading-none">Prompt Generation</h4>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="mini-include-chars" className="text-xs">Include Characters</Label>
                      <Switch id="mini-include-chars" checked={includeCharacters} onCheckedChange={setIncludeCharacters} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="mini-smart-tag" className="text-xs">Smart Tag Combination</Label>
                      <Switch id="mini-smart-tag" checked={optimizeTags} onCheckedChange={setOptimizeTags} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="mini-smart-excl" className="text-xs">Smart Tag Exclusion</Label>
                        <Badge variant="default" className="text-[10px] py-0 px-1 !rounded-sm">Beta</Badge>
                      </div>
                      <Switch id="mini-smart-excl" checked={smartTagExclusion} onCheckedChange={setSmartTagExclusion} />
                    </div>

                    <div className="border-t pt-3 mt-1">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Label className="text-xs font-medium">Background Options</Label>
                          <Badge variant="default" className="text-[10px] py-0 px-1 !rounded-sm">Beta</Badge>
                        </div>
                      </div>
                      <Select value={backgroundMode} onValueChange={setBackgroundMode}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select mode..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="keep">Keep Original</SelectItem>
                          <SelectItem value="remove_all">Remove All</SelectItem>
                          <SelectItem value="force_simple">Replace</SelectItem>
                          <SelectItem value="random">Simple Random</SelectItem>
                          <SelectItem value="detailed_random">Detailed Random</SelectItem>
                        </SelectContent>
                      </Select>

                      {backgroundMode === 'force_simple' && (
                        <div className="mt-2">
                          <DebouncedInput
                            value={simpleBackgroundReplacementTags}
                            onChange={setSimpleBackgroundReplacementTags}
                            placeholder="e.g. simple background, white background"
                            className="h-8 text-xs"
                            debounceTime={400}
                          />
                        </div>
                      )}
                      {backgroundMode === 'random' && (
                        <div className="mt-2 flex flex-col gap-2 bg-muted/50 p-2 rounded-md">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px]">Include Patterns</span>
                            <Switch checked={randomBackgroundPatterns} onCheckedChange={setRandomBackgroundPatterns} />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px]">Include Gradients</span>
                            <Switch checked={randomBackgroundIncludeGradients} onCheckedChange={setRandomBackgroundIncludeGradients} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <div className="w-px h-6 bg-border mx-1 hidden sm:block" aria-hidden="true" />

            {/* Action Buttons */}
            <div className="flex items-center gap-2 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    onClick={onToggleAiConvertMode}
                    variant="secondary"
                    className={`h-8 px-2.5 gap-1.5 transition-colors ${isAiConvertMode
                      ? "bg-amber-200 text-amber-800 hover:bg-amber-300 dark:bg-amber-800 dark:text-amber-100 dark:hover:bg-amber-700"
                      : "bg-amber-50 text-amber-600 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:hover:bg-amber-900/40"
                      }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 fill-current" />
                    <span className="text-xs font-medium hidden sm:inline">Convert</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="sm:hidden">AI Convert</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    onClick={onToggleMergeMode}
                    variant="secondary"
                    className={`h-8 px-2.5 gap-1.5 transition-colors ${isMergeMode && mergeModeType === 'merge'
                      ? "bg-blue-200 text-blue-800 hover:bg-blue-300 dark:bg-blue-800 dark:text-blue-100 dark:hover:bg-blue-700"
                      : "bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40"
                      }`}
                  >
                    <FileCheck2 className="w-3.5 h-3.5 fill-current" />
                    <span className="text-xs font-medium hidden sm:inline">Merge</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="sm:hidden">Merge Prompts</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    onClick={onToggleVariationMode}
                    variant="secondary"
                    className={`h-8 px-2.5 gap-1.5 transition-colors ${isMergeMode && mergeModeType === 'variations'
                      ? "bg-indigo-200 text-indigo-800 hover:bg-indigo-300 dark:bg-indigo-800 dark:text-indigo-100 dark:hover:bg-indigo-700"
                      : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-400 dark:hover:bg-indigo-900/40"
                      }`}
                  >
                    <Dices className="w-3.5 h-3.5 fill-current" />
                    <span className="text-xs font-medium hidden sm:inline">Variation</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="sm:hidden">Variations</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
