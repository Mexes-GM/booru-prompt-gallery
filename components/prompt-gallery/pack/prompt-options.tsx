"use client"

/**
 * "Customize prompt" in the pack builder: the gallery's prompt settings the pack applies, folded
 * into one line until asked for. They are the same settings as the gallery's (usePackPromptSettings):
 * editing one here edits it there. Built from the gallery's own controls.
 */
import { memo, useId, useState } from "react"
import dynamic from "next/dynamic"
import { ChevronDown, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "@/hooks/use-toast"
import { usePresetsAndHistory } from "@/hooks/use-presets-and-history"
import type { PackPromptSettings } from "@/hooks/use-pack-prompt-settings"
import { MAX_MAX_LONG_SIDE, MIN_MAX_LONG_SIDE } from "@/lib/extension/generation-resolution"
import { splitCommaSeparatedTags } from "@/lib/utils/tag-utils"
import { cn } from "@/lib/utils"
import { loadGlobalWeightsModal } from "../gallery-modals-loader"
import { PROMPT_OPTION_TEXT, SwitchRow, tagWeightsButtonText } from "../prompt-generation-options-panel"
import { TagsManagementPanel } from "../tags-management-panel"
import { PROMPT_OPTIONS_TEXT, promptOptionsSummary } from "./pack-text"

const GlobalWeightsModal = dynamic(() => loadGlobalWeightsModal().then((m) => m.GlobalWeightsModal), { ssr: false, loading: () => null })

const noop = () => {}
/** The panel's search filters, which the builder doesn't show (its "edits" section only). */
const NO_FILTERS = {
  tagCountFilter: "25",
  setTagCountFilter: noop,
  setAppliedTagCountFilter: noop,
  isTagCountSupported: false,
  isTagCountValid: true,
  scoreTier: "off",
  setScoreTier: noop,
  setAppliedScoreTier: noop,
  characterCountFilter: "0",
  setCharacterCountFilter: noop,
  setAppliedCharacterCountFilter: noop,
} as const

export const PackPromptOptions = memo(function PackPromptOptions({ settings }: { settings: PackPromptSettings }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const summary = promptOptionsSummary({
    added: splitCommaSeparatedTags(settings.addInput).length,
    removed: splitCommaSeparatedTags(settings.excludeInput).length,
    replaced: Math.min(splitCommaSeparatedTags(settings.findInput).length, splitCommaSeparatedTags(settings.replaceInput).length),
    weights: settings.globalWeightCount,
    weightsPaused: settings.isGlobalWeightsPaused,
    includeCharacters: settings.includeCharacters,
    smartTagExclusion: settings.smartTagExclusion,
    experimentalPromptRules: settings.experimentalPromptRules,
    maxLongSide: settings.maxLongSide,
    defaultMaxLongSide: MAX_MAX_LONG_SIDE,
  })
  return (
    <section className="rounded-xl border border-border/60 bg-background/50">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex min-h-12 w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left",
          "transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground" aria-hidden>
          <SlidersHorizontal className="size-3.5" />
        </span>
        <span className="shrink-0 text-sm font-medium text-foreground">{PROMPT_OPTIONS_TEXT.title}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && (
        <div id={bodyId} className="space-y-5 border-t border-border/60 px-3.5 pb-4 pt-3">
          <p className="text-xs text-muted-foreground text-pretty">{PROMPT_OPTIONS_TEXT.intro}</p>
          <PromptOptionsBody settings={settings} />
        </div>
      )}
    </section>
  )
})

