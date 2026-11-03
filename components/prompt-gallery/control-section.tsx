"use client"

import type React from "react"
import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

const loadDrawer = () => import("@/components/prompt-gallery/control-section-drawer")
const ControlSectionDrawer = lazy(() => loadDrawer().then((m) => ({ default: m.ControlSectionDrawer })))

interface ControlSectionProps {
  title: string
  /** One-line summary of the current state, shown under the title so the
   *  section is readable while collapsed (e.g. "Min. 5 tags · 2 blacklisted"). */
  summary: string
  icon: React.ReactNode
  /** Tints the icon tile with the accent color — reserved for the section
   *  that shapes the prompt output, so the two sections read differently. */
  accent?: boolean
  /**
   * Desktop dropdown spans the nearest positioned ancestor (the panel's
   * two-column grid, which must be `relative`) instead of just this header —
   * room for a two-column layout so long content needs no inner scroll.
   */
  wide?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Shown in the footer only when set; clears this section's options. */
  onReset?: () => void
  resetLabel?: string
  children: React.ReactNode
  /** Called when the header is hovered, focused or pressed: a chance to fetch
   *  the section's code before it opens. */
  onIntent?: () => void
  "data-tour"?: string
}

/** Layers opened from inside the dropdown (dialogs, selects, menus, popovers)
 *  are portaled to <body>; clicks there must not count as "outside". */
const PORTALED_LAYER_SELECTOR =
  "[role='dialog'], [role='alertdialog'], [role='listbox'], [role='menu'], [data-radix-popper-content-wrapper]"

/**
 * One of the two option groups of the main control panel ("Search filters" /
 * "Customize prompt"). Closed by default so a first visit sees only the
 * search row; the summary line keeps what's active visible anyway.
 *
 * Desktop: a dropdown panel absolutely positioned under (or, when it doesn't
 * fit below, above) the header, IN the
 * page flow (not portaled / position:fixed) — it floats over the results
 * without resizing the control panel, scrolls natively with the page (no
 * scroll-listener repositioning, so no jitter) and can be as tall as its
 * content. Outside click / Escape close it.
 * Mobile: the header opens a bottom drawer instead (Vaul — drag down to
 * dismiss), so the "Done" button stays within thumb reach.
 */
