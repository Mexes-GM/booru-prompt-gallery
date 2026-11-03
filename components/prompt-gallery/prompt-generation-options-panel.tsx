"use client"

import { memo } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { EASE_OUT_STRONG, SEGMENT_PILL_SPRING } from "@/lib/motion"
import { Button } from "@/components/ui/button"
import { DebouncedInput } from "@/components/ui/debounced-input"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { track } from '@/lib/analytics'
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { BackgroundMode } from "@/lib/background-detector"
import type { MatchStrictness } from "@/lib/background-context"
import { PromptFormatSetting } from "./prompt-format-setting"

/**
 * Labels + tooltip copy for the "Detailed Random" scene-matching strictness.
 * Shared between the compact and embedded renderings below, so the wording
 * never drifts between the two variants.
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

/** Background modes in Customize prompt (the extension keeps its own labels). */
const BACKGROUND_MODES: { value: BackgroundMode; label: string }[] = [
  { value: "keep", label: "Keep original" },
  { value: "remove_all", label: "Remove all" },
  { value: "force_simple", label: "Replace" },
  { value: "random", label: "Simple random" },
  { value: "detailed_random", label: "Detailed random" },
]

interface PromptGenerationOptionsPanelProps {
  /** Unused; kept so existing callers still compile. */
  isPromptOptionsExpanded?: boolean
  setIsPromptOptionsExpanded?: (updater: (prev: boolean) => boolean) => void
  booruProvider: string

  includeCharacters: boolean
  setIncludeCharacters: (val: boolean) => void
  optimizeTags: boolean
  setOptimizeTags: (val: boolean) => void
  smartTagExclusion: boolean
  setSmartTagExclusion: (val: boolean) => void
  prependAnimaArtist: boolean
  setPrependAnimaArtist: (val: boolean) => void
  /** Opt-in rules that guess from indirect signals (see derivePostPrompt). */
  experimentalPromptRules?: boolean
  setExperimentalPromptRules?: (val: boolean) => void
  /** Whether tags typed in the search bar but missing from a post's own
   *  prompt get silently appended to the final prompt. */
  autoAppendSearchTags?: boolean
  setAutoAppendSearchTags?: (val: boolean) => void

  removeLoRaTags: boolean
  setRemoveLoRaTags: (val: boolean) => void
  removeQualityTags: boolean
  setRemoveQualityTags: (val: boolean) => void

  /** Compact only: the extension still shows the on/off switch. */
  isGlobalWeightsEnabled?: boolean
  toggleGlobalWeights?: (enabled: boolean) => void
  setIsGlobalWeightsModalOpen: (open: boolean) => void
  /** Embedded: how many tag weights exist, and whether they're paused. */
  globalWeightCount?: number
  isGlobalWeightsPaused?: boolean

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
   * "embedded" is the Output column of Customize prompt on the main page;
   * "compact" is the extension's settings, with tighter markup.
   */
  variant?: "compact" | "embedded"
}

/** A plain switch row: label and one-line hint on the left, switch on the right. */
function SwitchRow({ id, label, hint, checked, onChange }: {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 py-2">
      <label htmlFor={id} className="flex min-w-0 cursor-pointer flex-col gap-0.5">
        <span className="text-sm text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="shrink-0" />
    </div>
  )
}

/**
 * Prompt output options: Customize prompt on the main page ("embedded") or
 * the extension's settings ("compact"). Character names, tag merging, @artist,
 * search tags, experimental rules (or the Aibooru-only LoRA/quality removal),
 * tag weights, and the background mode with its sub-options.
 */
