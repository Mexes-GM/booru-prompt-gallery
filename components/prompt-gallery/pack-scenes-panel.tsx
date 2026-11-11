"use client"

/**
 * Pack Builder's setup for the scenes engine (hooks/use-pack-scenes.ts), in
 * place of the per-category list. Top to bottom: the character (chips pinned
 * in every prompt or left to each scene), who is in the picture, the
 * situations of the pool (each with a switch and a few example thumbnails),
 * then Mix, Clothing, Scenery and Extras.
 *
 * Same visual language as the category list: neutral cards, the Pack Mode
 * colour only on active choices.
 */
import { memo, useId, useState } from "react"
import Image from "next/image"
import { AlertTriangle, ChevronDown, Database, Loader2, Pin, Plus, RefreshCw, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { getPostThumbnailUrl } from "@/lib/proxy-url"
import { OTHER_SITUATION, type PackPeople, type Situation } from "@/lib/pack/scene/scene-pool"
import type { SceneChip, ScenePackSettings } from "@/lib/pack/scene-pack"
import type { UsePackScenesResult } from "@/hooks/use-pack-scenes"
import { TagAutocompleteTextarea } from "./tag-autocomplete-textarea"
import { radioGroupKeyDown } from "./radio-keys"

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** "1 girl", "2 girls", "1 girl, 1 boy". */
function compositionLabel(people: PackPeople): string {
  const parts: string[] = []
  if (people.girls > 0) parts.push(plural(people.girls, "girl"))
  if (people.boys > 0) parts.push(plural(people.boys, "boy"))
  return parts.join(", ")
}

/** A situation's name from its tags: "Lying · on back"; the catch-all reads "Everything else". */
function situationLabel(situation: Situation): string {
  return situation.id === OTHER_SITUATION ? "Everything else" : capitalize(situation.label.join(" · "))
}

interface Option<T extends string> {
  value: T
  label: string
  hint: string
}

/** Single-choice row of buttons (arrow keys move the choice), with the chosen option's one-line hint under it. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  extra,
}: {
  label: string
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
  extra?: React.ReactNode
}) {
  const id = useId()
  const current = options.find((o) => o.value === value) ?? options[0]
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span id={id} className="text-sm font-semibold">{label}</span>
        <div
          className="inline-flex rounded-lg border border-border/60 bg-muted/40 p-0.5"
          role="radiogroup"
          aria-labelledby={id}
          onKeyDown={(e) => radioGroupKeyDown(e, options.map((o) => o.value), current.value, onChange)}
        >
          {options.map((opt) => {
            const active = opt.value === current.value
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => onChange(opt.value)}
                className={`h-8 pointer-coarse:h-11 px-2.5 text-xs font-medium rounded-md transition-colors ${
                  active ? "bg-mode-pack text-mode-pack-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{current.hint}</p>
      {extra}
    </div>
  )
}

const MIX_OPTIONS: readonly Option<ScenePackSettings["mix"]>[] = [
  { value: "faithful", label: "Faithful", hint: "Keeps each scene as it is. Only the character changes." },
  { value: "remix", label: "Remix", hint: "Swaps the expression, camera, place and outfit between matching scenes for more variety." },
]
const CLOTHING_FROM_SCENE: Option<ScenePackSettings["clothing"]> = { value: "scene", label: "From the scene", hint: "Each prompt wears what the scene's character wore." }
const CLOTHING_FROM_BASE: Option<ScenePackSettings["clothing"]> = { value: "base", label: "From the base", hint: "Every prompt wears your base's clothes instead of the scene's." }
const CLOTHING_FROM_LIBRARY: Option<ScenePackSettings["clothing"]> = { value: "library", label: "Outfit library", hint: "Whole outfits in the styles chosen under Customize prompt › Outfit." }
const SCENERY_OPTIONS: readonly Option<ScenePackSettings["scenery"]>[] = [
  { value: "scene", label: "From the scene", hint: "Keeps each scene's place." },
  { value: "vary", label: "Vary", hint: "Moves each scene to another place that fits the pose." },
  { value: "plain", label: "Plain background", hint: "Puts the character on a plain background." },
]

const sectionClass = "rounded-xl border border-border/70 bg-card/70 p-3 sm:p-4 space-y-3"

/** One Character chip: select it to pin it or leave it to the scene; the X removes it. */
function TraitChip({ chip, onToggle, onRemove }: { chip: SceneChip; onToggle: (tag: string) => void; onRemove: (tag: string) => void }) {
  const pinned = chip.state === "pinned"
  return (
    <span
      className={`group inline-flex items-center max-w-full rounded-md border font-mono text-xs leading-5 ${
        pinned ? "bg-foreground/[0.07] border-border text-foreground" : "border-dashed border-border/70 text-muted-foreground"
      }`}
    >
      <button
        type="button"
        aria-pressed={pinned}
        aria-label={`Pin ${chip.tag} in every prompt`}
        title={pinned ? "In every prompt. Select to let each scene decide." : "Only when the scene has it. Select to pin it in every prompt."}
        onClick={() => onToggle(chip.tag)}
        className="relative inline-flex items-center gap-1 min-w-0 rounded-l-md pl-1.5 pr-1 py-0.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-y-3 pointer-coarse:after:inset-x-0 pointer-coarse:after:content-['']"
      >
        {pinned && <Pin className="w-3 h-3 flex-shrink-0" aria-hidden />}
        <span className="truncate max-w-[14rem]">{chip.tag}</span>
      </button>
      <button
        type="button"
        onClick={() => onRemove(chip.tag)}
        aria-label={`Remove ${chip.tag} from every prompt`}
        className="relative mr-0.5 rounded p-0.5 text-faint-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5 pointer-coarse:after:content-[''] hover:text-destructive-text hover:bg-destructive-soft transition-[color,background-color,opacity]"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  )
}

export interface PackScenesPanelProps {
  scenes: UsePackScenesResult
  settings: ScenePackSettings
  onSettingsChange: (settings: ScenePackSettings) => void
  /** Removes (or puts back) a base tag: removed tags never appear. */
  onToggleRemovedTag: (tag: string) => void
  /** The base is a card (else a pasted prompt or a character); names the fold of the base's other tags. */
  baseIsCard: boolean
  hasMultipleCharacters: boolean
  isCollecting: boolean
  /** Posts collected for the source. */
  loadedPostCount: number
  promptCount: number
  canLoadMorePosts: boolean
  onLoadMorePosts: () => void
  onOpenSource: () => void
}

/** Why posts were left out, with the verb agreeing with the count. */
function reasonsOf(scenes: UsePackScenesResult): string[] {
  const stats = scenes.pool?.stats
  if (!stats) return []
  const line = (n: number, one: string, many: string) => (n > 0 ? [`${n} ${n === 1 ? one : many}`] : [])
  return [
    ...line(scenes.otherRatingPosts, "has another content rating", "have another content rating"),
    ...line(stats.blocked, "was filtered out by the content rules", "were filtered out by the content rules"),
    ...line(stats.notIllustration, "is a photo", "are photos"),
    ...line(stats.nearDuplicates, "is a near-copy of another post", "are near-copies of other posts"),
    ...line(stats.unextractable, "has no character to replace", "have no character to replace"),
    ...line(stats.belowQuality, "has too few tags to describe a scene", "have too few tags to describe a scene"),
    ...line(
      stats.incompatible,
      scenes.compositions.length > 1 ? "shows a different group of people (pick it above)" : "shows a different group of people",
      scenes.compositions.length > 1 ? "show a different group of people (pick it above)" : "show a different group of people"
    ),
  ]
}

function PackScenesPanelComponent({
  scenes,
  settings,
  onSettingsChange,
  onToggleRemovedTag,
  baseIsCard,
  hasMultipleCharacters,
  isCollecting,
  loadedPostCount,
  promptCount,
  canLoadMorePosts,
  onLoadMorePosts,
  onOpenSource,
}: PackScenesPanelProps) {
  const peopleId = useId()
  const situationsId = useId()
  const addId = useId()
  const { pool, chips, removedChips, compositions, people, disabledSituations, enabledScenes } = scenes
  const off = new Set(disabledSituations)
  const set = <K extends keyof ScenePackSettings>(key: K, value: ScenePackSettings[K]) => onSettingsChange({ ...settings, [key]: value })

  const [showMore, setShowMore] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState("")
  const [refused, setRefused] = useState(false)

  // The base's other tags stay folded unless pinned: they'd crowd the character.
  const mainChips = chips.filter((chip) => chip.origin !== "base" || chip.state === "pinned")
  const foldedChips = chips.filter((chip) => chip.origin === "base" && chip.state !== "pinned")
  const removeChip = (tag: string) => {
    scenes.resetChip(tag)
    onToggleRemovedTag(tag)
  }
  const restoreRemoved = () => {
    removedChips.forEach((tag) => {
      scenes.resetChip(tag)
      onToggleRemovedTag(tag)
    })
  }
  const submitDraft = () => {
    if (!draft.trim()) return
    const rejected = scenes.addTraits(draft)
    setRefused(rejected.length > 0)
    setDraft("")
  }

  const clothingOptions = [CLOTHING_FROM_SCENE, ...(scenes.hasBaseClothing ? [CLOTHING_FROM_BASE] : []), CLOTHING_FROM_LIBRARY]
  const clothing = settings.clothing === "base" && !scenes.hasBaseClothing ? "scene" : settings.clothing

  const noScenes = !!pool && pool.scenes.length === 0
  const finding = !scenes.loadFailed && (!pool || (noScenes && isCollecting))
  const allOff = !!pool && pool.scenes.length > 0 && enabledScenes === 0
  const fewScenes = enabledScenes > 0 && enabledScenes < promptCount
  const reasons = reasonsOf(scenes)
  const peopleValues = compositions.map((c) => c.people)
  const currentPeople = peopleValues.find((p) => !!people && p.girls === people.girls && p.boys === people.boys) ?? peopleValues[0]

  return (
    <div className="@container space-y-2">
      {/* Who: the character's look and clothes */}
      <section className={sectionClass} aria-label="Character">
        <div>
          <h3 className="text-sm font-semibold">Character</h3>
          <p className="text-xs text-muted-foreground">How the character looks and what they wear. It doesn&apos;t change which scenes are picked.</p>
        </div>
        {hasMultipleCharacters && (
          <p className="text-xs text-muted-foreground">Only the traits that match the character you picked are listed.</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {mainChips.map((chip) => (
            <TraitChip key={chip.tag} chip={chip} onToggle={scenes.toggleChip} onRemove={removeChip} />
          ))}
          {mainChips.length === 0 && (
            <span className="text-xs text-muted-foreground italic py-0.5">
              {isCollecting ? "Finding the character's look…" : "Nothing pinned. The scenes decide the look."}
            </span>
          )}
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 min-h-7 pointer-coarse:min-h-11 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          )}
          {removedChips.length > 0 && (
            <button
              type="button"
              onClick={restoreRemoved}
              className="inline-flex items-center gap-1 min-h-7 pointer-coarse:min-h-11 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="w-3 h-3" />
              {removedChips.length} removed · Restore
            </button>
          )}
        </div>
        {adding && (
          <div className="space-y-1">
            <label htmlFor={addId} className="text-xs font-medium text-muted-foreground">Add to the character</label>
            <div className="flex items-start gap-1.5">
              <TagAutocompleteTextarea
                id={addId}
                value={draft}
                onValueChange={(value) => {
                  setDraft(value)
                  setRefused(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.defaultPrevented) {
                    e.preventDefault()
                    submitDraft()
                  }
                }}
                placeholder="e.g. red scarf, glasses"
                rows={1}
                className="text-xs font-mono min-h-[2.25rem] h-9 resize-none py-2"
              />
              <Button type="button" variant="outline" size="sm" onClick={submitDraft} disabled={!draft.trim()} className="h-9 pointer-coarse:h-11 text-xs">
                Add
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setAdding(false); setDraft(""); setRefused(false) }} className="h-9 pointer-coarse:h-11 text-xs">
                Done
              </Button>
            </div>
            {refused && (
              <p className="text-xs text-warning-text" role="status">Set the number of people under Who&apos;s in the picture.</p>
            )}
          </div>
        )}
        {foldedChips.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              aria-expanded={showMore}
              className="inline-flex items-center gap-1 min-h-7 pointer-coarse:min-h-11 text-xs text-muted-foreground hover:text-foreground"
            >
              {baseIsCard ? "More from this card" : "More from your prompt"} ({foldedChips.length})
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMore ? "rotate-180" : ""}`} />
            </button>
            {showMore && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {foldedChips.map((chip) => (
                  <TraitChip key={chip.tag} chip={chip} onToggle={scenes.toggleChip} onRemove={removeChip} />
                ))}
              </div>
            )}
          </div>
        )}
        <p className="flex items-start gap-1 text-xs text-muted-foreground">
          <Pin className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden />
          <span>Pinned tags go in every prompt and replace the scene&apos;s own. Dashed ones appear only when the scene has them. Select a tag to switch it, or remove it to keep it out of every prompt.</span>
        </p>
      </section>

      {/* Pool state: still looking, failed to load, or nothing usable and why */}
      {scenes.loadFailed && (
        <section className={`${sectionClass} border-warning-border bg-warning-soft`} role="alert">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-warning-text">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            Couldn&apos;t load the scene data
          </p>
          <p className="text-xs text-foreground/85">Check your connection and try again.</p>
          <Button type="button" size="sm" variant="outline" onClick={scenes.retryLoad} className="h-8 pointer-coarse:h-11 text-xs gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Try again
          </Button>
        </section>
      )}
      {finding && (
        <section className={`${sectionClass} flex items-center gap-2`} aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin text-mode-pack-text flex-shrink-0" />
          <p className="text-xs text-muted-foreground">Finding scenes in the collected posts…</p>
        </section>
      )}
      {noScenes && !isCollecting && (
        <section className={`${sectionClass} border-warning-border bg-warning-soft`} aria-live="polite">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-warning-text">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            No usable scenes yet
          </p>
          {reasons.length > 0 ? (
            <div className="text-xs text-foreground/85">
              <p>Out of {plural(loadedPostCount, "post")}:</p>
              <ul className="mt-1 list-disc pl-5 space-y-0.5">
                {reasons.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-foreground/85">No posts were collected for this source.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {canLoadMorePosts && (
              <Button type="button" size="sm" variant="outline" onClick={onLoadMorePosts} className="h-8 pointer-coarse:h-11 text-xs gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                Collect more posts
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={onOpenSource} className="h-8 pointer-coarse:h-11 text-xs gap-1.5">
              <Database className="w-3.5 h-3.5" />
              Change source
            </Button>
          </div>
        </section>
      )}

      {/* Who's in the picture */}
      {compositions.length > 0 && currentPeople && (
        <section className={sectionClass} aria-labelledby={peopleId}>
          <h3 id={peopleId} className="text-sm font-semibold">Who&apos;s in the picture</h3>
          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-labelledby={peopleId}
            onKeyDown={(e) => radioGroupKeyDown(e, peopleValues, currentPeople, scenes.setPeople)}
          >
            {compositions.map((c) => {
              const active = c.people === currentPeople
              const label = compositionLabel(c.people)
              return (
                <button
                  key={`${c.people.girls}/${c.people.boys}`}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  aria-label={`${label}, ${plural(c.scenes, "scene")}`}
                  onClick={() => scenes.setPeople(c.people)}
                  className={`inline-flex items-center gap-1.5 min-h-8 pointer-coarse:min-h-11 rounded-md border px-2.5 text-xs transition-colors ${
                    active ? "bg-mode-pack text-mode-pack-foreground border-transparent" : "bg-background border-border/70 text-foreground hover:bg-muted"
                  }`}
                >
                  <span className="font-medium">{label}</span>
                  <span className={`tabular-nums ${active ? "text-mode-pack-foreground/80" : "text-muted-foreground"}`}>{c.scenes}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Situations */}
      {pool && pool.situations.length > 0 && (
        <section className={sectionClass} aria-labelledby={situationsId}>
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h3 id={situationsId} className="text-sm font-semibold">Situations</h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {enabledScenes} of {plural(pool.scenes.length, "scene")} on
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Groups of similar scenes from the collected posts. Turn off the ones you don&apos;t want in the pack.</p>
          <ul className="grid grid-cols-1 @xl:grid-cols-2 gap-1.5">
            {pool.situations.map((situation) => {
              const on = !off.has(situation.id)
              const label = situationLabel(situation)
              const switchId = `pack-situation-${situation.id.replace(/[^a-z0-9]+/gi, "-")}`
              return (
                <li
                  key={situation.id}
                  className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 ${on ? "border-border/60 bg-background/60" : "border-dashed border-border/60"}`}
                >
                  <div className={`flex -space-x-2 flex-shrink-0 ${on ? "" : "opacity-40"}`} aria-hidden>
                    {situation.previews.map((src) => (
                      <div key={src} className="relative w-8 h-11 rounded-md overflow-hidden bg-muted border border-background">
                        <Image src={getPostThumbnailUrl(src)} alt="" fill sizes="32px" className="object-cover" unoptimized />
                      </div>
                    ))}
                  </div>
                  <label htmlFor={switchId} className="min-w-0 flex-1 cursor-pointer">
                    <span className={`block text-xs font-medium truncate ${on ? "text-foreground" : "text-muted-foreground"}`} title={label}>
                      {label}
                    </span>
                    <span className="block text-xs text-muted-foreground tabular-nums">{plural(situation.sceneIds.length, "scene")}</span>
                  </label>
                  {/* The switch is 24px tall; the wrapper gives it a 44px target on touch. */}
                  <span className="flex items-center justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                    <Switch
                      id={switchId}
                      checked={on}
                      onCheckedChange={() => scenes.toggleSituation(situation.id)}
                      className="data-[state=checked]:bg-mode-pack"
                    />
                  </span>
                </li>
              )
            })}
          </ul>
          {allOff && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-warning-text">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              Turn on at least one situation to generate.
              <Button type="button" size="sm" variant="outline" onClick={scenes.enableAllSituations} className="h-7 pointer-coarse:h-11 text-xs">
                Turn all on
              </Button>
            </p>
          )}
          {fewScenes && (
            <p className="flex items-start gap-1.5 text-xs text-warning-text">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
              {settings.mix === "faithful"
                ? `Only ${plural(enabledScenes, "scene")} ${enabledScenes === 1 ? "is" : "are"} on, so you'll get up to ${plural(enabledScenes, "prompt")}. Switch to Remix to reuse scenes, or collect more posts.`
                : `Only ${plural(enabledScenes, "scene")} ${enabledScenes === 1 ? "is" : "are"} on. Remix reuses them with different swaps, so some prompts will look alike.`}
            </p>
          )}
        </section>
      )}

      {/* How */}
      <section className={sectionClass} aria-label="Scene options">
        <Segmented label="Mix" value={settings.mix} options={MIX_OPTIONS} onChange={(v) => set("mix", v)} />
        <div className="h-px bg-border/50" />
        <Segmented
          label="Clothing"
          value={clothing}
          options={clothingOptions}
          onChange={(v) => set("clothing", v)}
          extra={clothing === "library" && (
            <p className="text-xs text-muted-foreground">
              {scenes.libraryOutfitCount === null
                ? "Loading the outfit library…"
                : scenes.libraryOutfitCount === 0
                  ? "No outfits in the chosen styles. Pick some under Customize prompt › Outfit."
                  : `${scenes.libraryOutfitCount.toLocaleString("en")} outfits to draw from.`}
            </p>
          )}
        />
        <div className="h-px bg-border/50" />
        <Segmented label="Scenery" value={settings.scenery} options={SCENERY_OPTIONS} onChange={(v) => set("scenery", v)} />
        <div className="h-px bg-border/50" />
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="pack-scene-extras" className="min-w-0 cursor-pointer">
            <span className="block text-sm font-semibold">Equipment and creatures</span>
            <span className="block text-xs text-muted-foreground">Keep weapons, tools and animals that appear in the scene.</span>
          </label>
          <span className="flex items-center justify-center flex-shrink-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11">
            <Switch
              id="pack-scene-extras"
              checked={settings.extras}
              onCheckedChange={(v) => set("extras", v)}
              className="data-[state=checked]:bg-mode-pack"
            />
          </span>
        </div>
      </section>
    </div>
  )
}

export const PackScenesPanel = memo(PackScenesPanelComponent)
