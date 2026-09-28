import { memo } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { TagCategory } from '@/lib/tag-classifier'
import { CATEGORY_CHIP_CLASS } from './category-chip-styles'

export interface RemovableTagChipProps {
  text: string
  category: TagCategory
  onRemove: () => void
  /** "explode": scale up + blur on exit, with a red hover overlay and an
   *  absolutely-positioned X revealed on hover (Merge's original look).
   *  "fade": simple opacity/scale fade on exit, X shown inline at full
   *  opacity (Pack Builder's AxisEditor chip look). Both share the exact
   *  same entrance spring ({ stiffness: 500, damping: 30 }) — only the exit
   *  animation and hover chrome differ, which is why this prop exists
   *  instead of forcing one look on both call sites. */
  exitVariant?: 'explode' | 'fade'
  /** When true, drops the layout/scale animation in favor of a plain
   *  opacity fade (prefers-reduced-motion). Only applies to the "fade"
   *  variant — Merge's "explode" variant is always animated (matching its
   *  original behavior, since it never exposed a reduced-motion path). */
  reducedMotion?: boolean
}

/**
 * Removable tag chip shared by the Merge/Variations and Pack Builder sticky
 * footers. Category color comes from the shared
 * CATEGORY_CHIP_CLASS map (category-chip-styles.ts).
 */
export const RemovableTagChip = memo(({ text, category, onRemove, exitVariant = 'explode', reducedMotion = false }: RemovableTagChipProps) => {
  if (exitVariant === 'fade') {
    return (
      <motion.button
        type="button"
        layout={!reducedMotion}
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
        animate={reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
        transition={reducedMotion ? { duration: 0.15 } : { type: "spring", stiffness: 500, damping: 30 }}
        onClick={onRemove}
        className={`group px-2 py-1 rounded border text-xs font-mono cursor-pointer select-none flex items-center gap-1 max-w-full min-w-0 ${CATEGORY_CHIP_CLASS[category]}`}
      >
        <span className="truncate max-w-[140px]">{text}</span>
        <X className="w-3 h-3 opacity-50 group-hover:opacity-100 flex-shrink-0" />
      </motion.button>
    )
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{
        opacity: 0,
        scale: 2,
        filter: "blur(4px)",
        transition: { duration: 0.3 }
      }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className="relative z-0 hover:z-10"
    >
      <motion.button
        onClick={onRemove}
        className={`transform-gpu hover:scale-110 active:scale-95 transition-all duration-200 px-2.5 py-1.5 sm:py-0.5 rounded border text-xs font-medium font-mono cursor-pointer select-none relative overflow-hidden group ${CATEGORY_CHIP_CLASS[category]}`}
      >
        <span className="block relative z-10 transition-transform duration-300 group-hover:-translate-x-1.5 truncate max-w-[150px]">
          {text}
        </span>

        <span className="absolute inset-0 bg-destructive/20 sm:opacity-0 opacity-100 group-hover:opacity-100 transition-opacity duration-200" />

        <span className="absolute right-1 top-1/2 -translate-y-1/2 sm:opacity-0 opacity-100 group-hover:opacity-100 transition-opacity duration-200 z-10">
          <X className="w-3 h-3" />
        </span>
      </motion.button>
    </motion.div>
  )
})
RemovableTagChip.displayName = "RemovableTagChip"
