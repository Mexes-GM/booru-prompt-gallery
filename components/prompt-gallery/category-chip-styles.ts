import type { TagCategory } from "@/lib/tag-classifier"

/**
 * Shared per-category color classes for the sticky-footer chrome (Merge,
 * Variations, Pack Builder).
 */

/** Removable tag chip (bg + text + border), the most commonly reused style. */
export const CATEGORY_CHIP_CLASS: Record<TagCategory, string> = {
  appearance: 'text-cat-appearance-text bg-cat-appearance-soft border-cat-appearance-border',
  clothing: 'text-cat-clothing-text bg-cat-clothing-soft border-cat-clothing-border',
  equipment: 'text-cat-equipment-text bg-cat-equipment-soft border-cat-equipment-border',
  pose: 'text-cat-pose-text bg-cat-pose-soft border-cat-pose-border',
  scenery: 'text-cat-scenery-text bg-cat-scenery-soft border-cat-scenery-border',
  creature: 'text-cat-creature-text bg-cat-creature-soft border-cat-creature-border',
  other: 'text-muted-foreground bg-muted border-transparent',
}

/** Selected/active toggle state (category filter buttons, "roll" selectors). */
export const CATEGORY_ACTIVE_CLASS: Record<TagCategory, string> = {
  appearance: 'bg-cat-appearance-soft border-cat-appearance-border text-cat-appearance-text shadow-sm',
  clothing: 'bg-cat-clothing-soft border-cat-clothing-border text-cat-clothing-text shadow-sm',
  equipment: 'bg-cat-equipment-soft border-cat-equipment-border text-cat-equipment-text shadow-sm',
  pose: 'bg-cat-pose-soft border-cat-pose-border text-cat-pose-text shadow-sm',
  scenery: 'bg-cat-scenery-soft border-cat-scenery-border text-cat-scenery-text shadow-sm',
  creature: 'bg-cat-creature-soft border-cat-creature-border text-cat-creature-text shadow-sm',
  other: 'bg-muted border-muted-foreground/30 text-foreground shadow-sm',
}

/** Radix Slider thumb/track accent for a per-category slider control. */
export const CATEGORY_SLIDER_CLASS: Record<TagCategory, string> = {
  appearance: '[&_[role=slider]]:border-cat-appearance [&_[role=slider]]:focus-visible:ring-cat-appearance/50 [&_.relative>.absolute]:bg-cat-appearance',
  clothing: '[&_[role=slider]]:border-cat-clothing [&_[role=slider]]:focus-visible:ring-cat-clothing/50 [&_.relative>.absolute]:bg-cat-clothing',
  equipment: '[&_[role=slider]]:border-cat-equipment [&_[role=slider]]:focus-visible:ring-cat-equipment/50 [&_.relative>.absolute]:bg-cat-equipment',
  pose: '[&_[role=slider]]:border-cat-pose [&_[role=slider]]:focus-visible:ring-cat-pose/50 [&_.relative>.absolute]:bg-cat-pose',
  scenery: '[&_[role=slider]]:border-cat-scenery [&_[role=slider]]:focus-visible:ring-cat-scenery/50 [&_.relative>.absolute]:bg-cat-scenery',
  creature: '[&_[role=slider]]:border-cat-creature [&_[role=slider]]:focus-visible:ring-cat-creature/50 [&_.relative>.absolute]:bg-cat-creature',
  other: '[&_[role=slider]]:border-muted-foreground [&_.relative>.absolute]:bg-muted-foreground',
}

/** Text-only accent, no background/border (Merge's SymbolTag label). */
export const CATEGORY_TEXT_CLASS: Record<TagCategory, string> = {
  appearance: 'text-cat-appearance-text',
  clothing: 'text-cat-clothing-text',
  equipment: 'text-cat-equipment-text',
  pose: 'text-cat-pose-text',
  scenery: 'text-cat-scenery-text',
  creature: 'text-cat-creature-text',
  other: 'text-muted-foreground',
}

/** Dashed-border outline accent (Merge's SymbolTag border/background). */
export const CATEGORY_BORDER_CLASS: Record<TagCategory, string> = {
  appearance: 'border-cat-appearance-border bg-cat-appearance/5',
  clothing: 'border-cat-clothing-border bg-cat-clothing/5',
  equipment: 'border-cat-equipment-border bg-cat-equipment/5',
  pose: 'border-cat-pose-border bg-cat-pose/5',
  scenery: 'border-cat-scenery-border bg-cat-scenery/5',
  creature: 'border-cat-creature-border bg-cat-creature/5',
  other: 'border-border/50 bg-muted/30',
}

/** Subtle, harmonic pastel background and border for category container cards (AxisEditor, etc.) */
export const CATEGORY_CONTAINER_CLASS: Record<TagCategory, string> = {
  appearance: 'bg-cat-appearance-soft/60 dark:bg-cat-appearance-soft border-cat-appearance-border hover:border-cat-appearance/60 shadow-xs',
  clothing: 'bg-cat-clothing-soft/60 dark:bg-cat-clothing-soft border-cat-clothing-border hover:border-cat-clothing/60 shadow-xs',
  equipment: 'bg-cat-equipment-soft/60 dark:bg-cat-equipment-soft border-cat-equipment-border hover:border-cat-equipment/60 shadow-xs',
  pose: 'bg-cat-pose-soft/60 dark:bg-cat-pose-soft border-cat-pose-border hover:border-cat-pose/60 shadow-xs',
  scenery: 'bg-cat-scenery-soft/60 dark:bg-cat-scenery-soft border-cat-scenery-border hover:border-cat-scenery/60 shadow-xs',
  creature: 'bg-cat-creature-soft/60 dark:bg-cat-creature-soft border-cat-creature-border hover:border-cat-creature/60 shadow-xs',
  other: 'bg-muted/40 border-border/60 dark:bg-muted/15 dark:border-border/40 hover:border-border shadow-xs',
}
