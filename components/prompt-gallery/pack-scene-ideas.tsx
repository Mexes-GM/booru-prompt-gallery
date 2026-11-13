"use client"

/**
 * "Scene ideas" in Pack Builder (both methods): a searchable list of named scenes,
 * this month's first, the rest by category. Picking one adds its tags to the
 * character's chips (lib/pack/scene-ideas.ts, usePackMode's sceneIdeas): the
 * scene's own tags pinned, the ones that often come with it dashed. The scenes
 * already added show under the button, each with an X that takes its tags back.
 */
import { memo, useEffect, useMemo, useState } from "react"
import { CalendarDays, Check, Lightbulb, X } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useLowMotion } from "@/hooks/use-low-motion"
import type { PackRatingMode } from "@/hooks/use-pack-seed-search"
import type { SceneIdeaControls } from "@/hooks/use-pack-mode"
import {
  SCENE_IDEA_CATEGORY_LABELS,
  groupSceneIdeas,
  isSceneIdeaAdded,
  loadSceneIdeas,
  sceneIdeasForRating,
  searchSceneIdeas,
  type SceneIdea,
} from "@/lib/pack/scene-ideas"

/** Up to `max` tags joined, with "+N" for the rest. */
function previewTags(tags: readonly string[], max = 4): string {
  const shown = tags.slice(0, max).join(", ")
  return tags.length > max ? `${shown} +${tags.length - max}` : shown
}

export interface PackSceneIdeasProps {
  controls: SceneIdeaControls
  /** The pack's content rating: scenes above it aren't offered. */
  rating: PackRatingMode | null
  /** Where the added tags show, for the confirmation ("under Character" or "in the category rows"). */
  sceneMode: boolean
}

function PackSceneIdeasComponent({ controls, rating, sceneMode }: PackSceneIdeasProps) {
  const lowMotion = useLowMotion()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [ideas, setIdeas] = useState<SceneIdea[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [status, setStatus] = useState("")

  // The list loads the first time the picker opens (and again after a failed load), or
  // as soon as the character has added traits, so the added scenes can be listed.
  const hasAdded = controls.added.length > 0
  useEffect(() => {
    if ((!open && !hasAdded) || ideas) return
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
  }, [open, hasAdded, ideas])

  const month = new Date().getMonth() + 1
  const allowed = useMemo(() => (ideas ? sceneIdeasForRating(ideas, rating) : []), [ideas, rating])
  const groups = useMemo(() => groupSceneIdeas(searchSceneIdeas(allowed, query), month), [allowed, query, month])
  // Scenes added (from the whole list: a scene added before the rating changed can still be taken back).
  const added = useMemo(() => (ideas ?? []).filter((idea) => isSceneIdeaAdded(idea, controls.added)), [ideas, controls.added])
  const addedIds = useMemo(() => new Set(added.map((idea) => idea.id)), [added])
  const where = sceneMode ? "under Character" : "in the category rows"

  const toggle = (idea: SceneIdea) => {
    if (addedIds.has(idea.id)) {
      controls.remove(idea, added)
      setStatus(`Removed ${idea.title}.`)
      return
    }
    controls.add(idea)
    setStatus(`Added ${idea.title}. Its tags are ${where}.`)
  }
  const remove = (idea: SceneIdea) => {
    controls.remove(idea, added)
    setStatus(`Removed ${idea.title}.`)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 pointer-coarse:gap-x-3.5 pointer-coarse:gap-y-3">
        <Popover open={open} onOpenChange={setOpen} closeOnScroll={false}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-haspopup="dialog"
              className="inline-flex items-center gap-1 min-h-7 pointer-coarse:min-h-11 text-xs text-muted-foreground hover:text-foreground"
            >
              <Lightbulb className="w-3.5 h-3.5" aria-hidden />
              Scene ideas
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={6}
            collisionPadding={8}
            hideWhenDetached
            className={`w-[min(22rem,calc(100vw-2rem))] p-0 rounded-xl overflow-hidden ${lowMotion ? "data-[state=open]:animate-none data-[state=closed]:animate-none" : ""}`}
          >
            <Command shouldFilter={false} label="Scene ideas">
              <CommandInput value={query} onValueChange={setQuery} placeholder="Search scenes or tags" aria-label="Search scene ideas" />
              <CommandList className="max-h-[min(22rem,60vh)]">
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
                          const isAdded = addedIds.has(idea.id)
                          return (
                            <CommandItem
                              key={idea.id}
                              value={idea.id}
                              onSelect={() => toggle(idea)}
                              className="items-start gap-2 py-2 pointer-coarse:py-3"
                            >
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
                A scene&apos;s own tags are pinned; tags that often come with it are dashed.
              </p>
            </Command>
          </PopoverContent>
        </Popover>
        {added.map((idea) => (
          <span key={idea.id} className="group inline-flex items-center gap-1 max-w-full rounded-md border border-border bg-foreground/[0.07] pl-1.5 text-xs leading-5">
            <span className="truncate max-w-[12rem]">{idea.title}</span>
            <button
              type="button"
              onClick={() => remove(idea)}
              aria-label={`Remove ${idea.title} and its tags`}
              className="relative mr-0.5 rounded p-0.5 text-faint-foreground hover:text-destructive-text hover:bg-destructive-soft transition-colors pointer-coarse:px-2.5 pointer-coarse:after:absolute pointer-coarse:after:-inset-y-3.5 pointer-coarse:after:inset-x-0 pointer-coarse:after:content-['']"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground empty:hidden" role="status" aria-live="polite">{status}</p>
    </div>
  )
}

export const PackSceneIdeas = memo(PackSceneIdeasComponent)
