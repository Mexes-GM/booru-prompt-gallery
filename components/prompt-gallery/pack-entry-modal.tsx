"use client"

/**
 * Pack Mode's entry point (design spec §2.1) — replaces PackSetupModal as the
 * mandatory first step. The choices: the character the current search is
 * about (when there is one), a character typed by name, a base card from the
 * gallery, or an existing prompt. Nothing is fetched from here; "From a card"
 * just closes this and leaves the gallery in "pick a base" mode, while "From a
 * character" and "From my prompt" switch this same dialog to their own view.
 * A character base needs no card: their look is what most of their posts show.
 * Several names make a group: the first is the base, the others join its cast.
 */
import { useCallback, useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { BUILDER_SWITCH_TEXT } from "./pack/builder-switch"
import { ImageIcon, PenLine, ArrowLeft, Plus, Search, UserRound, Users, X } from "lucide-react"
import type { BooruProvider } from "@/lib/booru/types"
import type { CastMember } from "@/lib/pack/brief"
import { CastPickerForm } from "./pack/cast-picker"
import { CAST_PICKER_TEXT } from "./pack/pack-text"
import { MAX_CAST, castFromNames } from "@/lib/pack/scene/cast"
import { PackCharacterSearch } from "./pack-character-search"
import { TagAutocompleteTextarea } from "./tag-autocomplete-textarea"

export interface PackEntryModalProps {
  isOpen: boolean
  /** Initial value for the "From my prompt" textarea (usePreferences.getLastPackBasePrompt()). */
  initialPrompt: string
  /** Opens straight into the prompt-editing view instead of the choice
   *  screen — used by the builder's "Edit" button on an existing prompt base. */
  startInPromptView?: boolean
  onChooseCard: () => void
  onSubmitPrompt: (text: string) => void
  onCancel: () => void
  /** The one character the current search is about, if any: offered as a base with no card. */
  searchCharacter?: string | null
  /** The search's tags a pack can use; the search is offered when there are any, or a character. */
  searchTags?: readonly string[]
  onChooseSearch?: () => void
  /** "From a character": the typed characters, with spaces ("hatsune miku"); the first is the base, the others its group. */
  onSubmitCharacters: (characters: string[]) => void
  /** "Open in the classic builder": the start goes to the classic builder instead of the new one. */
  classic?: boolean
  onClassicChange?: (classic: boolean) => void
  /**
   * "Add several at once": characters picked by popularity or series, one per prompt, in the new
   * builder (not offered while the classic builder is chosen). `provider`: the site, for its names.
   */
  onSubmitCast?: (members: CastMember[]) => void
  provider?: BooruProvider
}

export function PackEntryModal({ isOpen, initialPrompt, startInPromptView = false, onChooseCard, onSubmitPrompt, onCancel, searchCharacter, searchTags = [], onChooseSearch, onSubmitCharacters, classic = false, onClassicChange, onSubmitCast, provider = "danbooru" }: PackEntryModalProps) {
  const [view, setView] = useState<"choose" | "prompt" | "character" | "cast">("choose")
  const castOffered = !!onSubmitCast && !classic
  const [promptText, setPromptText] = useState(initialPrompt)
  const [characters, setCharacters] = useState<string[]>([])
  const [addingCharacter, setAddingCharacter] = useState(true)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)

  // Reset to the right screen (and the remembered prompt) every time the
  // modal is (re)opened, so a previous "Back" doesn't leak into the next use.
  /* eslint-disable react-hooks/set-state-in-effect -- mirrors external state
     (the modal's open/closed prop and the last-remembered prompt from
     storage) into local UI state on open, not derived from render inputs. */
  useEffect(() => {
    if (isOpen) {
      setView(startInPromptView ? "prompt" : "choose")
      setPromptText(initialPrompt)
      setCharacters([])
      setAddingCharacter(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])
  /* eslint-enable react-hooks/set-state-in-effect */

  // A name already in the list, or one past the limit, isn't added twice ("Add a character" works the same way).
  // Stable: the search re-runs its lookup whenever onPick changes.
  const addCharacter = useCallback((character: string) => {
    setCharacters((prev) => castFromNames([...prev, character]))
    setAddingCharacter(false)
  }, [])
  const removeCharacter = (character: string) => {
    const next = characters.filter((c) => c !== character)
    setCharacters(next)
    if (next.length === 0) setAddingCharacter(true)
  }
  const searching = (addingCharacter || characters.length === 0) && characters.length < MAX_CAST

  const handleContinue = () => {
    if (!promptText.trim()) return
    onSubmitPrompt(promptText)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent
        className="max-w-md"
        // A click outside must not throw away what was typed: X, Cancel and Escape close it.
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
        // The first Escape closes the character suggestions; the dialog stays.
        if (view === "character" && suggestionsOpen) { e.preventDefault(); return }
        onCancel()
      }}>
        {view === "choose" ? (
          <>
            <DialogHeader>
              <DialogTitle>Make a pack</DialogTitle>
              <DialogDescription>
                Pick a base to build variations from — its identity stays fixed, everything else varies.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
              {(searchCharacter || searchTags.length > 0) && onChooseSearch && (
                <button
                  type="button"
                  onClick={onChooseSearch}
                  className="sm:col-span-2 flex items-center gap-3 rounded-lg border border-mode-pack-border bg-mode-pack-soft p-4 text-left transition-colors duration-200 hover:border-mode-pack"
                >
                  <Search className="w-6 h-6 flex-shrink-0 text-mode-pack-text" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      From my search: <span className="font-mono">{searchCharacter ?? searchTags.slice(0, 3).join(", ")}</span>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {searchCharacter
                        ? "No card needed. Their look comes from what most of your results show."
                        : "No card needed. Your search's tags go to the rows they belong in."}
                    </span>
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setView("character")}
                className="sm:col-span-2 flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 p-4 text-left transition-colors duration-200 hover:bg-mode-pack-soft hover:border-mode-pack-border"
              >
                <UserRound className="w-6 h-6 flex-shrink-0 text-mode-pack-text" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">From a character</span>
                  <span className="block text-xs text-muted-foreground">
                    Type a name, or several for a group. No search or card needed.
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={onChooseCard}
                className="flex flex-col items-center gap-2 rounded-lg border border-border/50 bg-muted/30 p-5 text-center transition-all duration-200 hover:bg-mode-pack-soft hover:border-mode-pack-border"
              >
                <ImageIcon className="w-6 h-6 text-mode-pack-text" />
                <span className="text-sm font-medium">From a card</span>
                <span className="text-xs text-muted-foreground">
                  Choose a post from the gallery; its character (and anything else you keep) becomes the base.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setView("prompt")}
                className="flex flex-col items-center gap-2 rounded-lg border border-border/50 bg-muted/30 p-5 text-center transition-all duration-200 hover:bg-mode-pack-soft hover:border-mode-pack-border"
              >
                <PenLine className="w-6 h-6 text-mode-pack-text" />
                <span className="text-sm font-medium">From my prompt</span>
                <span className="text-xs text-muted-foreground">
                  Already have your character or OC&apos;s prompt? Paste it and vary everything else without searching.
                </span>
              </button>
            </div>
            <DialogFooter className="sm:items-center sm:justify-between">
              {onClassicChange && (
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-muted-foreground sm:min-h-0">
                  <Checkbox checked={classic} onCheckedChange={(v) => onClassicChange(v === true)} />
                  <span>
                    {BUILDER_SWITCH_TEXT.entryClassic}
                    <span className="sr-only">. </span>
                    <span className="block text-[11px] text-faint-foreground">{BUILDER_SWITCH_TEXT.entryClassicHint}</span>
                  </span>
                </label>
              )}
              <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
            </DialogFooter>
          </>
        ) : view === "character" ? (
          <>
            <DialogHeader>
              <DialogTitle>From a character</DialogTitle>
              <DialogDescription>
                Type a character&apos;s name, or several for a group. Their look comes from what most of their posts show.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              {characters.length > 0 && (
                <ul className="space-y-1.5" aria-label="Characters in this pack">
                  {characters.map((character) => (
                    <li key={character} className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 py-1 pl-2.5 pr-1">
                      <UserRound className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={character}>{character}</span>
                      <button
                        type="button"
                        onClick={() => removeCharacter(character)}
                        aria-label={`Remove ${character}`}
                        className="inline-flex h-7 w-7 pointer-coarse:h-11 pointer-coarse:w-11 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-ring"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {searching ? (
                <PackCharacterSearch onPick={addCharacter} onSuggestionsOpenChange={setSuggestionsOpen} />
              ) : characters.length < MAX_CAST ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setAddingCharacter(true)} className="pointer-coarse:h-11">
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Add a character
                </Button>
              ) : null}
              <p className="text-xs text-muted-foreground">A group pack takes up to {MAX_CAST} characters.</p>
              {castOffered && characters.length === 0 && (
                <button
                  type="button"
                  onClick={() => setView("cast")}
                  className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-foreground transition-colors duration-150 hover:bg-mode-pack-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
                >
                  <Users className="size-3.5 shrink-0 text-mode-pack-text" aria-hidden="true" />
                  {CAST_PICKER_TEXT.entryLink}
                </button>
              )}
            </div>
            <DialogFooter className="flex items-center justify-between sm:justify-between">
              <Button type="button" variant="ghost" onClick={() => setView("choose")}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                Back
              </Button>
              <Button type="button" onClick={() => onSubmitCharacters(characters)} disabled={characters.length === 0}>
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : view === "cast" && castOffered ? (
          <>
            <DialogHeader>
              <DialogTitle>{CAST_PICKER_TEXT.entryTitle}</DialogTitle>
              <DialogDescription>{CAST_PICKER_TEXT.entryDescription}</DialogDescription>
            </DialogHeader>
            <CastPickerForm provider={provider} onAdd={(members) => onSubmitCast?.(members)} submitLabel={CAST_PICKER_TEXT.start} className="py-2" />
            <DialogFooter className="flex items-center justify-between sm:justify-between">
              <Button type="button" variant="ghost" onClick={() => setView("character")}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                Back
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>From my prompt</DialogTitle>
              <DialogDescription>
                Paste your character&apos;s prompt — it stays fixed while everything else varies.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <TagAutocompleteTextarea
                value={promptText}
                onValueChange={setPromptText}
                placeholder="e.g. 1girl, mona (genshin impact), long hair, red eyes, masterpiece..."
                className="text-xs font-mono min-h-[7rem] max-h-56 resize-y"
                autoFocus
              />
            </div>
            <DialogFooter className="flex items-center justify-between sm:justify-between">
              <Button type="button" variant="ghost" onClick={startInPromptView ? onCancel : () => setView("choose")}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                {startInPromptView ? "Cancel" : "Back"}
              </Button>
              <Button type="button" onClick={handleContinue} disabled={!promptText.trim()}>
                Continue
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
