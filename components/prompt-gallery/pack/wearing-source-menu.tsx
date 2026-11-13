"use client"

/**
 * Where the clothes come from when the Wearing row is left empty: each scene's own
 * outfit, the character's usual one, one of their official outfits, or the outfit
 * library.
 */
import { memo } from "react"
import { ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { OUTFIT_KIND_LABEL as KIND_LABEL, outfitFromKey as fromKey, outfitKey as keyOf, outfitSourceLabel, type OutfitSource } from "./pack-text"

export interface WearingSourceMenuProps {
  value: OutfitSource
  onChange: (source: OutfitSource) => void
  /** The character's official outfits, by name. */
  officialOutfits?: readonly string[]
  /** No named character yet: "usual" and "official" have nothing to take from. */
  noCharacter?: boolean
  className?: string
}

export const WearingSourceMenu = memo(function WearingSourceMenu({
  value,
  onChange,
  officialOutfits = [],
  noCharacter = false,
  className,
}: WearingSourceMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-7 max-w-full items-center gap-1 rounded-md px-2 text-xs text-muted-foreground pointer-coarse:h-11",
          "transition-[color,background-color] duration-150 ease-out-strong",
          "hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <span className="sr-only">Outfit when this row is empty: </span>
        <span className="truncate">{outfitSourceLabel(value)}</span>
        <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">When nothing is written here</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={keyOf(value)} onValueChange={(key) => onChange(fromKey(key))}>
          <DropdownMenuRadioItem value="scene">{KIND_LABEL.scene}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="usual" disabled={noCharacter}>
            {KIND_LABEL.usual}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="library">{KIND_LABEL.library}</DropdownMenuRadioItem>
          {officialOutfits.length > 0 && !noCharacter && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Official outfits</DropdownMenuLabel>
              {officialOutfits.map((name) => (
                <DropdownMenuRadioItem key={name} value={`official:${name}`}>
                  {name}
                </DropdownMenuRadioItem>
              ))}
            </>
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
