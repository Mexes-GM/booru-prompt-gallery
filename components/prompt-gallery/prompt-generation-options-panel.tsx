"use client"

import { AnimatePresence, motion } from "framer-motion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DebouncedInput } from "@/components/ui/debounced-input"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { usePostHog } from 'posthog-js/react'
import { Switch } from "@/components/ui/switch"
import {
  ArrowRight,
  Check,
  ChevronDown,
  CornerDownRight,
  Globe,
  Search,
  Settings,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { userPreferences } from "@/lib/storage"
import type { BackgroundMode } from "@/lib/background-detector"

interface PromptGenerationOptionsPanelProps {
  isPromptOptionsExpanded: boolean
  setIsPromptOptionsExpanded: (updater: (prev: boolean) => boolean) => void
  booruProvider: string

  includeCharacters: boolean
  setIncludeCharacters: (val: boolean) => void
  optimizeTags: boolean
  setOptimizeTags: (val: boolean) => void
  smartTagExclusion: boolean
  setSmartTagExclusion: (val: boolean) => void

  removeLoRaTags: boolean
  setRemoveLoRaTags: (val: boolean) => void
  removeQualityTags: boolean
  setRemoveQualityTags: (val: boolean) => void

  isGlobalWeightsEnabled: boolean
  toggleGlobalWeights: (enabled: boolean) => void
  setIsGlobalWeightsModalOpen: (open: boolean) => void

  backgroundMode: BackgroundMode
  setBackgroundMode: (mode: BackgroundMode) => void
  simpleBackgroundReplacementTags: string
  setSimpleBackgroundReplacementTags: (value: string) => void
  randomBackgroundPatterns: boolean
  setRandomBackgroundPatterns: (val: boolean) => void
  randomBackgroundIncludeGradients: boolean
  setRandomBackgroundIncludeGradients: (val: boolean) => void

  /**
   * "full" (default) is the desktop 2-column panel with InfoTooltip visuals
   * and a mobile-only collapsible header. "compact" renders the same controls
   * with the Pocket's tighter markup (small switches/selects, plain Labels
   * instead of InfoTooltip demos, always expanded — the Pocket has its own
   * outer Collapsible). Both variants share the exact same props/handlers.
   */
  variant?: "full" | "compact"
}

/**
 * Right column of the "Advanced Filters & Options" panel: the collapsible
 * (mobile-only) "Prompt Generation Options" header, the include-characters /
 * smart-tag-combination / smart-tag-exclusion switches (or the Aibooru-specific
 * remove-lora/remove-quality switches), the global tag weights toggle, and the
 * background-handling select with its conditional sub-panels (replacement tags
 * input for "Replace", pattern/gradient toggles for "Simple Random").
 */
export function PromptGenerationOptionsPanel({
  isPromptOptionsExpanded,
  setIsPromptOptionsExpanded,
  booruProvider,
  includeCharacters,
  setIncludeCharacters: _setIncludeCharacters,
  optimizeTags,
  setOptimizeTags: _setOptimizeTags,
  smartTagExclusion,
  setSmartTagExclusion: _setSmartTagExclusion,
  removeLoRaTags,
  setRemoveLoRaTags: _setRemoveLoRaTags,
  removeQualityTags,
  setRemoveQualityTags: _setRemoveQualityTags,
  isGlobalWeightsEnabled,
  toggleGlobalWeights: _toggleGlobalWeights,
  setIsGlobalWeightsModalOpen,
  backgroundMode,
  setBackgroundMode: _setBackgroundMode,
  simpleBackgroundReplacementTags,
  setSimpleBackgroundReplacementTags: _setSimpleBackgroundReplacementTags,
  randomBackgroundPatterns,
  setRandomBackgroundPatterns: _setRandomBackgroundPatterns,
  randomBackgroundIncludeGradients,
  setRandomBackgroundIncludeGradients: _setRandomBackgroundIncludeGradients,
  variant = "full",
}: PromptGenerationOptionsPanelProps) {
  const posthog = usePostHog();

  const trackSetting = (settingName: string, value: string | boolean) => {
    posthog.capture('generation_settings_changed', {
      setting_changed: settingName,
      new_value: value,
    });
  };

  const trackBackground = (settingName: string, value: string | boolean) => {
    posthog.capture('background_option_changed', {
      setting_changed: settingName,
      new_value: value,
    });
  };

  const setIncludeCharacters = (val: boolean) => { trackSetting('includeCharacters', val); _setIncludeCharacters(val); };
  const setOptimizeTags = (val: boolean) => { trackSetting('optimizeTags', val); _setOptimizeTags(val); };
  const setSmartTagExclusion = (val: boolean) => { trackSetting('smartTagExclusion', val); _setSmartTagExclusion(val); };
  const setRemoveLoRaTags = (val: boolean) => { trackSetting('removeLoRaTags', val); _setRemoveLoRaTags(val); };
  const setRemoveQualityTags = (val: boolean) => { trackSetting('removeQualityTags', val); _setRemoveQualityTags(val); };
  // toggleGlobalWeights prop expects (enabled: boolean) => void
  const toggleGlobalWeights = (enabled: boolean) => { trackSetting('globalWeights', enabled); _toggleGlobalWeights(enabled); };

  const setBackgroundMode = (val: BackgroundMode) => { trackBackground('backgroundMode', val); _setBackgroundMode(val); };
  const setSimpleBackgroundReplacementTags = (val: string) => { trackBackground('simpleBackgroundReplacementTags', val); _setSimpleBackgroundReplacementTags(val); };
  const setRandomBackgroundPatterns = (val: boolean) => { trackBackground('randomBackgroundPatterns', val); _setRandomBackgroundPatterns(val); };
  const setRandomBackgroundIncludeGradients = (val: boolean) => { trackBackground('randomBackgroundIncludeGradients', val); _setRandomBackgroundIncludeGradients(val); };

  if (variant === "compact") {
    return (
      <>
        {/* Switches Grid */}
        <div className="flex flex-col gap-1 border-t pt-2">
          <div className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
            <Label htmlFor="include-characters" className="text-xs select-none cursor-pointer flex-1">Include Characters</Label>
            <Switch id="include-characters" checked={includeCharacters} onCheckedChange={setIncludeCharacters} className="scale-75 origin-right" />
          </div>
          <div className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
            <Label htmlFor="smart-tag" className="text-xs select-none cursor-pointer flex-1">Smart Tag Combination</Label>
            <Switch id="smart-tag" checked={optimizeTags} onCheckedChange={setOptimizeTags} className="scale-75 origin-right" />
          </div>
          <div className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-1.5 flex-1">
              <Label htmlFor="smart-exclusion" className="text-xs select-none cursor-pointer">Smart Tag Exclusion</Label>
              <Badge variant="default" className="text-[8px] py-0 px-1 !rounded h-3.5 select-none shrink-0">Beta</Badge>
            </div>
            <Switch id="smart-exclusion" checked={smartTagExclusion} onCheckedChange={setSmartTagExclusion} className="scale-75 origin-right" />
          </div>

          {booruProvider === "aibooru" && (
            <>
              <div className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
                <Label htmlFor="remove-lora" className="text-xs select-none cursor-pointer flex-1">Remove LoRa tags</Label>
                <Switch id="remove-lora" checked={removeLoRaTags} onCheckedChange={setRemoveLoRaTags} className="scale-75 origin-right" />
              </div>
              <div className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
                <Label htmlFor="remove-quality" className="text-xs select-none cursor-pointer flex-1">Remove Quality tags</Label>
                <Switch id="remove-quality" checked={removeQualityTags} onCheckedChange={setRemoveQualityTags} className="scale-75 origin-right" />
              </div>
            </>
          )}

          <div className="flex items-center justify-between p-1 rounded-md hover:bg-muted/30 transition-colors">
            <div className="flex flex-col gap-0.5 flex-1">
              <Label htmlFor="global-weights-toggle" className="text-xs select-none cursor-pointer">Global Tag Weights</Label>
              <span className="text-[10px] text-muted-foreground leading-none">Apply weights across all cards</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Switch id="global-weights-toggle" checked={isGlobalWeightsEnabled} onCheckedChange={toggleGlobalWeights} className="scale-75 origin-right" />
              <Button variant="outline" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => setIsGlobalWeightsModalOpen(true)}>Manage</Button>
            </div>
          </div>
        </div>

        {/* Background Options */}
        <div className="flex flex-col gap-2 p-2 rounded-lg bg-muted/40 border border-border/50">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="background-handling-select" className="text-xs font-semibold cursor-pointer">Background Options</Label>
                <Badge variant="default" className="text-[8px] py-0 px-1 !rounded h-3.5 select-none shrink-0">Beta</Badge>
              </div>
              <span className="text-[10px] text-muted-foreground leading-tight">Modify background/scene tags</span>
            </div>
            <Select
              value={backgroundMode}
              onValueChange={(val: BackgroundMode) => setBackgroundMode(val)}
            >
              <SelectTrigger id="background-handling-select" className="h-7 text-[11px] bg-background w-[110px]">
                <SelectValue placeholder="Original" />
              </SelectTrigger>
              <SelectContent className="text-xs">
                <SelectItem value="keep">Original</SelectItem>
                <SelectItem value="remove_all">Remove All</SelectItem>
                <SelectItem value="force_simple">Replace</SelectItem>
                <SelectItem value="random">Simple Random</SelectItem>
                <SelectItem value="detailed_random">Detailed Random</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <AnimatePresence>
            {backgroundMode === 'force_simple' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="pt-1.5 flex items-center gap-1.5">
                  <CornerDownRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  <DebouncedInput
                    value={simpleBackgroundReplacementTags}
                    onChange={setSimpleBackgroundReplacementTags}
                    debounceTime={400}
                    placeholder="e.g., white background, simple background"
                    className="h-7 text-xs bg-background flex-1"
                  />
                </div>
              </motion.div>
            )}

            {backgroundMode === 'random' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="pt-2 flex flex-col gap-1.5 pl-3">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-medium">Include Patterns</span>
                      <span className="text-[10px] text-muted-foreground leading-none">Stripes, dots, etc.</span>
                    </div>
                    <Switch
                      checked={randomBackgroundPatterns}
                      onCheckedChange={setRandomBackgroundPatterns}
                      className="scale-75 origin-right"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-medium">Include Gradients</span>
                      <span className="text-[10px] text-muted-foreground leading-none">Gradients and two-tone colors</span>
                    </div>
                    <Switch
                      checked={randomBackgroundIncludeGradients}
                      onCheckedChange={setRandomBackgroundIncludeGradients}
                      className="scale-75 origin-right"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </>
    )
  }

  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-muted/30 p-4" data-tour="generation-options">
      <button
        type="button"
        onClick={() => setIsPromptOptionsExpanded((v) => !v)}
        aria-expanded={isPromptOptionsExpanded}
        className="w-full flex items-center justify-between gap-2 cursor-pointer sm:cursor-default sm:pointer-events-none"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Settings className="h-4 w-4 text-primary" />
          {booruProvider === 'aibooru' ? 'Aibooru Options' : 'Prompt Generation Options'}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 shrink-0 transition-transform duration-200 sm:hidden",
            isPromptOptionsExpanded && "rotate-180"
          )}
        />
      </button>
      <div
        className={cn(
          "grid grid-cols-1 sm:grid-cols-2 gap-3",
          !isPromptOptionsExpanded && "hidden sm:grid"
        )}
      >
        {booruProvider !== 'aibooru' ? (
          <>
            <div className="flex items-center justify-between sm:justify-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
              <InfoTooltip
                title="Include Characters"
                description="Does exactly that: includes character tags in the prompt. You can turn this off if you don't want character names."
                visual={
                  <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
                    <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                        <span className="text-muted-foreground font-medium min-w-[70px]">Toggle:</span>
                        <span className="bg-destructive/10 text-destructive border border-destructive/20 px-1.5 py-0.5 rounded font-mono font-medium">Off/False</span>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                        <span className="text-muted-foreground font-medium min-w-[70px]">Original:</span>
                        <span className="px-1.5 py-0.5 rounded text-foreground font-mono bg-primary/5">hatsune miku, 1girl, solo</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-1 px-1">
                      <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
                      <div className="flex flex-wrap gap-1">
                        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo</span>
                        <span className="bg-destructive/10 border border-destructive/20 text-destructive line-through px-1.5 py-0.5 rounded"><X className="w-2.5 h-2.5 inline mr-0.5" />hatsune miku</span>
                      </div>
                    </div>
                  </div>
                }
              >
                <Label htmlFor="include-characters" className="text-sm select-none cursor-pointer flex-1 sm:flex-none">Include Characters</Label>
              </InfoTooltip>
              <Switch
                id="include-characters"
                checked={includeCharacters}
                onCheckedChange={setIncludeCharacters}
                className="scale-90"
                aria-label="Include characters in prompts"
              />
            </div>
            <div className="flex items-center justify-between sm:justify-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
              <InfoTooltip
                title="Smart Tag Combination"
                description="If the prompt has, for example, 'hair, long hair, white hair', this function combines them into a single tag: 'long white hair'. Useful to avoid redundancy and not saturate the tokenizer."
                visual={
                  <div className="w-full flex flex-col gap-2 p-1">
                    <div className="flex justify-between items-center text-[10px] text-muted-foreground w-full px-1">
                      <span>Before</span>
                      <span>After</span>
                    </div>
                    <div className="flex justify-between items-center gap-2 w-full">
                      <span className="bg-muted text-muted-foreground px-2 py-1 rounded text-[10px] whitespace-nowrap">hair, long hair, white hair</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="bg-primary/10 border border-primary/20 text-primary px-2 py-1 rounded text-[10px] whitespace-nowrap">long white hair</span>
                    </div>
                  </div>
                }
              >
                <Label htmlFor="smart-tag" className="text-sm select-none cursor-pointer flex-1 sm:flex-none">Smart Tag Combination</Label>
              </InfoTooltip>
              <Switch
                id="smart-tag"
                checked={optimizeTags}
                onCheckedChange={setOptimizeTags}
                className="scale-90"
                aria-label="Enable smart tag combination"
              />
            </div>
            <div className="flex items-center justify-between sm:justify-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
              <div className="flex items-center gap-2">
                <InfoTooltip
                  title="Smart Tag Exclusion"
                  description="Makes added tags work smartly. For example, if the original prompt implies a back view without a face, and your 'Tags to add' contains facial features like 'lips, nose, blue eyes', it automatically disables them for that specific card to keep the generated result faithful. WARNING: This is a beta feature and is still being polished."
                  visual={
                    <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
                      <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                          <span className="text-muted-foreground font-medium min-w-[70px]">Prompt:</span>
                          <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, from behind</span>
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                          <span className="text-muted-foreground font-medium min-w-[70px]">Tags to Add:</span>
                          <span className="bg-green-500/10 text-green-500 border border-green-500/20 px-1.5 py-0.5 rounded">blue eyes, lips</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-1 px-1">
                        <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
                        <div className="flex flex-wrap gap-1">
                          <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">from behind</span>
                          <span className="bg-destructive/10 border border-destructive/20 text-destructive line-through px-1.5 py-0.5 rounded">blue eyes, lips</span>
                        </div>
                      </div>
                    </div>
                  }
                >
                  <Label htmlFor="smart-exclusion" className="text-sm select-none cursor-pointer">Smart Tag Exclusion</Label>
                </InfoTooltip>
                <Badge variant="default" className="text-xs py-0 px-2 !rounded-lg">Beta</Badge>
              </div>
              <Switch
                id="smart-exclusion"
                checked={smartTagExclusion}
                onCheckedChange={setSmartTagExclusion}
                className="scale-90"
                aria-label="Enable smart tag exclusion"
              />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between sm:justify-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
              <Label htmlFor="remove-lora" className="text-sm select-none cursor-pointer flex-1 sm:flex-none">Remove LoRa Tags</Label>
              <Switch
                id="remove-lora"
                checked={removeLoRaTags}
                onCheckedChange={setRemoveLoRaTags}
                className="scale-90"
                aria-label="Remove LoRa tags from Aibooru prompts"
              />
            </div>
            <div className="flex items-center justify-between sm:justify-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 sm:col-span-2">
              <Label htmlFor="remove-quality" className="text-sm select-none cursor-pointer flex-1 sm:flex-none">Remove Quality Tags</Label>
              <Switch
                id="remove-quality"
                checked={removeQualityTags}
                onCheckedChange={setRemoveQualityTags}
                className="scale-90"
                aria-label="Remove quality tags from Aibooru prompts"
              />
            </div>
          </>
        )}

        <div className="sm:col-span-2 flex items-center justify-between sm:justify-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50">
          <div className="flex flex-col gap-0.5 flex-1 sm:flex-none">
            <InfoTooltip
              title="Global Tag Weights"
              description="All tags are clickable. If you click a tag, you can adjust its weight (e.g., 1.5). If 'Global Tag Weights' is enabled and you click the Globe icon, that weight will automatically be applied to all cards containing said tag."
              visual={
                <div className="w-full flex gap-3 text-[10px] items-center p-3 bg-slate-950 rounded-lg overflow-hidden relative">

                  {/* Popover mock */}
                  <div className="flex flex-col w-[130px] bg-slate-800 rounded-lg border border-slate-700 shadow-xl overflow-hidden shrink-0 text-slate-200 z-10">
                    <div className="p-2 flex items-center justify-between">
                      <div className="flex items-center gap-2.5 text-slate-400">
                        <span>—</span> <span className="font-bold text-slate-100 text-[11px]">1.5</span> <span>+</span>
                      </div>
                      <Globe className="w-3.5 h-3.5 text-[#a855f7]" />
                    </div>
                    <div className="p-1.5 px-2 border-y border-slate-700 flex items-center gap-1.5 text-slate-400">
                      <Search className="w-3 h-3" /> <span>Search Tag</span>
                    </div>
                    <div className="p-2 flex flex-wrap gap-1 items-center">
                      <span className="bg-[#a855f7]/20 text-[#d8b4fe] px-1.5 py-0.5 rounded-md font-medium">
                        (frieren:1.5)
                      </span>
                      <span className="text-slate-300 leading-tight">1girl, elf...</span>
                    </div>
                  </div>

                  <ArrowRight className="w-4 h-4 text-slate-500 shrink-0 z-10" />

                  {/* Affected cards mock */}
                  <div className="flex flex-col gap-2 flex-1 w-full text-slate-200 z-10">
                    <div className="bg-slate-800 rounded-lg border border-slate-700 p-2 flex flex-col gap-1.5 shadow-sm">
                      <div className="flex">
                        <span className="bg-[#a855f7]/20 text-[#d8b4fe] rounded-md px-1.5 py-0.5 font-medium relative">
                          (frieren:1.5)
                          <span className="absolute -top-0.5 -right-0.5 w-[5px] h-[5px] rounded-full bg-[#a855f7] shadow-[0_0_6px_#c084fc]" />
                        </span>
                      </div>
                      <span className="text-slate-300">elf, sitting</span>
                    </div>
                    <div className="bg-slate-800 rounded-lg border border-slate-700 p-2 flex flex-col gap-1.5 shadow-sm">
                      <div className="flex">
                        <span className="bg-[#a855f7]/20 text-[#d8b4fe] rounded-md px-1.5 py-0.5 font-medium relative">
                          (frieren:1.5)
                          <span className="absolute -top-0.5 -right-0.5 w-[5px] h-[5px] rounded-full bg-[#a855f7] shadow-[0_0_6px_#c084fc]" />
                        </span>
                      </div>
                      <span className="text-slate-300">long_hair</span>
                    </div>
                  </div>
                </div>
              }
            >
              <Label htmlFor="global-weights-toggle" className="text-sm select-none cursor-pointer">Global Tag Weights</Label>
            </InfoTooltip>
            <span className="text-[10px] text-muted-foreground">Propagate changes to all cards</span>
          </div>
          <div className="flex items-center gap-2 ml-auto sm:ml-0">
            <Switch
              id="global-weights-toggle"
              checked={isGlobalWeightsEnabled}
              onCheckedChange={toggleGlobalWeights}
              className="scale-90"
              aria-label="Toggle global tag weights"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={(e) => {
                e.preventDefault()
                setIsGlobalWeightsModalOpen(true)
              }}
            >
              Manage
            </Button>
          </div>
        </div>

        <div className="sm:col-span-2 flex flex-col gap-2 p-3 mt-1 rounded-xl bg-muted/40 border border-border/50 shadow-sm transition-colors hover:border-border/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <InfoTooltip
                    title="Background Options"
                    description="This option allows you to modify background-related tags for greater control. You can leave them as is, remove them completely, or more importantly, replace them with one of your liking. Useful for getting results with the same background or simply adding a white background to all your generations. WARNING: This is a beta feature and is still being polished."
                    visual={
                      <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
                        <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                            <span className="text-muted-foreground font-medium min-w-[70px]">Original:</span>
                            <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, outdoors, blue sky</span>
                          </div>
                          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                            <span className="text-muted-foreground font-medium min-w-[70px]">Option:</span>
                            <span className="bg-yellow-500/10 text-yellow-600 border border-yellow-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">Replace: <span>white background</span></span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mt-1 px-1">
                          <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
                          <div className="flex flex-wrap gap-1">
                            <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl</span>
                            <span className="bg-green-500/10 border border-green-500/20 text-green-500 px-1.5 py-0.5 rounded flex items-center gap-0.5"><Check className="w-3 h-3" /> white background</span>
                          </div>
                        </div>
                      </div>
                    }
                  >
                    <Label htmlFor="background-handling-select" className="text-sm font-medium cursor-pointer">Background Options</Label>
                  </InfoTooltip>
                  <Badge variant="default" className="text-xs py-0 px-2 !rounded-lg">Beta</Badge>
                </div>
                <span className="text-[10px] text-muted-foreground leading-tight">Modify scenery tags</span>
              </div>
            </div>
            <div className="w-full sm:w-auto sm:min-w-[160px]">
              <Select
                value={backgroundMode}
                onValueChange={(val: any) => {
                  setBackgroundMode(val);
                  userPreferences.setBackgroundMode(val);
                }}
              >
                <SelectTrigger id="background-handling-select" className="h-8 text-xs bg-background">
                  <SelectValue placeholder="Keep Original" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">Keep Original</SelectItem>
                  <SelectItem value="remove_all">Remove All</SelectItem>
                  <SelectItem value="force_simple">Replace</SelectItem>
                  <SelectItem value="random">Simple Random</SelectItem>
                  <SelectItem value="detailed_random">Detailed Random</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <AnimatePresence>
            {backgroundMode === 'force_simple' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="pt-2 pl-0 sm:pl-[3.25rem] flex items-center gap-2">
                  <CornerDownRight className="w-3.5 h-3.5 text-muted-foreground hidden sm:block shrink-0" />
                  <DebouncedInput value={simpleBackgroundReplacementTags} onChange={(val) => {
                    setSimpleBackgroundReplacementTags(val);
                    userPreferences.setSimpleBackgroundReplacementTags(val);
                  }} debounceTime={400} placeholder="e.g. simple background, white background" className="h-8 text-xs bg-background focus-visible:ring-1 min-w-0 flex-1" aria-label="Tags to replace background with" />
                </div>
              </motion.div>
            )}
            {backgroundMode === 'random' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="pt-3 pl-0 sm:pl-[3.25rem] flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-foreground">Include Patterns</span>
                      <span className="text-[10px] text-muted-foreground leading-tight">Allow generation of patterned backgrounds.</span>
                    </div>
                    <Switch checked={randomBackgroundPatterns} onCheckedChange={(val) => { setRandomBackgroundPatterns(val); userPreferences.setRandomBackgroundPatterns(val); }} className="scale-75 origin-right" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-foreground">Include Gradients</span>
                      <span className="text-[10px] text-muted-foreground leading-tight">Add two-tone and gradient backgrounds.</span>
                    </div>
                    <Switch checked={randomBackgroundIncludeGradients} onCheckedChange={setRandomBackgroundIncludeGradients} className="scale-75 origin-right" />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
