"use client"

/**
 * The pack builder made of the brief: Who, Wearing, Doing, Where, Also and Never, the
 * scenes that fit on a contact sheet, a line on how well they fit, Generate, and the
 * prompts. It owns the pack's whole state (usePackBrief), its source (usePackSources),
 * the characters' looks and the engine (usePackBriefScenes); the gallery only gives
 * it the environment (taxonomy, booru, search, exit) and the characters it starts with; it
 * reads and edits the app's prompt settings itself (usePackPromptSettings, "Customize prompt").
 *
 * A full screen of its own: while it is open the gallery is hidden behind it and does no work
 * (PromptGallery), and focus stays inside until it closes. Before generating it shows the brief,
 * the sheet, the fit line and Generate; after, the prompts, with the brief folded into one line
 * that opens it again.
 */
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"
import { AlertTriangle, ChevronDown, Info, Package, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TooltipProvider } from "@/components/ui/tooltip"
import { toast } from "@/hooks/use-toast"
import { usePackBrief, type UsePackBriefResult } from "@/hooks/use-pack-brief"
import { usePackBriefScenes } from "@/hooks/use-pack-brief-scenes"
import { usePackSources, type UsePackSourcesResult } from "@/hooks/use-pack-sources"
import { useTagSuggestions } from "@/hooks/use-tag-suggestions"
import { useIsMobile } from "@/hooks/use-mobile"
import { useStableCallback } from "@/hooks/use-stable-callback"
import { usePackComfySend, type PackSendRow } from "@/hooks/use-pack-comfy-send"
import { packSendRequest } from "@/lib/pack/pack-comfy-send"
import { useNaturalPrompt, usePromptFormat } from "@/hooks/use-natural-prompt"
import { useTagSlotEnrichment } from "@/hooks/use-tag-slot-enrichment"
import { usePackPromptSettings } from "@/hooks/use-pack-prompt-settings"
import { PackPromptOptions } from "./prompt-options"
import { packPromptFormat } from "@/lib/pack/pack-config-migration"
import { storedPackRating, withPackRating } from "@/lib/pack/pack-rating"
import { safeTrack, track } from "@/lib/analytics"
import { recordPromptCopy } from "@/lib/support-prompt"
import { copyText } from "@/lib/clipboard"
import type { PackRatingMode } from "@/hooks/use-pack-seed-search"
import type { ComfySent } from "../comfyui-send"
import type { BooruPost, BooruProvider } from "@/lib/booru/types"
import {
  addLook as addLookInBrief,
  addNever,
  addOther as addOtherInBrief,
  addTagExactly,
  canBeCondition,
  briefCompositions,
  briefFromPrompt,
  briefTagName,
  routeTag,
  typedRole,
  briefRole,
  type SuggestedKind,
  setPeople as setPeopleInBrief,
  castTurns,
  addCast,
  emptyBrief,
  type CastMember,
  type PackBrief,
} from "@/lib/pack/brief"
import { readWeightedTag } from "@/lib/weight-utils"
import { DEFAULT_ROWS, briefFromCharacters, rowDefaults, rowMatchesDefaults, type DefaultRow } from "@/lib/pack/brief-history"
import type { CastRole } from "@/lib/pack/scene/cast"
import type { Permanence } from "@/lib/pack/scene/permanence"
import type { PackPeople } from "@/lib/pack/scene/scene-pool"
import { getTagSlotFromOverrides } from "@/lib/tag-taxonomy"
import { normalizeTagForPack } from "@/lib/pack/pack-generator"
import { splitTags } from "@/lib/utils/tag-utils"
import {
  axisRequests,
  BRIEF_EXAMPLES,
  briefAsksNothing,
  briefWithExample,
  briefFromCardPost,
  correctionAfterBriefChange,
  briefFromSearch,
  castPeopleNote,
  keptRows,
  lookOwner,
  changedRows,
  oneAxis,
  issuesFit,
  packProviderChoices,
  packCopyText,
  promptSize,
  withWaiting,
  loadedState,
  lockedWithTag,
  peopleFromCountTags,
  pickedPeopleNote,
  predictFit,
  mergeFitNotes,
  withPromptPeople,
  withSearchProgress,
  preferredPostIds,
  promptTokens,
  shortConditionRoles,
  menuOutfit,
  NEW_PACK_OUTFIT,
  shownOutfit,
  type BriefOutfit,
  type ConditionSupply,
  type FitNote,
} from "@/lib/pack/brief-pack"
import type { PackPrompt } from "@/lib/pack/pack-generator"
import { preferredSearchIds, type SourcePlan } from "@/lib/pack/source-plan"
import type { OutfitStyle } from "@/lib/outfit-swap"
import type { NaturalPromptSource } from "@/lib/prompt/natural-format"
import { convertPromptOnce, preloadNaturalPrompt } from "@/lib/prompt/natural-prompt-loader"
import { PROMPT_FORMATS, PROMPT_FORMAT_INFO, type PromptFormat } from "@/lib/prompt/prompt-format"
import { cn } from "@/lib/utils"
import { PROVIDERS, PROVIDER_LABELS } from "../provider-select"
import { getProviderTagLimit } from "@/lib/booru/tag-limits"
import { SearchDetails } from "./search-details"
import { savedResultOf, type SavedPack } from "@/lib/pack/saved-pack"
import { BUILDER_SWITCH_TEXT } from "./builder-switch"
import type { EntryOption } from "./tag-entry"
import { BriefSummary } from "./brief-summary"
import type { Choice } from "./choice-group"
import { ContactSheet, type ContactSheetStatus, type SceneThumb } from "./contact-sheet"
import { scenePostHref, sceneThumbs } from "./scene-tile"
import { FitLine } from "./fit-line"
import { GenerateBar, ResultsToolbar } from "./generate-bar"
import { PackBriefPanel } from "./pack-brief-panel"
import { BLOCKED, BUILDER_TEXT, CAST_MODE_TEXT, RANDOM_CAST_TEXT, CHANGES_OPTIONS, COPY_FAILED, EXAMPLES_HEADING, EXAMPLE_TEXT, TIP_TEXT, fitText, CORRECTION_TEXT, SHEET_TEXT, copyNoteText, DEFAULTS_TEXT, SIZE_TEXT, STYLE_TEXT, PEOPLE_TEXT, COMPOSITION_TEXT, RATING_OPTIONS, START_TEXT, missingText, type FitState } from "./pack-text"
import type { BriefPackResult } from "@/hooks/use-pack-brief-scenes"
import type { BriefOffer } from "./pack-brief-panel"
import { ResultRow } from "./result-row"
import { SLOTS, briefSummaryParts, characterName, companionsLabel, showTag, type CharacterInfo, type SlotId, type TagSuggestion } from "./slots"
import { UndoNotice } from "./undo-notice"
import { useCharacterIndex } from "./cast-picker"
import { castBrief, drawKey, drawRandomCast, drawsCast, needsRedraw, randomCastGender, redrawUsable } from "@/lib/pack/random-cast"
import { PackEmptyState, type ExampleBrief } from "./pack-empty-state"
import { PackTip } from "./pack-tip"
import { userPreferences } from "@/lib/storage"

/** Where a pack starts from: each way into Pack Mode. */
export type PackBriefStart =
  /** The pack kept across a reload (lib/pack/saved-pack.ts). */
  | { kind: "restored"; saved: SavedPack }
  /** `cast`: several characters picked at once (lib/pack/brief.ts addCast), each with their gender; the pack is one per prompt. */
  | { kind: "characters"; names: readonly string[]; cast?: readonly CastMember[] }
  | { kind: "card"; post: BooruPost }
  | { kind: "prompt"; text: string }
  | { kind: "search"; search: string; character: string | null }

/** A correction from the results: what it was, and the pack as it was before, for Undo. */
interface Correction {
  id: number
  kind: "always" | "never"
  tag: string
  snapshot: BriefPackResult
  format: PromptFormat
  /** The brief before the correction, and right after it (null until it lands). */
  briefBefore: PackBrief
  briefAfter: PackBrief | null
  /** waiting: the brief has the change, the remake hasn't started; running; done (Undo offered). */
  status: "waiting" | "running" | "done"
  message: string | null
}

/** What a start brought to the brief, for the note under the header. */
type StartNote =
  | { kind: "restored"; dropped: boolean }
  | { kind: "characters" }
  | { kind: "card"; named: boolean; outfit: string[]; pose: string[] }
  | { kind: "prompt" }
  | { kind: "search"; skipped: string[] }

export interface PackBriefBuilderProps {
  /** Where the pack starts. A new start needs a new `key` on the builder. */
  start: PackBriefStart
  /** Shown; while hidden the pack stays as it is. */
  open: boolean
  /** Opens the entry dialog for another pack; this one stays if the user cancels. */
  onNewPack: () => void
  /** The app's tag slots. The builder looks up the ones they don't cover itself, and keeps them. */
  tagOverrides: Record<string, string>
  provider: BooruProvider
  /**
   * The rating a pack starts with when none is saved. The builder keeps its own and saves it in the
   * preference it shares with the classic builder; `onRatingChange` only hears about it.
   */
  initialRating: PackRatingMode
  onRatingChange?: (rating: PackRatingMode) => void
  /** The gallery's search, for a brief without a named character. */
  gallerySearch: string
  onExit: () => void
  /** Opens the pack's card or character in the classic builder. */
  onOpenClassic?: () => void
}

/**
 * The brief a start makes, and what to say about it. Pure: nothing is written while rendering.
 * `permanence`: the permanence data, to make it again once it has loaded (usePackBrief placeWith).
 */
function begin(
  start: PackBriefStart,
  overrides: Record<string, string>,
  permanence?: (tag: string) => Permanence,
): { brief: PackBrief; note: StartNote } {
  switch (start.kind) {
    case "restored":
      return { brief: start.saved.brief, note: { kind: "restored", dropped: !!start.saved.resultsDropped } }
    case "characters":
      return { brief: start.cast ? addCast(emptyBrief(), start.cast) : briefFromCharacters([...start.names]), note: { kind: "characters" } }
    case "card": {
      // The card's characters come from the post's own character field, known to the taxonomy or not.
      const characters = splitTags(start.post.tag_string_character ?? "")
      const tags = splitTags(`${start.post.tag_string ?? ""} ${start.post.tag_string_character ?? ""}`)
      const { brief, offered } = briefFromCardPost(tags, characters, overrides, permanence)
      return { brief, note: { kind: "card", named: characters.length > 0, outfit: offered.outfit, pose: offered.pose } }
    }
    case "prompt": {
      const { brief, peopleTags } = briefFromPrompt(start.text, overrides, permanence)
      return { brief: withPromptPeople(brief, peopleTags), note: { kind: "prompt" } }
    }
    case "search": {
      const { brief, skipped } = briefFromSearch(start.search, overrides, start.character, permanence)
      return { brief, note: { kind: "search", skipped } }
    }
  }
}

/**
 * Shell: the screen and its header, a modal dialog over the whole app. Closed, it stays mounted
 * (the pack and its posts wait here) but inert: not shown, not focusable, and the environment it
 * works from is held as it was when it closed, so nothing is fetched, timed or worked out until
 * it opens again.
 */
