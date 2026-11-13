"use client"

/**
 * "Scene ideas" in Pack Builder: in Scenes under Scenery › Pick a scene, in Classic
 * inside the Scenery category row. A searchable list of named scenes,
 * this month's first, the rest by category, each title once at the highest level
 * the pack's content rating allows (lib/pack/scene-ideas.ts). Added scenes show
 * under the button, each with its own chips: the scene's own tags pinned, the ones
 * that often come with it dashed, any of them removable. Select a chip to switch
 * it; the X next to a title takes the whole scene back. Everything goes by id:
 * several entries can share a title.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, CalendarDays, Check, Lightbulb, Pin, RotateCcw, X } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useLowMotion } from "@/hooks/use-low-motion"
import type { PackRatingMode } from "@/hooks/use-pack-seed-search"
import type { SceneIdeaControls } from "@/hooks/use-pack-mode"
import {
  SCENE_IDEA_CATEGORY_LABELS,
  groupSceneIdeas,
  loadSceneIdeas,
  matchedOptionalTags,
  offeredSceneIdeas,
  sceneIdeaChips,
  sceneIdeasForRating,
  searchSceneIdeas,
  type SceneIdea,
  type SceneIdeaChip,
} from "@/lib/pack/scene-ideas"

/** Up to `max` tags joined, with "+N" for the rest. */
function previewTags(tags: readonly string[], max = 4): string {
  const shown = tags.slice(0, max).join(", ")
  return tags.length > max ? `${shown} +${tags.length - max}` : shown
}

/** Room kept under the popover for the builder's fixed Generate bar (mobile). */
const BOTTOM_BAR_ROOM = 96

