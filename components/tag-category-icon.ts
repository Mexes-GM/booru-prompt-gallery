/**
 * Resolves the `iconName` declared in lib/tag-taxonomy.ts to a real component.
 *
 * Kept out of the taxonomy module so that stays React-free and server actions
 * can import it without pulling icons into their bundle.
 */
import { Mountain, Package, PersonStanding, Shirt, Smile, type LucideIcon } from 'lucide-react'
import { TAG_CATEGORIES, type TagCategory, type TagCategoryIconName } from '@/lib/tag-taxonomy'

const ICON_BY_NAME: Record<TagCategoryIconName, LucideIcon> = {
  face: Smile,
  shirt: Shirt,
  person: PersonStanding,
  mountain: Mountain,
  package: Package,
}

/** Icon for a category, sourced from the taxonomy's `iconName`. */
export function tagCategoryIcon(category: TagCategory): LucideIcon {
  return ICON_BY_NAME[TAG_CATEGORIES[category].iconName]
}

export const TAG_CATEGORY_ICONS: Record<TagCategory, LucideIcon> = {
  appearance: tagCategoryIcon('appearance'),
  clothing: tagCategoryIcon('clothing'),
  pose: tagCategoryIcon('pose'),
  scenery: tagCategoryIcon('scenery'),
  other: tagCategoryIcon('other'),
}