export const PromptGenerationOptionsPanel = memo(function PromptGenerationOptionsPanel({
  booruProvider,
  includeCharacters,
  setIncludeCharacters: _setIncludeCharacters,
  optimizeTags,
  setOptimizeTags: _setOptimizeTags,
  smartTagExclusion,
  setSmartTagExclusion: _setSmartTagExclusion,
  prependAnimaArtist,
  setPrependAnimaArtist: _setPrependAnimaArtist,
  experimentalPromptRules = false,
  setExperimentalPromptRules: _setExperimentalPromptRules,
  autoAppendSearchTags = true,
  setAutoAppendSearchTags: _setAutoAppendSearchTags,
  removeLoRaTags,
  setRemoveLoRaTags: _setRemoveLoRaTags,
  removeQualityTags,
  setRemoveQualityTags: _setRemoveQualityTags,
  isGlobalWeightsEnabled = false,
  toggleGlobalWeights: _toggleGlobalWeights,
  setIsGlobalWeightsModalOpen,
  globalWeightCount = 0,
  isGlobalWeightsPaused = false,
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
  variant = "embedded",
}: PromptGenerationOptionsPanelProps) {
  const shouldReduceMotion = useReducedMotion();

  const trackSetting = (settingName: string, value: string | boolean) => {
    track('generation_settings_changed', {
      setting_changed: settingName,
      new_value: value,
    });
  };

  const trackBackground = (settingName: string, value: string | boolean) => {
    track('background_option_changed', {
      setting_changed: settingName,
      new_value: value,
    });
  };

  const setIncludeCharacters = (val: boolean) => { trackSetting('includeCharacters', val); _setIncludeCharacters(val); };
  const setOptimizeTags = (val: boolean) => { trackSetting('optimizeTags', val); _setOptimizeTags(val); };
  const setSmartTagExclusion = (val: boolean) => { trackSetting('smartTagExclusion', val); _setSmartTagExclusion(val); };
  const setPrependAnimaArtist = (val: boolean) => { trackSetting('prependAnimaArtist', val); _setPrependAnimaArtist(val); };
  const setExperimentalPromptRules = (val: boolean) => { trackSetting('experimentalPromptRules', val); _setExperimentalPromptRules?.(val); };
  const setAutoAppendSearchTags = (val: boolean) => { trackSetting('autoAppendSearchTags', val); _setAutoAppendSearchTags?.(val); };
  const setRemoveLoRaTags = (val: boolean) => { trackSetting('removeLoRaTags', val); _setRemoveLoRaTags(val); };
  const setRemoveQualityTags = (val: boolean) => { trackSetting('removeQualityTags', val); _setRemoveQualityTags(val); };
  const toggleGlobalWeights = (enabled: boolean) => { trackSetting('globalWeights', enabled); _toggleGlobalWeights?.(enabled); };

  const setBackgroundMode = (val: BackgroundMode) => { trackBackground('backgroundMode', val); _setBackgroundMode(val); };
  const setSimpleBackgroundReplacementTags = (val: string) => { trackBackground('simpleBackgroundReplacementTags', val); _setSimpleBackgroundReplacementTags(val); };
  const setRandomBackgroundPatterns = (val: boolean) => { trackBackground('randomBackgroundPatterns', val); _setRandomBackgroundPatterns(val); };
  const setRandomBackgroundIncludeGradients = (val: boolean) => { trackBackground('randomBackgroundIncludeGradients', val); _setRandomBackgroundIncludeGradients(val); };
  const setBackgroundMatchStrictness = (val: MatchStrictness) => { trackBackground('backgroundMatchStrictness', val); _setBackgroundMatchStrictness(val); };

  const isCompact = variant === "compact"
  const isAibooru = booruProvider === 'aibooru'

  // Native compact switch sizing without blurry CSS transform scaling
  const switchClass = isCompact
    ? "h-5 w-9 shrink-0 [&>span]:h-4 [&>span]:w-4 data-[state=checked]:[&>span]:translate-x-4"
    : "shrink-0"

  const renderBackgroundSubOptions = (idPrefix: string) => (
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
          <div className={cn("flex items-center gap-2", isCompact ? "pt-1.5" : "pb-2")}>
            <DebouncedInput
              value={simpleBackgroundReplacementTags}
              onChange={setSimpleBackgroundReplacementTags}
              debounceTime={400}
              placeholder={isCompact ? "e.g., white background, simple background" : "e.g. simple background, white background"}
              className={cn("bg-background min-w-0 flex-1", isCompact ? "h-7 text-xs" : "h-9 text-sm")}
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
          {isCompact ? (
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex items-center justify-between p-1.5 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-medium">Include Patterns</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">Stripes, dots, etc.</span>
                </div>
                <Switch
                  checked={randomBackgroundPatterns}
                  onCheckedChange={setRandomBackgroundPatterns}
                  className={switchClass}
                  aria-label="Include patterns in random backgrounds"
                />
              </div>
              <div className="flex items-center justify-between p-1.5 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-medium">Include Gradients</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">Gradients and two-tone colors</span>
                </div>
                <Switch
                  checked={randomBackgroundIncludeGradients}
                  onCheckedChange={setRandomBackgroundIncludeGradients}
                  className={switchClass}
                  aria-label="Include gradients in random backgrounds"
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col border-l border-border/60 pl-3">
              <SwitchRow id={`${idPrefix}-bg-patterns`} label="Include patterns" hint="Stripes, dots and other patterns" checked={randomBackgroundPatterns} onChange={setRandomBackgroundPatterns} />
              <SwitchRow id={`${idPrefix}-bg-gradients`} label="Include gradients" hint="Two-tone and gradient colors" checked={randomBackgroundIncludeGradients} onChange={setRandomBackgroundIncludeGradients} />
            </div>
          )}
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
          <div className={cn("flex flex-col gap-2", isCompact ? "pt-2" : "pb-2")}>
            <span id={`${idPrefix}-strictness-label`} className={isCompact ? "text-[11px] font-medium" : "text-sm text-foreground"}>{isCompact ? "Scene Matching" : "Scene matching"}</span>
            <div
              role="group"
              aria-labelledby={`${idPrefix}-strictness-label`}
              className={cn(
                "p-1 rounded-lg bg-muted/60 border border-border/50 grid grid-cols-3 gap-1 relative",
                isCompact ? "h-7" : "h-9"
              )}
            >
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
            <span className={isCompact ? "text-[10px] text-muted-foreground leading-tight" : "text-xs text-muted-foreground"}>
              {MATCH_STRICTNESS_DESCRIPTIONS[backgroundMatchStrictness]}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  if (isCompact) {
    const rowClass = "flex items-center justify-between gap-3 rounded-lg transition-colors border border-transparent p-1 hover:bg-muted/30"
    const labelClass = "text-xs select-none cursor-pointer flex-1"
    return (
      <>
        <div className="flex flex-col gap-1 border-t pt-2">
          <PromptFormatSetting variant="compact" onSettingChange={trackSetting} />
        </div>
        <div className="flex flex-col gap-1 border-t pt-2">
          {!isAibooru ? (
            <>
              <div className={rowClass}>
                <Label htmlFor="include-characters" className={labelClass}>Character Tags</Label>
                <Switch id="include-characters" checked={includeCharacters} onCheckedChange={setIncludeCharacters} className={switchClass} aria-label="Include character tags in prompts" />
              </div>
              <div className={rowClass}>
                <Label htmlFor="smart-tag" className={labelClass}>Tag Combination</Label>
                <Switch id="smart-tag" checked={optimizeTags} onCheckedChange={setOptimizeTags} className={switchClass} aria-label="Enable smart tag combination" />
              </div>
              <div className={rowClass}>
                <InfoTooltip
                  title="Tag Exclusion"
                  description="Leaves out added tags that the post's picture can't show. If the post is an upper-body shot, a portrait or a close-up, body tags from 'Tags to add' such as thighs or hips are dropped for that card, so the camera doesn't pull back to show them. The same goes for other contradictions, like facial features on a view from behind."
                >
                  <Label htmlFor="smart-exclusion" className={labelClass}>Tag Exclusion</Label>
                </InfoTooltip>
                <Switch id="smart-exclusion" checked={smartTagExclusion} onCheckedChange={setSmartTagExclusion} className={switchClass} aria-label="Enable smart tag exclusion" />
              </div>
              <div className={rowClass}>
                <div className="flex items-center gap-2">
                  <InfoTooltip
                    title="Prepend @artist"
                    description="Adds the post's artist as &quot;@artist,&quot; at the very start of the prompt. Only works for checkpoints that support Anima's @artist invocation syntax (e.g. Anima Pencil-XL) — other checkpoints treat it as a meaningless literal tag."
                  >
                    <Label htmlFor="prepend-anima-artist" className={labelClass}>Prepend @artist</Label>
                  </InfoTooltip>
                </div>
                <Switch id="prepend-anima-artist" checked={prependAnimaArtist} onCheckedChange={setPrependAnimaArtist} className={switchClass} aria-label="Prepend the post's artist as @artist" />
              </div>
              {_setExperimentalPromptRules && (
                <div className={rowClass}>
                  <div className="flex items-center gap-2">
                    <InfoTooltip
                      title="Experimental Rules"
                      description="Rules that guess from indirect signals, so they can be wrong. Body tags from 'Tags to add' such as thighs or hips are dropped when the post looks like a close shot of faces (a selfie, hands on someone's cheeks) and nothing in it shows the legs. Tags of posts made of several pictures (comic, 4koma, multiple views, reference sheet) are dropped, so you get one picture. Tags you add yourself are always kept."
                    >
                      <Label htmlFor="experimental-prompt-rules" className={labelClass}>Experimental Rules</Label>
                    </InfoTooltip>
                  </div>
                  <Switch id="experimental-prompt-rules" checked={experimentalPromptRules} onCheckedChange={setExperimentalPromptRules} className={switchClass} aria-label="Enable experimental prompt rules" />
                </div>
              )}
            </>
          ) : (
            <>
              <div className={rowClass}>
                <Label htmlFor="remove-lora" className={labelClass}>Remove LoRa tags</Label>
                <Switch id="remove-lora" checked={removeLoRaTags} onCheckedChange={setRemoveLoRaTags} className={switchClass} aria-label="Remove LoRa tags from Aibooru prompts" />
              </div>
              <div className={rowClass}>
                <Label htmlFor="remove-quality" className={labelClass}>Remove Quality tags</Label>
                <Switch id="remove-quality" checked={removeQualityTags} onCheckedChange={setRemoveQualityTags} className={switchClass} aria-label="Remove quality tags from Aibooru prompts" />
              </div>
            </>
          )}

          <div className={rowClass}>
            <Label htmlFor="auto-append-search-tags" className={labelClass}>Append Search Tags</Label>
            <Switch id="auto-append-search-tags" checked={autoAppendSearchTags} onCheckedChange={setAutoAppendSearchTags} className={switchClass} aria-label="Append missing search tags to the final prompt" />
          </div>

          <div className={cn(rowClass, "relative")}>
            <div className="flex items-center gap-1.5 min-w-0">
              <InfoTooltip
                title="Global Tag Weights"
                description="All tags are clickable. If you click a tag, you can adjust its weight (e.g., 1.5). If 'Global Tag Weights' is enabled and you click the Globe icon, that weight will automatically be applied to all cards containing said tag."
              >
                <Label htmlFor="global-weights-toggle" className={labelClass}>Global Tag Weights</Label>
              </InfoTooltip>
            </div>
            <div className="flex items-center shrink-0 relative">
              <Switch id="global-weights-toggle" checked={isGlobalWeightsEnabled} onCheckedChange={toggleGlobalWeights} className={switchClass} aria-label="Toggle global tag weights" />
              <AnimatePresence initial={false}>
                {isGlobalWeightsEnabled && (
                  <motion.div
                    key="manage-banderilla-attached"
                    initial={shouldReduceMotion ? false : { opacity: 0, x: -8, scale: 0.9 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={shouldReduceMotion ? undefined : { opacity: 0, x: -8, scale: 0.9 }}
                    transition={{ type: "spring", stiffness: 450, damping: 25, mass: 0.7 }}
                    className="z-30 flex items-center relative ml-1"
                  >
                    <button
                      type="button"
                      onClick={() => setIsGlobalWeightsModalOpen(true)}
                      className="group relative flex items-center gap-1.5 font-semibold select-none border border-primary/45 bg-card/95 backdrop-blur-md text-primary-text hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all duration-200 shadow-md active:scale-[0.96] cursor-pointer h-5 pl-1.5 pr-2 text-[10px] rounded-r-md rounded-l-xs"
                      title="Manage active global weights"
                      aria-label="Manage global tag weights"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-primary group-hover:bg-primary-foreground transition-colors shrink-0" />
                      <span className="leading-none tracking-tight">Manage</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
        <div className="sm:col-span-2 flex flex-col gap-2.5 pt-2 border-t border-border/40">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="background-handling-select-compact" className="text-xs font-semibold cursor-pointer">Background Options</Label>
              </div>
              <span id="background-options-desc-compact" className="text-[10px] text-muted-foreground leading-tight">Modify background/scene tags</span>
            </div>
            <div>
              <Select value={backgroundMode} onValueChange={setBackgroundMode}>
                <SelectTrigger id="background-handling-select-compact" aria-describedby="background-options-desc-compact" className="h-7 text-[11px] bg-background w-[110px]">
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
          </div>
          {renderBackgroundSubOptions("compact")}
        </div>
      </>
    )
  }

  // "embedded": the Output column of Customize prompt. One switch per row,
  // each with a plain one-line explanation instead of an ⓘ tooltip. Tag
  // Exclusion lives under "Add to every prompt" in the Tags column, the
  // only list it affects.
  const options: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }[] =
    !isAibooru
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
  if (!isAibooru) {
    options.push({ id: "prepend-anima-artist", label: "Start with @artist", hint: "Only for checkpoints that support Anima's @artist syntax", checked: prependAnimaArtist, onChange: setPrependAnimaArtist })
    if (_setExperimentalPromptRules) {
      options.push({ id: "experimental-prompt-rules", label: "Experimental rules", hint: "Drop leg tags you add from close shots and the tags of multi-panel posts. Can be wrong", checked: experimentalPromptRules, onChange: setExperimentalPromptRules })
    }
  }

  const backgroundLabel = BACKGROUND_MODES.find((mode) => mode.value === backgroundMode)?.label ?? BACKGROUND_MODES[0].label

  return (
    <div className="flex flex-col gap-4" data-tour="generation-options">
      <div className="flex flex-col">
        <PromptFormatSetting onSettingChange={trackSetting} />
        {options.map((o) => (
          <div key={o.id} className="flex min-h-[56px] items-center justify-between gap-3 border-b border-border/50 py-2">
            <label htmlFor={`${o.id}-embedded`} className="flex min-w-0 cursor-pointer flex-col gap-0.5">
              <span className="text-sm text-foreground">{o.label}</span>
              <span className="text-xs text-muted-foreground">{o.hint}</span>
            </label>
            <Switch id={`${o.id}-embedded`} checked={o.checked} onCheckedChange={o.onChange} className="shrink-0" />
          </div>
        ))}
        {/* Tag weights apply whenever one exists: no switch, just their state
            on the button that opens them. */}
        <div className="flex min-h-[56px] items-center justify-between gap-3 py-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm text-foreground">Tag weights</span>
            <span className="text-xs text-muted-foreground">Apply the weights you set on tags to every card</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsGlobalWeightsModalOpen(true)}
            className="relative h-8 shrink-0 px-2.5 text-xs pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5"
            aria-label={globalWeightCount > 0
              ? `Edit tag weights (${globalWeightCount} ${isGlobalWeightsPaused ? "paused" : "active"})`
              : "Add tag weights"}
          >
            {globalWeightCount > 0
              ? `${globalWeightCount} ${isGlobalWeightsPaused ? "paused" : "active"} · Edit`
              : "Add"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 border-t border-border/50 pt-3">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-col gap-0.5">
            <label htmlFor="background-handling-select-embedded" className="cursor-pointer text-sm font-medium text-foreground">Background</label>
            <span id="background-options-desc-embedded" className="text-xs text-muted-foreground">Change the post&apos;s scenery tags</span>
          </div>
          <div className="w-full sm:w-auto sm:min-w-[160px]">
            <Select value={backgroundMode} onValueChange={(value) => setBackgroundMode(value as BackgroundMode)}>
              <SelectTrigger
                id="background-handling-select-embedded"
                aria-describedby="background-options-desc-embedded"
                className="h-8 bg-background text-xs"
              >
                <SelectValue>{backgroundLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {BACKGROUND_MODES.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {renderBackgroundSubOptions("embedded")}
      </div>
    </div>
  )
})
