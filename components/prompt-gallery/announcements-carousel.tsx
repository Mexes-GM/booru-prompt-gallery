"use client"

import { useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sparkles,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Replace,
  SlidersHorizontal,
  Wrench,
  AtSign,
  Maximize2,
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
  { color: 'blue', icon: <Wrench className="h-4 w-4 text-blue-600 dark:text-blue-400" />, title: 'Tooltips Now Work on Mobile', badge: 'Fixed', body: "Info tooltips wouldn't open on phones and tablets because they only responded to a mouse hover. Now a quick tap on the info icon opens the tip, and tapping anywhere else closes it." },
  { color: 'emerald', icon: <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />, title: 'Smarter Tag Autocomplete', badge: 'Improved', body: "Tag autocomplete now covers over 145,000 Danbooru tags (up from ~60,000) and understands aliases, so searching for a common alternate name now correctly finds and suggests the matching Danbooru tag." },
  { color: 'blue', icon: <Wrench className="h-4 w-4 text-blue-600 dark:text-blue-400" />, title: '"View Original Post" Links Fixed', badge: 'Fixed', body: "Fixed a bug where \"View original post\" could send you to the wrong booru — most noticeable in History, where a re-copied post sometimes pointed at the wrong site's link for that same post ID." },
  { color: 'emerald', icon: <Maximize2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />, title: 'Click to Expand Cards', badge: 'New', body: "Click a card to make it bigger and see the whole prompt at a glance." },
  { color: 'emerald', icon: <AtSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />, title: 'Prepend Artist (@artist)', badge: 'New', body: "Added the option to prepend a card's artist as \"@artist\" at the start of the prompt, to replicate their style. Only works for Anima checkpoints." },
  { color: 'emerald', icon: <Replace className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />, title: 'Find and Replace', badge: 'New', body: "Quickly swap tags for others in your prompts." },
  { color: 'emerald', icon: <SlidersHorizontal className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />, title: 'Score Floor', badge: 'New', body: "Added the option to filter by score, since our own testing showed posts tend to be better tagged the higher their score. Optimized presets are included, based on that testing." },
]

// Single changelog row used by the desktop teaser/list. `clamp` truncates the
// body to one line for the collapsed teaser.
function DesktopAnnouncementItem({ it, clamp }: { it: AnnouncementItem; clamp: boolean }) {
  const [border, bg, iconBg, badgeBg, badgeText] = COLORS[it.color] ?? COLORS.blue
  return (
    <div className={`border-l-4 ${border} ${bg} hover:opacity-90 transition-colors p-4 rounded-r-xl`}>
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 mt-0.5 flex h-8 w-8 items-center justify-center rounded-full ${iconBg}`}>{it.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <p className="text-sm font-semibold text-foreground leading-snug">{it.title}</p>
            <Badge className={`text-[10px] px-1.5 py-0 h-4 font-medium border-0 ${badgeBg} ${badgeText} rounded-md`}>{it.badge}</Badge>
          </div>
          <p className={`text-xs text-muted-foreground leading-relaxed text-left ${clamp ? "line-clamp-1" : ""}`}>{it.body}</p>
        </div>
      </div>
    </div>
  )
}

// Staggered reveal for the desktop "show more" list. A parent container with
// `staggerChildren` is the reliable way to reveal items one-by-one — per-child
// delays fight with `layout` and read as a single blob. No `layout` here on
// purpose: the container reserves its full height at once (children start
// transparent) and the items then slide/fade in sequence, which looks crisper
// than animating height and position simultaneously.
const REST_LIST_VARIANTS = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.03 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
}

const REST_ITEM_VARIANTS = {
  hidden: { opacity: 0, y: -10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", duration: 0.35, bounce: 0 } },
}

interface AnnouncementsCarouselProps {
  version: string
  onDismiss: () => void
}

export function AnnouncementsCarousel({ version, onDismiss }: AnnouncementsCarouselProps) {
  const [slide, setSlide] = useState(0)
  const [dir, setDir] = useState(1)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(true)
  // Desktop-only: collapse the changelog to a single-item teaser by default so
  // it doesn't dominate the first view. Session-only (not persisted): a new
  // visit always starts collapsed.
  const [expanded, setExpanded] = useState(false)

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
  // The `layout` prop lets Framer Motion measure the new content size and
  // FLIP to it (single measurement + transform), instead of us tracking a
  // numeric pixel height in state and animating that directly.
  const slideRef = useRef<HTMLDivElement>(null)

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
            layout
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
              {ITEMS.map((item, i) => (
                <button type="button" key={item.title} onClick={() => go(i, i > slide ? 1 : -1)} aria-label={`Go to update ${i + 1}`} className={`h-1.5 rounded-full transition-all duration-300 ${i === slide ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30'}`} />
              ))}
            </div>
            <Button variant="ghost" size="icon" onClick={() => go(slide + 1, 1)} className="h-7 w-7 rounded-full" aria-label="Next update">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Desktop: single-item teaser (newest = top of ITEMS) that expands to the full list */}
        <div className="hidden md:flex flex-col gap-3">
          <DesktopAnnouncementItem it={ITEMS[0]} clamp={!expanded} />

          {/* Extra items only mount on expand, so they always animate in (no
              load animation to guard against). Parent variants stagger them. */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                key="rest"
                className="flex flex-col gap-3"
                variants={REST_LIST_VARIANTS}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                {ITEMS.slice(1).map((it) => (
                  <motion.div key={it.title} variants={REST_ITEM_VARIANTS}>
                    <DesktopAnnouncementItem it={it} clamp={false} />
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {ITEMS.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              className="self-center h-6 -mt-1.5 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground transition-transform active:scale-[0.96]"
            >
              {expanded ? "Show less" : `Show ${ITEMS.length - 1} more`}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