export const PackBriefBuilder = memo(function PackBriefBuilder(props: PackBriefBuilderProps) {
  const { start, open, tagOverrides, onExit, onNewPack, onOpenClassic } = props
  // The slots of tags the app's don't cover, looked up for this pack and kept here: the lookups
  // that every page of posts brings re-render the pack, never the gallery behind it.
  const slots = useTagSlotEnrichment(tagOverrides)
  const overrides = slots.overrides
  const [begun] = useState(() => ({
    ...begin(start, tagOverrides),
    // The same start with the permanence data: the brief above may be made before it loads.
    remake: (permanence: (tag: string) => Permanence) => begin(start, tagOverrides, permanence).brief,
  }))
  const pack = usePackBrief(overrides, begun.brief, { seeded: start.kind === "restored", remake: begun.remake })
  // The environment while open; held while closed.
  // The pack keeps the booru and gallery search it was started with, open or closed; only
  // "New pack" takes the gallery's current ones. Its own controls (site, rating) stay live:
  // another site is another source, like another rating.
  const [startSource, setStartSource] = useState(() => start.kind === "restored"
    ? { provider: start.saved.provider, gallerySearch: start.saved.gallerySearch }
    : { provider: props.provider, gallerySearch: props.gallerySearch })
  const onProviderChange = useCallback((provider: BooruProvider) => setStartSource((s) => ({ ...s, provider })), [])
  // The rating is the pack's own, like its site: saved in the preference the classic builder
  // reads, never set in the gallery while the pack is open.
  const [rating, setRating] = useState<PackRatingMode>(() => {
    try {
      return storedPackRating(userPreferences.getPackSourceAnswers(), props.initialRating)
    } catch {
      return props.initialRating
    }
  })
  const { onRatingChange } = props
  const changeRating = useCallback((next: PackRatingMode) => {
    setRating(next)
    try {
      userPreferences.setPackSourceAnswers(withPackRating(userPreferences.getPackSourceAnswers(), next, {
        ratingMode: next, tagsSource: "current", searchTags: startSource.gallerySearch, booruProvider: startSource.provider,
      }))
    } catch {
      // Storage unavailable: the choice lasts this pack.
    }
    onRatingChange?.(next)
  }, [onRatingChange, startSource])
  // While closed, the rest of the environment is held as it was when it closed.
  const [held, setHeld] = useState<PackBriefBuilderProps | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    setHeld(open ? null : props)
  }
  const env = { ...(open || !held ? props : held), ...startSource, onProviderChange, overrides, enrichTagSlots: slots.enrich, rating }

  // Focus goes into the screen when it opens and back where it was when it closes. The element
  // that opened it is read before the gallery is hidden (a layout effect runs before the browser
  // moves focus off hidden elements); an item of a menu or a dialog that goes away with it hands
  // over to the control that opened that menu or dialog (a card's "More actions").
  const headingRef = useRef<HTMLHeadingElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const returnRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const handingOverRef = useRef(false)
  const openClassic = useCallback(() => {
    handingOverRef.current = true
    onOpenClassic?.()
  }, [onOpenClassic])
  // While closed: the last control used in the page, read as it gets focus (a menu item is then
  // still in its open menu, and resolves to the menu's trigger).
  const lastOutsideRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (open) return
    const onFocusIn = (e: FocusEvent) => {
      lastOutsideRef.current = returnTargetOf(e.target instanceof Element ? e.target : null)
    }
    document.addEventListener("focusin", onFocusIn)
    return () => document.removeEventListener("focusin", onFocusIn)
  }, [open])
  useLayoutEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = open
    if (open) {
      if (wasOpen) return
      const active = returnTargetOf(document.activeElement)
      const last = lastOutsideRef.current
      // An opener inside a menu or dialog that is closing gives way to the control read before.
      returnRef.current = active && !active.closest("[role='menu'], [role='dialog'], [role='alertdialog']") ? active : last ?? active
      return
    }
    if (!wasOpen) return
    // Another builder or dialog took over (the classic builder): it places focus itself, and focus
    // moved into the page behind it would leave it there.
    const handedOver = handingOverRef.current
    handingOverRef.current = false
    if (handedOver || otherModalOpen(screenRef.current)) return
    // Without scrolling: the gallery puts its own scroll back right after this (PromptGallery).
    const back = returnRef.current
    returnRef.current = null
    if (back && isFocusable(back)) back.focus({ preventScroll: true })
    else document.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Mode"] [data-mode="pack"]')?.focus({ preventScroll: true })
  }, [open])
  useEffect(() => {
    if (open) headingRef.current?.focus({ preventScroll: true })
  }, [open])
  // Tab and Shift+Tab go round inside the screen: the guards at each end send focus to the other end.
  const focusEdge = useCallback((edge: "first" | "last") => {
    const items = tabbablesIn(screenRef.current)
    const item = edge === "first" ? items[0] : items[items.length - 1]
    ;(item ?? headingRef.current)?.focus({ preventScroll: true })
  }, [])
  const titleId = useId()

  // While open, focus never rests outside the screen and Escape closes it wherever focus is.
  // Focus that leaves for something outside (the page's skip link, the body after a dialog over
  // the pack closes) comes back to the last control used in the screen, or to its title; menus,
  // dialogs over the pack and the notifications keep theirs. Escape is heard on the document,
  // after everything inside: whatever handles it first (a list, a menu, a dialog over the pack)
  // stops it or marks it handled, and the pack stays.
  const lastInsideRef = useRef<HTMLElement | null>(null)
  const onExitRef = useRef(onExit)
  useLayoutEffect(() => {
    onExitRef.current = onExit
  })
  useEffect(() => {
    if (!open) return
    const screen = screenRef.current
    if (!screen) return
    // A control from an earlier opening is not where this one left off: until a control is used,
    // focus comes back to the title.
    lastInsideRef.current = null
    const bringBack = () => {
      const last = lastInsideRef.current
      if (last && screen.contains(last) && isFocusable(last)) last.focus({ preventScroll: true })
      else headingRef.current?.focus({ preventScroll: true })
    }
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target && screen.contains(target)) {
        if (!target.hasAttribute("data-focus-guard")) lastInsideRef.current = target
        return
      }
      if (!focusAllowedOutside(target)) bringBack()
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget) return
      // Focus going nowhere (to the body): checked once the move is over.
      clearTimeout(timer)
      timer = setTimeout(() => {
        const active = document.activeElement
        if (!active || active === document.body || !(screen.contains(active) || focusAllowedOutside(active))) bringBack()
      }, 0)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return
      const target = e.target instanceof Element ? e.target : null
      const owner = target?.closest(LAYER)
      if (owner && owner !== screen) return
      onExitRef.current()
    }
    document.addEventListener("focusin", onFocusIn)
    document.addEventListener("focusout", onFocusOut, true)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("focusin", onFocusIn)
      document.removeEventListener("focusout", onFocusOut, true)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  // Shown while open, and for the moment the closing animation takes; inert from the moment it closes.
  const [shown, setShown] = useState(open)
  if (open && !shown) setShown(true)
  useEffect(() => {
    if (open || !shown) return
    const timer = setTimeout(() => setShown(false), EXIT_MS)
    return () => clearTimeout(timer)
  }, [open, shown])
  // A click on the backdrop closes, as Escape does; one that started inside the panel (selecting
  // text and letting go outside) doesn't.
  const pressedBackdropRef = useRef(false)

  return (
    <TooltipProvider delayDuration={300}>
      <div
        data-state={open ? "open" : "closed"}
        className={cn(
          "group/pack fixed inset-0 z-50",
          !open && "pointer-events-none motion-reduce:hidden",
          // Last, so it wins over the rest: closed and done animating is not shown.
          !shown && "hidden",
        )}
      >
        {/* The gallery shows through, dimmed and blurred; on a phone the sheet covers it whole. */}
        <div
          aria-hidden
          onPointerDown={(e) => { pressedBackdropRef.current = e.target === e.currentTarget }}
          onClick={(e) => {
            if (pressedBackdropRef.current && e.target === e.currentTarget) onExit()
            pressedBackdropRef.current = false
          }}
          className={cn(
            "absolute inset-0 bg-overlay/40 backdrop-blur-[6px] dark:bg-overlay/60 max-sm:hidden",
            "group-data-[state=open]/pack:animate-in group-data-[state=open]/pack:fade-in-0 group-data-[state=open]/pack:duration-300",
            "group-data-[state=closed]/pack:animate-out group-data-[state=closed]/pack:fade-out-0 group-data-[state=closed]/pack:duration-150 group-data-[state=closed]/pack:fill-mode-forwards",
            "ease-out-strong motion-reduce:animate-none",
          )}
        />
        <div
          ref={screenRef}
          // A dialog only while open: closed, it stays mounted (inert, then hidden), and the page's
          // checks for an open dialog (the option dropdowns, the release dialog) would find it.
          role={open ? "dialog" : undefined}
          aria-modal={open ? true : undefined}
          aria-labelledby={open ? titleId : undefined}
          inert={!open}
          // A click on an empty part of the panel gives focus to the panel itself, as a dialog does:
          // with nowhere to go, focus would fall to the page and be brought back to the last control,
          // and a list closed by that click (a field's suggestions) would open again.
          tabIndex={-1}
          className={cn(
            "outline-none",
            // Phone: a sheet over the whole screen, clear of the notch and the home indicator.
            "absolute inset-0 flex flex-col overflow-clip bg-background",
            "max-sm:pt-[env(safe-area-inset-top)] max-sm:pl-[env(safe-area-inset-left)] max-sm:pr-[env(safe-area-inset-right)]",
            // Wider: a panel over the app, with the dimmed gallery showing on every side.
            "sm:inset-4 sm:rounded-2xl sm:shadow-2xl sm:ring-1 sm:ring-foreground/10",
            "lg:inset-x-[max(3rem,calc(50vw-39rem))] lg:inset-y-[max(2rem,calc(50dvh-31rem))]",
            "group-data-[state=open]/pack:animate-in group-data-[state=open]/pack:fade-in-0 group-data-[state=open]/pack:slide-in-from-bottom-6 sm:group-data-[state=open]/pack:slide-in-from-bottom-3 sm:group-data-[state=open]/pack:zoom-in-[0.98] group-data-[state=open]/pack:duration-300",
            "group-data-[state=closed]/pack:animate-out group-data-[state=closed]/pack:fade-out-0 group-data-[state=closed]/pack:slide-out-to-bottom-3 sm:group-data-[state=closed]/pack:zoom-out-[0.98] group-data-[state=closed]/pack:duration-150 group-data-[state=closed]/pack:fill-mode-forwards",
            "ease-out-strong motion-reduce:animate-none",
          )}
        >
          <span tabIndex={open ? 0 : -1} aria-hidden="true" data-focus-guard="" className="sr-only" onFocus={() => focusEdge("last")} />
          <PackHeader
            titleId={titleId}
            headingRef={headingRef}
            provider={startSource.provider}
            rating={rating}
            onProviderChange={onProviderChange}
            onRatingChange={changeRating}
            onNewPack={onNewPack}
            onOpenClassic={onOpenClassic ? openClassic : undefined}
            onExit={onExit}
          />
          <BriefWorkspace {...env} open={open} pack={pack} startNote={begun.note} />
          <span tabIndex={open ? 0 : -1} aria-hidden="true" data-focus-guard="" className="sr-only" onFocus={() => focusEdge("first")} />
        </div>
      </div>
    </TooltipProvider>
  )
})

/** Layers over or inside the pack that own their keys and their focus: menus, lists, dialogs, popovers. */
const LAYER = "[role='menu'], [role='listbox'], [role='dialog'], [role='alertdialog'], [data-radix-popper-content-wrapper]"

/** Outside the screen, focus may rest in a layer over it or in the notifications, nowhere else. */
function focusAllowedOutside(el: Element | null): boolean {
  return !!el && el !== document.body && !!el.closest(`${LAYER}, [role='region'][aria-label^='Notifications']`)
}

/** A modal dialog open besides the pack's screen (another builder took over). */
function otherModalOpen(screen: HTMLElement | null): boolean {
  return Array.from(document.querySelectorAll("[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open']")).some((el) => el !== screen)
}

const isFocusable = (el: HTMLElement) => el.isConnected && el !== document.body && !el.closest("[inert]") && el.getClientRects().length > 0

/**
 * Where focus goes back to when the pack closes: the element that opened it, or, when that is an
 * item of a menu or a dialog that closes with it, the control that opened that menu or dialog.
 */
