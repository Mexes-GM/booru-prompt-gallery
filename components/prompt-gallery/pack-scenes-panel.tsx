"use client"

/**
 * Pack Builder's setup for the scenes engine (hooks/use-pack-scenes.ts), in
 * place of the per-category list. Top to bottom: the character's identity,
 * who is in the picture, the situations of the pool (each with a switch and
 * a few example thumbnails), then Mix, Clothing, Scenery and Extras.
 *
 * Same visual language as the category list: neutral cards, the Pack Mode
 * colour only on active choices.
 */
import { memo, useId } from "react"
import Image from "next/image"
import { AnimatePresence } from "framer-motion"
import { AlertTriangle, Loader2, RefreshCw, RotateCcw, Database } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { getPostThumbnailUrl } from "@/lib/proxy-url"
import { OTHER_SITUATION, type PackPeople, type Situation } from "@/lib/pack/scene/scene-pool"
import type { ScenePackSettings } from "@/lib/pack/scene-pack"
import type { UsePackScenesResult } from "@/hooks/use-pack-scenes"
import { useLowMotion } from "@/hooks/use-low-motion"
import { PackTagChip } from "./pack-category-list"

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "1 girl", "2 girls", "1 girl, 1 boy". */
export function compositionLabel(people: PackPeople): string {
  const parts: string[] = []
  if (people.girls > 0) parts.push(plural(people.girls, "girl"))
  if (people.boys > 0) parts.push(plural(people.boys, "boy"))
  return parts.join(", ")
}

/** A situation's name from its tags: "lying · on back"; the catch-all reads "Everything else". */
export function situationLabel(situation: Situation): string {
  return situation.id === OTHER_SITUATION ? "Everything else" : situation.label.join(" · ")
}

interface Option<T extends string> {
  value: T
  label: string
  hint: string
}

