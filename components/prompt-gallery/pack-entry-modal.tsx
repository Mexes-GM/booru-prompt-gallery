"use client"

/**
 * Pack Mode's entry point (design spec §2.1) — replaces PackSetupModal as the
 * mandatory first step. The choices: the character the current search is
 * about (when there is one), a character typed by name, a base card from the
 * gallery, or an existing prompt. Nothing is fetched from here; "From a card"
 * just closes this and leaves the gallery in "pick a base" mode, while "From a
 * character" and "From my prompt" switch this same dialog to their own view.
 * A character base needs no card: their look is what most of their posts show.
 */
import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ImageIcon, PenLine, ArrowLeft, Search, UserRound, X } from "lucide-react"
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
  onChooseSearch?: () => void
  /** "From a character": the typed character, with spaces ("hatsune miku"). */
  onSubmitCharacter: (character: string) => void
}

export function PackEntryModal({ isOpen, initialPrompt, startInPromptView = false, onChooseCard, onSubmitPrompt, onCancel, searchCharacter, onChooseSearch, onSubmitCharacter }: PackEntryModalProps) {
  const [view, setView] = useState<"choose" | "prompt" | "character">("choose")
  const [promptText, setPromptText] = useState(initialPrompt)
  const [character, setCharacter] = useState<string | null>(null)

  // Reset to the right screen (and the remembered prompt) every time the
  // modal is (re)opened, so a previous "Back" doesn't leak into the next use.
  /* eslint-disable react-hooks/set-state-in-effect -- mirrors external state
     (the modal's open/closed prop and the last-remembered prompt from
     storage) into local UI state on open, not derived from render inputs. */
  useEffect(() => {
    if (isOpen) {
      setView(startInPromptView ? "prompt" : "choose")
      setPromptText(initialPrompt)
      setCharacter(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleContinue = () => {
    if (!promptText.trim()) return
    onSubmitPrompt(promptText)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="max-w-md" onEscapeKeyDown={onCancel}>
        {view === "choose" ? (
          <>
            <DialogHeader>
              <DialogTitle>Make a pack</DialogTitle>
              <DialogDescription>
                Pick a base to build variations from — its identity stays fixed, everything else varies.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
              {searchCharacter && onChooseSearch && (
                <button
                  type="button"
                  onClick={onChooseSearch}
                  className="sm:col-span-2 flex items-center gap-3 rounded-lg border border-mode-pack-border bg-mode-pack-soft p-4 text-left transition-colors duration-200 hover:border-mode-pack"
                >
                  <Search className="w-6 h-6 flex-shrink-0 text-mode-pack-text" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      From my search: <span className="font-mono">{searchCharacter}</span>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      No card needed. Their look comes from what most of your results show.
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
                    Type a character&apos;s name. No search or card needed.
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
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
            </DialogFooter>
          </>
        ) : view === "character" ? (
          <>
            <DialogHeader>
              <DialogTitle>From a character</DialogTitle>
              <DialogDescription>
                Type a character&apos;s name. Their look comes from what most of their posts show.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              {character ? (
                <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 py-1 pl-2.5 pr-1">
                  <UserRound className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={character}>{character}</span>
                  <button
                    type="button"
                    onClick={() => setCharacter(null)}
                    aria-label={`Remove ${character}`}
                    className="inline-flex h-7 w-7 pointer-coarse:h-11 pointer-coarse:w-11 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-ring"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <PackCharacterSearch onPick={setCharacter} />
              )}
            </div>
            <DialogFooter className="flex items-center justify-between sm:justify-between">
              <Button type="button" variant="ghost" onClick={() => setView("choose")}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                Back
              </Button>
              <Button type="button" onClick={() => character && onSubmitCharacter(character)} disabled={!character}>
                Continue
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
