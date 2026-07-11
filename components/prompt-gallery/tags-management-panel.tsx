"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DebouncedInput, DebouncedHTMLInput } from "@/components/ui/debounced-input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { SmoothFilterSlider } from "@/components/ui/smooth-filter-slider"
import { Check, ChevronDown, Save, Trash2, X } from "lucide-react"
import type { TagPreset } from "@/lib/storage"

interface TagsManagementPanelProps {
  addInput: string
  setAddInput: (value: string) => void
  isPresetDialogOpen: boolean
  setIsPresetDialogOpen: (open: boolean) => void
  presetName: string
  setPresetName: (value: string) => void
  savePreset: () => void
  presets: TagPreset[]
  loadPreset: (preset: TagPreset) => void
  deletePreset: (id: string, e: React.MouseEvent) => void

  excludeInput: string
  setExcludeInput: (value: string) => void

  tagCountFilter: string
  setTagCountFilter: (value: string) => void
  setAppliedTagCountFilter: (value: string) => void
  isTagCountSupported: boolean
  isTagCountValid: boolean

  characterCountFilter: string
  setCharacterCountFilter: (value: string) => void
  setAppliedCharacterCountFilter: (value: string) => void
  includeCharacters: boolean

  /**
   * "full" (default) is the desktop 2-column panel with InfoTooltip visuals.
   * "compact" renders the same controls with the Pocket's tighter markup
   * (smaller inputs/icons, no InfoTooltip visual demos) so a narrow sidebar
   * can host it without the tooltips overflowing. Both variants are driven by
   * the exact same props/handlers — no logic is duplicated, only markup.
   */
  variant?: "full" | "compact"
}

/**
 * Left column of the "Advanced Filters & Options" panel: the "Tags to Add"
 * input (with save/load/delete preset controls), "Tags to Exclude" input, and
 * the minimum tag count / minimum character post count sliders.
 */
