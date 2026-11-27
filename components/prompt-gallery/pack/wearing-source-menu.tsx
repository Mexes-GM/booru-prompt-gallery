"use client"

/**
 * Wearing's two menus.
 *
 * - WearingSourceMenu: what the pack wears while Wearing has no chips (each scene's own outfit,
 *   the character's usual one, or one of their official outfits). It sits at the end of the empty
 *   field, whose placeholder reads the current choice, and goes away once Wearing has a chip.
 * - OutfitDetailMenu: how much of each library outfit goes in a prompt (main pieces or the full
 *   outfit). Shown only while Wearing has a library style chip.
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
import type { OutfitDetail } from "@/lib/outfit-swap"
import { cn } from "@/lib/utils"
import {
  OUTFIT_DETAIL_TEXT,
  OUTFIT_KIND_LABEL as KIND_LABEL,
  OUTFIT_MENU_TEXT,
  outfitFromKey as fromKey,
  outfitKey as keyOf,
  outfitSourceLabel,
  type OutfitSource,
} from "./pack-text"

const MENU_LABEL = "text-xs font-medium text-muted-foreground"
const ITEM = "pointer-coarse:min-h-11"

export interface WearingSourceMenuProps {
  value: OutfitSource
  onChange: (source: OutfitSource) => void
  /** The character's official outfits, by name. */
  officialOutfits?: readonly string[]
  /** No named character yet: "usual" and "official" have nothing to take from. */
  noCharacter?: boolean
  className?: string
}

/** The chevron at the end of an empty Wearing field, and its menu. */
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
        aria-label={OUTFIT_MENU_TEXT.button(outfitSourceLabel(value))}
        className={cn(
          // Fills the field's height at the end of the well; a full touch target on coarse pointers.
          "-mr-1.5 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground pointer-coarse:-mr-2.5 pointer-coarse:size-11",
          "transition-[color,background-color] duration-150 ease-out-strong",
          "hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <ChevronDown className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      {/* A character can have many official outfits: the list scrolls within the screen. */}
      <DropdownMenuContent align="end" collisionPadding={8} className="max-h-(--radix-dropdown-menu-content-available-height) w-60 overflow-y-auto overscroll-contain">
        <DropdownMenuLabel className={MENU_LABEL}>{OUTFIT_MENU_TEXT.heading}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={keyOf(value)} onValueChange={(key) => onChange(fromKey(key))}>
          <DropdownMenuRadioItem value="scene" className={ITEM}>{KIND_LABEL.scene}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="usual" disabled={noCharacter} className={ITEM}>
            {KIND_LABEL.usual}
          </DropdownMenuRadioItem>
          {officialOutfits.length > 0 && !noCharacter && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className={MENU_LABEL}>{OUTFIT_MENU_TEXT.official}</DropdownMenuLabel>
              {officialOutfits.map((name) => (
                <DropdownMenuRadioItem key={name} value={`official:${name}`} className={ITEM}>
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

export interface OutfitDetailMenuProps {
  value: OutfitDetail
  onChange: (detail: OutfitDetail) => void
  className?: string
}

/** "Main pieces ▾" beside Wearing while it has a library style: the detail of every library outfit in the pack. */
export const OutfitDetailMenu = memo(function OutfitDetailMenu({ value, onChange, className }: OutfitDetailMenuProps) {
  const current = OUTFIT_DETAIL_TEXT.options.find((o) => o.value === value) ?? OUTFIT_DETAIL_TEXT.options[0]
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={OUTFIT_DETAIL_TEXT.button(current.label)}
        className={cn(
          "inline-flex h-7 max-w-full items-center gap-1 rounded-md px-2 text-xs text-foreground pointer-coarse:h-11",
          "transition-[background-color] duration-150 ease-out-strong",
          "hover:bg-muted data-[state=open]:bg-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <span className="truncate font-medium">{current.label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className={MENU_LABEL}>{OUTFIT_DETAIL_TEXT.heading}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current.value} onValueChange={(v) => onChange(v === "full" ? "full" : "simple")}>
          {OUTFIT_DETAIL_TEXT.options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} className={ITEM}>
              <span className="flex flex-col gap-0.5">
                <span>{o.label}</span>
                <span className="text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