/** Single-choice row of buttons, with the chosen option's one-line hint under it. */
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
        <div className="inline-flex rounded-lg border border-border/60 bg-muted/40 p-0.5" role="radiogroup" aria-labelledby={id}>
          {options.map((opt) => {
            const active = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
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
const CLOTHING_OPTIONS: readonly Option<ScenePackSettings["clothing"]>[] = [
  { value: "scene", label: "From the scene", hint: "Each prompt wears what the scene's character wore." },
  { value: "library", label: "Outfit library", hint: "Whole outfits in the styles chosen under Customize prompt › Outfit." },
]
const SCENERY_OPTIONS: readonly Option<ScenePackSettings["scenery"]>[] = [
  { value: "scene", label: "From the scene", hint: "Keeps each scene's place." },
  { value: "vary", label: "Vary", hint: "Moves each scene to another place that fits the pose." },
  { value: "plain", label: "Plain background", hint: "Puts the character on a plain background." },
]

const sectionClass = "rounded-xl border border-border/70 bg-card/70 p-3 sm:p-4 space-y-3"

export interface PackScenesPanelProps {
  scenes: UsePackScenesResult
  settings: ScenePackSettings
  onSettingsChange: (settings: ScenePackSettings) => void
  /** Identity chips: the character's name, look and signature accessories (before removals). */
  identityCandidates: string[]
  excludedBaseTags: ReadonlySet<string>
  onToggleExcludedBaseTag: (tag: string) => void
  onRestoreExcludedBaseTags: () => void
  hasMultipleCharacters: boolean
  isCollecting: boolean
  /** Posts collected for the source. */
  loadedPostCount: number
  promptCount: number
  canLoadMorePosts: boolean
  onLoadMorePosts: () => void
  onOpenSource: () => void
}

function PackScenesPanelComponent({
  scenes,
  settings,
  onSettingsChange,
  identityCandidates,
  excludedBaseTags,
  onToggleExcludedBaseTag,
  onRestoreExcludedBaseTags,
  hasMultipleCharacters,
  isCollecting,
  loadedPostCount,
  promptCount,
  canLoadMorePosts,
  onLoadMorePosts,
  onOpenSource,
}: PackScenesPanelProps) {
  const lowMotion = useLowMotion()
  const peopleId = useId()
  const situationsId = useId()
  const { pool, identity, compositions, people, disabledSituations, enabledScenes } = scenes
  const set = <K extends keyof ScenePackSettings>(key: K, value: ScenePackSettings[K]) => onSettingsChange({ ...settings, [key]: value })

  const kept = new Set(identity.kept)
  const fromScene = new Set(identity.fromScene)
  const visible = identityCandidates.filter((tag) => !excludedBaseTags.has(tag))
  const removed = identityCandidates.length - visible.length
  const hasFaded = visible.some((tag) => fromScene.has(tag))

  const stats = pool?.stats
  const noScenes = !!pool && pool.scenes.length === 0
  const finding = !pool || (noScenes && isCollecting)
  const allOff = !!pool && pool.scenes.length > 0 && enabledScenes === 0
  const fewScenes = enabledScenes > 0 && enabledScenes < promptCount

  const reasons = stats
    ? [
        [scenes.otherRatingPosts, "have another content rating"],
        [stats.blocked, "were filtered out by the content rules"],
        [stats.notIllustration, "are photos"],
        [stats.nearDuplicates, "are near-copies of other posts"],
        [stats.unextractable, "have no character to replace"],
        [stats.belowQuality, "have too few tags to describe a scene"],
        [stats.incompatible, compositions.length > 1 ? "show a different group of people (pick it above)" : "show a different group of people"],
      ].filter(([n]) => (n as number) > 0) as Array<[number, string]>
    : []

  return (
    <div className="@container space-y-2">
      {/* Who: the identity every prompt keeps */}
      <section className={sectionClass} aria-label="Character">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Character</h3>
          <span className="text-xs text-muted-foreground">Kept in every prompt</span>
        </div>
        {hasMultipleCharacters && (
          <p className="text-xs text-muted-foreground">Only the traits that match the character you picked are kept.</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((tag) => (
              <PackTagChip
                key={tag}
                text={tag}
                tone={kept.has(tag) ? "kept" : "faded"}
                onRemove={() => onToggleExcludedBaseTag(tag)}
                removeLabel={`Remove ${tag} from the character`}
                lowMotion={lowMotion}
              />
            ))}
          </AnimatePresence>
          {visible.length === 0 && (
            <span className="text-xs text-muted-foreground italic py-0.5">
              {isCollecting ? "Finding the character's look…" : "No traits to keep. The scenes decide the look."}
            </span>
          )}
          {removed > 0 && (
            <button
              type="button"
              onClick={onRestoreExcludedBaseTags}
              className="inline-flex items-center gap-1 min-h-7 pointer-coarse:min-h-11 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="w-3 h-3" />
              {removed} removed · restore
            </button>
          )}
        </div>
        {hasFaded && (
          <p className="text-xs text-muted-foreground">Faded tags change from picture to picture, so each scene sets them.</p>
        )}
      </section>

      {/* Pool state: still looking, or nothing usable and why */}
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
                {reasons.map(([n, text]) => (
                  <li key={text}>{n} {text}</li>
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
      {compositions.length > 0 && (
        <section className={sectionClass} aria-labelledby={peopleId}>
          <h3 id={peopleId} className="text-sm font-semibold">Who&apos;s in the picture</h3>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby={peopleId}>
            {compositions.map((c) => {
              const active = !!people && people.girls === c.people.girls && people.boys === c.people.boys
              const label = compositionLabel(c.people)
              return (
                <button
                  key={`${c.people.girls}/${c.people.boys}`}
                  type="button"
                  role="radio"
                  aria-checked={active}
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
          <p className="text-xs text-muted-foreground">Turn off the ones you don&apos;t want in the pack.</p>
          <ul className="grid grid-cols-1 @xl:grid-cols-2 gap-1.5">
            {pool.situations.map((situation) => {
              const on = !disabledSituations.includes(situation.id)
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
          value={settings.clothing}
          options={CLOTHING_OPTIONS}
          onChange={(v) => set("clothing", v)}
          extra={settings.clothing === "library" && (
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