function returnTargetOf(active: Element | null): HTMLElement | null {
  if (!(active instanceof HTMLElement) || active === document.body) return null
  const layer = active.closest<HTMLElement>("[role='menu'], [role='dialog'], [role='alertdialog']")
  if (!layer) return active
  // The trigger names the layer it opens; a menu also names its trigger.
  const byControls = layer.id ? document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(layer.id)}"]`) : null
  const labelledBy = layer.getAttribute("role") === "menu" ? layer.getAttribute("aria-labelledby") : null
  const byLabel = labelledBy ? document.getElementById(labelledBy) : null
  return byControls ?? byLabel ?? active
}

const TABBABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"

/** What Tab can reach inside `root`, in order: shown, not inert, and not the focus guards. */
function tabbablesIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => !el.hasAttribute("data-focus-guard") && !el.closest("[inert]") && el.getClientRects().length > 0
  )
}

/** How long the panel takes to go when it closes (its exit animation). */
const EXIT_MS = 160

/**
 * The panel's header: what it is, where its scenes come from (site and rating, one control), a
 * new pack, the classic builder, and Close. On a phone the title and Close share the first line
 * and the rest wraps below them, so Close is always in view.
 */
const PackHeader = memo(function PackHeader({
  titleId,
  headingRef,
  provider,
  rating,
  onProviderChange,
  onRatingChange,
  onNewPack,
  onOpenClassic,
  onExit,
}: {
  titleId: string
  headingRef: RefObject<HTMLHeadingElement | null>
  provider: BooruProvider
  rating: PackRatingMode
  onProviderChange: (provider: BooruProvider) => void
  onRatingChange: (rating: PackRatingMode) => void
  onNewPack: () => void
  onOpenClassic?: () => void
  onExit: () => void
}) {
  return (
    <header className="flex-shrink-0 border-b border-border/60">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-mode-pack-soft text-mode-pack-text" aria-hidden>
          <Package className="size-[18px]" />
        </span>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-base font-semibold leading-none tracking-[-0.01em] text-foreground focus-visible:outline-none">
          {BUILDER_TEXT.title}
        </h2>
        <div className="order-3 flex w-full min-w-0 flex-wrap items-center gap-1.5 sm:order-none sm:ml-auto sm:w-auto sm:flex-nowrap">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onNewPack}
            title={BUILDER_TEXT.newPackHint}
            className="h-8 px-2.5 text-[13px] text-muted-foreground hover:text-foreground pointer-coarse:h-11"
          >
            {BUILDER_TEXT.newPack}
          </Button>
          {onOpenClassic && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onOpenClassic}
              title={BUILDER_SWITCH_TEXT.classicHint}
              aria-label={BUILDER_SWITCH_TEXT.classic}
              className="h-8 px-2.5 text-[13px] text-muted-foreground hover:text-foreground pointer-coarse:h-11"
            >
              <span className="sm:hidden">{BUILDER_SWITCH_TEXT.classicShort}</span>
              <span className="max-sm:hidden">{BUILDER_SWITCH_TEXT.classic}</span>
            </Button>
          )}
          {/* Where the scenes come from: the site and the rating, read together. */}
          <div className="flex h-8 items-stretch rounded-lg bg-muted/70 p-0.5 pointer-coarse:h-11 pointer-coarse:p-0">
            <ProviderMenu value={provider} rating={rating} onChange={onProviderChange} />
            <span aria-hidden className="my-1.5 w-px bg-border" />
            <RatingMenu value={rating} onChange={onRatingChange} />
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onExit}
          aria-label={BUILDER_TEXT.close}
          title={BUILDER_TEXT.closeHint}
          className="ml-auto size-9 shrink-0 rounded-lg text-muted-foreground hover:text-foreground pointer-coarse:size-11 sm:ml-0"
        >
          <X className="size-[18px]" aria-hidden />
        </Button>
      </div>
    </header>
  )
})

const MENU_TRIGGER = cn(
  "inline-flex max-w-[12rem] items-center gap-1 rounded-md px-2.5 text-[13px] font-medium text-foreground",
  "transition-[background-color,box-shadow] duration-150 ease-out-strong",
  "hover:bg-background/70 data-[state=open]:bg-background data-[state=open]:shadow-sm",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
)