export function TagsManagementPanel({
  addInput,
  setAddInput,
  isPresetDialogOpen,
  setIsPresetDialogOpen,
  presetName,
  setPresetName,
  savePreset,
  presets,
  loadPreset,
  deletePreset,
  excludeInput,
  setExcludeInput,
  tagCountFilter,
  setTagCountFilter,
  setAppliedTagCountFilter,
  isTagCountSupported,
  isTagCountValid,
  characterCountFilter,
  setCharacterCountFilter,
  setAppliedCharacterCountFilter,
  includeCharacters,
  variant = "full",
}: TagsManagementPanelProps) {
  if (variant === "compact") {
    return (
      <div className="flex flex-col gap-3.5">
        {/* Tags to Add */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="add-tags-input" className="text-xs font-semibold">Tags to Add</Label>
            <span className="text-[10px] text-muted-foreground">(Only final prompt)</span>
          </div>
          <div className="flex h-8 w-full items-center rounded-md border border-input bg-background/50 pl-2 pr-1 text-xs shadow-sm focus-within:ring-1 focus-within:ring-ring">
            <DebouncedHTMLInput
              id="add-tags-input"
              value={addInput}
              onChange={setAddInput}
              debounceTime={400}
              placeholder="masterpiece, best quality..."
              className="flex-1 bg-transparent border-none p-0 placeholder:text-muted-foreground focus:outline-none h-full min-w-0"
            />
            <div className="flex items-center gap-0.5 shrink-0 ml-1">
              {addInput && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setAddInput("")}
                  className="h-5 w-5 text-muted-foreground hover:text-foreground rounded-full"
                >
                  <X className="h-2.5 w-2.5" />
                </Button>
              )}
              <div className="h-3.5 w-px bg-border mx-0.5" />

              <Dialog open={isPresetDialogOpen} onOpenChange={setIsPresetDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" title="Save Preset">
                    <Save className="h-3 w-3" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[350px]">
                  <DialogHeader>
                    <DialogTitle className="text-sm font-bold">Save Preset</DialogTitle>
                    <DialogDescription className="text-xs">
                      Enter a name to save this list of tags.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2 text-xs">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Preset Name</Label>
                      <DebouncedInput value={presetName} onChange={setPresetName} debounceTime={300} placeholder="My awesome preset" className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Tags</Label>
                      <div className="p-2 bg-muted rounded text-[10px] font-mono break-all max-h-20 overflow-y-auto">
                        {addInput || <span className="text-muted-foreground italic">No tags entered</span>}
                      </div>
                    </div>
                  </div>
                  <DialogFooter className="flex-row gap-1 justify-end">
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setIsPresetDialogOpen(false)}>Cancel</Button>
                    <Button size="sm" className="h-8 text-xs" onClick={savePreset} disabled={!presetName.trim() || !addInput.trim()}>Save</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" title="View Presets">
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[180px] text-xs">
                  <DropdownMenuLabel className="text-[10px]">Saved Presets</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {presets.length === 0 ? (
                    <div className="p-2 text-center text-muted-foreground text-[10px]">
                      No saved presets
                    </div>
                  ) : (
                    presets.map(preset => (
                      <DropdownMenuItem key={preset.id} className="justify-between group cursor-pointer text-xs" onClick={() => loadPreset(preset)}>
                        <span className="truncate mr-1">{preset.name}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                          onClick={(e) => deletePreset(preset.id, e)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Tags to Exclude */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="exclude-tags-input" className="text-xs font-semibold">Tags to Exclude</Label>
            <span className="text-[10px] text-muted-foreground">(Only final prompt)</span>
          </div>
          <div className="relative">
            <DebouncedInput
              id="exclude-tags-input"
              value={excludeInput}
              onChange={setExcludeInput}
              debounceTime={400}
              placeholder="bad quality, watermark, signature..."
              className="h-8 text-xs bg-background/50 pr-7"
            />
            {excludeInput && (
              <button
                type="button"
                onClick={() => setExcludeInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground flex items-center justify-center h-5 w-5 rounded-full hover:bg-muted"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        </div>

        {/* Sliders */}
        <div className="flex flex-col gap-1">
          <SmoothFilterSlider
            variant="compact"
            min={5}
            max={100}
            step={1}
            value={tagCountFilter}
            onChange={setTagCountFilter}
            onCommit={setAppliedTagCountFilter}
            disabled={!isTagCountSupported}
            labelPrefix="Minimum Tags"
            tooltipTitle="Minimum Tag Count"
            tooltipDescription="Only shows prompts that have at least this number of tags. Recommended between 20 and 30 for detailed prompts."
            inputId="tag-count"
            isInputValid={isTagCountValid}
            maxInput={1000}
            ariaLabel="Minimum tags"
            dotColor={isTagCountSupported ? "bg-blue-500" : "bg-gray-400"}
          />
          <SmoothFilterSlider
            variant="compact"
            min={0}
            max={10000}
            step={100}
            value={characterCountFilter}
            onChange={setCharacterCountFilter}
            onCommit={setAppliedCharacterCountFilter}
            disabled={!includeCharacters}
            labelPrefix="Minimum Character Posts"
            tooltipTitle="Minimum Character Posts"
            tooltipDescription="Filters images to only include characters with more posts accumulated in the booru database, avoiding obscure characters."
            inputId="character-count"
            isInputValid={!!characterCountFilter && /^\d+$/.test(characterCountFilter)}
            maxInput={1000000}
            ariaLabel="Minimum character posts"
            dotColor={includeCharacters ? "bg-blue-500" : "bg-gray-400"}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-muted/30 border rounded-xl p-4 space-y-4">
      <div className="grid grid-cols-1 gap-4">
        {/* Tags Management */}
        <div className="space-y-4" data-tour="tags-to-add">
          <div className="space-y-2">
            <label htmlFor="add-tags" className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
              <InfoTooltip
                title="Tags to Add"
                description="An option to add whatever tags you want to all prompts. Useful if you use LoRAs with trigger words or want to apply styles (realistic, photorealistic, sketch, etc.)."
                visual={
                  <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
                    <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                        <span className="text-muted-foreground font-medium min-w-[70px]">Input:</span>
                        <span className="bg-green-500/10 text-green-500 border border-green-500/20 px-1.5 py-0.5 rounded">masterpiece, best quality</span>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                        <span className="text-muted-foreground font-medium min-w-[70px]">Original:</span>
                        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo, looking at viewer</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-1 px-1">
                      <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
                      <div className="flex flex-wrap gap-1">
                        <span className="bg-green-500/10 border border-green-500/20 text-green-500 px-1.5 py-0.5 rounded flex items-center gap-0.5"><Check className="w-3 h-3" /> masterpiece, best quality</span>
                        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo, looking at viewer</span>
                      </div>
                    </div>
                  </div>
                }
              >
                Tags to Add
              </InfoTooltip>
              <span className="text-[10px] font-normal text-muted-foreground/70">(Only modify final prompt)</span>
            </label>
            <div className="flex h-9 w-full items-center rounded-md border border-input bg-background/50 pl-3 pr-1 text-sm shadow-sm transition-colors focus-within:outline-none focus-within:ring-1 focus-within:ring-ring">
              <DebouncedHTMLInput id="add-tags" value={addInput} onChange={setAddInput} debounceTime={400} placeholder="masterpiece, best quality..." aria-label="Tags to include input" className="flex-1 bg-transparent border-none p-0 placeholder:text-muted-foreground focus:outline-none h-full min-w-0" />
              <div className="flex items-center gap-0.5 ml-1.5 shrink-0">
                {addInput && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setAddInput("")}
                    className="h-6 w-6 text-muted-foreground hover:text-foreground rounded-full"
                    aria-label="Clear added tags"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}

                <div className="h-4 w-px bg-border mx-1" />
                <div className="flex items-center">
                  <Dialog open={isPresetDialogOpen} onOpenChange={setIsPresetDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground rounded-r-none" title="Save Preset" aria-label="Save current tags as preset">
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Save Preset</DialogTitle>
                        <DialogDescription>
                          Enter a name for your tags preset.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>Preset Name</Label>
                          <DebouncedInput value={presetName} onChange={setPresetName} debounceTime={300} placeholder="My awesome preset" />
                        </div>
                        <div className="space-y-2">
                          <Label>Tags</Label>
                          <div className="p-2 bg-muted rounded-md text-sm font-mono break-all max-h-32 overflow-y-auto">
                            {addInput || <span className="text-muted-foreground italic">No tags entered</span>}
                          </div>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsPresetDialogOpen(false)}>Cancel</Button>
                        <Button onClick={savePreset} disabled={!presetName.trim() || !addInput.trim()}>Save</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-6 min-w-[1.5rem] text-muted-foreground hover:text-foreground rounded-l-none" title="Select Preset" aria-label="Select a saved tags preset">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[240px]">
                      <DropdownMenuLabel>Saved Presets</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {presets.length === 0 ? (
                        <div className="p-2 text-sm text-center text-muted-foreground">
                          No presets saved
                        </div>
                      ) : (
                        presets.map(preset => (
                          <DropdownMenuItem key={preset.id} className="justify-between group cursor-pointer" onClick={() => loadPreset(preset)}>
                            <span className="truncate mr-2">{preset.name}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={(e) => deletePreset(preset.id, e)}
                              aria-label={`Delete preset ${preset.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="exclude-tags" className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
              <InfoTooltip
                title="Tags to Exclude"
                description="Removes tags from the final prompt on all cards. For example, tags like 'solo' or 'realistic' which are sometimes found in prompts and might not be desired."
                visual={
                  <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
                    <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                        <span className="text-muted-foreground font-medium min-w-[70px]">Input:</span>
                        <span className="bg-red-500/10 text-red-500 border border-red-500/20 px-1.5 py-0.5 rounded">realistic, 3d</span>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                        <span className="text-muted-foreground font-medium min-w-[70px]">Original:</span>
                        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo, realistic, 3d, hat</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-1 px-1">
                      <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
                      <div className="flex flex-wrap gap-1">
                        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo, hat</span>
                        <span className="bg-destructive/10 border border-destructive/20 text-destructive line-through px-1.5 py-0.5 rounded"><X className="w-2.5 h-2.5 inline mr-0.5" />realistic, 3d</span>
                      </div>
                    </div>
                  </div>
                }
              >
                Tags to Exclude
              </InfoTooltip>
              <span className="text-[10px] font-normal text-muted-foreground/70">(Only modify final prompt)</span>
            </label>
            <div className="relative">
              <DebouncedInput id="exclude-tags" value={excludeInput} onChange={setExcludeInput} debounceTime={400} placeholder="bad quality, watermark..." className="h-9 text-sm bg-background/50" aria-label="Tags to exclude input" />
              {excludeInput && (
                <button type="button" onClick={() => setExcludeInput("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground flex items-center justify-center h-6 w-6 rounded-full hover:bg-muted" aria-label="Clear excluded tags">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <SmoothFilterSlider
            min={5}
            max={100}
            step={1}
            value={tagCountFilter}
            onChange={setTagCountFilter}
            onCommit={setAppliedTagCountFilter}
            disabled={!isTagCountSupported}
            labelPrefix="Minimum Tag Count"
            tooltipTitle="Minimum Tag Count"
            tooltipDescription="This option ensures that only prompts with more than a certain amount of tags appear. The higher the number, the more detailed prompts you get; recommended around 20-30."
            tooltipVisual={
              <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
                <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                    <span className="text-muted-foreground font-medium min-w-[70px]">Config:</span>
                    <span className="bg-blue-500/10 text-blue-500 border border-blue-500/20 px-1.5 py-0.5 rounded font-mono">{">"} 20 Tags</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2 mt-1 px-1">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2 bg-primary/5 rounded border border-border gap-2">
                    <span className="text-foreground line-clamp-1 flex-1">1girl, solo, short hair...</span>
                    <Badge variant="destructive" className="shrink-0 whitespace-nowrap">15 Tags (Hidden)</Badge>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2 bg-primary/10 rounded border border-primary/20 gap-2">
                    <span className="text-foreground line-clamp-1 flex-1 font-medium">1girl, solo, detailed face, green eyes...</span>
                    <Badge className="bg-blue-500 hover:bg-blue-500 text-white shrink-0 whitespace-nowrap">42 Tags (Visible)</Badge>
                  </div>
                </div>
              </div>
            }
            inputId="tag-count"
            isInputValid={isTagCountValid}
            maxInput={1000}
            ariaLabel="Minimum tag count"
            dotColor={isTagCountSupported ? "bg-blue-500" : "bg-gray-400"}
          />
          <SmoothFilterSlider
            min={0}
            max={10000}
            step={100}
            value={characterCountFilter}
            onChange={setCharacterCountFilter}
            onCommit={setAppliedCharacterCountFilter}
            disabled={!includeCharacters}
            labelPrefix="Minimum Character Post Count"
            tooltipTitle="Minimum Character Post Count"
            tooltipDescription="This option ensures that only posts containing characters with a minimum amount of booru posts appear. Useful for filtering out obscure characters."
            inputId="character-count"
            isInputValid={!!characterCountFilter && /^\d+$/.test(characterCountFilter)}
            maxInput={1000000}
            ariaLabel="Minimum character post count"
            dotColor={includeCharacters ? "bg-blue-500" : "bg-gray-400"}
          />
        </div>
      </div>
    </div>
  )
}
