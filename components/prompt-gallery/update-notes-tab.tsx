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
  { kind: 'new', title: 'Pack Mode, redesigned', body: "Pack Mode opens on a screen of its own. Describe the pack in rows (Who, Wearing, Doing, Where and more) and it finds real posts whose scenes fit, then writes the prompts. On a wide window the rows stay on the left and the prompts on the right. From the results, keep a tag in every prompt or out of all of them, re-roll or lock a prompt, and copy them all in any prompt format. Weights like (smile:1.2) work in the rows, the pack survives a page reload, and the classic builder is still there." },
  { kind: 'new', title: 'Several characters in a pack', body: "Who takes several characters, together in each prompt (up to 3) or one per prompt (up to 15). Add several picks them by popularity or from a series, and Random characters puts a different character in each prompt. Both choose from thousands of known characters." },
  { kind: 'new', title: 'Send to ComfyUI', body: "Send prompts to ComfyUI on your computer from cards, AI convert, Merge and Pack Mode, and follow the image as it generates. In Pack Mode, send one prompt or all of them and see each image beside its prompt. Finished images open in a viewer inside the app, with Download. Turn it on in Customize prompt. It needs a free node for ComfyUI, and the setup guide shows how to add it and your workflow." },
  { kind: 'new', title: 'Fill in missing tags', body: "Danbooru posts often leave out the clothes, the place or the framing. This option, on by default in Customize prompt, adds the ones the image shows, on cards and in packs. Added tags can be wrong." },
  { kind: 'new', title: 'Compare two prompts', body: "The Import Cleaner has a Compare view. Paste two prompts to see the tags they share and the tags only one of them has, and copy any of the three lists." },
  { kind: 'new', title: 'Shared tags in Merge', body: "Merge can keep only the tags that several of the selected posts have. Set \"Tags in at least N of M posts\" and the rest are left out of the copied prompt." },
  { kind: 'improved', title: 'Floofgens replaces e6ai', body: "e6ai has closed. Floofgens has the same posts, so the e6ai source is now Floofgens, and your e6ai favorites, history and saved artists move over." },
  { kind: 'improved', title: 'Smaller improvements', body: "The what's new window walks you through Pack Mode and Send to ComfyUI with short videos. Messages say what went wrong and what to try next, and copy buttons say the same thing everywhere. Smart Tag Exclusion removes fewer tags that belong in the prompt, and names on Gelbooru posts are recognized more reliably." },
  { kind: 'fixed', title: 'Fixes', body: "e621 searches load again, and deep Gelbooru searches end normally instead of showing an error. The AI prompt writer accepts OpenRouter keys, newer OpenAI and Anthropic keys, and OpenRouter's free models. Full sets in the classic builder keep all their tags, copy buttons work in more browsers, and sign-in says when it can't reach the server." },
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
          <span className="hidden tabular-nums text-muted-foreground sm:inline">v{version}</span>
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
              className="relative inline-flex items-center gap-1 rounded-sm font-medium pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-3.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