/** The site the scenes come from, as the gallery's menu lists them; changing it is another source for the pack. */
const ProviderMenu = memo(function ProviderMenu({
  value,
  rating,
  onChange,
}: {
  value: BooruProvider
  rating: PackRatingMode
  onChange: (provider: BooruProvider) => void
}) {
  // Whether the gallery's adult-content confirmation was given, read when the menu opens.
  const [adultAcknowledged, setAdultAcknowledged] = useState(false)
  const choices = useMemo(() => packProviderChoices(PROVIDERS, rating, adultAcknowledged), [rating, adultAcknowledged])
  const label = PROVIDER_LABELS[value]
  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(isOpen) => {
        if (isOpen) setAdultAcknowledged(userPreferences.getRule34Acknowledged())
      }}
    >
      <DropdownMenuTrigger aria-label={`${BUILDER_TEXT.providerMenu}: ${label}`} className={MENU_TRIGGER}>
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{BUILDER_TEXT.providerMenu}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as BooruProvider)}>
          {choices.map((c) => {
            const detail = c.reason === "adult-consent" ? BUILDER_TEXT.providerNeedsConsent : c.note === "no-sensitive" ? BUILDER_TEXT.providerNoSensitive : null
            return (
              <DropdownMenuRadioItem
                key={c.provider}
                value={c.provider}
                disabled={!c.available}
                className="flex-col items-start gap-0.5 pointer-coarse:min-h-11"
              >
                <span>{PROVIDER_LABELS[c.provider]}</span>
                {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

const RatingMenu = memo(function RatingMenu({ value, onChange }: { value: PackRatingMode; onChange: (rating: PackRatingMode) => void }) {
  const label = RATING_OPTIONS.find((o) => o.value === value)?.label ?? RATING_OPTIONS[0].label
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger aria-label={`${BUILDER_TEXT.ratingMenu}: ${label}`} className={MENU_TRIGGER}>
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{BUILDER_TEXT.ratingMenu}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as PackRatingMode)}>
          {RATING_OPTIONS.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} className="pointer-coarse:min-h-11">
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

// ── The source ───────────────────────────────────────────────────────────────────

/**
 * Runs the source plan. Mounted only while the plan has something to search:
 * usePackSources fetches page 1 of every search on mount.
 */
function BriefSource({
  plan,
  conditions,
  count,
  onResult,
}: {
  plan: SourcePlan
  /** The conditions' supply (conditionSupply): a donor search pages only while its condition is short. */
  conditions: readonly ConditionSupply[]
  count: number
  onResult: (result: UsePackSourcesResult | null) => void
}) {
  const shortKey = shortConditionRoles(conditions, count).join(",")
  const shortConditions = useMemo(() => (shortKey ? (shortKey.split(",") as Array<"wearing" | "where">) : []), [shortKey])
  const result = usePackSources({ plan, shortConditions })
  useEffect(() => onResult(result), [result, onResult])
  useEffect(() => () => onResult(null), [onResult])
  return null
}

// ── The workspace ────────────────────────────────────────────────────────────────

const FORMATS: Choice<PromptFormat>[] = PROMPT_FORMATS.map((f) => ({ value: f, label: PROMPT_FORMAT_INFO[f].label }))
const NO_POSTS: never[] = []
const NO_IDS: string[] = []
const NO_PROGRESS: never[] = []
const NO_DONORS: number[] = []
const UNDO_MS = 6000
/** Changes to the pack wait this long before it is saved for the next visit. */
const SAVE_DELAY_MS = 600

/** A sentence that ends with its stop, once. */
const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`)

/** A tag of a prompt as the brief spells it: no weight, no brackets ("kashima (kancolle)" keeps its qualifier). */
const bareToken = (token: string) => readWeightedTag(token).tag

/**
 * The slot of the brief a typed tag lands in, by its role (routeTag); null for a people count
 * (it sets People) and "people" for a pairing or focus ("hetero": People sets it, never a tag).
 * A tag about the people who are not the characters (`othersTag`) goes to Others wherever it is
 * typed; typed in Others, a look of anyone and a tag nothing knows stay there.
 */
function landsIn(
  tag: string,
  typedIn: SlotId,
  overrides: Record<string, string>,
  othersTag: (tag: string) => boolean,
  suggested?: SuggestedKind,
): SlotId | "people" | null {
  const route = routeTag(tag, overrides)
  if (route.kind === "people") return null
  if (route.kind === "composition") return "people"
  if (typedIn === "never") return "never"
  if (route.kind === "character") return "who"
  if (othersTag(tag)) return "others"
  if (typedIn === "others" && (route.kind === "look" || briefRole(tag, overrides).kind === "aspect")) return "others"
  if (route.kind === "look") return "who"
  if (route.kind === "request") return route.role
  if (typedIn === "others") return briefRole(tag, overrides).kind === "unknown" ? "others" : "style"
  return typedRole(tag, typedIn, overrides, suggested) ?? "style"
}

/** What an autocomplete suggestion said a tag is (slotSuggestions' kind); none for a typed tag. */
function suggestedKind(picked?: TagSuggestion): SuggestedKind | undefined {
  if (!picked) return undefined
  if (picked.kind === "Artist") return "artist"
  if (picked.kind === "Series") return "copyright"
  if (picked.kind === "Meta") return "meta"
  return picked.kind ? undefined : "general"
}

/** What the shell works out for the workspace: the pack's own site, rating and tag slots. */
interface WorkspaceEnv {
  onProviderChange: (provider: BooruProvider) => void
  /** The app's slots plus the ones looked up for this pack. */
  overrides: Record<string, string>
  enrichTagSlots: (tags: string[]) => Promise<boolean>
  rating: PackRatingMode
}

function BriefWorkspace({
  pack,
  overrides,
  enrichTagSlots,
  provider,
  rating,
  gallerySearch,
  onProviderChange,
  open,
  start,
  startNote,
}: PackBriefBuilderProps & WorkspaceEnv & { pack: UsePackBriefResult; startNote: StartNote }) {
  const { brief, preferences } = pack
  // Random characters: the engine works from the brief with the drawn ones in Who (castBrief).
  const engineBrief = useMemo(() => castBrief(brief), [brief])
  const count = preferences.promptCount
  const restored = start.kind === "restored" ? start.saved : null
  // A new pack starts with the characters' usual outfit. A pack saved with the library as its
  // outfit (no longer offered here) reads as "each scene's".
  const [outfit, setOutfit] = useState<BriefOutfit>(() => (restored ? menuOutfit(restored.outfit) : NEW_PACK_OUTFIT))
  // A pack kept across a reload gets its pool back once the source is done loading (from the last render).
  const [sourceSettled, setSourceSettled] = useState(false)
  // Collecting: the pool can't have enough scenes yet, whatever they turn out to be, so pages keep
  // coming by themselves and the scenes that fit are worked out once they stop (from the last render).
  const [collecting, setCollecting] = useState(false)

  // ── Source ──────────────────────────────────────────────────────────────────────
  const [source, setSource] = useState<UsePackSourcesResult | null>(null)

  const posts = source?.allPosts ?? NO_POSTS
  const [ownKey, setOwnKey] = useState("")
  const originOf = source?.originOf
  const preferredPosts = useMemo(
    () => (originOf && ownKey ? preferredPostIds(originOf, new Set(ownKey.split("||"))) : []),
    [originOf, ownKey]
  )
  // Posts only the donor searches brought: they lend clothes or a place to the scenes.
  const [donorKey, setDonorKey] = useState("")
  const donorPosts = useMemo(
    () => (originOf && donorKey ? preferredPostIds(originOf, new Set(donorKey.split("||"))) : NO_DONORS),
    [originOf, donorKey]
  )

  // The pack's own prompt format: the gallery's until one is picked in this pack, and picking one
  // here never changes the gallery's cards. Kept with this pack only: the next pack starts from
  // the gallery's format again.
  const { format: galleryFormat, fullDetail } = usePromptFormat()
  const [ownFormat, setFormat] = useState<PromptFormat | undefined>(undefined)
  const promptFormat = packPromptFormat({ promptFormat: ownFormat }, galleryFormat)
  const copy = useCallback((text: string, format: PromptFormat) => copyPackText(text, format, provider), [provider])
  // The app's prompt settings (Tags to add and exclude, Find & Replace, weights…), the same ones
  // the gallery uses: read and edited here, never passed in. The pack's clothes are set in Wearing.
  const { settings: promptSettings, cleanOptions, globalWeights, isGlobalWeightsEnabled } = usePackPromptSettings()

  const engine = usePackBriefScenes({
    brief: engineBrief,
    posts,
    preferredPosts,
    donorPosts,
    restored: restored?.result ?? null,
    sourceSettled,
    deferCandidates: collecting,
    provider,
    rating,
    includeSensitive: preferences.includeSensitive,
    gallerySearch,
    promptCount: count,
    outfit,
    overrides,
    enrichTagSlots,
    cleanOptions,
    globalWeights,
    isGlobalWeightsEnabled,
  })
  const { plan, identity, candidates, candidatesPending, result, isGenerating, othersTag } = engine
  // The start's tags placed before the permanence data loaded go where it says, once it has.
  const { placeWith } = pack
  const { permanence } = engine
  useEffect(() => {
    if (permanence) placeWith(permanence)
  }, [permanence, placeWith])
  // The searches of the character's own posts (and of a mixed pack's compositions): their posts'
  // scenes go first. Read from the plan of the previous render (the plan needs the posts to settle).
  const planOwnKey = preferredSearchIds(plan).join("||")
  if (planOwnKey !== ownKey) setOwnKey(planOwnKey)
  const planDonorKey = plan.donors.map((s) => s.id).join("||")
  if (planDonorKey !== donorKey) setDonorKey(planDonorKey)
  const searching = plan.scenes.some((s) => s.tags.length > 0)

  // ── What fits ───────────────────────────────────────────────────────────────────
  // One-part packs ("Only the outfit"…) leave out variants, a list of their own: back on
  // "Whole scene" the scenes left out before are as they were.
  const axis = oneAxis(brief)
  const leftOutList = axis ? brief.leftOutVariants ?? NO_IDS : brief.leftOut
  const leftOut = useMemo(() => new Set(leftOutList), [leftOutList])
  // The source ran out without a single post: there is nothing to wait for.
  const noPosts = !!source && source.noMoreResults && !source.isLoadingMore && posts.length === 0
  const usable = useMemo(
    () => (candidates ? candidates.filter((c) => !leftOut.has(String(c.postId))) : noPosts ? [] : null),
    [candidates, leftOut, noPosts]
  )
  const poses = pack.requests.select
  const have = usable ? (poses.length > 0 && !axis ? usable.filter((c) => c.hasPose).length : usable.length) : 0
  // Pages go one at a time to the search that can bring most; one the pace limit doesn't
  // allow yet waits and goes by itself (usePackSources). By itself the pack stops at
  // its automatic request cap (autoRequestCap); "Find more scenes" goes on from there.
  const canLoad = !!source && !source.noMoreResults && !source.failed && !source.sessionCapReached && source.requests < source.autoRequestCap
  // While the pool alone says there can't be enough scenes yet, the next page goes as soon as the
  // pool has taken the last one, without waiting for the scenes that fit (they wait for the batch).
  const collectingNow = open && canLoad && engine.sceneEstimate !== null && engine.sceneEstimate < count
  if (collectingNow !== collecting) setCollecting(collectingNow)
  const needMore = (collectingNow && !engine.poolBehind) || (!!usable && !candidatesPending && have < count)
  // Short of scenes: fetch more pages until there are enough, every search has run out or
  // the cap is reached (then the fit line says what there is).
  useEffect(() => {
    if (open && needMore && canLoad && source && !source.isLoadingMore && !source.waiting) source.loadMore()
  }, [open, needMore, canLoad, source])
  const loadingPosts = !!source?.isLoadingMore || (searching && !source)
  // One state for any failed load (the pack data or a page of posts): one line, one retry.
  const loadError = engine.loadFailed || !!source?.failed
  // Waiting for roles is not searching: the button says what is missing.
  const rolesMissing = identity.missingRoles.length > 0
  const finding = !loadError && !rolesMissing && (loadingPosts || (needMore && canLoad) || (!candidates && searching && !noPosts))
  const settledNow = !!source && !finding && !source.waiting && !loadError
  if (settledNow !== sourceSettled) setSourceSettled(settledNow)
  const canOfferSensitive = rating === "sfw" && plan.sensitive === "excluded" && !finding
  // Nothing stops the loading for good any more: a page waits for the pace limit and goes
  // by itself, and past the cap "Find more scenes" is on the loaded line.
  const paused = false
  const waiting = !!source?.waiting && !loadError
  // A page asked for by hand: searching while it is on its way, then whether it brought
  // new scenes. `seen` once the request is in flight; `before` the scenes there were.
  const [manual, setManual] = useState<{ before: number; seen: boolean; nothingNew: boolean } | null>(null)
  const sourceLoading = !!source?.isLoadingMore
  const usableCount = usable?.length ?? 0
  if (manual && !manual.nothingNew) {
    if (sourceLoading && !manual.seen) setManual({ ...manual, seen: true })
    // The page failed: nothing is on its way, the offer comes back.
    else if (!manual.seen && source?.failed) setManual(null)
    else if (manual.seen && !sourceLoading && !candidatesPending) {
      setManual(usableCount > manual.before ? null : { ...manual, nothingNew: true })
    }
  }
  const [manualPlan, setManualPlan] = useState(plan.sceneKey)
  if (manualPlan !== plan.sceneKey) {
    setManualPlan(plan.sceneKey)
    setManual(null)
  }
  const loadOnePage = useCallback(() => {
    // Only a page really asked for shows "searching".
    if (source?.loadMore()) setManual({ before: usableCount, seen: false, nothingNew: false })
  }, [source, usableCount])
  // What the scenes were found in, and the way to ask the site for more whenever it has more
  // (the automatic loading stops once there are enough scenes; this goes on by hand).
  const loadedNow = source
    ? loadedState({
        posts: posts.length,
        noMoreResults: source.noMoreResults,
        failed: source.failed,
        sessionCapReached: source.sessionCapReached,
        paused: waiting,
        finding,
        loading: sourceLoading || (!!manual && !manual.nothingNew),
      })
    : null
  const loadedPosts = loadedNow?.posts ?? 0
  const loadedAll = !!loadedNow?.all
  const loadedMore = !!loadedNow?.more
  const loaded = useMemo(
    () =>
      loadedPosts > 0
        ? {
            // The posts that give scenes, and the donors' apart: the same numbers How it searches adds up.
            text: BUILDER_TEXT.loadedFrom(loadedPosts - donorPosts.length, PROVIDER_LABELS[provider], loadedAll, donorPosts.length),
            onFindMore: loadedMore ? loadOnePage : undefined,
          }
        : null,
    [loadedPosts, loadedAll, loadedMore, provider, loadOnePage, donorPosts.length]
  )
  // What the pack searches, folded under the fit line until asked for.
  const searchesId = useId()
  const [searchesOpen, setSearchesOpen] = useState(false)
  const toggleSearches = useCallback(() => setSearchesOpen((v) => !v), [])
  const searchesToggle = useMemo(
    () => (searching && !loadError ? { open: searchesOpen, onToggle: toggleSearches, controls: searchesId } : null),
    [searching, loadError, searchesOpen, toggleSearches, searchesId]
  )
  const firstTag = brief.who[0]?.tag ?? null
  const firstName = firstTag ? characterName(firstTag) : null
  const axisNote = useMemo(() => (axis ? { axis, requested: axisRequests(brief, axis) } : null), [axis, brief])
  const peopleNote = pickedPeopleNote({ picked: brief.people, available: engine.available, using: engine.people, cast: identity.cast })

  // A correction from the results remakes the prompts itself: no "generate again" for it
  // while it runs. A pack made from another source (booru, rating, characters) is out of date.
  const [correction, setCorrection] = useState<Correction | null>(null)
  const correcting = !!correction && correction.status !== "done"
  const stale = !!result && (engine.sourceChanged || (!correcting && (result.brief !== engineBrief || result.count !== count || result.outfit !== outfit)))
  const notes: FitNote[] = useMemo(() => {
    const castNote = castPeopleNote(brief.people, identity.cast)
    const lead = [peopleNote, castNote].filter((n): n is FitNote => !!n)
    const progress = {
      loading: (sourceLoading || (!!manual && !manual.nothingNew)) && !loadError,
      found: have,
      nothingNew: manual?.nothingNew ? { exhausted: !!source?.noMoreResults } : null,
    }
    if (loadError) return []
    const predicted = () => predictFit({ candidates: usable, count, poses, finding, canOfferSensitive, paused, axis: axisNote, conditions: engine.conditionSupply })
    if (!result) return mergeFitNotes(withSearchProgress([...lead, ...predicted()], progress))
    // Out of date: the last pack's notes are about another brief; the line speaks of the brief as it is.
    if (stale) return mergeFitNotes(withSearchProgress([{ kind: "stale" }, ...lead, ...predicted()], progress))
    const after = issuesFit({
      issues: result.issues,
      count: result.count,
      made: result.prompts.length,
      cast: identity.cast,
      scenes: usable ? have : null,
      canOfferSensitive,
      paused,
      axis: oneAxis(result.brief),
    })
    return mergeFitNotes(withSearchProgress([...lead, ...after], progress))
  }, [result, usable, count, poses, finding, canOfferSensitive, paused, axisNote, peopleNote, brief.people, identity.cast, have, stale, sourceLoading, manual, loadError, source?.noMoreResults, engine.conditionSupply])
  // A page waiting for the pace limit: said in place of "Finding scenes…", gone once it goes.
  const lineNotes = useMemo(() => withWaiting(notes, waiting), [notes, waiting])
  const { setIncludeSensitive } = pack
  const includeSensitive = useCallback(() => setIncludeSensitive(true), [setIncludeSensitive])
  const fitStates = useMemo<FitState[]>(
    () => lineNotes.map((n): FitState =>
      n.kind === "few-rated"
        ? { kind: "few-rated", onInclude: includeSensitive }
        : n.kind === "paused"
          ? { kind: "paused", onLoadMore: loadOnePage, waiting: !!source?.scrollLimited, nothingNew: n.nothingNew }
          : n),
    [lineNotes, includeSensitive, loadOnePage, source?.scrollLimited]
  )

  // ── Folding ─────────────────────────────────────────────────────────────────────
  // A pack kept across a reload with its prompts comes back as a made pack does: prompts first.
  const [folded, setFolded] = useState(() => !!restored?.result?.prompts.length)
  const [openedFromSummary, setOpenedFromSummary] = useState(false)
  // A pack just made folds the brief away, so the prompts come first.
  const [wasGenerating, setWasGenerating] = useState(false)
  const [briefOpenNarrow, setBriefOpenNarrow] = useState(false)
  if (wasGenerating !== isGenerating) {
    setWasGenerating(isGenerating)
    if (!isGenerating && result) {
      setFolded(true)
      setBriefOpenNarrow(false)
      setOpenedFromSummary(false)
    }
  }
  const expand = useCallback(() => {
    setFolded(false)
    setOpenedFromSummary(true)
  }, [])
  // On a phone the brief is a line that opens and closes in place: what the pack will be,
  // the fit line, Generate and the prompts come first. Focus stays on the line.
  const narrow = useIsMobile()
  const toggleBriefNarrow = useCallback(() => setBriefOpenNarrow((v) => !v), [])
  const showBrief = narrow ? briefOpenNarrow : !folded
  // After a pack is made, focus goes to the prompts.
  const resultsRef = useRef<HTMLDivElement>(null)
  const wasGeneratingRef = useRef(false)
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating) {
      // The brief is folded by now: the top of the panel is the summary, the fit line and the results.
      scrollerOf(resultsRef.current)?.scrollTo({ top: 0 })
      resultsRef.current?.focus({ preventScroll: true })
    }
    wasGeneratingRef.current = isGenerating
  }, [isGenerating])

  // ── Brief edits ─────────────────────────────────────────────────────────────────
  const [routed, setRouted] = useState<{ slot: SlotId | "people"; key: number } | null>(null)
  const suggestions = useTagSuggestions(overrides)
  const { add, addOther, never, remove, unnever, removeCharacter, setRole, removeLook, restoreLook, leaveOutScene, restoreScene, setPeople, undo } = pack
  const { leaveOutVariant, restoreVariant, setBaseScene } = pack
  const cast = identity.cast
  const onAddTags = useCallback((tags: string[], slot: SlotId, picked?: TagSuggestion) => {
    let elsewhere: SlotId | "people" | null = null
    const counts: string[] = []
    const kind = suggestedKind(picked)
    for (const tag of tags) {
      const dest = landsIn(tag, slot, overrides, othersTag, kind)
      // A typed count ("2girls", "1boy", "solo") sets who is in the picture.
      if (dest === null) {
        counts.push(tag)
        continue
      }
      // A pairing or a focus ("hetero") is who is in the picture: People sets it, the pack says so.
      if (dest === "people") {
        toast({ description: COMPOSITION_TEXT.setByPeople(showTag(tag)), duration: 5000 })
        elsewhere = "people"
        continue
      }
      if (slot === "never") never(tag)
      else if (dest === "others") addOther(tag)
      else add(tag, typedRole(tag, slot === "others" ? "style" : slot, overrides, kind))
      if (dest !== slot) elsewhere = dest
    }
    const people = peopleFromCountTags(counts, cast)
    if (people) {
      setPeople(people)
      elsewhere = "people"
    }
    if (elsewhere) setRouted({ slot: elsewhere, key: Date.now() })
  }, [add, addOther, never, setPeople, overrides, cast, othersTag])
  // Undo: the last change of the brief, for a few seconds.
  const [undoFor, setUndoFor] = useState<object | null>(null)
  const [providerUndo, setProviderUndo] = useState<{ from: BooruProvider; to: BooruProvider } | null>(null)
  const [seenBrief, setSeenBrief] = useState(brief)
  // A brief that came back through Undo opens no notice: the one before would name an older change.
  const [undoing, setUndoing] = useState(false)
  if (seenBrief !== brief) {
    setSeenBrief(brief)
    // The correction's own change has its own notice; any other change retires it, and from
    // then on the brief's undo and "The pack changed…" apply.
    const next = correctionAfterBriefChange(correction, brief)
    const own = next.own
    if (next.correction !== correction) setCorrection(next.correction)
    setUndoFor(pack.canUndo && !undoing && !own ? brief : null)
    if (undoing) setUndoing(false)
    setProviderUndo(null)
  }
  // Another site: one notice with Undo, which goes back to the site before (and opens no notice).
  const [seenProvider, setSeenProvider] = useState(provider)
  const [undoingProvider, setUndoingProvider] = useState(false)
  if (seenProvider !== provider) {
    setSeenProvider(provider)
    setProviderUndo(undoingProvider ? null : { from: seenProvider, to: provider })
    if (undoingProvider) setUndoingProvider(false)
    setUndoFor(null)
  }
  if (!open && providerUndo) setProviderUndo(null)
  // Never and Style defaults: set on purpose from the row, never part of the brief's Undo; the
  // notice that confirms a change has its own Undo, which puts the defaults back as they were.
  const { setRowDefaults, removeRowDefault } = pack
  const [defaultsUndo, setDefaultsUndo] = useState<{ row: DefaultRow; before: string[]; message: string } | null>(null)
  if (!open && defaultsUndo) setDefaultsUndo(null)
  useEffect(() => {
    if (!defaultsUndo) return
    const timer = setTimeout(() => setDefaultsUndo(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [defaultsUndo])
  const rowDefaultsProps = useMemo(() => {
    const prefs = pack.preferences
    const make = (row: DefaultRow, label: string) => {
      // By the bare tag: a default saved with its weight ("(masterpiece:1.2)") marks the chip "masterpiece".
      const saved = new Set(rowDefaults(prefs, row).map(briefTagName))
      const tags = DEFAULT_ROWS[row].tagsOf(brief)
      return {
        has: (tag: string) => saved.has(briefTagName(tag)),
        matches: rowMatchesDefaults(brief, prefs, row),
        empty: tags.length === 0,
        onUse: () => {
          const before = setRowDefaults(row, tags)
          setDefaultsUndo({ row, before, message: tags.length === 0 ? DEFAULTS_TEXT.cleared(label) : DEFAULTS_TEXT.saved(label) })
        },
        onRemove: (tag: string) => {
          const before = removeRowDefault(row, tag)
          setDefaultsUndo({ row, before, message: DEFAULTS_TEXT.removed(showTag(tag)) })
        },
      }
    }
    return { never: make("never", SLOTS.never.label), style: make("style", SLOTS.style.label) }
  }, [pack.preferences, brief, setRowDefaults, removeRowDefault])
  const onUndoDefaults = useCallback(() => {
    if (!defaultsUndo) return
    setRowDefaults(defaultsUndo.row, defaultsUndo.before)
    setDefaultsUndo(null)
  }, [defaultsUndo, setRowDefaults])
  useEffect(() => {
    if (!providerUndo) return
    const timer = setTimeout(() => setProviderUndo(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [providerUndo])
  const onUndoProvider = useCallback(() => {
    if (!providerUndo) return
    setUndoingProvider(true)
    setProviderUndo(null)
    onProviderChange(providerUndo.from)
  }, [providerUndo, onProviderChange])
  // Closed: no notices and no timers.
  if (!open && (undoFor || correction)) {
    setUndoFor(null)
    setCorrection(null)
  }
  useEffect(() => {
    if (!undoFor) return
    const timer = setTimeout(() => setUndoFor(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [undoFor])
  const showUndo = undoFor === brief && !!pack.lastChange
  const onUndo = useCallback(() => {
    if (undo() !== null) setUndoing(true)
    setUndoFor(null)
  }, [undo])

  // ── Corrections from the results ────────────────────────────────────────────────
  // The tag menu changes the brief and the pack is remade at once with the same seed and
  // scenes; Undo puts brief, prompts, locks and format back as they were.
  const correctionIdRef = useRef(0)
  const { addLook, addExactly } = pack
  const correct = useCallback((kind: "always" | "never", raw: string) => {
    if (!result || engine.busy || engine.sourceChanged || engine.poolPending) return
    const tag = bareToken(raw)
    const route = routeTag(tag, overrides)
    let next: PackBrief
    let apply: () => void
    if (kind === "never") {
      next = addNever(brief, tag)
      apply = () => never(tag)
    } else if (route.kind === "composition") {
      // A pairing or a focus is who is in the picture: People sets it.
      toast({ description: COMPOSITION_TEXT.setByPeople(showTag(tag)), duration: 5000 })
      return
    } else if (route.kind === "people") {
      // A count says who is in the picture: it goes to People, as when typed.
      const people = peopleFromCountTags([tag], cast)
      if (!people) return
      next = setPeopleInBrief(brief, people)
      apply = () => setPeople(people)
    } else if (othersTag(tag)) {
      // "dark-skinned male" next to girls is how the others look, as when typed.
      next = addOtherInBrief(brief, tag)
      apply = () => addOther(tag)
    } else if (route.kind === "look" && (identity.castSize >= 2 || !!identity.turns)) {
      // With several characters a look tag goes to the one it came from, never to a guess.
      const owner = lookOwner(tag, identity.blocks)
      const ownerTag = owner ? engineBrief.who.find((c) => c.tag && normalizeTagForPack(c.tag) === owner)?.tag ?? null : null
      if (!ownerTag) {
        toast({ description: CORRECTION_TEXT.lookWhose(showTag(tag)), duration: 5000 })
        return
      }
      next = addLookInBrief(brief, ownerTag, tag)
      apply = () => addLook(ownerTag, tag)
    } else {
      // Like a tag typed in Also: one the taxonomy does not know goes to Style.
      // Always on a garment or a place of a prompt asks for that tag: exact, not any form of it.
      const role = typedRole(tag, "also", overrides)
      next = addTagExactly(brief, tag, overrides, role)
      apply = () => addExactly(tag, role)
    }
    if (JSON.stringify(next) === JSON.stringify(brief)) return
    setCorrection({
      id: ++correctionIdRef.current, kind, tag, snapshot: result, format: promptFormat,
      briefBefore: brief, briefAfter: null, status: "waiting", message: null,
    })
    apply()
  }, [result, engine.busy, engine.sourceChanged, engine.poolPending, overrides, brief, engineBrief.who, cast, identity.castSize, identity.turns, identity.blocks, promptFormat, never, setPeople, addLook, addExactly, othersTag, addOther])
  // Stable: `correct` follows the brief, the slots and the engine, which change with every page of
  // posts, and the rows would all render again for it.
  const onAlways = useStableCallback((tag: string) => correct("always", tag))
  const onNever = useStableCallback((tag: string) => correct("never", tag))
  // Runs once the brief has the change (the engine's arguments follow it). Every outcome
  // closes the notice: done offers Undo; replaced, skipped or failed goes.
  const { recompose, restore } = engine
  const runningRef = useRef(0)
  useEffect(() => {
    if (!correction || correction.status !== "waiting" || correction.briefAfter !== brief || runningRef.current === correction.id) return
    runningRef.current = correction.id
    const { id, kind, tag } = correction
    void recompose().then((outcome) => {
      if (outcome.status !== "done") {
        setCorrection((cur) => (cur?.id === id ? null : cur))
        return
      }
      const { before, after } = outcome
      const changed = changedRows(before.prompts, after.prompts)
      const kept = keptRows(after.prompts.length, new Set(after.locked), after.made.slots)
      const parts = [CORRECTION_TEXT[kind](tag, changed)]
      if (kind === "never") {
        const locked = lockedWithTag(after.prompts, kept.locked, tag)
        const older = lockedWithTag(after.prompts, kept.older, tag)
        if (locked > 0) parts.push(CORRECTION_TEXT.lockedKeep(locked))
        if (older > 0) parts.push(CORRECTION_TEXT.olderKeep(older))
      }
      setCorrection((cur) => (cur?.id === id ? { ...cur, status: "done", message: parts.join(". ") } : cur))
    })
  }, [correction, brief, recompose])
  const undoCorrection = useCallback(() => {
    if (!correction || correction.status !== "done") return
    // Any other change would have retired this notice: the last change is the correction's.
    if (undo() !== null) setUndoing(true)
    restore(correction.snapshot)
    setFormat(correction.format)
    setCorrection(null)
  }, [correction, undo, restore, setFormat])
  // A correction notice goes after a while, like the brief's.
  useEffect(() => {
    if (correction?.status !== "done") return
    const timer = setTimeout(() => setCorrection((cur) => (cur?.id === correction.id ? null : cur)), UNDO_MS)
    return () => clearTimeout(timer)
  }, [correction])
  // Locking and re-rolling are changes too: a correction's Undo must not throw them away.
  const { toggleLock, reroll } = engine
  const onToggleLock = useCallback((index: number) => {
    setCorrection(null)
    toggleLock(index)
  }, [toggleLock])
  // Stable for the rows: `reroll` follows the engine's arguments, which change with every page.
  const onReroll = useStableCallback((index: number) => {
    const done = reroll(index)
    if (done) setCorrection(null)
    return done
  })
  // Generate is another operation: a correction's notice goes.
  const { generate } = engine
  // Random characters: the first Generate uses the draw made when they were chosen; Generate again
  // (or a draw too short for the prompts) draws others, keeping the locked rows' characters, and
  // generates once the engine has them and their looks.
  const castIndex = useCharacterIndex(drawsCast(brief))
  const [pendingDraw, setPendingDraw] = useState<string | null>(null)
  const { redrawCast } = pack
  const onGenerate = useCallback(() => {
    setCorrection(null)
    if (castIndex && brief.randomCast && needsRedraw(brief, count, !!result?.prompts.length)) {
      const lockedCharacters = new Set((result?.locked ?? []).flatMap((i) => (result?.prompts[i]?.character ? [result.prompts[i].character!] : [])))
      const keep = brief.randomCast.drawn.filter((m) => lockedCharacters.has(normalizeTagForPack(m.tag)))
      const drawn = drawRandomCast(castIndex, {
        source: brief.randomCast.source,
        gender: randomCastGender(brief.randomCast.gender, brief),
        count,
        seed: Math.floor(Math.random() * 0x7fffffff),
        provider,
        keep,
      })
      // A draw with nobody new (the source ran out of characters) would leave Who unnamed: keep the
      // current draw and generate with it, so the button never waits for characters that won't come.
      if (redrawUsable(drawn, keep)) {
        redrawCast(drawn)
        setPendingDraw(drawKey(drawn))
        return
      }
    }
    generate()
  }, [generate, castIndex, brief, count, result, provider, redrawCast])
  const drawing = pendingDraw !== null
  // The new draw's characters are the engine's, with their looks and a pool: now it generates.
  const engineDraw = drawKey(identity.members.map((m) => ({ tag: m.character })))
  useEffect(() => {
    if (pendingDraw === null || engineDraw !== pendingDraw || !engine.looksReady || !engine.pool || engine.busy) return
    // The engine has the draw (its state, worked out over renders): the wait ends and the run starts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingDraw(null)
    generate()
  }, [pendingDraw, engineDraw, engine.looksReady, engine.pool, engine.busy, generate])
  const onRemoveCharacter = useCallback((tag: string | null) => { if (tag) removeCharacter(tag) }, [removeCharacter])
  const addCast = pack.addCast
  const castPicker = useMemo(() => ({ provider, onAdd: addCast }), [provider, addCast])
  const { setRandomCast } = pack
  const autoGender = randomCastGender("auto", brief)
  const randomCastControl = useMemo(() => ({ autoGender, onChange: setRandomCast }), [autoGender, setRandomCast])
  const onToggleScene = useCallback(
    (id: string) => {
      if (axis) return leftOut.has(id) ? restoreVariant(id) : leaveOutVariant(id)
      return leftOut.has(id) ? restoreScene(id) : leaveOutScene(id)
    },
    [axis, leftOut, leaveOutScene, restoreScene, leaveOutVariant, restoreVariant]
  )
  // One-part packs: the first tile is the scene that repeats; selecting it chooses another.
  const [pickingFixed, setPickingFixed] = useState(false)
  const fixedId = axis && candidates?.[0]?.axisRole === "base" ? String(candidates[0].postId) : null
  if (pickingFixed && !fixedId) setPickingFixed(false)
  // With locked rows the scene that repeats is the pack's: choosing another waits until they're unlocked.
  const fixedLocked = !!axis && !!result && result.locked.length > 0
  const fixed = useMemo(() => (fixedId
    ? {
        id: fixedId,
        picking: pickingFixed && !fixedLocked,
        blockedReason: fixedLocked ? SHEET_TEXT.fixedLocked : undefined,
        onStartPick: () => { if (!fixedLocked) setPickingFixed(true) },
        onCancelPick: () => setPickingFixed(false),
        onPick: (id: string) => {
          setPickingFixed(false)
          setBaseScene(Number(id))
        },
      }
    : undefined), [fixedId, pickingFixed, fixedLocked, setBaseScene])


  // ── What the start brought ──────────────────────────────────────────────────────
  // The card's outfit and pose are offered, never copied: a request is a condition.
  const { addTags } = pack
  const has = useCallback((tag: string) => brief.requests.some((r) => r.tag === normalizeTagForPack(tag)), [brief.requests])
  const offers = useMemo<BriefOffer[]>(() => {
    if (startNote.kind !== "card") return []
    const out: BriefOffer[] = []
    const outfit = startNote.outfit.filter((t) => !has(t))
    const pose = startNote.pose.filter((t) => !has(t))
    if (outfit.length > 0) {
      out.push({ id: "card-outfit", slot: "wearing", label: BUILDER_TEXT.cardOutfit, detail: outfit.map(showTag).join(", "), onAccept: () => addTags(outfit, "wearing") })
    }
    if (pose.length > 0) {
      out.push({ id: "card-pose", slot: "doing", label: BUILDER_TEXT.cardPose, detail: pose.map(showTag).join(", "), onAccept: () => addTags(pose, "doing") })
    }
    return out
  }, [startNote, has, addTags])
  // Said until the first change: what the start put in, and what it left out.
  const startText = pack.canUndo ? null : startNoteText(startNote, engine.poolPending)
  // The note on a pack that came back stays in view with the brief folded: it explains the prompts.
  const showStartText = !!startText && (showBrief || startNote.kind === "restored")

  // ── Saved for the next visit ────────────────────────────────────────────────────
  // The pack as it is now replaces the one saved before, a moment after each change (never while
  // rendering); a change still waiting is written when the page goes or the pack is replaced.
  const pendingSave = useRef<(() => void) | null>(null)
  useEffect(() => {
    const write = () => {
      try {
        userPreferences.setSavedPack({ brief, outfit, provider, gallerySearch, result: result ? savedResultOf(result, engineBrief, outfit) : null })
      } catch {
        // Storage unavailable: the pack lasts this visit.
      }
    }
    pendingSave.current = write
    const timer = setTimeout(() => {
      pendingSave.current = null
      write()
    }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [brief, engineBrief, outfit, provider, gallerySearch, result])
  useEffect(() => {
    const flush = () => {
      const write = pendingSave.current
      pendingSave.current = null
      write?.()
    }
    window.addEventListener("pagehide", flush)
    return () => {
      window.removeEventListener("pagehide", flush)
      flush()
    }
  }, [])

  // ── What the brief shows of each character ──────────────────────────────────────
  const characterInfo = useMemo(() => {
    const out: Record<string, CharacterInfo> = {}
    for (const c of brief.who) if (c.tag) out[c.tag] = { usualLook: engine.looks[c.tag]?.look ?? [], replacedLook: engine.replacedLook[c.tag] }
    return out
  }, [brief.who, engine.looks, engine.replacedLook])
  // With several characters, the role the pack assumes for each one (the user corrects it in Who).
  const assumedRoles = useMemo(() => {
    const out: Record<string, CastRole | null> = {}
    brief.who.forEach((c, i) => { if (c.tag) out[c.tag] = identity.members[i]?.role ?? null })
    return out
  }, [brief.who, identity.members])
  const { setChanges } = pack
  const changesControl = useMemo(() => ({ value: brief.changes, onChange: setChanges }), [brief.changes, setChanges])
  // Several make-ups can be marked; a one-part pack keeps one (its scene that repeats sets it).
  const { toggleComposition } = pack
  const enginePeople = engine.people
  const onTogglePeople = useCallback((option: PackPeople) => toggleComposition(option, enginePeople), [toggleComposition, enginePeople])
  const people = engine.peopleLine
    ? {
        options: engine.peopleLine.options,
        value: engine.peopleLine.value,
        onChange: setPeople,
        cast: identity.cast,
        poseNeeds: engine.peopleLine.poseNeeds,
        ...(axis
          ? { note: PEOPLE_TEXT.axis }
          : { selected: engine.peopleSelected, onToggle: onTogglePeople, blocked: engine.peopleBlocked }),
      }
    : null
  // ── Wearing and Where as conditions ─────────────────────────────────────────────
  // Every garment, and a place, is met with a different form per prompt unless made exact.
  const exactness = useMemo(() => {
    const out: Record<string, boolean> = {}
    for (const r of brief.requests) if (canBeCondition(r, overrides)) out[r.tag] = !!r.exact
    return out
  }, [brief.requests, overrides])
  // The library's styles: offered in the Wearing field, chosen as chips.
  const { addStyle, removeStyle } = pack
  const chosenStyles = brief.outfitStyles ?? NO_IDS
  const styleOptions = useMemo<EntryOption[]>(
    () => engine.allowedStyles
      .filter((style) => !chosenStyles.includes(style) && (engine.styleCounts[style] ?? 0) > 0)
      .map((style) => ({
        id: style,
        label: STYLE_TEXT.name(style),
        detail: STYLE_TEXT.count(engine.styleCounts[style] ?? 0),
        onPick: () => addStyle(style, STYLE_TEXT.chip(style)),
      })),
    [engine.allowedStyles, engine.styleCounts, chosenStyles, addStyle]
  )
  const styleChips = useMemo(
    () => chosenStyles.map((style) => ({
      style,
      label: STYLE_TEXT.chip(style),
      inactive: engine.allowedStyles.includes(style as OutfitStyle) ? undefined : STYLE_TEXT.notAtRating,
      onRemove: () => removeStyle(style, STYLE_TEXT.chip(style)),
    })),
    [chosenStyles, engine.allowedStyles, removeStyle]
  )
  const { setOutfitDetail } = pack
  const outfitDetail = useMemo(() => ({ value: brief.outfitDetail ?? "simple", onChange: setOutfitDetail }), [brief.outfitDetail, setOutfitDetail])
  const unusedStyles = chosenStyles.filter((style) => !engine.allowedStyles.includes(style as OutfitStyle))
  const styleNote = unusedStyles.length > 0 ? STYLE_TEXT.unused(unusedStyles) : undefined

  // Others shows once the make-up has someone besides the characters (the chosen one, or the one the scenes give).
  const composition = engine.people ?? brief.people
  const othersApply = composition ? composition.girls + composition.boys > identity.cast.girls + identity.cast.boys : null
  const othersRow = useMemo(() => ({ applies: othersApply }), [othersApply])
  const summary = useMemo(() => {
    // Several make-ups: "with 2 boys or with 3 boys".
    const label = brief.people ? briefCompositions(brief).map((p) => companionsLabel(p, identity.cast)).join(" or ") : null
    const own = briefSummaryParts(brief, label, characterInfo)
    // Random characters: said first, as a character's name would be.
    const parts = drawsCast(brief) ? [RANDOM_CAST_TEXT.open.toLowerCase(), ...own] : own
    // The folded line says when only one part changes.
    const changes = CHANGES_OPTIONS.find((o) => o.value === brief.changes)
    // And when each prompt has one of the characters.
    const withTurns = castTurns(brief) ? [...parts, CAST_MODE_TEXT.turns.toLowerCase()] : parts
    return axis && changes ? [...withTurns, changes.label.toLowerCase()] : withTurns
  }, [brief, identity.cast, characterInfo, axis])
  // Each character's name as the card shows it, by brief tag (their own searches say it).
  const characterNames = useMemo(() => {
    const out: Record<string, string> = {}
    for (const c of engineBrief.who) if (c.tag) out[c.tag] = characterName(c.tag, characterInfo[c.tag])
    return out
  }, [engineBrief.who, characterInfo])

  // ── The contact sheet ───────────────────────────────────────────────────────────
  const thumbs = useMemo<SceneThumb[]>(
    () => sceneThumbs(candidates ?? []),
    [candidates]
  )
  // The sheet never shows its own error: the builder's one line above covers every failed load.
  const sheetStatus: ContactSheetStatus = !candidates && !loadError && (finding || !engine.ready) ? "loading" : "ready"
  const { loadFailed: dataFailed, retryLoad } = engine
  // Retries everything that failed, data and pages; each clears its error as it starts again.
  const retryAll = useCallback(() => {
    if (dataFailed) retryLoad()
    if (source?.failed) source.retry()
  }, [dataFailed, retryLoad, source])

  // ── Help: examples for an empty brief, and tips shown once ──────────────────────
  const { changeTo } = pack
  const showExamples = showBrief && !result && briefAsksNothing(brief)
  const examples = useMemo<ExampleBrief[]>(
    () => BRIEF_EXAMPLES.map((ex) => ({ id: ex.id, parts: [EXAMPLE_TEXT[ex.id]?.title ?? ex.id, EXAMPLE_TEXT[ex.id]?.detail ?? ""] })),
    []
  )
  const pickExample = useCallback((id: string) => {
    const ex = BRIEF_EXAMPLES.find((e) => e.id === id)
    if (!ex) return
    const label = ex.tags.length > 0 ? `Added ${ex.tags.map((t) => t.tag).join(", ")}` : "Changed what varies"
    changeTo(briefWithExample(brief, ex, overrides), label)
  }, [brief, overrides, changeTo])
  // Each tip shows the first time it is useful, and never again (marked as seen when shown).
  const [tipsSeen] = useState<ReadonlySet<string>>(() => {
    try {
      return new Set(userPreferences.getPackTipsSeen())
    } catch {
      return new Set()
    }
  })
  const [tipsClosed, setTipsClosed] = useState<ReadonlySet<string>>(() => new Set())
  const tipOn = (id: string, when: boolean) => open && when && !tipsSeen.has(id) && !tipsClosed.has(id)
  const sheetTip = tipOn("sheet", showBrief && !axis && thumbs.length > 0)
  const axisTip = tipOn("axis", showBrief && !!axis && !!fixedId)
  const resultsTip = tipOn("results", !!result && result.prompts.length > 0)
  useEffect(() => {
    const shown = [sheetTip && "sheet", axisTip && "axis", resultsTip && "results"].filter((id): id is string => !!id)
    try {
      shown.forEach((id) => userPreferences.markPackTipSeen(id))
    } catch {
      // Storage unavailable: the tip may show again next time.
    }
  }, [sheetTip, axisTip, resultsTip])
  const closeTip = useCallback((id: string) => setTipsClosed((prev) => new Set(prev).add(id)), [])

  // ── Generate ────────────────────────────────────────────────────────────────────
  const named = engineBrief.who.some((c) => c.tag)
  const blockedReason = !named
    ? BLOCKED.noCharacter
    : drawing || (drawsCast(brief) && !engine.looksReady)
      ? BLOCKED.waiting
    : identity.missingRoles.length > 0
      ? BLOCKED.roles
      : noPosts
        ? BLOCKED.noScenes
        : !engine.pool
        ? BLOCKED.waiting
        : usable && usable.length === 0 && !finding
          ? BLOCKED.noScenes
          : undefined

  // Before generating, on a wide panel, the brief and the scenes sit side by side, each scrolling on
  // its own: what changes in the brief shows on the sheet at once. Folded after generating (and on
  // a phone, tablet or narrow window), one column: the brief's line, the fit line, the prompts.
  const split = showBrief && !narrow
  return (
    <>
      <div
        data-pack-scroll=""
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain",
          split && "lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:overflow-hidden",
        )}
      >
        <div
          className={cn(
            "space-y-4 px-4 pt-4 sm:px-6",
            split
              ? "mx-auto max-w-4xl lg:mx-0 lg:max-w-none lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-border/60 lg:bg-card/60 lg:pb-6 lg:pt-5"
              : "mx-auto max-w-4xl",
          )}
        >
          {showStartText && (
            <p className="flex items-start gap-2 text-[13px] leading-snug text-muted-foreground text-pretty">
              <Info className="mt-0.5 size-3.5 shrink-0 text-info-text" aria-hidden />
              {startText}
            </p>
          )}
          {narrow ? (
            <BriefSummary parts={summary} onExpand={toggleBriefNarrow} expanded={briefOpenNarrow} />
          ) : folded ? (
            <BriefSummary parts={summary} onExpand={expand} />
          ) : null}
          {showBrief && (
            <PackBriefPanel
              brief={brief}
              characterInfo={characterInfo}
              autoFocus={openedFromSummary && !narrow}
              routed={routed}
              onAddTags={onAddTags}
              onRemoveTag={remove}
              onRemoveNever={unnever}
              onRemoveCharacter={onRemoveCharacter}
              onSetRole={setRole}
              onRemoveTrait={removeLook}
              onRestoreTrait={restoreLook}
              outfitSource={shownOutfit(outfit, engine.usualOutfitKnown)}
              onOutfitSourceChange={setOutfit}
              officialOutfits={engine.officialOutfits}
              outfitNote={axis === "outfit" ? SHEET_TEXT.outfitChanges : undefined}
              assumedRoles={assumedRoles}
              onCastModeChange={pack.setCastMode}
              castPicker={castPicker}
              promptCount={count}
              randomCast={randomCastControl}
              changes={changesControl}
              people={people}
              others={othersRow}
              exactness={exactness}
              onSetExact={pack.setExact}
              styleOptions={styleOptions}
              styleChips={styleChips}
              styleNote={styleNote}
              outfitDetail={outfitDetail}
              rowDefaults={rowDefaultsProps}
              offers={offers}
              suggestions={suggestions.suggestions}
              suggestionStatus={suggestions.status}
              onQueryChange={suggestions.onQueryChange}
            />
          )}
          {showBrief && <PackPromptOptions settings={promptSettings} />}
        </div>

        <div
          className={cn(
            "space-y-4 px-4 pb-6 pt-4 sm:px-6",
            split ? "mx-auto max-w-4xl lg:mx-0 lg:max-w-none lg:overflow-y-auto lg:overscroll-contain lg:pt-5" : "mx-auto max-w-4xl",
          )}
        >
          {loadError && (
            <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-destructive-border bg-destructive-soft px-3.5 py-3 text-sm text-destructive-text">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 text-pretty">{BUILDER_TEXT.loadFailed}</span>
              <Button type="button" variant="outline" size="sm" onClick={retryAll} className="h-8 bg-background px-3 text-xs pointer-coarse:h-11">
                {BUILDER_TEXT.retry}
              </Button>
            </div>
          )}

          {/* One live region for the fit line and the run: the lines themselves stay quiet. */}
          <p className="sr-only" role="status" aria-live="polite">
            {isGenerating ? BUILDER_TEXT.generatingSpoken : fitStates.map((st) => sentence(fitText(st).spoken)).join(" ")}
          </p>
          {fitStates.length > 0 && (
            <div className="space-y-1.5">
              {fitStates.map((state, i) => (
                <FitLine
                  // Several notes of one kind (one per tag) need their own key.
                  key={`${state.kind}:${"tag" in state ? state.tag : i}`}
                  lead={i === 0}
                  announce={false}
                  state={state}
                  onIncludeSensitive={includeSensitive}
                  hint={i === 0 && showBrief && thumbs.length > 0 && !result ? (axis ? SHEET_TEXT.hint(axis) : BUILDER_TEXT.sheetHint) : undefined}
                  loaded={i === fitStates.length - 1 && !isGenerating ? loaded ?? undefined : undefined}
                  searches={i === fitStates.length - 1 && searchesToggle ? searchesToggle : undefined}
                />
              ))}
            </div>
          )}
          {searchesToggle?.open && (
            <SearchDetails
              id={searchesId}
              plan={plan}
              progress={source?.searches ?? NO_PROGRESS}
              character={firstName}
              characterNames={characterNames}
              site={PROVIDER_LABELS[provider]}
              limit={getProviderTagLimit(provider)}
            />
          )}
          {showExamples && (
            <PackEmptyState heading={EXAMPLES_HEADING} examples={examples} onPick={pickExample} />
          )}
          {sheetTip && <PackTip text={TIP_TEXT.sheet} onDismiss={() => closeTip("sheet")} />}
          {axisTip && axis && <PackTip text={TIP_TEXT.axis(axis)} onDismiss={() => closeTip("axis")} />}
          {/* With no character yet the examples are where to start; an empty sheet would only say nothing fits. */}
          {showBrief && !(loadError && thumbs.length === 0) && !(showExamples && !named) && (
            <ContactSheet
              scenes={thumbs}
              leftOut={leftOutList}
              emptyTitle={rolesMissing ? BLOCKED.roles : undefined}
              emptyHint={rolesMissing ? "" : undefined}
              onToggle={onToggleScene}
              fixed={fixed}
              status={sheetStatus}
              expected={count}
            />
          )}

          {resultsTip && <PackTip text={TIP_TEXT.results} onDismiss={() => closeTip("results")} />}
          {result && result.prompts.length > 0 && (
            <Results
              containerRef={resultsRef}
              prompts={result.prompts}
              locked={result.locked}
              missing={result.shortBy}
              copyNote={copyNoteText({ missing: result.shortBy, stale })}
              onToggleLock={onToggleLock}
              busy={engine.busy || engine.sourceChanged || engine.poolPending}
              busyReason={engine.sourceChanged ? BUILDER_TEXT.busySource : engine.poolPending ? BUILDER_TEXT.busyReloading : BUILDER_TEXT.busyRunning}
              naturalSourceOf={engine.naturalSourceOf}
              overrides={overrides}
              format={promptFormat}
              fullDetail={fullDetail}
              onFormatChange={setFormat}
              onCopy={copy}
              onReroll={onReroll}
              onAlways={onAlways}
              onNever={onNever}
              // Links go to the site the prompts came from; after a change of source, until Generate, none.
              postProvider={engine.sourceChanged ? undefined : provider}
            />
          )}
        </div>
      </div>

      {/* Generate stays at the panel's bottom edge, above the home indicator, whatever is scrolled. */}
      <footer className="flex-shrink-0 border-t border-border/60 bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-3">
        {/* Notices with Undo sit with Generate: always in view, whatever the brief or the list shows. */}
        <div className="mb-3 empty:hidden">
          {correction?.status === "done" && correction.message ? (
            <UndoNotice message={correction.message} onUndo={undoCorrection} onDismiss={() => setCorrection(null)} />
          ) : correcting ? (
            <p role="status" className="text-sm text-muted-foreground">{CORRECTION_TEXT.working}</p>
          ) : showUndo && pack.lastChange ? (
            <UndoNotice message={pack.lastChange} onUndo={onUndo} onDismiss={() => setUndoFor(null)} />
          ) : defaultsUndo ? (
            <UndoNotice message={defaultsUndo.message} onUndo={onUndoDefaults} onDismiss={() => setDefaultsUndo(null)} />
          ) : providerUndo ? (
            <UndoNotice message={BUILDER_TEXT.providerChanged(PROVIDER_LABELS[providerUndo.to])} onUndo={onUndoProvider} onDismiss={() => setProviderUndo(null)} />
          ) : null}
        </div>
        <GenerateBar
          count={count}
          onCountChange={pack.setPromptCount}
          onGenerate={onGenerate}
          generating={isGenerating}
          blockedReason={blockedReason}
          locked={result?.locked.length ?? 0}
        />
      </footer>

      {searching && (
        <BriefSource plan={plan} conditions={engine.conditionSupply} count={count} onResult={setSource} />
      )}
    </>
  )
}

/** What scrolls `el` into view: its nearest ancestor that scrolls (a column, or the panel's body). */
function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node
  }
  return null
}

function startNoteText(note: StartNote, poolPending: boolean): string | null {
  switch (note.kind) {
    case "restored":
      return note.dropped ? START_TEXT.restoredDropped : poolPending ? START_TEXT.restoredLoading : START_TEXT.restored
    case "characters":
      return null
    case "card": {
      const who = note.named ? START_TEXT.cardNamed : START_TEXT.cardUnnamed
      return note.outfit.length + note.pose.length > 0 ? `${who} ${START_TEXT.cardOffers}` : who
    }
    case "prompt":
      return START_TEXT.prompt
    case "search":
      return note.skipped.length > 0 ? `${START_TEXT.search} ${START_TEXT.searchSkipped(note.skipped)}` : START_TEXT.search
  }
}

// ── Results ──────────────────────────────────────────────────────────────────────

/**
 * Copies a pack's text without the gallery: no card is marked copied and no gallery state changes.
 * The rows and the toolbar say whether it was copied, a failure included (COPY_FAILED), so this
 * shows nothing of its own.
 */
async function copyPackText(text: string, format: PromptFormat, provider: BooruProvider): Promise<boolean> {
  try {
    await copyText(text)
  } catch {
    safeTrack("error_shown", { error_source: "copy_to_clipboard", provider, postId: 0, isPrompt: true })
    return false
  }
  track("prompt_copied", {
    copy_type: "ai_text",
    booru_source: provider,
    has_translated_tags: text.includes("Masterpiece"),
    prompt_format: format,
  })
  recordPromptCopy()
  return true
}

const warnTagsCopied = () => toast({ description: BUILDER_TEXT.convertFailed, variant: "destructive", duration: 3000 })
const warnTagsSent = () => toast({ description: BUILDER_TEXT.convertFailedSend, variant: "destructive", duration: 3000 })

function Results({
  containerRef,
  prompts,
  busy,
  busyReason,
  locked,
  missing,
  copyNote,
  onToggleLock,
  naturalSourceOf,
  overrides,
  format,
  fullDetail,
  onFormatChange: setFormat,
  onCopy,
  onReroll,
  onAlways,
  onNever,
  postProvider,
}: {
  /** Where focus goes after a pack is made. */
  containerRef?: RefObject<HTMLDivElement | null>
  prompts: PackPrompt[]
  /** A run is going on, or the pack is from another source: re-roll and the tag menu wait. */
  busy: boolean
  /** Said on those controls while they wait. */
  busyReason: string
  locked: readonly number[]
  /** Prompts asked for and not made. */
  missing: number
  copyNote?: string
  onToggleLock: (index: number) => void
  naturalSourceOf: (prompt: PackPrompt) => NaturalPromptSource
  overrides: Record<string, string>
  /** The pack's own format (never the gallery's) and its "every detail" length, read from the app. */
  format: PromptFormat
  fullDetail: boolean
  onFormatChange: (format: PromptFormat) => void
  onCopy: (text: string, format: PromptFormat) => Promise<boolean>
  onReroll: (index: number) => boolean
  onAlways: (tag: string) => void
  onNever: (tag: string) => void
  /** The site of the posts the prompts came from, for the links to them. */
  postProvider?: BooruProvider
}) {
  const lockedSet = useMemo(() => new Set(locked), [locked])
  // Text on screen per row, so a copy matches what is shown.
  const shownRef = useRef(new Map<number, string>())

  const bodyOf = useCallback(async (p: PackPrompt, shown?: string): Promise<{ text: string; failed: boolean }> => {
    if (format === "tags") return { text: p.prompt, failed: false }
    if (shown) return { text: shown, failed: false }
    try {
      return { text: (await convertPromptOnce(format, naturalSourceOf(p), overrides, fullDetail)).text, failed: false }
    } catch {
      return { text: p.prompt, failed: true }
    }
  }, [format, fullDetail, naturalSourceOf, overrides])

  // "Add size as [WIDTHxHEIGHT]": the old builder's preference (pack-add-resolution), kept.
  const [withSize, setWithSize] = useState(() => {
    try {
      return userPreferences.getPackAddResolution()
    } catch {
      return false
    }
  })
  const changeWithSize = useCallback((next: boolean) => {
    setWithSize(next)
    try {
      userPreferences.setPackAddResolution(next)
    } catch {
      // Storage unavailable: the choice lasts this session.
    }
  }, [])
  const sizeOption = useMemo(() => ({ value: withSize, onChange: changeWithSize }), [withSize, changeWithSize])

  // One live region for every row's copy.
  const [copySaid, setCopySaid] = useState("")
  const copyOne = useCallback(async (index: number) => {
    const p = prompts[index]
    if (!p) return false
    const body = await bodyOf(p, shownRef.current.get(index))
    if (body.failed) warnTagsCopied()
    const { text, unsized } = packCopyText([p], [body.text], withSize)
    const ok = await onCopy(text, body.failed ? "tags" : format)
    setCopySaid(ok ? `Prompt ${index + 1} copied${withSize && unsized === 0 ? " with its size" : ""}` : COPY_FAILED)
    return ok
  }, [prompts, bodyOf, onCopy, format, withSize])

  // Stable for the rows: it follows the slots, which grow with every page of posts.
  const copyRow = useStableCallback(copyOne)

  // The slots the rows convert with: those of the moment the prompts were made, renewed only when
  // the prompts change or a slot of one of their tags does. Slots looked up for the pages that
  // keep arriving are about other posts, and every row would be converted again for them.
  const promptTags = useMemo(() => {
    const out = new Set<string>()
    for (const p of prompts) for (const raw of p.prompt.split(",")) {
      const tag = bareToken(raw).toLowerCase()
      if (tag) out.add(tag).add(tag.replace(/ /g, "_"))
    }
    return out
  }, [prompts])
  const [rowSlots, setRowSlots] = useState({ prompts, overrides })
  if (rowSlots.overrides !== overrides && (rowSlots.prompts !== prompts || Array.from(promptTags).some((t) => rowSlots.overrides[t] !== overrides[t]))) {
    setRowSlots({ prompts, overrides })
  }
  const rowOverrides = rowSlots.overrides

  const [unsizedCopied, setUnsizedCopied] = useState(0)
  const copyAll = useCallback(async () => {
    const bodies = await Promise.all(prompts.map((p, i) => bodyOf(p, shownRef.current.get(i))))
    const failed = bodies.some((b) => b.failed)
    if (failed) warnTagsCopied()
    const { text, unsized } = packCopyText(prompts, bodies.map((b) => b.text), withSize)
    setUnsizedCopied(unsized)
    return onCopy(text, failed ? "tags" : format)
  }, [prompts, bodyOf, onCopy, format, withSize])
  const allCopyNote = [copyNote, unsizedCopied > 0 ? SIZE_TEXT.unsized(unsizedCopied) : null].filter(Boolean).join(" ") || undefined

  // ComfyUI mode: each row sends what its Copy copies, in the pack's format, without the
  // "[WIDTHxHEIGHT] " prefix; the suggested size goes as the image size (packSendRequest).
  const comfy = usePackComfySend()
  const { sendOne, sendAll: sendRows, dismiss: dismissSend } = comfy
  const sendRowOf = useCallback((index: number, warn: () => void, copyInstead: () => void): PackSendRow | null => {
    const p = prompts[index]
    if (!p) return null
    return {
      key: index,
      forPrompt: p.prompt,
      build: async () => {
        const body = await bodyOf(p, shownRef.current.get(index))
        if (body.failed) warn()
        return packSendRequest(p, body.text)
      },
      onCopyInstead: copyInstead,
    }
  }, [prompts, bodyOf])
  const sendRow = useStableCallback((index: number) => {
    const row = sendRowOf(index, warnTagsSent, () => void copyOne(index))
    if (row) sendOne(row)
  })
  const sendAll = useCallback(() => {
    // One warning for the whole pack when the converter can't load.
    let warned = false
    const warnOnce = () => {
      if (!warned) warnTagsSent()
      warned = true
    }
    const copyInstead = () => void copyAll()
    void sendRows(prompts.flatMap((_, i) => sendRowOf(i, warnOnce, copyInstead) ?? []))
  }, [prompts, sendRowOf, sendRows, copyAll])
  const sendOption = useMemo(
    () => (comfy.enabled ? { state: comfy.all, onSendAll: sendAll } : undefined),
    [comfy.enabled, comfy.all, sendAll],
  )

  const reroll = useStableCallback((index: number) => {
    if (!onReroll(index)) toast({ description: BUILDER_TEXT.rerollFailed, duration: 3000 })
  })

  const onFormatChange = useCallback((next: PromptFormat) => {
    if (next !== "tags") preloadNaturalPrompt()
    setFormat(next)
  }, [setFormat])

  return (
    <div ref={containerRef} tabIndex={-1} aria-label={BUILDER_TEXT.resultsLabel} className="space-y-2 focus-visible:outline-none">
      <p className="sr-only" role="status" aria-live="polite">{copySaid}</p>
      <ResultsToolbar
        formats={FORMATS}
        format={format}
        onFormatChange={onFormatChange}
        count={prompts.length}
        onCopyAll={copyAll}
        copyNote={allCopyNote}
        withSize={sizeOption}
        send={sendOption}
      >
        {missing > 0 && <span className="text-xs tabular-nums text-warning-text">{missingText(missing)}</span>}
      </ResultsToolbar>
      <div className="space-y-1.5">
        {prompts.map((p, i) => (
          <BriefResultRow
            // By position: a row whose prompt changes is the same row (focus stays in it).
            key={`row-${i}`}
            index={i}
            prompt={p}
            format={format}
            fullDetail={fullDetail}
            naturalSourceOf={naturalSourceOf}
            overrides={rowOverrides}
            shownRef={shownRef}
            locked={lockedSet.has(i)}
            busy={busy}
            busyReason={busyReason}
            onToggleLock={onToggleLock}
            onCopy={copyRow}
            onReroll={reroll}
            onAlways={onAlways}
            onNever={onNever}
            postProvider={postProvider}
            onSend={comfy.enabled ? sendRow : undefined}
            sendJob={comfy.enabled ? comfy.jobOf(i, p.prompt) : null}
            sending={comfy.enabled && comfy.sending.has(i)}
            onDismissSend={dismissSend}
          />
        ))}
      </div>
    </div>
  )
}

/** A result row in the chosen format: tags, or the prompt converted the way a gallery card is. */
const BriefResultRow = memo(function BriefResultRow({
  index,
  prompt,
  format,
  fullDetail,
  naturalSourceOf,
  overrides,
  shownRef,
  locked,
  busy,
  busyReason,
  onToggleLock,
  onCopy,
  onReroll,
  onAlways,
  onNever,
  postProvider,
  onSend,
  sendJob,
  sending,
  onDismissSend,
}: {
  postProvider?: BooruProvider
  onSend?: (index: number) => void
  sendJob: ComfySent | null
  sending: boolean
  onDismissSend: (index: number) => void
  locked: boolean
  busy: boolean
  busyReason: string
  onToggleLock: (index: number) => void
  index: number
  prompt: PackPrompt
  format: PromptFormat
  fullDetail: boolean
  naturalSourceOf: (prompt: PackPrompt) => NaturalPromptSource
  overrides: Record<string, string>
  shownRef: RefObject<Map<number, string>>
  onCopy: (index: number) => Promise<boolean>
  onReroll: (index: number) => void
  onAlways: (tag: string) => void
  onNever: (tag: string) => void
}) {
  const source = useMemo(() => naturalSourceOf(prompt), [naturalSourceOf, prompt])
  const natural = useNaturalPrompt({ enabled: true, format, fullDetail, source, overrides })
  const text = natural.prompt?.text
  useEffect(() => {
    const shown = shownRef.current
    if (text) shown.set(index, text)
    else shown.delete(index)
  }, [shownRef, index, text])
  const tokens = useMemo(() => promptTokens(prompt), [prompt])
  return (
    <ResultRow
      index={index}
      character={prompt.character ? characterName(prompt.character) : undefined}
      tokens={tokens}
      text={text}
      postId={prompt.scene?.postId}
      postHref={scenePostHref(postProvider, prompt.scene)}
      postSite={postProvider ? PROVIDER_LABELS[postProvider] : undefined}
      inventedScene={!!prompt.scene?.invented}
      size={promptSize(prompt)}
      pending={format !== "tags" && natural.status === "loading"}
      locked={locked}
      busy={busy}
      busyReason={busyReason}
      announce={false}
      onToggleLock={onToggleLock}
      onCopy={onCopy}
      onReroll={onReroll}
      onAlways={onAlways}
      onNever={onNever}
      onSend={onSend}
      sendJob={sendJob}
      sending={sending}
      onDismissSend={onDismissSend}
    />
  )
})
