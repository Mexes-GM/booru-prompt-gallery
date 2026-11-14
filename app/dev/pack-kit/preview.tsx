"use client"

// Vista previa del kit de Pack: cada pieza en cada estado, y abajo la ficha completa en
// 343 px y 560 px con estado local. Los textos de esta página (fuera de los componentes)
// son internos.
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"
import { useTheme } from "next-themes"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  addCharacter,
  addLook,
  addNever,
  addTag,
  briefFromPrompt,
  emptyBrief,
  leaveOutScene,
  removeCharacter,
  removeLook,
  removeNever,
  removeTag,
  restoreLook,
  restoreScene,
  routeTag,
  typedRole,
  setChanges,
  setCharacterRole,
  setPeople,
  type ChangesAxis,
  type PackBrief,
} from "@/lib/pack/brief"
import { castPeople } from "@/lib/pack/scene/cast"
import type { PackPeople } from "@/lib/pack/scene/scene-pool"
import {
  BriefSummary,
  ChangesSelect,
  ContactSheet,
  FitLine,
  GenerateBar,
  PackBriefPanel,
  PackEmptyState,
  PeopleLine,
  RequestChip,
  ResultRow,
  ResultsToolbar,
  TagEntry,
  UndoNotice,
  CHANGES_OPTIONS,
  briefSummaryParts,
  characterName,
  companionsLabel,
  restoreFocus,
  peopleKey,
  type Choice,
  type FitState,
  type OutfitSource,
  type PeopleOption,
  type SlotId,
  type TagSuggestion,
} from "@/components/prompt-gallery/pack"
import {
  CHARACTER_INFO,
  EXAMPLES,
  EXAMPLE_PROMPTS,
  OFFICIAL_OUTFITS,
  OVERRIDES,
  SAMPLE_NATURAL,
  SAMPLE_PROMPTS,
  makeScenes,
  suggest,
} from "./fixtures"

const noop = () => {}
const SCENES_60 = makeScenes(60)
const SCENES_300 = makeScenes(300)
const SCENES_10 = makeScenes(10, 100)

const PEOPLE_OPTIONS: PeopleOption[] = [
  { people: { girls: 1, boys: 1 }, scenes: 41 },
  { people: { girls: 2, boys: 0 }, scenes: 27 },
  { people: { girls: 1, boys: 2 }, scenes: 3 },
]

type Format = "tags" | "anima"
const FORMATS: Choice<Format>[] = [
  { value: "tags", label: "Tags" },
  { value: "anima", label: "Natural" },
]

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function startBrief(): PackBrief {
  let b = emptyBrief()
  for (const t of ["tifa lockhart", "bikini", "princess carry"]) b = addTag(b, t, OVERRIDES)
  return addNever(b, "smile")
}

// ── Montaje de la página ──────────────────────────────────────────────────────────

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border pt-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {note && <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  )
}

function Specimen({ label, children, width }: { label: string; children: ReactNode; width?: "phone" | "mid" }) {
  return (
    <div className={cn("min-w-0 max-w-full", width === "phone" ? "w-[343px]" : width === "mid" ? "w-[560px]" : undefined)}>
      <p className="mb-1.5 font-mono text-xs text-muted-foreground">{label}</p>
      <div className="rounded-xl border border-border bg-card p-3">{children}</div>
    </div>
  )
}

function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <div className="flex items-center gap-1 text-sm">
      {(["light", "dark"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => setTheme(t)}
          aria-pressed={resolvedTheme === t}
          className="rounded-md border border-border px-2.5 py-1 text-xs aria-pressed:bg-secondary aria-pressed:font-medium"
        >
          {t === "light" ? "Claro" : "Oscuro"}
        </button>
      ))}
    </div>
  )
}

// ── Ficha completa con estado local ───────────────────────────────────────────────

interface Row {
  key: string
  tokens: string[]
  postId: number
}

function makeRows(count: number, keep: ReadonlyMap<number, Row>, seed: number): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const kept = keep.get(i)
    if (kept) return kept
    const n = i + seed
    return { key: `r${seed}-${i}`, tokens: [...SAMPLE_PROMPTS[n % SAMPLE_PROMPTS.length]], postId: SCENES_60[n % 60].postId }
  })
}

const nameOf = (tag: string) => characterName(tag, CHARACTER_INFO[tag])

