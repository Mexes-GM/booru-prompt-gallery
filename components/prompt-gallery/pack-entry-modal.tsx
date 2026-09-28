"use client"

/**
 * Pack Mode's entry point (design spec §2.1) — replaces PackSetupModal as the
 * mandatory first step. Two big choices: pick a base card from the gallery,
 * or paste an existing prompt. Nothing is fetched from here; picking "From a
 * card" just closes this and leaves the gallery in "pick a base" mode,
 * picking "From my prompt" switches this same dialog to a textarea.
 */
import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ImageIcon, PenLine, ArrowLeft } from "lucide-react"
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
}

export function PackEntryModal({ isOpen, initialPrompt, startInPromptView = false, onChooseCard, onSubmitPrompt, onCancel }: PackEntryModalProps) {
  const [view, setView] = useState<"choose" | "prompt">("choose")
  const [promptText, setPromptText] = useState(initialPrompt)

  // Reset to the right screen (and the remembered prompt) every time the
  // modal is (re)opened, so a previous "Back" doesn't leak into the next use.
  /* eslint-disable react-hooks/set-state-in-effect -- mirrors external state
     (the modal's open/closed prop and the last-remembered prompt from
     storage) into local UI state on open, not derived from render inputs. */
  useEffect(() => {
    if (isOpen) {
      setView(startInPromptView ? "prompt" : "choose")
      setPromptText(initialPrompt)
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
              <button
                type="button"
                onClick={onChooseCard}
                className="flex flex-col items-center gap-2 rounded-lg border border-border/50 bg-muted/30 p-5 text-center transition-all duration-200 hover:bg-mode-pack-soft hover:border-mode-pack-border"
              >
                <ImageIcon className="w-6 h-6 text-mode-pack-text" />
                <span className="text-sm font-medium">From a card</span>
                <span className="text-[11px] text-muted-foreground">
                  Choose a post from the gallery; its character (and what you decide to lock) becomes the base.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setView("prompt")}
                className="flex flex-col items-center gap-2 rounded-lg border border-border/50 bg-muted/30 p-5 text-center transition-all duration-200 hover:bg-mode-pack-soft hover:border-mode-pack-border"
              >
                <PenLine className="w-6 h-6 text-mode-pack-text" />
                <span className="text-sm font-medium">From my prompt</span>
                <span className="text-[11px] text-muted-foreground">
                  Already have your character or OC&apos;s prompt? Paste it and vary everything else without searching.
                </span>
              </button>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
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
