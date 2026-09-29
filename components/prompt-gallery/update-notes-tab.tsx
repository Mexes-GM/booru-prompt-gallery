"use client"

import { useRef, useState, useSyncExternalStore } from "react"
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { PixelMascot, PixelPuff } from "@/components/prompt-gallery/pixel-mascot"
import { cn } from "@/lib/utils"
import { PANEL_TAB_CLASS } from "@/components/prompt-gallery/panel-tab-styles"
import { trackExternalLink } from "@/lib/analytics"
import { SOCIAL_URLS } from "@/lib/constants"
import { ArrowUpRight, Sparkles, TrendingUp, Wrench, type LucideIcon } from "lucide-react"

type NoteKind = 'new' | 'improved' | 'fixed'

type UpdateNote = {
  kind: NoteKind
  title: string
  body: string
}

// One look per kind: color lives only in the small kind label, so the grid
// of cards stays visually even whatever the mix of notes is. `order` puts
// what's worth noticing (new, improved) ahead of fixes.
const KIND_META: Record<NoteKind, { label: string; icon: LucideIcon; tone: string; order: number }> = {
  new: { label: 'New', icon: Sparkles, tone: 'text-primary-text', order: 0 },
  improved: { label: 'Improved', icon: TrendingUp, tone: 'text-success-text', order: 1 },
  fixed: { label: 'Fixed', icon: Wrench, tone: 'text-info-text', order: 2 },
}

// This release's notes. Edit on each release; display order comes from
// KIND_META, so write them in any order.
const NOTES: UpdateNote[] = [
  { kind: 'new', title: 'Pack Mode', body: "Pick a base card or paste your own prompt and get a whole batch built around it. Choose what stays fixed, set how wild it gets with the Variety slider, and re-roll any single prompt you don't like. There's also a \"Make pack\" shortcut in every card's \"...\" menu." },
  { kind: 'new', title: 'New Tag Categories (Jev)', body: "Tags are now sorted into 7 categories and 33 subcategories (weapon, handheld, footwear, expression, props...), with new Equipment and Creature badges. All ~145k Danbooru tags were classified with Jev, TypeSafe's AI model, so way fewer tags end up in \"other\"." },
  { kind: 'new', title: 'Quick Teach', body: "Teaching tags is now a fast queue of the tags Jev wasn't sure about, with its best guess already picked: Enter to accept, number keys to choose another. Each answer is saved right away, with Undo." },
  { kind: 'new', title: 'Find & Append', body: "Make your own rules: when a prompt has X, append Y. There's a visual block editor, and your rules are applied to every prompt you copy." },
  { kind: 'improved', title: 'A Much Cleaner Interface', body: "Way fewer controls between you and your first card. There's a new Update Notes tab, a single card size control (Small / Medium / Large) and mode buttons that all behave the same. Trending and List view were removed to keep things simple." },
  { kind: 'improved', title: 'Cleaner Prompts & Backgrounds', body: "Rule34 and Gelbooru artist and meta tags no longer sneak into your prompts as content. Detailed Random backgrounds also got a much bigger scenery dataset." },
  { kind: 'fixed', title: 'Assorted Fixes', body: "Fixed Aibooru applying options that were hidden there, artists you removed coming back to your favorites, and the page jumping slightly whenever a popover opened." },
]

const SORTED_NOTES = [...NOTES].sort((a, b) => KIND_META[a.kind].order - KIND_META[b.kind].order)

// "1 improved · 3 fixed" for the popover header.
const KIND_SUMMARY = (() => {
  const parts: string[] = []
  for (const kind of Object.keys(KIND_META) as NoteKind[]) {
    const count = NOTES.filter((n) => n.kind === kind).length
    if (count > 0) parts.push(`${count} ${KIND_META[kind].label.toLowerCase()}`)
  }
  return parts.join(' · ')
})()

const SEEN_KEY = 'update_notes_seen_version'

// Room the popover needs below the tab to show every note without an inner
// scrollbar (measured: ~360px at 2 columns). When there's less, the page is
// scrolled first so the tab sits just under the sticky header.
const POPOVER_ROOM_PX = 400
const SCROLL_TOP_OFFSET_PX = 88

// Tiny external store over localStorage, so the "seen" flag can be read
// without a setState-in-effect and the server snapshot can differ from the
// client one without a hydration mismatch (server always says "seen").
const seenListeners = new Set<() => void>()