/** Mounted only while open: the presets and the weights dialog load when asked for. */
function PromptOptionsBody({ settings }: { settings: PackPromptSettings }) {
  const presets = usePresetsAndHistory({ isClient: true, addInput: settings.addInput, setAddInput: settings.setAddInput, toast })
  const [weightsOpen, setWeightsOpen] = useState(false)
  const [weightsOpened, setWeightsOpened] = useState(false)
  const weightsButton = tagWeightsButtonText(settings.globalWeightCount, settings.isGlobalWeightsPaused)
  const idPrefix = useId()

  return (
    <>
      <TagsManagementPanel
        embedded
        section="edits"
        appendRules={false}
        idPrefix={`${idPrefix}-`}
        addInput={settings.addInput}
        setAddInput={settings.setAddInput}
        excludeInput={settings.excludeInput}
        setExcludeInput={settings.setExcludeInput}
        findInput={settings.findInput}
        setFindInput={settings.setFindInput}
        replaceInput={settings.replaceInput}
        setReplaceInput={settings.setReplaceInput}
        tagAppendRules={settings.tagAppendRules}
        setTagAppendRules={settings.setTagAppendRules}
        smartTagExclusion={settings.smartTagExclusion}
        setSmartTagExclusion={settings.setSmartTagExclusion}
        includeCharacters={settings.includeCharacters}
        isPresetDialogOpen={presets.isPresetDialogOpen}
        setIsPresetDialogOpen={presets.setIsPresetDialogOpen}
        presetName={presets.presetName}
        setPresetName={presets.setPresetName}
        savePreset={presets.savePreset}
        presets={presets.presets}
        loadPreset={presets.loadPreset}
        deletePreset={presets.deletePreset}
        {...NO_FILTERS}
      />

      <div className="flex flex-col border-t border-border/60 pt-2">
        <SwitchRow
          id={`${idPrefix}-characters`}
          {...PROMPT_OPTION_TEXT.includeCharacters}
          checked={settings.includeCharacters}
          onChange={settings.setIncludeCharacters}
        />
        <SwitchRow
          id={`${idPrefix}-experimental`}
          {...PROMPT_OPTION_TEXT.experimentalRules}
          checked={settings.experimentalPromptRules}
          onChange={settings.setExperimentalPromptRules}
        />
        <div className="flex min-h-[52px] items-center justify-between gap-3 py-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm text-foreground">{PROMPT_OPTION_TEXT.tagWeights.label}</span>
            <span className="text-xs text-muted-foreground">{PROMPT_OPTION_TEXT.tagWeights.hint}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setWeightsOpened(true)
              setWeightsOpen(true)
            }}
            aria-label={weightsButton.label}
            className="h-8 shrink-0 px-2.5 text-xs pointer-coarse:h-11"
          >
            {weightsButton.text}
          </Button>
        </div>
        <SizeRow id={`${idPrefix}-size`} value={settings.maxLongSide} onChange={settings.setMaxLongSide} />
      </div>

      {weightsOpened && (
        <GlobalWeightsModal
          open={weightsOpen}
          onOpenChange={setWeightsOpen}
          weights={settings.globalWeights}
          isEnabled={settings.isGlobalWeightsEnabled}
          onEnabledChange={settings.setIsGlobalWeightsEnabled}
          onRemoveWeight={settings.onRemoveGlobalWeight}
          onClearWeights={settings.onClearGlobalWeights}
          onSaveWeight={settings.onGlobalWeightChange}
        />
      )}
    </>
  )
}

/** The longest side of the suggested sizes, typed and kept on blur or Enter (512 to 1536). */
function SizeRow({ id, value, onChange }: { id: string; value: number; onChange: (value: number) => void }) {
  // null while not editing: the field shows the setting.
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const parsed = Number.parseInt(draft, 10)
    if (Number.isFinite(parsed)) onChange(parsed)
    setDraft(null)
  }
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 py-2">
      <label htmlFor={id} className="flex min-w-0 cursor-pointer flex-col gap-0.5">
        <span className="text-sm text-foreground">{PROMPT_OPTIONS_TEXT.sizeLabel}</span>
        <span className="text-xs text-muted-foreground">{PROMPT_OPTIONS_TEXT.sizeHint}</span>
      </label>
      <div className="flex shrink-0 items-center gap-1.5">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={MIN_MAX_LONG_SIDE}
          max={MAX_MAX_LONG_SIDE}
          step={64}
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit()
          }}
          className="h-8 w-20 text-right text-sm tabular-nums pointer-coarse:h-11"
        />
        <span className="text-xs text-muted-foreground" aria-hidden>px</span>
      </div>
    </div>
  )
}
