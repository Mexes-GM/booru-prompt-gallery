"use client"

/**
 * Several characters at once, for Who: the most posted ones, or the ones of a series typed with
 * suggestions, by gender, as many as the stepper says, drawn at random from the top or most popular
 * first. The names to be added are shown before adding; Shuffle draws others.
 *
 * - CastPickerForm: the form, also used by the entry dialog.
 * - CastPickerButton: "Add several" in Who, opening the form in a popover.
 *
 * The characters come from the static index (lib/pack/cast-picker.ts): no request to any site.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Dices, Minus, Plus, Shuffle, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { BooruProvider } from "@/lib/booru/types"
import type { CastMember, RandomCast } from "@/lib/pack/brief"
import {
  castCandidates, castMembers, drawCast, findSeries, loadCharacterIndex,
  type CastGender, type CastOrder, type CastSource, type CharacterIndex, type SeriesEntry,
} from "@/lib/pack/cast-picker"
import { drawRandomCast } from "@/lib/pack/random-cast"
import { MAX_TURNS_CAST } from "@/lib/pack/scene/cast"
import { cn } from "@/lib/utils"
import { ChoiceGroup, type Choice } from "./choice-group"
import { CAST_PICKER_TEXT as T, RANDOM_CAST_TEXT as R } from "./pack-text"
import { characterName } from "./slots"

/** The character index, loaded once `enabled` (null until then, or when it can't be read). */
export function useCharacterIndex(enabled = true): CharacterIndex | null {
  const [index, setIndex] = useState<CharacterIndex | null>(null)
  useEffect(() => {
    if (!enabled || index) return
    let active = true
    void loadCharacterIndex().then((loaded) => { if (active) setIndex(loaded) })
    return () => { active = false }
  }, [enabled, index])
  return index
}

/** How many the stepper starts at. */
export const DEFAULT_CAST_COUNT = 6

type SourceKind = "popular" | "series"

const SOURCE_CHOICES: Choice<SourceKind>[] = [
  { value: "popular", label: T.popular },
  { value: "series", label: T.series },
]
const GENDER_CHOICES: Choice<CastGender>[] = [
  { value: "girls", label: T.girls },
  { value: "boys", label: T.boys },
  { value: "any", label: T.any },
]
const ORDER_CHOICES: Choice<CastOrder>[] = [
  { value: "random", label: T.random },
  { value: "popular", label: T.mostPopular },
]

/** "genshin impact" -> "Genshin Impact"; a qualifier stays as written: "Fate (series)". */
export function seriesName(name: string): string {
  return name.replace(/(^|[\s:/-])([a-z])/g, (_m, before: string, letter: string) => before + letter.toUpperCase())
    .replace(/\(([^)]*)\)/g, (_m, inner: string) => `(${inner.toLowerCase()})`)
}

const newSeed = () => Math.floor(Math.random() * 0x7fffffff)

const ROW = "grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1"
const LABEL = "text-xs font-medium text-muted-foreground"
const STEP =
  "grid h-full w-8 shrink-0 place-items-center text-muted-foreground pointer-coarse:w-11 " +
  "transition-[color,background-color] duration-150 ease-out-strong hover:bg-muted hover:text-foreground " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring " +
  "disabled:pointer-events-none disabled:opacity-40"

export interface CastPickerFormProps {
  /** The pack's site: Rule34 gets its own names for the characters. */
  provider: BooruProvider
  /** Characters already in the pack (any spelling): never picked again. */
  exclude?: readonly string[]
  /** How many more characters the pack can take. */
  room?: number
  onAdd: (members: CastMember[]) => void
  /** The button's text for this many characters; "Add 6 characters" by default. */
  submitLabel?: (count: number) => string
  className?: string
}