function subscribeSeen(listener: () => void) {
  seenListeners.add(listener)
  return () => { seenListeners.delete(listener) }
}

function readSeenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    // Storage unavailable (private mode).
    return null
  }
}

function markSeen(version: string) {
  try {
    localStorage.setItem(SEEN_KEY, version)
  } catch {
    // Non-fatal: the alert just comes back next visit.
  }
  seenListeners.forEach((l) => l())
}

// Stepped easing so the mascot moves in whole-frame jumps like a sprite
// instead of a smooth tween. Only used for transforms: opacity is animated
// through WAAPI, which can't take a JS easing function (it stays stuck at its
// start value), so opacity keeps plain named easings.
const stepped = (frames: number) => (t: number) => Math.min(1, Math.floor(t * frames) / frames)

// Parent only holds the timeline open long enough for the children's exit
// (hop + puff) to finish before AnimatePresence unmounts.
const MASCOT_VARIANTS: Variants = {
  hidden: {},
  shown: {},
  gone: { opacity: 1, transition: { duration: 0.65 } },
}

// Drops in on arrival; on exit hops up and blinks out as the puff appears.
const BODY_VARIANTS: Variants = {
  hidden: { y: -14, opacity: 0 },
  shown: {
    y: 0,
    opacity: 1,
    transition: { y: { duration: 0.3, ease: stepped(4) }, opacity: { duration: 0.1, ease: "linear" } },
  },
  gone: {
    y: [0, -8, -8],
    opacity: [1, 1, 0],
    transition: {
      y: { duration: 0.36, times: [0, 0.6, 1], ease: stepped(3) },
      opacity: { duration: 0.36, times: [0, 0.75, 1], ease: "linear" },
    },
  },
}

const PUFF_VARIANTS: Variants = {
  hidden: { opacity: 0, scale: 0.6 },
  shown: { opacity: 0, scale: 0.6 },
  gone: {
    opacity: [0, 0, 1, 1, 0],
    scale: [0.6, 0.6, 1, 1.2, 1.35],
    transition: {
      scale: { duration: 0.65, times: [0, 0.4, 0.5, 0.8, 1], ease: stepped(6) },
      opacity: { duration: 0.65, times: [0, 0.4, 0.45, 0.8, 1], ease: "linear" },
    },
  },
}

const REDUCED_BODY_VARIANTS: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.15 } },
  gone: { opacity: 0, transition: { duration: 0.15 } },
}

function NoteCard({ note }: { note: UpdateNote }) {
  const { label, icon: Icon, tone } = KIND_META[note.kind]
  return (
    <article className="flex h-full flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/30 p-3.5">
      <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide", tone)}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </span>
      <h4 className="text-sm font-semibold leading-snug text-foreground text-balance">{note.title}</h4>
      <p className="text-xs leading-relaxed text-muted-foreground text-pretty">{note.body}</p>
    </article>
  )
}

interface UpdateNotesTabProps {
  version: string
}

/**
 * Folder-style tab sitting on the top edge of the search panel. Replaces the
 * old always-visible changelog card: the notes live in a popover. While this
 * version's notes are unseen a pixel mascot stands on the tab (bobbing, with
 * a "!") next to a dot. Opening the popover marks them seen; once it closes
 * the mascot hops off in a puff and the tab shrinks back to plain text.
 */
