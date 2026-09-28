"use client"

/**
 * Guided tour of the Pack Builder. Rendered INSIDE the builder's dialog, not
 * with react-joyride like MainTour: a modal Radix Dialog blocks pointer events
 * and traps focus outside its content, so a tooltip portalled to <body> would
 * be unclickable. Targets are marked with `data-pack-tour="<id>"`; steps whose
 * target isn't on screen (e.g. no category set to Vary) are skipped.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import { ArrowLeft, ArrowRight, Ban, Blocks, Database, Layers, ListChecks, Lock, Package, Shirt, Shuffle, SlidersHorizontal, UserRound, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const PACK_TOUR_STORAGE_KEY = "pack_builder_tour_done"

interface TourStep {
  /** `data-pack-tour` value to spotlight; omitted = centered card. */
  target?: string
  icon: ReactNode
  title: string
  body: ReactNode
  /** Wider card, for steps carrying an illustration. */
  wide?: boolean
  /** Readies the UI for this step (e.g. expands a panel) before it's measured. */
  prepare?: () => void
}

/** Event the tour's anchor category row listens to, to open its subcategory list. */
export const PACK_TOUR_OPEN_PARTS_EVENT = "pack-tour:open-parts"

/**
 * Opens the anchor row's subcategory list. An idempotent "open" event rather
 * than clicking the toggle: effects can run twice (StrictMode), and two clicks
 * would close it again. It stays open afterwards — that's what was just shown.
 */
function expandParts() {
  window.dispatchEvent(new Event(PACK_TOUR_OPEN_PARTS_EVENT))
}

/** Side-by-side example of the two pool modes. */
function ModeExample() {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
      <div className="rounded-lg border bg-muted/40 p-2.5">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <Shuffle className="w-3 h-3" /> Loose tags
        </div>
        <p className="mt-1 text-muted-foreground leading-snug">Single tags mixed from different posts.</p>
        <p className="mt-1.5 font-mono text-foreground leading-snug">red beret, denim jacket, sneakers</p>
        <p className="mt-1.5 text-muted-foreground">More variety, may clash.</p>
      </div>
      <div className="rounded-lg border bg-muted/40 p-2.5">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <Package className="w-3 h-3" /> Full sets
        </div>
        <p className="mt-1 text-muted-foreground leading-snug">One post&apos;s whole outfit, kept together.</p>
        <p className="mt-1.5 font-mono text-foreground leading-snug">witch hat, black dress, boots</p>
        <p className="mt-1.5 text-muted-foreground">Always coherent.</p>
      </div>
    </div>
  )
}