/** Adds one typed tag where it belongs and says which row got it. */
function place(b: PackBrief, tag: string, typedIn: SlotId): { brief: PackBrief; dest: SlotId } {
  if (typedIn === "never") return { brief: addNever(b, tag), dest: "never" }
  const route = routeTag(tag, OVERRIDES)
  if (route.kind === "character") return { brief: addCharacter(b, tag), dest: "who" }
  if (route.kind === "look") return { brief: addLook(b, b.who[0]?.tag ?? null, tag), dest: "who" }
  if (route.kind === "request") return { brief: addTag(b, tag, OVERRIDES), dest: route.role }
  if (route.kind === "people") return { brief: b, dest: typedIn }
  // Style tags go to Style; one the taxonomy does not know stays in Wearing, Doing or Where.
  const into = typedRole(tag, typedIn, OVERRIDES)
  return { brief: addTag(b, tag, OVERRIDES, into), dest: into ?? "style" }
}

interface UndoEntry {
  message: string
  brief: PackBrief
  rows: Row[]
  /** Where focus was when the change happened. */
  focus: Element | null
  /** The row the change touched, for focus when the old control is gone. */
  slot?: SlotId
}

function Playground() {
  const [brief, setBrief] = useState<PackBrief>(startBrief)
  const [outfit, setOutfit] = useState<OutfitSource>({ kind: "scene" })
  const [query, setQuery] = useState("")
  const [count, setCount] = useState(10)
  const [rows, setRows] = useState<Row[]>([])
  const [locked, setLocked] = useState<ReadonlySet<number>>(new Set())
  const [format, setFormat] = useState<Format>("tags")
  const seed = useRef(0)
  const [undo, setUndo] = useState<UndoEntry | null>(null)
  const [folded, setFolded] = useState(false)
  const [openedFromSummary, setOpenedFromSummary] = useState(false)
  const [offerTaken, setOfferTaken] = useState(false)
  const [routed, setRouted] = useState<{ slot: SlotId; key: number } | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const suggestions = useMemo<TagSuggestion[]>(() => suggest(query), [query])
  const cast = useMemo(() => castPeople(brief.who.map((c) => c.role ?? "girl")), [brief.who])
  const doing = brief.requests.some((r) => r.role === "doing")

  // Every change to the card goes through here, so each one can be undone.
  const change = (message: string, next: PackBrief, slot?: SlotId) => {
    setUndo({ message, brief, rows, focus: document.activeElement, slot })
    setBrief(next)
  }

  const onAddTags = (tags: string[], slot: SlotId) => {
    let next = brief
    let elsewhere: SlotId | null = null
    for (const t of tags) {
      const placed = place(next, t, slot)
      next = placed.brief
      if (placed.dest !== slot) elsewhere = placed.dest
    }
    change(`Added ${tags.join(", ")}`, next, slot)
    if (elsewhere) setRouted({ slot: elsewhere, key: Date.now() })
  }

  const scenes = SCENES_60
  const inUse = scenes.length - brief.leftOut.length
  const fit: FitState = inUse >= count ? { kind: "fit", scenes: inUse } : { kind: "reuse", scenes: inUse, reused: count - inUse }

  const onToggleScene = (id: string) => {
    const out = brief.leftOut.includes(id)
    change(out ? "Put a scene back" : "Left out a scene", out ? restoreScene(brief, id) : leaveOutScene(brief, id))
  }

  const generate = () => {
    if (progress !== null) return
    const keep = new Map<number, Row>()
    rows.forEach((r, i) => locked.has(i) && keep.set(i, r))
    // A stand-in for the engine: one prompt every 120 ms, then the list.
    let done = 0
    setProgress(0)
    const step = () => {
      done += 1
      if (done < count) {
        setProgress(done)
        window.setTimeout(step, 120)
        return
      }
      seed.current += 1
      setRows(makeRows(count, keep, seed.current))
      setProgress(null)
      setFolded(true)
      setOpenedFromSummary(false)
    }
    window.setTimeout(step, 120)
  }

  const onCopy = useCallback((i: number) => writeClipboard(rows[i]?.tokens.join(", ") ?? ""), [rows])
  const onReroll = useCallback(
    (i: number) =>
      setRows((rs) => rs.map((r, j) => (j === i ? { ...r, key: `${r.key}+`, tokens: [...r.tokens].reverse() } : r))),
    [],
  )
  const onToggleLock = useCallback(
    (i: number) =>
      setLocked((s) => {
        const next = new Set(s)
        if (next.has(i)) next.delete(i)
        else next.add(i)
        return next
      }),
    [],
  )
  const onAlways = useCallback(
    (tag: string) => {
      setUndo({ message: `Added ${tag} to every prompt`, brief, rows, focus: document.activeElement, slot: "also" })
      setBrief(addTag(brief, tag, OVERRIDES, "also"))
    },
    [brief, rows],
  )
  const onNever = useCallback(
    (tag: string) => {
      const touched = rows.filter((r) => r.tokens.includes(tag)).length
      setUndo({
        message: `Removed ${tag} from ${touched} ${touched === 1 ? "prompt" : "prompts"}`,
        brief,
        rows,
        focus: document.activeElement,
        slot: "never",
      })
      setBrief(addNever(brief, tag))
      setRows(rows.map((r) => ({ ...r, tokens: r.tokens.filter((t) => t !== tag) })))
    },
    [rows, brief],
  )

  const closeUndo = (restore: boolean) => {
    if (!undo) return
    if (restore) {
      setBrief(undo.brief)
      setRows(undo.rows)
      if (folded) setFolded(false)
    }
    setUndo(null)
    restoreFocus(undo.focus, panelRef.current, undo.slot)
  }

  const peopleLabel = brief.people ? companionsLabel(brief.people, cast) : null
  const summary = briefSummaryParts(brief, peopleLabel, CHARACTER_INFO)

  return (
    <div className="space-y-3">
      {folded ? (
        <BriefSummary
          parts={summary}
          onExpand={() => {
            setFolded(false)
            setOpenedFromSummary(true)
          }}
        />
      ) : (
        <div ref={panelRef} className="rounded-xl border border-border bg-card p-3">
          <PackBriefPanel
            brief={brief}
            characterInfo={CHARACTER_INFO}
            autoFocus={openedFromSummary}
            routed={routed}
            onAddTags={onAddTags}
            onRemoveTag={(t) => change(`Removed ${t}`, removeTag(brief, t), "also")}
            onRemoveNever={(t) => change(`Removed ${t} from Never`, removeNever(brief, t), "never")}
            onRemoveCharacter={(t) => t && change(`Removed ${nameOf(t)}`, removeCharacter(brief, t), "who")}
            onSetRole={(t, role) => change(`${t ? nameOf(t) : "Character"} is a ${role}`, setCharacterRole(brief, t, role), "who")}
            onRemoveTrait={(c, t) => change(`Removed ${t}`, removeLook(brief, c, t), "who")}
            onRestoreTrait={(c, t) => change(`Put back ${t}`, restoreLook(brief, c, t), "who")}
            outfitSource={outfit}
            onOutfitSourceChange={setOutfit}
            officialOutfits={OFFICIAL_OUTFITS}
            offers={
              offerTaken
                ? []
                : [
                    {
                      id: "card-outfit",
                      slot: "wearing",
                      label: "Use this card's outfit",
                      detail: "sun hat, sandals",
                      onAccept: () => {
                        setOfferTaken(true)
                        onAddTags(["sun hat", "sandals"], "wearing")
                      },
                    },
                  ]
            }
            conflicts={{ "winter coat": "Clashes with bikini" }}
            onOpenScenePicker={() => window.alert("Aquí se abre el selector de escenas (otro paquete).")}
            people={
              doing
                ? {
                    options: PEOPLE_OPTIONS,
                    value: brief.people,
                    onChange: (p: PackPeople) => change(`People: ${companionsLabel(p, cast).toLowerCase()}`, setPeople(brief, p)),
                    cast,
                    poseNeeds: 2,
                  }
                : null
            }
            changes={{
              value: brief.changes,
              onChange: (v: ChangesAxis) =>
                change(`Changes: ${CHANGES_OPTIONS.find((o) => o.value === v)?.label.toLowerCase()}`, setChanges(brief, v)),
            }}
            suggestions={suggestions}
            suggestionStatus="idle"
            onQueryChange={(q) => setQuery(q)}
          />
        </div>
      )}

      <div className="space-y-2">
        <FitLine state={fit} hint="Select a scene to leave it out" />
        <ContactSheet scenes={scenes} leftOut={brief.leftOut} onToggle={onToggleScene} />
      </div>

      <GenerateBar
        count={count}
        onCountChange={setCount}
        onGenerate={generate}
        generating={progress !== null}
        done={progress ?? undefined}
        locked={locked.size}
        blockedReason={brief.who.some((c) => c.tag) ? undefined : "Pick a character first"}
      />

      {undo && <UndoNotice message={undo.message} onUndo={() => closeUndo(true)} onDismiss={() => closeUndo(false)} />}

      {rows.length > 0 && (
        <div className="space-y-2">
          <ResultsToolbar
            formats={FORMATS}
            format={format}
            onFormatChange={setFormat}
            count={rows.length}
            onCopyAll={() => writeClipboard(rows.map((r) => r.tokens.join(", ")).join("\n"))}
          />
          <div className="space-y-1.5">
            {rows.map((r, i) => (
              <ResultRow
                key={r.key}
                index={i}
                tokens={r.tokens}
                text={format === "anima" ? SAMPLE_NATURAL : undefined}
                postId={r.postId}
                locked={locked.has(i)}
                onCopy={onCopy}
                onReroll={onReroll}
                onToggleLock={onToggleLock}
                onAlways={onAlways}
                onNever={onNever}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Página ───────────────────────────────────────────────────────────────────────

const FIT_STATES: FitState[] = [
  { kind: "finding", found: 9 },
  { kind: "fit", scenes: 41 },
  { kind: "few-rated", onInclude: noop },
  { kind: "reuse", scenes: 8, reused: 2 },
  { kind: "similar", tag: "carrying person" },
  { kind: "short", made: 8, asked: 10, scenes: 8, what: "this pose" },
]

function StaticPanel({ brief, people, changes }: { brief: PackBrief; people?: boolean; changes?: boolean }) {
  const cast = castPeople(brief.who.map((c) => c.role ?? "girl"))
  return (
    <PackBriefPanel
      brief={brief}
      characterInfo={CHARACTER_INFO}
      onAddTags={noop}
      onRemoveTag={noop}
      onRemoveNever={noop}
      onRemoveCharacter={noop}
      onSetRole={noop}
      onRemoveTrait={noop}
      onRestoreTrait={noop}
      outfitSource={{ kind: "scene" }}
      onOutfitSourceChange={noop}
      officialOutfits={OFFICIAL_OUTFITS}
      people={people ? { options: PEOPLE_OPTIONS, value: PEOPLE_OPTIONS[0].people, onChange: noop, cast, poseNeeds: 2 } : null}
      changes={changes ? { value: "scene", onChange: noop } : null}
    />
  )
}

export function PackKitPreview() {
  const [sheetOut, setSheetOut] = useState<string[]>(["scene-2", "scene-7", "scene-8"])
  const toggleSheet = useCallback(
    (id: string) => setSheetOut((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    [],
  )
  const [changes, setChangesValue] = useState<ChangesAxis>("scene")
  const [people, setPeopleValue] = useState<PackPeople | null>(null)
  const [count, setCount] = useState(10)
  const [entryQuery, setEntryQuery] = useState("")
  const [picked, setPicked] = useState<string | null>(null)

  const twoCharacters = useMemo(() => {
    let b = startBrief()
    b = addTag(b, "yor briar", OVERRIDES)
    b = setCharacterRole(b, "tifa lockhart", "girl")
    return removeLook(b, "tifa lockhart", "long hair")
  }, [])
  const fullBrief = useMemo(() => {
    let b = startBrief()
    for (const t of ["beach", "blush", "my lora trigger", "winter coat"]) b = addTag(b, t, OVERRIDES, "also")
    return b
  }, [])

  return (
    <TooltipProvider>
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Pack: kit de componentes</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Piezas de <code className="font-mono">components/prompt-gallery/pack</code> con datos escritos a mano. Abajo, la
              ficha completa con estado local en 343 px y 560 px.
            </p>
          </div>
          <ThemeSwitch />
        </header>

        <Section title="Chip de petición" note="Pedido, seleccionado con Backspace, con conflicto, nunca, rasgo, rasgo quitado, ofrecido y nombre.">
          <Specimen label="variants">
            <div className="flex flex-wrap items-center gap-1.5">
              <RequestChip label="bikini" onRemove={noop} />
              <RequestChip label="princess carry" selected onRemove={noop} />
              <RequestChip label="winter coat" conflict="Clashes with bikini" onRemove={noop} />
              <RequestChip variant="never" label="smile" onRemove={noop} />
              <RequestChip variant="trait" label="black hair" onRemove={noop} onRestore={noop} />
              <RequestChip variant="trait" label="long hair" removed onRemove={noop} onRestore={noop} />
              <RequestChip variant="offered" label="Use this card's outfit" detail="sun hat, sandals" onAccept={noop} />
              <RequestChip strong label="Tifa Lockhart" onRemove={noop} />
              <RequestChip label="a very long tag name that has to truncate inside a narrow row" onRemove={noop} className="max-w-[16rem]" />
            </div>
          </Specimen>
        </Section>

        <Section title="Entrada de tags" note="Escribe «b» o «ha» para ver sugerencias. Enter o coma añaden; Backspace en vacío selecciona el último chip.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 [&>*]:min-w-0">
            <Specimen label="with suggestions">
              <span id="entry-a" className="sr-only">Wearing</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <RequestChip label="bikini" selected={picked === "bikini"} onRemove={noop} />
                <TagEntry
                  labelledBy="entry-a"
                  placeholder="Add clothing"
                  suggestions={suggest(entryQuery)}
                  onQueryChange={setEntryQuery}
                  onAdd={(tags) => window.alert(`onAdd: ${tags.join(" | ")}`)}
                  lastChipLabel="bikini"
                  onPickLast={(on) => setPicked(on ? "bikini" : null)}
                  onRemoveLast={() => window.alert("onRemoveLast: bikini")}
                />
              </div>
            </Specimen>
            <Specimen label="empty slot">
              <span id="entry-b" className="sr-only">Where</span>
              <TagEntry labelledBy="entry-b" placeholder="Anything" empty onAdd={noop} />
            </Specimen>
            <Specimen label="suggestions loading (type)">
              <span id="entry-c" className="sr-only">Doing</span>
              <TagEntry labelledBy="entry-c" placeholder="Add a pose or action" suggestionStatus="loading" onAdd={noop} />
            </Specimen>
            <Specimen label="suggestions failed (type) · disabled">
              <span id="entry-d" className="sr-only">Also</span>
              <div className="space-y-2">
                <TagEntry labelledBy="entry-d" placeholder="Add more" suggestionStatus="error" onAdd={noop} />
                <TagEntry labelledBy="entry-d" placeholder="Add more" disabled onAdd={noop} />
              </div>
            </Specimen>
          </div>
        </Section>

        <Section title="Ficha" note="Vacía, con un personaje, con dos (selector Girl / Boy y un rasgo quitado) y con todo, incluido People y Changes.">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Specimen label="empty brief" width="mid">
              <StaticPanel brief={emptyBrief()} />
            </Specimen>
            <Specimen label="one character" width="mid">
              <StaticPanel brief={startBrief()} />
            </Specimen>
            <Specimen label="two characters" width="phone">
              <StaticPanel brief={twoCharacters} />
            </Specimen>
            <Specimen label="everything + People + Changes" width="phone">
              <StaticPanel brief={fullBrief} people changes />
            </Specimen>
          </div>
        </Section>

        <Section title="People y Changes">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 [&>*]:min-w-0">
            <Specimen label="People · three options">
              <PeopleLine
                options={PEOPLE_OPTIONS}
                value={people}
                onChange={setPeopleValue}
                cast={{ girls: 1, boys: 0 }}
              />
              <p className="mt-2 font-mono text-xs text-muted-foreground">value: {people ? peopleKey(people) : "null"}</p>
            </Specimen>
            <Specimen label="People · one option, pose needs company">
              <PeopleLine
                options={[{ people: { girls: 1, boys: 1 }, scenes: 12 }]}
                value={{ girls: 1, boys: 1 }}
                onChange={noop}
                cast={{ girls: 1, boys: 0 }}
                poseNeeds={2}
              />
            </Specimen>
            <Specimen label="Changes">
              <ChangesSelect value={changes} onChange={setChangesValue} unavailable={["outfit"]} />
            </Specimen>
          </div>
        </Section>

        <Section title="Hoja de contactos" note="Toca una miniatura para dejarla fuera y otra vez para volver a meterla.">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Specimen label="60 scenes, 3 out" width="mid">
              <ContactSheet scenes={SCENES_60} leftOut={sheetOut} onToggle={toggleSheet} />
            </Specimen>
            <Specimen label="loading · 9 so far" width="phone">
              <ContactSheet scenes={SCENES_10.slice(0, 9)} leftOut={[]} onToggle={noop} status="loading" expected={24} />
            </Specimen>
            <Specimen label="10 scenes" width="phone">
              <ContactSheet scenes={SCENES_10} leftOut={["scene-103"]} onToggle={noop} />
            </Specimen>
            <Specimen label="empty" width="phone">
              <ContactSheet scenes={[]} leftOut={[]} onToggle={noop} />
            </Specimen>
            <Specimen label="error" width="phone">
              <ContactSheet scenes={[]} leftOut={[]} onToggle={noop} status="error" onRetry={noop} />
            </Specimen>
            <Specimen label="300 scenes (Show all)" width="mid">
              <ContactSheet scenes={SCENES_300} leftOut={sheetOut} onToggle={toggleSheet} />
            </Specimen>
          </div>
        </Section>

        <Section title="Línea de ajuste">
          <Specimen label="states" width="mid">
            <div className="space-y-1">
              {FIT_STATES.map((s) => (
                <FitLine key={s.kind} state={s} />
              ))}
            </div>
          </Specimen>
        </Section>

        <Section title="Filas de resultado" note="Toca un tag para abrir su menú.">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Specimen label="tags · locked · pending" width="mid">
              <div className="space-y-1.5">
                <ResultRow index={0} tokens={SAMPLE_PROMPTS[0]} postId={4812345} onCopy={() => true} onReroll={noop} onToggleLock={noop} onAlways={noop} onNever={noop} />
                <ResultRow index={1} tokens={SAMPLE_PROMPTS[1]} postId={4823456} locked onCopy={() => true} onReroll={noop} onToggleLock={noop} onAlways={noop} onNever={noop} />
                <ResultRow index={2} tokens={SAMPLE_PROMPTS[2]} postId={4834567} pending onCopy={() => true} onReroll={noop} onToggleLock={noop} onAlways={noop} onNever={noop} />
              </div>
            </Specimen>
            <Specimen label="natural language" width="phone">
              <ResultRow index={0} text={SAMPLE_NATURAL} postId={4812345} onCopy={() => true} onReroll={noop} onToggleLock={noop} onAlways={noop} onNever={noop} />
            </Specimen>
          </div>
        </Section>

        <Section title="Generar, copiar, resumen, deshacer">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Specimen label="generate bar" width="mid">
              <div className="space-y-3">
                <GenerateBar count={count} onCountChange={setCount} onGenerate={noop} />
                <GenerateBar count={count} onCountChange={setCount} onGenerate={noop} generating done={4} />
                <GenerateBar count={1} onCountChange={noop} onGenerate={noop} blockedReason="Pick a character first" />
              </div>
            </Specimen>
            <Specimen label="results toolbar" width="phone">
              <ResultsToolbar formats={FORMATS} format="tags" onFormatChange={noop} count={10} onCopyAll={() => true} />
            </Specimen>
            <Specimen label="summary" width="phone">
              <div className="space-y-2">
                <BriefSummary parts={["Tifa Lockhart", "bikini", "princess carry", "with 1 boy"]} onExpand={noop} />
                <BriefSummary parts={[]} onExpand={noop} />
              </div>
            </Specimen>
            <Specimen label="undo" width="phone">
              <UndoNotice message="Removed smile from 8 prompts" onUndo={noop} onDismiss={noop} />
            </Specimen>
          </div>
        </Section>

        <Section title="Estado vacío">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Specimen label="empty pack" width="mid">
              <PackEmptyState examples={EXAMPLES} onPick={(id) => window.alert(EXAMPLE_PROMPTS[id])} />
            </Specimen>
            <Specimen label="empty pack" width="phone">
              <PackEmptyState
                examples={EXAMPLES}
                onPick={(id) => window.alert(JSON.stringify(briefFromPrompt(EXAMPLE_PROMPTS[id], OVERRIDES).brief.requests))}
              />
            </Specimen>
          </div>
        </Section>

        <Section title="Ficha completa" note="Estado local: escribe tags, quita chips, cambia People y Changes, deja fuera escenas, genera y abre el menú de un tag.">
          <div className="flex flex-wrap items-start gap-6">
            <div className="w-[343px] max-w-full">
              <p className="mb-1.5 font-mono text-xs text-muted-foreground">343 px</p>
              <Playground />
            </div>
            <div className="w-[560px] max-w-full">
              <p className="mb-1.5 font-mono text-xs text-muted-foreground">560 px</p>
              <Playground />
            </div>
          </div>
        </Section>
      </main>
    </TooltipProvider>
  )
}