export function UpdateNotesTab({ version }: UpdateNotesTabProps) {
  const [open, setOpen] = useState(false)
  const seen = useSyncExternalStore(
    subscribeSeen,
    () => readSeenVersion() === version,
    () => true,
  )

  const reduceMotion = useReducedMotion()
  // True while the popover that first revealed these notes is open: she stays
  // "presenting" them and leaves when it closes. Reopening already-seen notes
  // doesn't bring her back.
  const [presenting, setPresenting] = useState(false)
  const showMascot = !seen || presenting
  // Keeps her space reserved until her exit animation has fully played, so
  // the label doesn't slide left underneath the hop/puff.
  const [exiting, setExiting] = useState(false)

  const triggerRef = useRef<HTMLButtonElement>(null)

  const applyOpen = (next: boolean) => {
    setOpen(next)
    if (next && !seen) {
      setPresenting(true)
      markSeen(version)
    } else if (!next && presenting) {
      setPresenting(false)
      setExiting(true)
    }
  }

  // Opening near the bottom of the viewport would squeeze the popover into an
  // inner scroll. Scroll the page to make room first, then open once the
  // scroll has settled (the Popover closes itself on page scroll, so opening
  // mid-scroll would snap it shut).
  const handleOpenChange = (next: boolean) => {
    const el = triggerRef.current
    if (!next || !el) return applyOpen(next)
    const { top, bottom } = el.getBoundingClientRect()
    const roomBelow = window.innerHeight - bottom
    // Clamp to what the page can actually scroll: a zero-distance scroll never
    // fires `scrollend`, so there'd be nothing to wait for.
    const maxDelta = document.documentElement.scrollHeight - window.innerHeight - window.scrollY
    const delta = Math.min(top - SCROLL_TOP_OFFSET_PX, maxDelta)
    if (roomBelow >= POPOVER_ROOM_PX || delta <= 0) return applyOpen(true)

    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.removeEventListener('scrollend', finish)
      applyOpen(true)
    }
    const smooth = !reduceMotion
    if (smooth && 'onscrollend' in window) {
      window.addEventListener('scrollend', finish)
      // Safety net only; long enough that it never beats a real smooth scroll
      // (opening mid-scroll would get the popover closed by the scroll).
      setTimeout(finish, 1500)
    } else {
      // Instant scroll, or no `scrollend` (Safari): give it time to settle.
      setTimeout(finish, smooth ? 700 : 50)
    }
    window.scrollBy({ top: delta, behavior: smooth ? 'smooth' : 'auto' })
  }

  // Few notes read best as 2 columns; more get a 3rd so the popover grows
  // wider instead of taller (no inner scroll).
  const wide = NOTES.length > 4

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={seen ? `Update notes for v${version}` : `New update notes for v${version}`}
          className={cn(
            PANEL_TAB_CLASS,
            "transition-[color,padding] duration-200 ease-out data-[state=open]:text-foreground motion-reduce:transition-none",
            (showMascot || exiting) && "pl-12 sm:pl-12",
          )}
        >
          <AnimatePresence onExitComplete={() => setExiting(false)}>
            {showMascot && (
              <motion.span
                key="mascot"
                className="pointer-events-none absolute left-2 bottom-0"
                variants={MASCOT_VARIANTS}
                initial="hidden"
                animate="shown"
                exit="gone"
              >
                <motion.span className="block" variants={reduceMotion ? REDUCED_BODY_VARIANTS : BODY_VARIANTS}>
                  <PixelMascot
                    alert={!seen}
                    className="transition-transform duration-150 ease-out group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
                  />
                </motion.span>
                {!reduceMotion && (
                  <motion.span className="absolute left-1/2 top-1 -ml-[11px]" variants={PUFF_VARIANTS}>
                    <PixelPuff className="pixel-sticker" />
                  </motion.span>
                )}
              </motion.span>
            )}
          </AnimatePresence>
          Update Notes
          <span className="hidden tabular-nums text-muted-foreground/70 sm:inline">v{version}</span>
          {!seen && <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={16}
        className={cn(
          "max-h-(--radix-popover-content-available-height) overflow-y-auto p-0",
          wide ? "w-[min(calc(100vw-2rem),64rem)]" : "w-[min(calc(100vw-2rem),52rem)]",
        )}
      >
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
              <Sparkles className="h-3.5 w-3.5 text-primary-text" aria-hidden="true" />
            </span>
            <h3 className="text-sm font-semibold tracking-tight">What&apos;s new</h3>
            <span className="rounded-md border border-border/60 px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted-foreground">
              v{version}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span>{KIND_SUMMARY}</span>
            <span className="h-3 w-px bg-border" aria-hidden="true" />
            <a
              href={SOCIAL_URLS.CIVITAI_ARTICLE}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackExternalLink(SOCIAL_URLS.CIVITAI_ARTICLE, 'changelog')}
              className="inline-flex items-center gap-1 rounded-sm font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Full changelog
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </header>
        <div className={cn("grid grid-cols-1 gap-2.5 p-3 sm:grid-cols-2", wide && "lg:grid-cols-3")}>
          {SORTED_NOTES.map((note) => (
            <NoteCard key={note.title} note={note} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
