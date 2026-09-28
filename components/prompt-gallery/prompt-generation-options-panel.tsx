"use client"

import { memo, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { EASE_OUT_STRONG, SEGMENT_PILL_SPRING } from "@/lib/motion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DebouncedInput } from "@/components/ui/debounced-input"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { usePostHog } from 'posthog-js/react'
import { Switch } from "@/components/ui/switch"
import {
  ArrowRight,
  Check,
  ChevronDown,
  Globe,
  Search,
  Settings,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { BackgroundMode } from "@/lib/background-detector"
import type { MatchStrictness } from "@/lib/background-context"

/**
 * Labels + tooltip copy for the "Detailed Random" scene-matching strictness.
 * Shared between the compact (segmented control) and full (Select) renderings
 * below, so the wording never drifts between the two variants.
 */
export const MATCH_STRICTNESS_OPTIONS: { value: MatchStrictness; label: string }[] = [
  { value: "free", label: "Free" },
  { value: "balanced", label: "Balanced" },
  { value: "strict", label: "Strict" },
]

export const MATCH_STRICTNESS_DESCRIPTIONS: Record<MatchStrictness, string> = {
  free: "Fully random scenery.",
  balanced: "Tries to keep the scenery as close as possible to the original post (default).",
  strict: "Tries even harder to keep the scenery close to the original post.",
}

/** InfoTooltip demo visuals for the full variant, extracted as constants so
 *  the unified JSX tree below doesn't duplicate them per-branch. */
const INCLUDE_CHARACTERS_VISUAL = (
  <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
    <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Toggle:</span>
        <span className="bg-destructive/10 text-destructive-text border border-destructive/20 px-1.5 py-0.5 rounded font-mono font-medium">Off/False</span>
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
        <span className="bg-destructive/10 border border-destructive/20 text-destructive-text line-through px-1.5 py-0.5 rounded"><X className="w-2.5 h-2.5 inline mr-0.5" />hatsune miku</span>
      </div>
    </div>
  </div>
)

const SMART_TAG_COMBINATION_VISUAL = (
  <div className="w-full flex flex-col gap-2 p-1">
    <div className="flex justify-between items-center text-[10px] text-muted-foreground w-full px-1">
      <span>Before</span>
      <span>After</span>
    </div>
    <div className="flex justify-between items-center gap-2 w-full">
      <span className="bg-muted text-muted-foreground px-2 py-1 rounded text-[10px] whitespace-nowrap">hair, long hair, white hair</span>
      <span className="text-muted-foreground">→</span>
      <span className="bg-primary/10 border border-primary/20 text-primary-text px-2 py-1 rounded text-[10px] whitespace-nowrap">long white hair</span>
    </div>
  </div>
)

const SMART_TAG_EXCLUSION_VISUAL = (
  <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
    <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Prompt:</span>
        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, from behind</span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Tags to Add:</span>
        <span className="bg-success-soft text-success-text border border-success-border px-1.5 py-0.5 rounded">blue eyes, lips</span>
      </div>
    </div>

    <div className="flex items-center gap-2 mt-1 px-1">
      <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
      <div className="flex flex-wrap gap-1">
        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">from behind</span>
        <span className="bg-destructive/10 border border-destructive/20 text-destructive-text line-through px-1.5 py-0.5 rounded">blue eyes, lips</span>
      </div>
    </div>
  </div>
)

const PREPEND_ARTIST_VISUAL = (
  <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
    <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Artist:</span>
        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">wlop</span>
      </div>
    </div>

    <div className="flex items-center gap-2 mt-1 px-1">
      <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
      <div className="flex flex-wrap gap-1">
        <span className="bg-success-soft border border-success-border text-success-text px-1.5 py-0.5 rounded font-mono">@wlop,</span>
        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo...</span>
      </div>
    </div>
  </div>
)

const GLOBAL_WEIGHTS_VISUAL = (
  <div className="w-full flex gap-3 text-[10px] items-center p-3 bg-muted/30 rounded-lg border border-border/50 overflow-hidden relative">
    {/* Popover mock */}
    <div className="flex flex-col w-[130px] bg-background rounded-lg border border-border/80 shadow-xs overflow-hidden shrink-0 text-foreground z-10">
      <div className="p-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-muted-foreground">
          <span>—</span> <span className="font-bold text-foreground text-[11px]">1.5</span> <span>+</span>
        </div>
        <Globe className="w-3.5 h-3.5 text-primary-text" />
      </div>
      <div className="p-1.5 px-2 border-y border-border/60 flex items-center gap-1.5 text-muted-foreground">
        <Search className="w-3 h-3" /> <span>Search Tag</span>
      </div>
      <div className="p-2 flex flex-wrap gap-1 items-center">
        <span className="bg-primary/10 border border-primary/20 text-primary-text px-1.5 py-0.5 rounded-md font-medium">
          (frieren:1.5)
        </span>
        <span className="text-muted-foreground leading-tight">1girl, elf...</span>
      </div>
    </div>

    <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 z-10" />

    {/* Affected cards mock */}
    <div className="flex flex-col gap-2 flex-1 w-full text-foreground z-10">
      <div className="bg-background rounded-lg border border-border/80 p-2 flex flex-col gap-1.5 shadow-xs">
        <div className="flex">
          <span className="bg-primary/10 border border-primary/20 text-primary-text rounded-md px-1.5 py-0.5 font-medium relative">
            (frieren:1.5)
            <span className="absolute -top-0.5 -right-0.5 w-[5px] h-[5px] rounded-full bg-primary" />
          </span>
        </div>
        <span className="text-muted-foreground">elf, sitting</span>
      </div>
      <div className="bg-background rounded-lg border border-border/80 p-2 flex flex-col gap-1.5 shadow-xs">
        <div className="flex">
          <span className="bg-primary/10 border border-primary/20 text-primary-text rounded-md px-1.5 py-0.5 font-medium relative">
            (frieren:1.5)
            <span className="absolute -top-0.5 -right-0.5 w-[5px] h-[5px] rounded-full bg-primary" />
          </span>
        </div>
        <span className="text-muted-foreground">long_hair</span>
      </div>
    </div>
  </div>
)

const BACKGROUND_OPTIONS_VISUAL = (
  <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
    <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Original:</span>
        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, outdoors, blue sky</span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Option:</span>
        <span className="bg-warning-soft text-warning-text border border-warning-border px-1.5 py-0.5 rounded flex items-center gap-1">Replace: <span>white background</span></span>
      </div>
    </div>

    <div className="flex items-center gap-2 mt-1 px-1">
      <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
      <div className="flex flex-wrap gap-1">
        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl</span>
        <span className="bg-success-soft border border-success-border text-success-text px-1.5 py-0.5 rounded flex items-center gap-0.5"><Check className="w-3 h-3" /> white background</span>
      </div>
    </div>
  </div>
)

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
  prependAnimaArtist: boolean
  setPrependAnimaArtist: (val: boolean) => void
  /** Whether tags typed in the search bar but missing from a post's own
   *  prompt get silently appended to the final prompt. */
  autoAppendSearchTags?: boolean
  setAutoAppendSearchTags?: (val: boolean) => void

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
  /** How strictly "Detailed Random" gates its pick against the post's scene. */
  backgroundMatchStrictness: MatchStrictness
  setBackgroundMatchStrictness: (val: MatchStrictness) => void

  /**
   * "full" (default) is the desktop 2-column panel with InfoTooltip visuals
   * and a mobile-only collapsible header. "compact" renders the same controls
   * with the Pocket's tighter markup (small switches/selects, plain Labels
   * instead of InfoTooltip demos, always expanded — the Pocket has its own
   * outer Collapsible). Both variants render from ONE JSX tree per section
   * (switchesSection/backgroundOptionsSection below), branching per-control
   * on `isCompact` instead of two full copies of the markup.
   */
  variant?: "full" | "compact" | "embedded"
}

/**
 * Right column of the "Advanced Filters & Options" panel: the collapsible
 * (mobile-only) "Prompt Generation Options" header, the include-characters /
 * smart-tag-combination / smart-tag-exclusion switches (or the Aibooru-specific
 * remove-lora/remove-quality switches), the global tag weights toggle, and the
 * background-handling select with its conditional sub-panels (replacement tags
 * input for "Replace", pattern/gradient toggles for "Simple Random").
 */
export const PromptGenerationOptionsPanel = memo(function PromptGenerationOptionsPanel({
  isPromptOptionsExpanded,
  setIsPromptOptionsExpanded,
  booruProvider,
  includeCharacters,
  setIncludeCharacters: _setIncludeCharacters,
  optimizeTags,
  setOptimizeTags: _setOptimizeTags,
  smartTagExclusion,
  setSmartTagExclusion: _setSmartTagExclusion,
  prependAnimaArtist,
  setPrependAnimaArtist: _setPrependAnimaArtist,
  autoAppendSearchTags = true,
  setAutoAppendSearchTags: _setAutoAppendSearchTags,
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
  backgroundMatchStrictness,
  setBackgroundMatchStrictness: _setBackgroundMatchStrictness,
  variant = "full",
}: PromptGenerationOptionsPanelProps) {
  const posthog = usePostHog();
  const shouldReduceMotion = useReducedMotion();

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
  const setPrependAnimaArtist = (val: boolean) => { trackSetting('prependAnimaArtist', val); _setPrependAnimaArtist(val); };
  const setAutoAppendSearchTags = (val: boolean) => { trackSetting('autoAppendSearchTags', val); _setAutoAppendSearchTags?.(val); };
  const setRemoveLoRaTags = (val: boolean) => { trackSetting('removeLoRaTags', val); _setRemoveLoRaTags(val); };
  const setRemoveQualityTags = (val: boolean) => { trackSetting('removeQualityTags', val); _setRemoveQualityTags(val); };
  // toggleGlobalWeights prop expects (enabled: boolean) => void
  const toggleGlobalWeights = (enabled: boolean) => { trackSetting('globalWeights', enabled); _toggleGlobalWeights(enabled); };

  const setBackgroundMode = (val: BackgroundMode) => { trackBackground('backgroundMode', val); _setBackgroundMode(val); };
  const setSimpleBackgroundReplacementTags = (val: string) => { trackBackground('simpleBackgroundReplacementTags', val); _setSimpleBackgroundReplacementTags(val); };
  const setRandomBackgroundPatterns = (val: boolean) => { trackBackground('randomBackgroundPatterns', val); _setRandomBackgroundPatterns(val); };
  const setRandomBackgroundIncludeGradients = (val: boolean) => { trackBackground('randomBackgroundIncludeGradients', val); _setRandomBackgroundIncludeGradients(val); };
  const setBackgroundMatchStrictness = (val: MatchStrictness) => { trackBackground('backgroundMatchStrictness', val); _setBackgroundMatchStrictness(val); };

  const isCompact = variant === "compact"

  // Native compact switch sizing without blurry CSS transform scaling
  const switchClass = isCompact
    ? "h-5 w-9 shrink-0 [&>span]:h-4 [&>span]:w-4 data-[state=checked]:[&>span]:translate-x-4"
    : "shrink-0"

  const rowClass = cn(
    "flex items-center justify-between gap-3 rounded-lg transition-colors border border-transparent",
    isCompact ? "p-1 hover:bg-muted/30" : "p-2 hover:bg-muted/40 hover:border-border/40"
  )

  const handleBackgroundModeChange = (val: BackgroundMode) => {
    setBackgroundMode(val)
  }
  const handleSimpleBackgroundReplacementTagsChange = (val: string) => {
    setSimpleBackgroundReplacementTags(val)
  }
  const handleRandomBackgroundPatternsChange = (val: boolean) => {
    setRandomBackgroundPatterns(val)
  }

  const switchesSection = (
    <div className={isCompact ? "flex flex-col gap-1 border-t pt-2" : "contents"}>
      {booruProvider !== 'aibooru' ? (
        <>
          <div className={rowClass}>
            {isCompact ? (
              <Label htmlFor="include-characters" className="text-xs select-none cursor-pointer flex-1">Character Tags</Label>
            ) : (
              <InfoTooltip
                title="Character Tags"
                description="Does exactly that: includes character tags in the prompt. You can turn this off if you don't want character names."
                visual={INCLUDE_CHARACTERS_VISUAL}
              >
                <Label htmlFor="include-characters" className="text-sm select-none cursor-pointer flex-1 sm:flex-none">Character Tags</Label>
              </InfoTooltip>
            )}
            <Switch
              id="include-characters"
              checked={includeCharacters}
              onCheckedChange={setIncludeCharacters}
              className={switchClass}
              aria-label="Include character tags in prompts"
            />
          </div>
          <div className={rowClass}>
            {isCompact ? (
              <Label htmlFor="smart-tag" className="text-xs select-none cursor-pointer flex-1">Tag Combination</Label>
            ) : (
              <InfoTooltip
                title="Tag Combination"
                description="If the prompt has, for example, 'hair, long hair, white hair', this function combines them into a single tag: 'long white hair'. Useful to avoid redundancy and not saturate the tokenizer."
                visual={SMART_TAG_COMBINATION_VISUAL}
              >
                <Label htmlFor="smart-tag" className="text-sm select-none cursor-pointer flex-1 sm:flex-none">Tag Combination</Label>
              </InfoTooltip>
            )}
            <Switch
              id="smart-tag"
              checked={optimizeTags}
              onCheckedChange={setOptimizeTags}
              className={switchClass}
              aria-label="Enable smart tag combination"
            />
          </div>
          <div className={rowClass}>
            {isCompact ? (
              <InfoTooltip
                title="Tag Exclusion"
                description="Makes added tags work smartly. For example, if the original prompt implies a back view without a face, and your 'Tags to add' contains facial features like 'lips, nose, blue eyes', it automatically disables them for that specific card to keep the generated result faithful."
              >
                <Label htmlFor="smart-exclusion" className="text-xs select-none cursor-pointer flex-1">Tag Exclusion</Label>
              </InfoTooltip>
            ) : (
              <div className="flex items-center gap-2">
                <InfoTooltip
                  title="Tag Exclusion"
                  description="Makes added tags work smartly. For example, if the original prompt implies a back view without a face, and your 'Tags to add' contains facial features like 'lips, nose, blue eyes', it automatically disables them for that specific card to keep the generated result faithful."
                  visual={SMART_TAG_EXCLUSION_VISUAL}
                >
                  <Label htmlFor="smart-exclusion" className="text-sm select-none cursor-pointer">Tag Exclusion</Label>
                </InfoTooltip>
              </div>
            )}
            <Switch
              id="smart-exclusion"
              checked={smartTagExclusion}
              onCheckedChange={setSmartTagExclusion}
              className={switchClass}
              aria-label="Enable smart tag exclusion"
            />
          </div>
          <div className={rowClass}>
            <div className="flex items-center gap-2">
              <InfoTooltip
                title="Prepend @artist"
                description="Adds the post's artist as &quot;@artist,&quot; at the very start of the prompt. Only works for checkpoints that support Anima's @artist invocation syntax (e.g. Anima Pencil-XL) — other checkpoints treat it as a meaningless literal tag."
                visual={isCompact ? undefined : PREPEND_ARTIST_VISUAL}
              >
                <Label htmlFor="prepend-anima-artist" className={isCompact ? "text-xs select-none cursor-pointer flex-1" : "text-sm select-none cursor-pointer whitespace-nowrap"}>Prepend @artist</Label>
              </InfoTooltip>
            </div>
            <Switch
              id="prepend-anima-artist"
              checked={prependAnimaArtist}
              onCheckedChange={setPrependAnimaArtist}
              className={switchClass}
              aria-label="Prepend the post's artist as @artist"
            />
          </div>
        </>
      ) : (
        <>
          <div className={rowClass}>
            <Label htmlFor="remove-lora" className={isCompact ? "text-xs select-none cursor-pointer flex-1" : "text-sm select-none cursor-pointer flex-1 sm:flex-none"}>
              {isCompact ? "Remove LoRa tags" : "Remove LoRa Tags"}
            </Label>
            <Switch
              id="remove-lora"
              checked={removeLoRaTags}
              onCheckedChange={setRemoveLoRaTags}
              className={switchClass}
              aria-label="Remove LoRa tags from Aibooru prompts"
            />
          </div>
          <div className={rowClass}>
            <Label htmlFor="remove-quality" className={isCompact ? "text-xs select-none cursor-pointer flex-1" : "text-sm select-none cursor-pointer flex-1 sm:flex-none"}>
              {isCompact ? "Remove Quality tags" : "Remove Quality Tags"}
            </Label>
            <Switch
              id="remove-quality"
              checked={removeQualityTags}
              onCheckedChange={setRemoveQualityTags}
              className={switchClass}
              aria-label="Remove quality tags from Aibooru prompts"
            />
          </div>
        </>
      )}

      {/* Applies regardless of provider — unlike the switches above, this one
          isn't gated by booruProvider. */}
      <div className={rowClass}>
        {isCompact ? (
          <Label htmlFor="auto-append-search-tags" className="text-xs select-none cursor-pointer flex-1">Append Search Tags</Label>
        ) : (
          <InfoTooltip
            title="Append Search Tags"
            description="Any tag you type in the search bar that isn't already present in a post's own prompt gets appended to the end of the final prompt. Turn this off if you only want the post's own tags plus whatever you explicitly add in 'Tags to Add'. Tags listed in 'Tags to Exclude' are never appended regardless of this switch."
          >
            <Label htmlFor="auto-append-search-tags" className="text-sm select-none cursor-pointer flex-1 sm:flex-none whitespace-nowrap">Append Search Tags</Label>
          </InfoTooltip>
        )}
        <Switch
          id="auto-append-search-tags"
          checked={autoAppendSearchTags}
          onCheckedChange={setAutoAppendSearchTags}
          className={switchClass}
          aria-label="Append missing search tags to the final prompt"
        />
      </div>

      <div className={cn(rowClass, "relative")}>
        <div className="flex items-center gap-1.5 min-w-0">
          <InfoTooltip
            title="Global Tag Weights"
            description="All tags are clickable. If you click a tag, you can adjust its weight (e.g., 1.5). If 'Global Tag Weights' is enabled and you click the Globe icon, that weight will automatically be applied to all cards containing said tag."
            visual={isCompact ? undefined : GLOBAL_WEIGHTS_VISUAL}
          >
            <Label htmlFor="global-weights-toggle" className={isCompact ? "text-xs select-none cursor-pointer flex-1" : "text-sm select-none cursor-pointer whitespace-nowrap"}>Global Tag Weights</Label>
          </InfoTooltip>
        </div>
        <div className="flex items-center shrink-0 relative">
          <Switch
            id="global-weights-toggle"
            checked={isGlobalWeightsEnabled}
            onCheckedChange={toggleGlobalWeights}
            className={switchClass}
            aria-label="Toggle global tag weights"
          />

          {/* Banderilla flotante pegada encima de todo (overlay absolute con z-30, no empuja el layout) */}
          <AnimatePresence initial={false}>
            {isGlobalWeightsEnabled && (
              <motion.div
                key="manage-banderilla-attached"
                initial={shouldReduceMotion ? false : { opacity: 0, x: -8, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={shouldReduceMotion ? undefined : { opacity: 0, x: -8, scale: 0.9 }}
                transition={{
                  type: "spring",
                  stiffness: 450,
                  damping: 25,
                  mass: 0.7
                }}
                className={cn(
                  "z-30 flex items-center",
                  isCompact
                    ? "relative ml-1"
                    : "absolute left-full ml-1.5 top-1/2 -translate-y-1/2"
                )}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    if (!isCompact) e.preventDefault()
                    setIsGlobalWeightsModalOpen(true)
                  }}
                  className={cn(
                    "group relative flex items-center gap-1.5 font-semibold select-none border border-primary/45 bg-card/95 backdrop-blur-md text-primary-text hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all duration-200 shadow-md active:scale-[0.96] cursor-pointer",
                    isCompact
                      ? "h-5 pl-1.5 pr-2 text-[9px] rounded-r-md rounded-l-xs"
                      : "h-6 pl-2 pr-2.5 text-xs rounded-r-lg rounded-l-xs before:absolute before:-left-1 before:top-1/2 before:-translate-y-1/2 before:w-1 before:h-3 before:bg-primary/50 before:rounded-l-xs"
                  )}
                  title="Manage active global weights"
                  aria-label="Manage global tag weights"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-primary group-hover:bg-primary-foreground transition-colors shrink-0 animate-pulse" />
                  <span className="leading-none tracking-tight">Manage</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )

  const renderBackgroundOptionsSection = (idPrefix: string) => (
    <div className={cn(
      "sm:col-span-2 flex flex-col gap-2.5",
      isCompact ? "pt-2 border-t border-border/40" : "pt-3 mt-1 border-t border-border/50"
    )}>
      <div className={isCompact ? "flex items-center justify-between gap-2" : "flex flex-col sm:flex-row sm:items-center justify-between gap-3"}>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            {isCompact ? (
              <Label htmlFor={`background-handling-select-${idPrefix}`} className="text-xs font-semibold cursor-pointer">Background Options</Label>
            ) : (
              <InfoTooltip
                title="Background Options"
                description="This option allows you to modify background-related tags for greater control. You can leave them as is, remove them completely, or more importantly, replace them with one of your liking. Useful for getting results with the same background or simply adding a white background to all your generations."
                visual={BACKGROUND_OPTIONS_VISUAL}
              >
                <Label htmlFor={`background-handling-select-${idPrefix}`} className="text-sm font-medium cursor-pointer">Background Options</Label>
              </InfoTooltip>
            )}
          </div>
          <span id={`background-options-desc-${idPrefix}`} className="text-[10px] text-muted-foreground leading-tight">
            {isCompact ? "Modify background/scene tags" : "Modify scenery tags"}
          </span>
        </div>
        <div className={isCompact ? undefined : "w-full sm:w-auto sm:min-w-[160px]"}>
          <Select
            value={backgroundMode}
            onValueChange={handleBackgroundModeChange}
          >
            <SelectTrigger
              id={`background-handling-select-${idPrefix}`}
              aria-describedby={`background-options-desc-${idPrefix}`}
              className={isCompact ? "h-7 text-[11px] bg-background w-[110px]" : "h-8 text-xs bg-background"}
            >
              <SelectValue placeholder={isCompact ? "Original" : "Keep Original"} />
            </SelectTrigger>
            <SelectContent className={isCompact ? "text-xs" : undefined}>
              <SelectItem value="keep">{isCompact ? "Original" : "Keep Original"}</SelectItem>
              <SelectItem value="remove_all">Remove All</SelectItem>
              <SelectItem value="force_simple">Replace</SelectItem>
              <SelectItem value="random">Simple Random</SelectItem>
              <SelectItem value="detailed_random">Detailed Random</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {backgroundMode === 'force_simple' && (
          <motion.div
            key="force_simple"
            initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={shouldReduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT_STRONG }}
            className="overflow-hidden"
          >
            <div className={cn("pt-1.5 flex items-center gap-2", !isCompact && "sm:pl-1")}>
              <DebouncedInput
                value={simpleBackgroundReplacementTags}
                onChange={handleSimpleBackgroundReplacementTagsChange}
                debounceTime={400}
                placeholder={isCompact ? "e.g., white background, simple background" : "e.g. simple background, white background"}
                className={cn("bg-background min-w-0 flex-1", isCompact ? "h-7 text-xs" : "h-8 text-xs focus-visible:ring-1")}
                aria-label="Tags to replace background with"
              />
            </div>
          </motion.div>
        )}

        {backgroundMode === 'random' && (
          <motion.div
            key="random"
            initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={shouldReduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT_STRONG }}
            className="overflow-hidden"
          >
            <div className={cn("flex flex-col gap-2 pt-2", !isCompact && "sm:pl-1")}>
              <div className="flex items-center justify-between p-1.5 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="flex flex-col gap-0.5">
                  <span className={isCompact ? "text-[11px] font-medium" : "text-xs font-medium text-foreground"}>Include Patterns</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    {isCompact ? "Stripes, dots, etc." : "Allow generation of patterned backgrounds."}
                  </span>
                </div>
                <Switch
                  checked={randomBackgroundPatterns}
                  onCheckedChange={handleRandomBackgroundPatternsChange}
                  className={switchClass}
                  aria-label="Include patterns in random backgrounds"
                />
              </div>
              <div className="flex items-center justify-between p-1.5 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="flex flex-col gap-0.5">
                  <span className={isCompact ? "text-[11px] font-medium" : "text-xs font-medium text-foreground"}>Include Gradients</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    {isCompact ? "Gradients and two-tone colors" : "Add two-tone and gradient backgrounds."}
                  </span>
                </div>
                <Switch
                  checked={randomBackgroundIncludeGradients}
                  onCheckedChange={setRandomBackgroundIncludeGradients}
                  className={switchClass}
                  aria-label="Include gradients in random backgrounds"
                />
              </div>
            </div>
          </motion.div>
        )}

        {backgroundMode === 'detailed_random' && (
          <motion.div
            key="detailed_random"
            initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={shouldReduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT_STRONG }}
            className="overflow-hidden"
          >
            <div className={cn("pt-2 flex flex-col gap-2", !isCompact && "sm:pl-1")}>
              {isCompact ? (
                <span className="text-[11px] font-medium">Scene Matching</span>
              ) : (
                <InfoTooltip
                  title="Scene Matching"
                  description="Controls how closely the randomly-picked scenery has to match the original post. 'Free' ignores the post entirely for maximum variety. 'Balanced' (default) tries to keep the scenery as close as possible to the original post. 'Strict' tries even harder to keep it close."
                >
                  <span className="text-xs font-medium text-foreground cursor-pointer">Scene Matching</span>
                </InfoTooltip>
              )}
              <div className={cn(
                "p-1 rounded-lg bg-muted/60 border border-border/50 grid grid-cols-3 gap-1 relative",
                isCompact ? "h-7" : "h-8"
              )}>
                {MATCH_STRICTNESS_OPTIONS.map(({ value, label }) => {
                  const isSelected = backgroundMatchStrictness === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setBackgroundMatchStrictness(value)}
                      className={cn(
                        "relative z-10 flex items-center justify-center rounded-md font-medium transition-colors select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.98]",
                        isCompact ? "text-[10px]" : "text-xs",
                        isSelected ? "text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                      )}
                      aria-pressed={isSelected}
                    >
                      {isSelected && (
                        <motion.div
                          layoutId={`${idPrefix}-strictness-active-pill`}
                          className="absolute inset-0 bg-primary rounded-md shadow-xs"
                          transition={shouldReduceMotion ? { duration: 0 } : SEGMENT_PILL_SPRING}
                        />
                      )}
                      <span className="relative z-20">{label}</span>
                    </button>
                  );
                })}
              </div>
              <span className="text-[10px] text-muted-foreground leading-tight">
                {MATCH_STRICTNESS_DESCRIPTIONS[backgroundMatchStrictness]}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  if (isCompact) {
    return (
      <>
        {switchesSection}
        {renderBackgroundOptionsSection("compact")}
      </>
    )
  }

  // "embedded": the "Output" half of the main panel's "Customize prompt"
  // section. One column of switches, each with a plain one-line explanation
  // instead of an ⓘ tooltip. Tag Exclusion is omitted here — on the main
  // panel it sits under "Tags to Add", the only list it affects.
  if (variant === "embedded") {
    const options: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; extra?: ReactNode }[] =
      booruProvider !== 'aibooru'
        ? [
            { id: "include-characters", label: "Include character names", hint: "Keep the post's character tags", checked: includeCharacters, onChange: setIncludeCharacters },
            { id: "smart-tag", label: "Merge redundant tags", hint: "“hair, long hair, white hair” → “long white hair”", checked: optimizeTags, onChange: setOptimizeTags },
          ]
        : [
            { id: "remove-lora", label: "Remove LoRA tags", hint: "Strip <lora:…> tags from Aibooru prompts", checked: removeLoRaTags, onChange: setRemoveLoRaTags },
            { id: "remove-quality", label: "Remove quality tags", hint: "Strip masterpiece, best quality, …", checked: removeQualityTags, onChange: setRemoveQualityTags },
          ]
    options.push(
      { id: "auto-append-search-tags", label: "Add my search tags", hint: "Append the tags you searched for if the post lacks them", checked: autoAppendSearchTags, onChange: setAutoAppendSearchTags },
    )
    if (booruProvider !== 'aibooru') {
      options.push({ id: "prepend-anima-artist", label: "Start with @artist", hint: "Only for checkpoints that support Anima's @artist syntax", checked: prependAnimaArtist, onChange: setPrependAnimaArtist })
    }
    options.push({
      id: "global-weights-toggle",
      label: "Global tag weights",
      hint: "Apply the weights you set on tags to every card",
      checked: isGlobalWeightsEnabled,
      onChange: toggleGlobalWeights,
      extra: isGlobalWeightsEnabled && (
        <Button type="button" variant="outline" size="sm" onClick={() => setIsGlobalWeightsModalOpen(true)} className="h-8 px-2.5 text-xs">
          Edit weights
        </Button>
      ),
    })

    return (
      <div className="flex flex-col gap-4" data-tour="generation-options">
        <div className="flex flex-col">
          {options.map((o) => (
            <div key={o.id} className="flex min-h-[56px] items-center justify-between gap-3 border-b border-border/50 py-2 last:border-b-0">
              <label htmlFor={`${o.id}-embedded`} className="flex min-w-0 cursor-pointer flex-col gap-0.5">
                <span className="text-sm text-foreground">{o.label}</span>
                <span className="text-xs text-muted-foreground">{o.hint}</span>
              </label>
              <div className="flex shrink-0 items-center gap-2">
                {o.extra}
                <Switch id={`${o.id}-embedded`} checked={o.checked} onCheckedChange={o.onChange} />
              </div>
            </div>
          ))}
        </div>
        {renderBackgroundOptionsSection("embedded")}
      </div>
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
          <Settings className="h-4 w-4 text-primary-text" />
          {booruProvider === 'aibooru' ? 'Aibooru Options' : 'Prompt Generation Options'}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 shrink-0 transition-transform duration-200 sm:hidden",
            isPromptOptionsExpanded && "rotate-180"
          )}
        />
      </button>

      {/* Desktop: always visible grid */}
      <div className="hidden sm:grid sm:grid-cols-2 sm:gap-2.5">
        {switchesSection}
        {renderBackgroundOptionsSection("desktop")}
      </div>

      {/* Mobile: smooth accordion with Framer Motion */}
      <div className="sm:hidden">
        <AnimatePresence initial={false}>
          {isPromptOptionsExpanded && (
            <motion.div
              key="prompt-options-mobile-content"
              initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={shouldReduceMotion ? undefined : { height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE_OUT_STRONG }}
              className="overflow-hidden"
            >
              <div className="flex flex-col gap-2 pt-1">
                {switchesSection}
                {renderBackgroundOptionsSection("mobile")}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
})
