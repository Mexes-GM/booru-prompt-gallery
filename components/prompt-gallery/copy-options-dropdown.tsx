import { ChevronDown, Mountain, Shirt, Smile, User } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ClassifiedTags, TagCategory } from "@/lib/tag-classifier"
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
}

/**
 * "Copy Options" dropdown shared by masonry-item.tsx's grid view.
 * Lists per-category copy actions (scenery/pose/clothing/appearance, each with its tag count).
 */
export function CopyOptionsDropdown({
  classifiedTags,
  onCopyCategory,
  disabled,
  trigger,
  contentClassName,
}: CopyOptionsDropdownProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={contentClassName}>
        <DropdownMenuLabel>Copy Options</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onCopyCategory('scenery')}>
          <Mountain className="mr-2 h-4 w-4" />
          <span className="flex-1">Scenery</span>
          <span className="ml-2 text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
            {classifiedTags.scenery.length}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onCopyCategory('pose')}>
          <User className="mr-2 h-4 w-4" />
          <span className="flex-1">Pose</span>
          <span className="ml-2 text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
            {classifiedTags.pose.length}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onCopyCategory('clothing')}>
          <Shirt className="mr-2 h-4 w-4" />
          <span className="flex-1">Clothing</span>
          <span className="ml-2 text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
            {classifiedTags.clothing.length}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onCopyCategory('appearance')}>
          <Smile className="mr-2 h-4 w-4" />
          <span className="flex-1">Appearance</span>
          <span className="ml-2 text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center">
            {classifiedTags.appearance.length}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