export function ControlSection({
  title,
  summary,
  icon,
  accent,
  wide,
  open,
  onOpenChange,
  onReset,
  resetLabel,
  children,
  onIntent,
  "data-tour": dataTour,
}: ControlSectionProps) {
  const isMobile = useIsMobile()
  // The drawer mounts on first open and then stays, so it can animate closed.
  const [drawerMounted, setDrawerMounted] = useState(false)
  if (isMobile && open && !drawerMounted) setDrawerMounted(true)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // The open panel's element, set once it has rendered with its content.
  // Section content may be code-split: the panel (inside a Suspense
  // boundary) only renders once that code has loaded, and it is measured then.
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null)
  const attachPanel = useCallback((el: HTMLDivElement | null) => {
    panelRef.current = el
    setPanelEl(el)
  }, [])
  const panelId = useId()
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom")

  // Desktop placement: drop down when the panel fits below its anchor, open
  // upward only when it fits above in full. When it fits neither way it drops
  // down and the page scrolls just enough to show it — opening upward there
  // would push its top off screen. Measured before paint on open and on
  // window resize only — never while scrolling, so the panel doesn't flip
  // (or jitter) under the user's cursor mid-scroll.
  useLayoutEffect(() => {
    if (!panelEl) return
    const measure = (revealOverflow: boolean) => {
      const panel = panelEl
      // The anchor is the panel's containing block: this card, or the whole
      // two-column grid for `wide` sections.
      const anchor = panel?.offsetParent
      if (!panel || !anchor) return
      const gap = 8
      const rect = anchor.getBoundingClientRect()
      const height = panel.offsetHeight
      const spaceBelow = window.innerHeight - rect.bottom - gap
      const spaceAbove = rect.top - gap
      const fitsBelow = height <= spaceBelow
      setPlacement(fitsBelow || height > spaceAbove ? "bottom" : "top")
      if (revealOverflow && !fitsBelow && height > spaceAbove) {
        // Scroll the panel's bottom into view, but never past the anchor's top.
        const overflow = Math.min(height - spaceBelow + gap, rect.top - gap)
        if (overflow > 0) {
          const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches
          window.scrollBy({ top: overflow, behavior: smooth ? "smooth" : "auto" })
        }
      }
    }
    measure(true)
    const onResize = () => measure(false)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [panelEl])

  // Desktop dismissal: outside pointerdown and Escape. Skipped while a layer
  // opened from inside (e.g. the Tag rules dialog) is on screen — that layer
  // handles its own dismissal first.
  useEffect(() => {
    if (!open || isMobile) return
    const hasOpenLayer = () => document.querySelector(PORTALED_LAYER_SELECTOR) !== null
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (!target) return
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      if (target.closest(PORTALED_LAYER_SELECTOR) || hasOpenLayer()) return
      onOpenChange(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || hasOpenLayer()) return
      onOpenChange(false)
    }
    // Escape is checked on window in the capture phase — before Radix's own
    // document-level Escape handler closes a nested dialog — so an Escape
    // meant for that dialog still sees it open and leaves the dropdown alone.
    document.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("keydown", onKeyDown, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("keydown", onKeyDown, true)
    }
  }, [open, isMobile, onOpenChange])

  const handleIntent = () => {
    onIntent?.()
    if (isMobile) void loadDrawer()
  }

  const header = (
    <button
      type="button"
      onClick={() => onOpenChange(!open)}
      onPointerEnter={handleIntent}
      onPointerDown={handleIntent}
      onFocus={handleIntent}
      aria-expanded={isMobile ? undefined : open}
      aria-controls={isMobile ? undefined : panelId}
      aria-haspopup={isMobile ? "dialog" : undefined}
      className="flex w-full min-h-[60px] items-center gap-3 px-4 py-3 text-left rounded-xl transition-[background-color,transform] duration-150 ease-out active:scale-[0.99] motion-reduce:active:scale-100 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&>svg]:h-[18px] [&>svg]:w-[18px]",
          accent ? "bg-primary/15 text-primary-text" : "bg-muted text-foreground/80"
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{summary}</span>
      </span>
      {isMobile ? (
        <ChevronRight className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
      ) : (
        <ChevronDown
          className={cn("h-[18px] w-[18px] shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")}
        />
      )}
    </button>
  )

  if (isMobile) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/20" data-tour={dataTour}>
        {header}
        {/* Opens once the drawer and the section's content have loaded, so it
            never slides up empty. */}
        <Suspense fallback={null}>
          {drawerMounted && (
            <ControlSectionDrawer
              title={title}
              summary={summary}
              open={open}
              onOpenChange={onOpenChange}
              onReset={onReset}
              resetLabel={resetLabel}
            >
              {children}
            </ControlSectionDrawer>
          )}
        </Suspense>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        "rounded-xl border bg-muted/20 transition-colors",
        // Non-wide: the dropdown is positioned against this card.
        !wide && "relative",
        open ? "border-primary/40 bg-muted/40" : "border-border/60"
      )}
      data-tour={dataTour}
    >
      {header}
      {/* Shown once the section's content has loaded, so it never opens empty. */}
      <Suspense fallback={null}>
        {open && (
          <div
            ref={attachPanel}
            id={panelId}
            role="region"
            aria-label={title}
            data-side={placement}
            style={placement === "bottom" ? { top: "calc(100% + 8px)" } : { bottom: "calc(100% + 8px)" }}
            className={cn(
              // Grows out of the header it hangs from; closing snaps (unmount).
              "absolute inset-x-0 z-40 rounded-xl border bg-popover px-4 pb-3 pt-4 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-98 duration-150 ease-out-strong",
              placement === "bottom" ? "origin-top slide-in-from-top-1" : "origin-bottom slide-in-from-bottom-1"
            )}
          >
            {children}
            {onReset && (
              <div className="mt-2 flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={onReset} className="text-xs text-muted-foreground hover:text-foreground">
                  {resetLabel ?? "Reset"}
                </Button>
              </div>
            )}
          </div>
        )}
      </Suspense>
    </div>
  )
}
