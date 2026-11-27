"use client"

/**
 * Where the clothes come from when the Wearing row is left empty: each scene's own
 * outfit, the character's usual one, or one of their official outfits. The outfit
 * library is chosen in Wearing itself, by style.
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
import { OUTFIT_KIND_LABEL as KIND_LABEL, outfitFromKey as fromKey, outfitKey as keyOf, outfitSourceValue, type OutfitSource } from "./pack-text"

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
          "inline-flex h-7 max-w-full items-center gap-1 rounded-md px-2 text-xs pointer-coarse:h-11",
          "transition-[background-color] duration-150 ease-out-strong",
          "hover:bg-muted data-[state=open]:bg-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <span className="shrink-0 text-muted-foreground">Outfit:</span>
        <span className="truncate font-medium text-foreground">{outfitSourceValue(value)}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">When nothing is written here</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={keyOf(value)} onValueChange={(key) => onChange(fromKey(key))}>
          <DropdownMenuRadioItem value="scene" className="pointer-coarse:min-h-11">{KIND_LABEL.scene}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="usual" disabled={noCharacter} className="pointer-coarse:min-h-11">
            {KIND_LABEL.usual}
          </DropdownMenuRadioItem>
          {officialOutfits.length > 0 && !noCharacter && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Official outfits</DropdownMenuLabel>
              {officialOutfits.map((name) => (
                <DropdownMenuRadioItem key={name} value={`official:${name}`} className="pointer-coarse:min-h-11">
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