/** The picker itself: where from, gender, how many, the order, the names it will add, and Add. */
export const CastPickerForm = memo(function CastPickerForm({ provider, exclude = [], room = MAX_TURNS_CAST, onAdd, submitLabel = T.add, className }: CastPickerFormProps) {
  const [index, setIndex] = useState<CharacterIndex | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void loadCharacterIndex().then((loaded) => {
      if (!active) return
      setIndex(loaded)
      setStatus(loaded ? "ready" : "failed")
    })
    return () => { active = false }
  }, [attempt])
  const retry = () => {
    setStatus("loading")
    setAttempt((n) => n + 1)
  }

  const [source, setSource] = useState<SourceKind>("popular")
  const [series, setSeries] = useState<SeriesEntry | null>(null)
  const [gender, setGender] = useState<CastGender>("girls")
  const max = Math.max(1, Math.min(MAX_TURNS_CAST, room))
  const [wanted, setWanted] = useState(DEFAULT_CAST_COUNT)
  const count = Math.min(wanted, max)
  const [order, setOrder] = useState<CastOrder>("random")
  const [seed, setSeed] = useState(newSeed)

  const excludeKey = exclude.join("|")
  const candidates = useMemo(() => {
    if (!index) return []
    if (source === "series" && !series) return []
    return castCandidates(index, {
      source: source === "series" && series ? { kind: "series", series: series.name } : { kind: "popular" },
      gender,
      exclude: excludeKey ? excludeKey.split("|") : [],
    })
  }, [index, source, series, gender, excludeKey])
  const picked = useMemo(() => drawCast(candidates, count, order, seed), [candidates, count, order, seed])

  const full = room <= 0
  const waitingForSeries = source === "series" && !series
  const add = () => {
    if (picked.length === 0 || full) return
    onAdd(castMembers(picked, provider))
  }

  const previewId = useId()
  const countId = useId()

  if (status !== "ready" || !index) {
    return (
      <div className={cn("space-y-2 text-sm", className)}>
        {status === "failed" ? (
          <>
            <p className="text-muted-foreground">{T.failed}</p>
            <Button type="button" variant="outline" size="sm" onClick={retry} className="pointer-coarse:h-11">{T.retry}</Button>
          </>
        ) : (
          <p className="text-muted-foreground" role="status">{T.loading}</p>
        )}
      </div>
    )
  }

  return (
    <div className={cn("space-y-3", className)}>
      <ChoiceGroup choices={SOURCE_CHOICES} value={source} onChange={setSource} label={T.sourceLabel} className="w-full [&>button]:flex-1" />

      {source === "series" && (
        <SeriesField index={index} value={series} onChange={setSeries} />
      )}

      <div className={ROW}>
        <span className={LABEL} id={`${countId}-gender`}>{T.genderLabel}</span>
        <ChoiceGroup size="sm" choices={GENDER_CHOICES} value={gender} onChange={setGender} labelledBy={`${countId}-gender`} className="justify-self-start" />

        <label htmlFor={countId} className={LABEL}>{T.countLabel}</label>
        <div className="flex h-8 w-fit items-center overflow-hidden rounded-lg border border-border/80 bg-background focus-within:ring-2 focus-within:ring-ring/40 pointer-coarse:h-11">
          <button type="button" tabIndex={-1} aria-label={T.fewer} disabled={count <= 1} onClick={() => setWanted(Math.max(1, count - 1))} className={STEP}>
            <Minus className="size-3.5" aria-hidden />
          </button>
          <input
            id={countId}
            type="number"
            inputMode="numeric"
            min={1}
            max={max}
            value={count}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10)
              if (Number.isFinite(n)) setWanted(Math.min(max, Math.max(1, n)))
            }}
            className={cn(
              "h-full w-9 text-center font-mono text-sm tabular-nums text-foreground outline-none pointer-coarse:w-11",
              "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            )}
          />
          <button type="button" tabIndex={-1} aria-label={T.more} disabled={count >= max} onClick={() => setWanted(Math.min(max, count + 1))} className={STEP}>
            <Plus className="size-3.5" aria-hidden />
          </button>
        </div>

        <span className={LABEL} id={`${countId}-order`}>{T.orderLabel}</span>
        <ChoiceGroup size="sm" choices={ORDER_CHOICES} value={order} onChange={setOrder} labelledBy={`${countId}-order`} describedBy={`${countId}-order-hint`} className="justify-self-start" />
        <p id={`${countId}-order-hint`} className="col-start-2 text-xs text-muted-foreground text-pretty">
          {order === "random" ? T.randomHint : T.popularHint}
        </p>
      </div>

      <div className="rounded-lg bg-muted/45 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className={LABEL}>{T.previewLabel}</span>
          {order === "random" && picked.length > 0 && candidates.length > picked.length && (
            <button
              type="button"
              onClick={() => setSeed(newSeed())}
              aria-label={T.shuffleSpoken}
              aria-controls={previewId}
              className={cn(
                "-my-1 -mr-1.5 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-foreground pointer-coarse:h-11",
                "transition-[background-color] duration-150 ease-out-strong hover:bg-background/80",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <Shuffle className="size-3.5 text-muted-foreground" aria-hidden />
              {T.shuffle}
            </button>
          )}
        </div>
        <p id={previewId} aria-live="polite" className="mt-1 text-[13px] leading-relaxed text-foreground text-pretty">
          {waitingForSeries
            ? <span className="text-muted-foreground">{T.pickSeries}</span>
            : picked.length > 0
              ? picked.map((c) => characterName(c.tag)).join(", ")
              : <span className="text-muted-foreground">{T.none(gender, series ? seriesName(series.name) : null)}</span>}
        </p>
      </div>

      <div className="space-y-1.5">
        <Button type="button" onClick={add} disabled={picked.length === 0 || full} className="w-full pointer-coarse:h-11">
          {submitLabel(picked.length || count)}
        </Button>
        <p className="text-center text-xs text-muted-foreground text-pretty">
          {full ? T.full(MAX_TURNS_CAST) : room < MAX_TURNS_CAST && room <= count ? `${T.addsTurns} ${T.room(room)}` : T.addsTurns}
        </p>
      </div>
    </div>
  )
})

/** A series typed with suggestions; picking one sets it, typing again clears it. */
function SeriesField({ index, value, onChange }: { index: CharacterIndex; value: SeriesEntry | null; onChange: (series: SeriesEntry | null) => void }) {
  const id = useId()
  const listId = `${id}-list`
  const [draft, setDraft] = useState(value ? seriesName(value.name) : "")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const matches = useMemo(() => (value ? [] : findSeries(index, draft)), [index, draft, value])
  const showList = open && !value && draft.trim().length >= 2
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const pick = useCallback((entry: SeriesEntry) => {
    onChange(entry)
    setDraft(seriesName(entry.name))
    setOpen(false)
    setActive(-1)
  }, [onChange])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (matches.length === 0) return
      e.preventDefault()
      setOpen(true)
      const n = matches.length
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const entry = matches[active] ?? matches[0]
      if (entry) pick(entry)
    } else if (e.key === "Escape" && showList) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">{T.seriesLabel}</label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        value={draft}
        placeholder={T.seriesPlaceholder}
        onChange={(e) => {
          setDraft(e.target.value)
          setOpen(true)
          setActive(-1)
          if (value) onChange(null)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={cn(
          "h-9 w-full rounded-lg bg-muted/55 px-2.5 text-sm text-foreground outline-none pointer-coarse:h-11",
          "transition-[background-color,box-shadow] duration-150 ease-out-strong placeholder:text-muted-foreground",
          "hover:bg-muted focus:bg-background focus:ring-2 focus:ring-ring/60",
        )}
      />
      {value && (
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs tabular-nums text-muted-foreground">
          {T.seriesCount(value.characters)}
        </span>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label={T.seriesLabel}
        hidden={!showList}
        className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-56 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      >
        {matches.map((entry, i) => (
          <li
            key={entry.name}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(entry)}
            onMouseMove={() => i !== active && setActive(i)}
            className={cn(
              "flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-[13px] pointer-coarse:py-3",
              i === active ? "bg-accent text-accent-foreground" : "text-foreground",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{seriesName(entry.name)}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{T.seriesCount(entry.characters)}</span>
          </li>
        ))}
        {matches.length === 0 && (
          <li role="presentation" className="px-2 py-1.5 text-xs text-muted-foreground">{T.seriesNone}</li>
        )}
      </ul>
    </div>
  )
}

export interface CastPickerButtonProps extends Omit<CastPickerFormProps, "className"> {
  className?: string
}

/** "Add several" in Who: the picker in a popover, closed once the characters are added. */
export const CastPickerButton = memo(function CastPickerButton({ onAdd, className, ...form }: CastPickerButtonProps) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const added = useCallback((members: CastMember[]) => {
    onAdd(members)
    setOpen(false)
  }, [onAdd])
  return (
    <Popover open={open} onOpenChange={setOpen} closeOnScroll={false}>
      <PopoverTrigger
        aria-label={T.openSpoken}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground pointer-coarse:h-11",
          "transition-[color,background-color] duration-150 ease-out-strong",
          "hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <Users className="size-3.5 text-mode-pack-text" aria-hidden />
        {T.open}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        aria-labelledby={titleId}
        className="w-[min(22rem,calc(100vw-1.5rem))] max-h-(--radix-popover-content-available-height) overflow-y-auto overscroll-contain p-4"
      >
        <h3 id={titleId} className="mb-3 text-sm font-semibold text-foreground">{T.title}</h3>
        <CastPickerForm {...form} onAdd={added} />
      </PopoverContent>
    </Popover>
  )
})

// ── Random characters ─────────────────────────────────────────────────────────

type RandomGender = RandomCast["gender"]

const RANDOM_GENDER_CHOICES: Choice<RandomGender>[] = [
  { value: "auto", label: R.auto },
  { value: "girls", label: T.girls },
  { value: "boys", label: T.boys },
  { value: "any", label: T.any },
]

export interface RandomCastFormProps {
  provider: BooruProvider
  /** The current choice, to change it; null for a new one. */
  value: RandomCast | null
  /** What Auto is with the pack's People (lib/pack/random-cast.ts randomCastGender). */
  autoGender: CastGender
  /** Prompts the pack makes: one character each. */
  promptCount: number
  onSubmit: (randomCast: RandomCast) => void
  className?: string
}

/** Random characters: where they come from and their gender; Use draws one per prompt. */
export const RandomCastForm = memo(function RandomCastForm({ provider, value, autoGender, promptCount, onSubmit, className }: RandomCastFormProps) {
  const index = useCharacterIndex(true)
  const [source, setSource] = useState<SourceKind>(value?.source.kind ?? "popular")
  const [series, setSeries] = useState<SeriesEntry | null>(() => {
    const name = value?.source.kind === "series" ? value.source.series : null
    return name ? { name, characters: 0, posts: 0 } : null
  })
  // A series kept from before gets its count once the index is here.
  const shownSeries = useMemo(() => (series && index ? index.series.find((x) => x.name === series.name) ?? series : series), [series, index])
  const [gender, setGender] = useState<RandomGender>(value?.gender ?? "auto")
  const genderId = useId()
  const resolved: CastGender = gender === "auto" ? autoGender : gender
  const seriesKey = source === "series" ? shownSeries?.name ?? null : null
  const castSource = useMemo<CastSource | null>(
    () => (source === "popular" ? { kind: "popular" } : seriesKey ? { kind: "series", series: seriesKey } : null),
    [source, seriesKey]
  )
  const available = useMemo(() => (index && castSource ? castCandidates(index, { source: castSource, gender: resolved }).length : 0), [index, castSource, resolved])

  const submit = () => {
    if (!index || !castSource) return
    const drawn = drawRandomCast(index, { source: castSource, gender: resolved, count: promptCount, seed: newSeed(), provider })
    if (drawn.length === 0) return
    onSubmit({ source: castSource, gender, drawn })
  }

  if (!index) return <p className={cn("text-sm text-muted-foreground", className)} role="status">{T.loading}</p>
  return (
    <div className={cn("space-y-3", className)}>
      <p className="text-xs text-muted-foreground text-pretty">{R.intro}</p>
      <ChoiceGroup choices={SOURCE_CHOICES} value={source} onChange={setSource} label={T.sourceLabel} className="w-full [&>button]:flex-1" />
      {source === "series" && <SeriesField index={index} value={shownSeries} onChange={setSeries} />}
      <div className={ROW}>
        <span className={LABEL} id={genderId}>{T.genderLabel}</span>
        <ChoiceGroup size="sm" choices={RANDOM_GENDER_CHOICES} value={gender} onChange={setGender} labelledBy={genderId} describedBy={`${genderId}-hint`} className="justify-self-start" />
        <p id={`${genderId}-hint`} className="col-start-2 text-xs text-muted-foreground text-pretty">
          {gender === "auto" ? R.autoHint(autoGender) : " "}
        </p>
      </div>
      {castSource && available === 0 && (
        <p className="text-xs text-muted-foreground">{T.none(resolved, shownSeries ? seriesName(shownSeries.name) : null)}</p>
      )}
      {castSource && available > 0 && available < promptCount && (
        <p className="text-xs text-muted-foreground text-pretty">{R.few(available)}</p>
      )}
      <Button type="button" onClick={submit} disabled={!castSource || available === 0} className="w-full pointer-coarse:h-11">
        {value ? R.update : R.use}
      </Button>
    </div>
  )
})

export interface RandomCastButtonProps extends Omit<RandomCastFormProps, "className" | "value"> {
  value?: RandomCast | null
  /** The trigger's text; "Random characters" by default. */
  label?: string
  className?: string
}

/** "Random characters" in an empty Who (or "Change" on its chip): the form in a popover. */
export const RandomCastButton = memo(function RandomCastButton({ onSubmit, label = R.open, className, value = null, ...form }: RandomCastButtonProps) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const submitted = useCallback((randomCast: RandomCast) => {
    onSubmit(randomCast)
    setOpen(false)
  }, [onSubmit])
  return (
    <Popover open={open} onOpenChange={setOpen} closeOnScroll={false}>
      <PopoverTrigger
        aria-label={value ? undefined : R.openSpoken}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground pointer-coarse:h-11",
          "transition-[color,background-color] duration-150 ease-out-strong",
          "hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {!value && <Dices className="size-3.5 text-mode-pack-text" aria-hidden />}
        {label}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        aria-labelledby={titleId}
        className="w-[min(22rem,calc(100vw-1.5rem))] max-h-(--radix-popover-content-available-height) overflow-y-auto overscroll-contain p-4"
      >
        <h3 id={titleId} className="mb-2 text-sm font-semibold text-foreground">{R.title}</h3>
        <RandomCastForm {...form} value={value} onSubmit={submitted} />
      </PopoverContent>
    </Popover>
  )
})