/** One chip of an added scene: select it to pin it or dash it; the X leaves it out. */
function IdeaChip({ chip, onToggle, onRemove }: { chip: SceneIdeaChip; onToggle: () => void; onRemove: () => void }) {
  const pinned = chip.state === "pinned"
  return (
    <span
      className={`group inline-flex items-center max-w-full rounded-md border font-mono text-xs leading-5 ${
        pinned ? "bg-foreground/[0.07] border-border text-foreground" : "border-dashed border-border/70 text-muted-foreground"
      }`}
    >
      <button
        type="button"
        aria-pressed={pinned}
        aria-label={`Pin ${chip.tag} in every prompt`}
        title={pinned ? "In every prompt. Select to leave it to each prompt." : "Only when a prompt brings it. Select to pin it in every prompt."}
        onClick={onToggle}
        className="relative inline-flex items-center gap-1 min-w-0 rounded-l-md pl-1.5 pr-1 py-0.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-y-2.5 pointer-coarse:after:inset-x-0 pointer-coarse:after:content-['']"
      >
        {pinned && <Pin className="w-3 h-3 flex-shrink-0" aria-hidden />}
        <span className="truncate max-w-[14rem]">{chip.tag}</span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Leave ${chip.tag} out of every prompt`}
        className="relative mr-0.5 rounded p-0.5 text-faint-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 pointer-coarse:px-2.5 pointer-coarse:after:absolute pointer-coarse:after:-inset-y-3.5 pointer-coarse:after:left-0 pointer-coarse:after:-right-3 pointer-coarse:after:content-[''] hover:text-destructive-text hover:bg-destructive-soft transition-[color,background-color,opacity]"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  )
}

export interface PackSceneIdeasProps {
  controls: SceneIdeaControls
  /** The pack's content rating: scenes above it aren't offered (nor used, if added before). */
  rating: PackRatingMode | null
}

function PackSceneIdeasComponent({ controls, rating }: PackSceneIdeasProps) {
  const lowMotion = useLowMotion()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [ideas, setIdeas] = useState<SceneIdea[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [status, setStatus] = useState("")

  // The list loads the first time the picker opens (and again after a failed load).
  useEffect(() => {
    if (!open || ideas) return
    let active = true
    void loadSceneIdeas().then((list) => {
      if (!active) return
      if (list.length === 0) setFailed(true)
      else {
        setFailed(false)
        setIdeas(list)
      }
    })
    return () => {
      active = false
    }
  }, [open, ideas])

  const month = new Date().getMonth() + 1
  const offered = useMemo(() => (ideas ? offeredSceneIdeas(ideas, rating) : []), [ideas, rating])
  const groups = useMemo(() => groupSceneIdeas(searchSceneIdeas(offered, query), month), [offered, query, month])
  const appliedIds = useMemo(() => new Set(controls.applied.map((idea) => idea.id)), [controls.applied])
  const usable = useMemo(() => new Set(sceneIdeasForRating(controls.applied, rating).map((idea) => idea.id)), [controls.applied, rating])

  const toggle = (idea: SceneIdea) => {
    if (appliedIds.has(idea.id)) {
      controls.remove(idea.id)
      setStatus(`Removed ${idea.title}.`)
    } else {
      controls.add(idea)
      setStatus(`Added ${idea.title}.`)
    }
    inputRef.current?.focus()
  }
  const removeIdea = (idea: SceneIdea) => {
    controls.remove(idea.id)
    setStatus(`Removed ${idea.title}.`)
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen} closeOnScroll={false}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-haspopup="dialog"
            className="self-start inline-flex items-center gap-1 min-h-7 pointer-coarse:min-h-11 text-xs text-muted-foreground hover:text-foreground"
          >
            <Lightbulb className="w-3.5 h-3.5" aria-hidden />
            Browse scene ideas
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          collisionPadding={{ top: 8, left: 8, right: 8, bottom: BOTTOM_BAR_ROOM }}
          hideWhenDetached
          className={`w-[min(22rem,calc(100vw-2rem))] p-0 rounded-xl overflow-hidden ${lowMotion ? "data-[state=open]:animate-none data-[state=closed]:animate-none" : ""}`}
        >
          <Command shouldFilter={false} label="Scene ideas">
            <CommandInput ref={inputRef} value={query} onValueChange={setQuery} placeholder="Search scenes or tags" aria-label="Search scene ideas" />
            <CommandList className="max-h-[min(20rem,calc(var(--radix-popover-content-available-height,60vh)-7rem))]">
              {!ideas ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground" role="status">
                  {failed ? "Couldn't load the scene ideas. Close this and try again." : "Loading scene ideas…"}
                </p>
              ) : (
                <>
                  <CommandEmpty className="px-3 py-6 text-center text-xs text-muted-foreground">No scenes match that search.</CommandEmpty>
                  {groups.map((group) => (
                    <CommandGroup key={group.key} heading={group.key === "season" ? "This month" : SCENE_IDEA_CATEGORY_LABELS[group.key]}>
                      {group.ideas.map((idea) => {
                        const isAdded = appliedIds.has(idea.id)
                        const via = matchedOptionalTags(idea, query)
                        return (
                          <CommandItem key={idea.id} value={idea.id} onSelect={() => toggle(idea)} className="items-start gap-2 py-2 pointer-coarse:py-3">
                            <span className="mt-0.5 w-4 flex-shrink-0" aria-hidden>
                              {isAdded ? <Check className="w-4 h-4 text-mode-pack-text" /> : null}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 text-sm font-medium">
                                <span className="truncate">{idea.title}</span>
                                {group.key === "season" && <CalendarDays className="w-3.5 h-3.5 flex-shrink-0 text-mode-pack-text" aria-label="In season" />}
                                {isAdded && <span className="sr-only">(added, select to remove)</span>}
                              </span>
                              <span className="block truncate font-mono text-xs text-muted-foreground">{previewTags(idea.tags)}</span>
                              {via.length > 0 && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  Often with <span className="font-mono">{via.join(", ")}</span>
                                </span>
                              )}
                            </span>
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  ))}
                </>
              )}
            </CommandList>
            <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
              Select a scene to add it, or select it again to remove it.
            </p>
          </Command>
        </PopoverContent>
      </Popover>

      {controls.applied.map((idea) => {
        const chips = sceneIdeaChips(idea, (tag) => controls.states.get(tag))
        const shown = chips.filter((chip) => chip.state !== "removed")
        const removed = chips.filter((chip) => chip.state === "removed")
        return (
          <div key={idea.id} className="space-y-1.5 rounded-lg border border-border/50 bg-background/40 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="min-w-0 truncate text-xs font-semibold">{idea.title}</h4>
              <button
                type="button"
                onClick={() => removeIdea(idea)}
                aria-label={`Remove the scene ${idea.title}`}
                className="relative rounded p-0.5 text-faint-foreground hover:text-destructive-text hover:bg-destructive-soft transition-colors pointer-coarse:p-2.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {!usable.has(idea.id) && (
              <p className="flex items-start gap-1.5 text-xs text-warning-text">
                <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden />
                Not used: this scene is above the pack&apos;s content rating.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5 pointer-coarse:gap-x-3.5 pointer-coarse:gap-y-5">
              {shown.map((chip) => (
                <IdeaChip
                  key={chip.tag}
                  chip={chip}
                  onToggle={() => controls.setState(chip.tag, chip.state === "pinned" ? "scene" : "pinned")}
                  onRemove={() => controls.setState(chip.tag, "removed")}
                />
              ))}
              {removed.length > 0 && (
                <button
                  type="button"
                  onClick={() => removed.forEach((chip) => controls.setState(chip.tag, null))}
                  className="inline-flex items-center gap-1 min-h-7 pointer-coarse:min-h-11 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="w-3 h-3" />
                  {removed.length} removed · Restore
                </button>
              )}
            </div>
          </div>
        )
      })}
      {controls.applied.length > 0 && (
        <p className="flex items-start gap-1 text-xs text-muted-foreground">
          <Pin className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden />
          <span>Pinned tags go in every prompt, dashed ones only when a prompt brings them. Select a tag to switch it.</span>
        </p>
      )}
      <p className="text-xs text-muted-foreground empty:hidden" role="status" aria-live="polite">{status}</p>
    </div>
  )
}

export const PackSceneIdeas = memo(PackSceneIdeasComponent)
