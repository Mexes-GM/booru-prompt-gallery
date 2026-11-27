import { Check, Mountain, Shirt, Smile, User } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ClassifiedTags, TagCategory } from "@/lib/tag-classifier"
import { PROMPT_FORMATS, PROMPT_FORMAT_INFO, type PromptFormat } from "@/lib/prompt/prompt-format"
import { preloadNaturalPrompt } from "@/lib/prompt/natural-prompt-loader"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export interface CopyOptionsDropdownProps {
  classifiedTags: ClassifiedTags
  onCopyCategory: (category: TagCategory) => void
  disabled?: boolean
  /** Renders the exact DropdownMenuTrigger content (grid uses an icon-only
   *  ghost-styled button that shares its group with the primary action;
   *  list uses a standalone bordered button) — kept as a render prop instead
   *  of a fixed style/size union so each call site's existing trigger button
   *  (and its className/variant, which differ meaningfully between the two
   *  layouts) doesn't need to be forced into a shared shape. */
  trigger: ReactNode
  /** Extra class names for DropdownMenuContent (grid raises z-index above its
   *  in-place-expand overlay; list doesn't need to). */
  contentClassName?: string
  /** Adds "Copy as" items: this card's prompt in another format, once,
   *  without changing the format setting. */
  copyAs?: {
    current: PromptFormat
    onSelect: (format: PromptFormat) => void
  }
  /** Adds "Send as" items above "Copy as" (ComfyUI mode): this card's prompt
   *  in a format, sent to ComfyUI once. Uses copyAs's current format. */
  sendAs?: (format: PromptFormat) => void
}

const CATEGORY_ITEMS: { category: TagCategory; label: string; Icon: typeof Mountain }[] = [
  { category: "scenery", label: "Scenery", Icon: Mountain },
  { category: "pose", label: "Pose", Icon: User },
  { category: "clothing", label: "Clothing", Icon: Shirt },
  { category: "appearance", label: "Appearance", Icon: Smile },
]

/**
 * "Copy Options" dropdown shared by masonry-item.tsx's grid view.
 * Lists the prompt formats ("Copy as", when `copyAs` is given) and the
 * per-category copy actions (scenery/pose/clothing/appearance, each with its
 * tag count).
 */
export function CopyOptionsDropdown({
  classifiedTags,
  onCopyCategory,
  disabled,
  trigger,
  contentClassName,
  copyAs,
  sendAs,
}: CopyOptionsDropdownProps) {
  const formatItems = (current: PromptFormat, onSelect: (format: PromptFormat) => void) =>
    PROMPT_FORMATS.map((format) => {
      const info = PROMPT_FORMAT_INFO[format]
      const isCurrent = format === current
      return (
        <DropdownMenuItem
          key={format}
          onClick={() => onSelect(format)}
          // Warm the converter while the pointer or focus is on a text format.
          onFocus={format === "tags" ? undefined : preloadNaturalPrompt}
        >
          <Check className={cn("mr-2 h-4 w-4", !isCurrent && "invisible")} aria-hidden="true" />
          <span className="flex-1">
            {info.label}
            {isCurrent && <span className="sr-only"> (current format)</span>}
          </span>
          <span className="ml-3 text-xs text-muted-foreground">{info.contents}</span>
        </DropdownMenuItem>
      )
    })

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // With Send as the menu is tall: it scrolls instead of running off short screens.
        className={cn(copyAs && "w-60 max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto", contentClassName)}
      >
        {copyAs ? (
          <>
            {sendAs && (
              <>
                <DropdownMenuLabel>Send as</DropdownMenuLabel>
                {formatItems(copyAs.current, sendAs)}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel>Copy as</DropdownMenuLabel>
            {formatItems(copyAs.current, copyAs.onSelect)}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Copy only</DropdownMenuLabel>
          </>
        ) : (
          <>
            <DropdownMenuLabel>Copy options</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        {CATEGORY_ITEMS.map(({ category, label, Icon }) => (
          <DropdownMenuItem key={category} onClick={() => onCopyCategory(category)}>
            <Icon className="mr-2 h-4 w-4" />
            <span className="flex-1">{label}</span>
            <span className="ml-2 text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
              {classifiedTags[category].length}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
