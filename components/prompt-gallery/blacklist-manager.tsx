"use client"

import { useState } from "react"
import { Tag, Plus, X, RotateCcw, AlertOctagon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface BlacklistManagerProps {
  blacklist: string[]
  onAdd: (tag: string) => void
  onRemove: (tag: string) => void
  onReset: () => void
}

export function BlacklistManager({ blacklist, onAdd, onRemove, onReset }: BlacklistManagerProps) {
  const [inputValue, setInputValue] = useState("")
  const [isOpen, setIsOpen] = useState(false)

  const handleAdd = () => {
    if (inputValue.trim()) {
      onAdd(inputValue.trim())
      setInputValue("")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAdd()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="h-11 rounded-none relative z-10 px-2 sm:px-3 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Tag className="w-3.5 h-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline text-xs font-medium">Blacklist</span>
              {blacklist.length > 0 && (
                <span className="ml-1.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-[10px] font-bold px-1 h-4 min-w-[1rem] flex items-center justify-center rounded-full">
                  {blacklist.length}
                </span>
              )}
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Manage blacklisted tags</TooltipContent>
      </Tooltip>

      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertOctagon className="w-5 h-5 text-destructive" />
            Content Blacklist
          </DialogTitle>
          <DialogDescription>
            Posts containing these tags will be hidden from the gallery.
            This filter is applied locally in your browser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex gap-2">
            <Input
              placeholder="Add tag to blacklist (e.g., spiders)"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1"
            />
            <Button onClick={handleAdd} size="icon" disabled={!inputValue.trim()}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          <div className="rounded-md border bg-muted/30 p-1">
            <ScrollArea className="h-[200px] w-full rounded-md p-3 bg-background/50">
              {blacklist.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm opacity-70 gap-2">
                  <Tag className="w-8 h-8 opacity-20" />
                  <p>No tags blacklisted</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {blacklist.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="pl-2 pr-1 py-1 h-7 flex items-center gap-1 hover:bg-destructive/10 hover:text-destructive group transition-colors"
                    >
                      <span className="font-mono text-xs">{tag}</span>
                      <button
                        onClick={() => onRemove(tag)}
                        className="rounded-full p-0.5 hover:bg-destructive/20 focus:outline-none focus:ring-1 focus:ring-destructive"
                        aria-label={`Remove ${tag}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="sm:justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-2" />
            Reset Defaults
          </Button>
          <Button type="button" onClick={() => setIsOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