/** The whole idea in one picture: same base, different variations. */
function PackExample() {
  const rows = [
    ["school uniform", "sitting", "classroom"],
    ["kimono", "waving", "shrine"],
    ["swimsuit", "running", "beach"],
  ]
  return (
    <div className="mt-3 rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
      <div className="flex items-center gap-1.5 text-[10px] font-sans font-semibold uppercase tracking-wider text-muted-foreground">
        <Lock className="w-3 h-3" /> Kept from the base
      </div>
      <div className="text-muted-foreground">1girl, hatsune miku, long hair, twintails</div>
      <div className="mt-2 flex items-center gap-1.5 text-[10px] font-sans font-semibold uppercase tracking-wider text-muted-foreground">
        <Shuffle className="w-3 h-3" /> Varied on each prompt
      </div>
      {rows.map((row, i) => (
        <div key={i} className="truncate">
          <span className="text-muted-foreground/70">{String(i + 1).padStart(2, "0")} … </span>
          {row.map((tag, j) => (
            <span key={tag}>
              <span className="font-semibold text-foreground">{tag}</span>
              {j < row.length - 1 && <span className="text-muted-foreground">, </span>}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function RoleLine({ icon, name, text }: { icon: ReactNode; name: string; text: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground [&_svg]:w-3.5 [&_svg]:h-3.5">{icon}</span>
      <span>
        <span className="font-semibold text-foreground">{name}</span> — {text}
      </span>
    </li>
  )
}

const STEPS: TourStep[] = [
  {
    icon: <Package />,
    title: "What's a pack?",
    body: (
      <>
        Many prompts for the <span className="font-medium text-foreground">same character</span>: the base stays, everything else changes from prompt to prompt.
        <PackExample />
      </>
    ),
  },
  {
    target: "base",
    icon: <UserRound />,
    title: "Your base",
    body: "The card or prompt you started from. Its tags are sorted into the categories below, where you can remove any you don't want. “Always add” goes into every prompt (LoRA triggers, quality tags).",
  },
  {
    target: "source",
    icon: <Database />,
    title: "Where variations come from",
    body: "New tags are sampled from real posts of this source. Collected posts are saved, so next time it opens instantly and keeps growing. Click the source to change it.",
  },
  {
    target: "category-role",
    icon: <Layers />,
    title: "One choice per category",
    body: (
      <ul className="space-y-1.5">
        <RoleLine icon={<Lock />} name="Keep" text="the base's tags stay in every prompt." />
        <RoleLine icon={<Shuffle />} name="Vary" text="different tags are picked for each prompt." />
        <RoleLine icon={<Ban />} name="Off" text="the category is left out entirely." />
      </ul>
    ),
  },
  {
    target: "category-parts",
    prepare: expandParts,
    icon: <Blocks />,
    title: "Each part can go its own way",
    body: (
      <>
        Every category is split into parts — Clothing into outfit, top, headwear, footwear… Click one to pick its role:
        <ul className="mt-2 space-y-1.5">
          <RoleLine icon={<Lock />} name="Keep from base" text="your base's tags for that part stay." />
          <RoleLine icon={<Shuffle />} name="Vary" text="it changes with the rest of the category." />
          <RoleLine icon={<Ban />} name="Leave out" text="nothing from that part appears." />
        </ul>
        <p className="mt-2">
          Example: Clothing on Vary but <span className="font-medium text-foreground">headwear on Keep</span> — the outfit changes, the hat stays. “2 base · 15 pool” counts the part&apos;s tags on your base and in the pool.
        </p>
      </>
    ),
  },
  {
    target: "category-mode",
    wide: true,
    icon: <Shirt />,
    title: "Loose tags or full sets?",
    body: (
      <>
        How the pool is built from the collected posts:
        <ModeExample />
        <p className="mt-2">With full sets, “per prompt” counts whole sets instead of tags.</p>
      </>
    ),
  },
  {
    target: "category-pool",
    icon: <ListChecks />,
    title: "The pool",
    body: "Every candidate for this category, grouped by part. × removes one, the box below adds your own, and Re-sample rebuilds it from the collected posts. “Tags per prompt” (top of the row) sets how many are picked each time.",
  },
  {
    target: "batch",
    icon: <SlidersHorizontal />,
    title: "Shape the batch",
    body: "How many prompts, how wild the mix gets (Variety), and an optional minimum of tags per prompt. Then Generate.",
  },
  {
    target: "results",
    icon: <Shuffle />,
    title: "Copy what you like",
    body: "Bold tags are the varied ones. Re-roll a single prompt with the dice, copy one, or Copy all. Replay this tour anytime from “How it works”.",
  },
]

const CARD_WIDTH = 344
/** The centered intro card holds the example pack, so it gets more room. */
const WELCOME_WIDTH = 420
const GAP = 12
const PAD = 6

interface Rect { top: number; left: number; width: number; height: number }

/** `data-pack-tour` targets currently present in `container` — call when starting the tour. */
export function findPackTourTargets(container: HTMLElement | null): string[] {
  if (!container) return []
  return STEPS.flatMap((s) => (s.target && container.querySelector(`[data-pack-tour="${s.target}"]`) ? [s.target] : []))
}

export interface PackBuilderTourProps {
  /** The dialog content element the tour is laid out in. */
  containerRef: RefObject<HTMLElement | null>
  /** Targets present when the tour started (findPackTourTargets); other steps are skipped. */
  availableTargets: string[]
  onClose: () => void
}

export function PackBuilderTour({ containerRef, availableTargets, onClose }: PackBuilderTourProps) {
  const steps = useMemo(
    () => STEPS.filter((s) => !s.target || availableTargets.includes(s.target)),
    [availableTargets]
  )
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [box, setBox] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [cardHeight, setCardHeight] = useState(220)
  const cardRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const step = steps[index]
  const isLast = index === steps.length - 1

  const measure = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const c = container.getBoundingClientRect()
    setBox({ width: c.width, height: c.height })
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight)
    const el = step?.target ? container.querySelector<HTMLElement>(`[data-pack-tour="${step.target}"]`) : null
    if (!el) {
      setRect(null)
      return
    }
    const r = el.getBoundingClientRect()
    // Clip to the container so a tall target (a long list) doesn't spill out.
    const top = Math.max(r.top, c.top) - c.top
    const bottom = Math.min(r.bottom, c.bottom) - c.top
    setRect({ top: top - PAD, left: r.left - c.left - PAD, width: r.width + PAD * 2, height: Math.max(0, bottom - top) + PAD * 2 })
  }, [containerRef, step])

  // Ready the UI for the step, bring the target into view, then measure
  // (again shortly after, once expansions and smooth scrolling settle).
  useLayoutEffect(() => {
    const container = containerRef.current
    step?.prepare?.()
    const el = step?.target ? container?.querySelector<HTMLElement>(`[data-pack-tour="${step.target}"]`) : null
    el?.scrollIntoView({ block: "nearest", inline: "nearest" })
    measure()
    const timers = [setTimeout(measure, 120), setTimeout(measure, 350)]
    return () => timers.forEach(clearTimeout)
  }, [step, containerRef, measure])

  useEffect(() => {
    const container = containerRef.current
    window.addEventListener("resize", measure)
    container?.addEventListener("scroll", measure, true)
    return () => {
      window.removeEventListener("resize", measure)
      container?.removeEventListener("scroll", measure, true)
    }
  }, [containerRef, measure])

  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true })
  }, [index])

  const next = useCallback(() => (isLast ? onClose() : setIndex((i) => i + 1)), [isLast, onClose])
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // Capture phase on window runs before Radix's document listener, so Escape
  // closes the tour instead of the builder (whose Escape exits Pack Mode).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopImmediatePropagation()
        onClose()
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        next()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [next, back, onClose])

  // Card placement: below the target, else above, else beside it (tall
  // targets like the results column), else overlapping its bottom edge.
  const cardStyle = useMemo(() => {
    if (!rect) {
      const width = Math.min(WELCOME_WIDTH, box.width - GAP * 2)
      return { width, left: (box.width - width) / 2, top: Math.max(GAP, (box.height - cardHeight) / 2) }
    }
    const width = Math.min(step?.wide ? WELCOME_WIDTH : CARD_WIDTH, box.width - GAP * 2)
    const clampTop = (t: number) => Math.min(Math.max(GAP, t), box.height - cardHeight - GAP)
    const centeredLeft = Math.min(Math.max(GAP, rect.left + rect.width / 2 - width / 2), box.width - width - GAP)
    const below = rect.top + rect.height + GAP
    if (below + cardHeight <= box.height - GAP) return { width, left: centeredLeft, top: below }
    const above = rect.top - GAP - cardHeight
    if (above >= GAP) return { width, left: centeredLeft, top: above }
    const sideTop = clampTop(rect.top + rect.height / 2 - cardHeight / 2)
    if (rect.left - GAP - width >= GAP) return { width, left: rect.left - GAP - width, top: sideTop }
    if (rect.left + rect.width + GAP + width <= box.width - GAP) return { width, left: rect.left + rect.width + GAP, top: sideTop }
    return { width, left: centeredLeft, top: clampTop(rect.top + rect.height - cardHeight - GAP) }
  }, [rect, box, cardHeight, step])

  if (!step) return null

  return (
    <div className="absolute inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Pack Builder tour">
      {/* Dim everything; the spotlight is a transparent box with a huge shadow. */}
      {rect ? (
        <div
          aria-hidden
          className="absolute rounded-xl ring-2 ring-mode-pack transition-all duration-300 ease-out motion-reduce:transition-none pointer-events-none"
          style={{ ...rect, boxShadow: "0 0 0 9999px color-mix(in oklab, var(--overlay) 55%, transparent)" }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0" style={{ background: "color-mix(in oklab, var(--overlay) 55%, transparent)" }} />
      )}

      <div
        ref={cardRef}
        className="absolute rounded-xl border bg-popover text-popover-foreground shadow-xl p-4 transition-[top,left] duration-300 ease-out motion-reduce:transition-none"
        style={cardStyle}
      >
        <div className="flex items-start gap-2.5">
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-mode-pack-soft text-mode-pack-text [&_svg]:h-4 [&_svg]:w-4">
            {step.icon}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h3 className="text-[15px] font-semibold leading-tight text-foreground">{step.title}</h3>
            <div className="mt-1 text-sm leading-snug text-muted-foreground text-pretty">{step.body}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tour"
            className="-mr-1.5 -mt-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          {index === 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={onClose} className="h-8 px-2.5 text-xs text-muted-foreground">
              I know how it works
            </Button>
          ) : (
            <div className="flex items-center gap-1" aria-label={`Step ${index + 1} of ${steps.length}`}>
              {steps.map((_, i) => (
                <span key={i} className={cn("h-1.5 rounded-full transition-all", i === index ? "w-4 bg-mode-pack" : "w-1.5 bg-muted-foreground/30")} />
              ))}
            </div>
          )}
          <div className="flex items-center gap-1">
            {index > 0 && (
              <Button type="button" variant="ghost" size="icon" onClick={back} aria-label="Previous step" className="h-8 w-8 text-muted-foreground">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <Button
              ref={primaryRef}
              type="button"
              size="sm"
              onClick={next}
              className="h-8 gap-1 px-3 text-xs font-semibold bg-mode-pack hover:bg-mode-pack/90 text-mode-pack-foreground"
            >
              {index === 0 ? "Show me" : isLast ? "Got it" : "Next"}
              {!isLast && <ArrowRight className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
