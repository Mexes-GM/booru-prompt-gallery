"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sparkles,
  X,
  ChevronLeft,
  ChevronRight,
  Tag,
  Wrench,
} from "lucide-react"

type AnnouncementItem = {
  color: keyof typeof COLORS
  icon: React.ReactNode
  title: string
  badge: string
  body: string
}

const COLORS = {
  emerald: ['border-emerald-500', 'bg-emerald-500/10', 'bg-emerald-500/20', 'bg-emerald-500/15', 'text-emerald-600 dark:text-emerald-400'],
  indigo: ['border-indigo-500', 'bg-indigo-500/10', 'bg-indigo-500/20', 'bg-indigo-500/15', 'text-indigo-600 dark:text-indigo-400'],
  amber: ['border-amber-500', 'bg-amber-500/10', 'bg-amber-500/20', 'bg-amber-500/15', 'text-amber-600 dark:text-amber-400'],
  blue: ['border-blue-500', 'bg-blue-500/10', 'bg-blue-500/20', 'bg-blue-500/15', 'text-blue-600 dark:text-blue-400'],
} as const

const ITEMS: AnnouncementItem[] = [
  { color: 'emerald', icon: <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />, title: 'Smarter Tag Exclusion', badge: 'Improved', body: 'Added new conflict cases and improved the Smart Tag Exclusion logic, so prompts come out cleaner and more consistent.' },
  { color: 'emerald', icon: <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />, title: 'Smarter Tag Combination', badge: 'Improved', body: 'Improved the Smart Tag Combination logic so it handles tricky cases better and avoids odd or contradictory tag mixes.' },
  { color: 'emerald', icon: <Tag className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />, title: 'Category Tag Badges', badge: 'New', body: 'Small badges on each card now count tags by category (appearance, clothing, pose, etc).' },
  { color: 'indigo', icon: <Wrench className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />, title: 'Teach Modal Fix', badge: 'Fix', body: 'Fixed an issue with the teach modal that caused the page to reload when opening it.' },
  { color: 'indigo', icon: <Wrench className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />, title: 'Favorites System Refactor', badge: 'Fix', body: 'Refactored the favorites system to address several recurring issues, along with making adjustments to favorites management to improve stability.' },
]

interface AnnouncementsCarouselProps {
  version: string
  onDismiss: () => void
}

export function AnnouncementsCarousel({ version, onDismiss }: AnnouncementsCarouselProps) {
  const [slide, setSlide] = useState(0)
  const [dir, setDir] = useState(1)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(true)

  // Pause everything when the carousel is scrolled off-screen: avoids the
  // auto-rotate height animation shifting content the user is reading below it,
  // and saves needless work while out of view.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.01 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Auto-rotate (mobile only) until the user interacts or it scrolls off-screen.
  useEffect(() => {
    if (paused || !visible) return
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 767px)')
    if (!mq.matches) return
    const id = setInterval(() => {
      setDir(1)
      setSlide(s => (s + 1) % ITEMS.length)
    }, 6000)
    return () => clearInterval(id)
  }, [paused, visible])

  // Smoothly animate the carousel height so longer/shorter slides don't jump.
  const slideRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | 'auto'>('auto')
  useLayoutEffect(() => {
    if (slideRef.current) setHeight(slideRef.current.offsetHeight)
  }, [slide])

  // Recalculate height when the active slide reflows (e.g. viewport resize or
  // device rotation changes how many lines the body text wraps to).
  useEffect(() => {
    const el = slideRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [slide])

  const go = (next: number, direction: number) => {
    setPaused(true)
    setDir(direction)
    setSlide(((next % ITEMS.length) + ITEMS.length) % ITEMS.length)
  }

  const item = ITEMS[slide]
  const [, slideBg, slideIconBg, slideBadgeBg, slideBadgeText] = COLORS[item.color] ?? COLORS.blue

  return (
    <Card ref={rootRef} className="mt-4 glass-effect overflow-hidden min-w-[280px] mx-auto">
      <CardContent className="p-3.5">
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-base font-semibold text-foreground tracking-tight">Update Notes: v{version}</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onDismiss} className="h-8 w-8 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" aria-label="Dismiss update notes">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Mobile: carousel (1 item at a time) */}
        <div className="md:hidden">
          <motion.div
            className="relative overflow-hidden"
            animate={{ height }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <AnimatePresence mode="popLayout" custom={dir} initial={false}>
              <motion.div
                ref={slideRef}
                key={slide}
                custom={dir}
                initial={{ x: dir > 0 ? 24 : -24, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: dir > 0 ? -24 : 24, opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.18}
                onDragEnd={(_, info) => {
                  const swipe = info.offset.x
                  const velocity = info.velocity.x
                  if (swipe < -50 || velocity < -500) go(slide + 1, 1)
                  else if (swipe > 50 || velocity > 500) go(slide - 1, -1)
                }}
                className={`${slideBg} p-4 rounded-xl touch-pan-y cursor-grab active:cursor-grabbing`}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex-shrink-0 mt-0.5 flex h-8 w-8 items-center justify-center rounded-full ${slideIconBg}`}>{item.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <p className="text-sm font-semibold text-foreground leading-snug">{item.title}</p>
                      <Badge className={`text-[10px] px-1.5 py-0 h-4 font-medium border-0 ${slideBadgeBg} ${slideBadgeText} rounded-md`}>{item.badge}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed text-left">{item.body}</p>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </motion.div>
          <div className="flex items-center justify-between mt-3 px-1">
            <Button variant="ghost" size="icon" onClick={() => go(slide - 1, -1)} className="h-7 w-7 rounded-full" aria-label="Previous update">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex gap-1.5">
              {ITEMS.map((_, i) => (
                <button key={i} onClick={() => go(i, i > slide ? 1 : -1)} aria-label={`Go to update ${i + 1}`} className={`h-1.5 rounded-full transition-all duration-300 ${i === slide ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30'}`} />
              ))}
            </div>
            <Button variant="ghost" size="icon" onClick={() => go(slide + 1, 1)} className="h-7 w-7 rounded-full" aria-label="Next update">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Desktop: full list */}
        <div className="hidden md:flex flex-col gap-3">
          {ITEMS.map((it, i) => {
            const [border, bg, iconBg, badgeBg, badgeText] = COLORS[it.color] ?? COLORS.blue
            return (
              <div key={i} className={`border-l-4 ${border} ${bg} hover:opacity-90 transition-colors p-4 rounded-r-xl`}>
                <div className="flex items-start gap-3">
                  <div className={`flex-shrink-0 mt-0.5 flex h-8 w-8 items-center justify-center rounded-full ${iconBg}`}>{it.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <p className="text-sm font-semibold text-foreground leading-snug">{it.title}</p>
                      <Badge className={`text-[10px] px-1.5 py-0 h-4 font-medium border-0 ${badgeBg} ${badgeText} rounded-md`}>{it.badge}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed text-left">{it.body}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
