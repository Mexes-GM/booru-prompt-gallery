"use client"

// Vista previa del kit de Pack: cada pieza en cada estado, y abajo la ficha completa en
// 343 px y 560 px con estado local. Los textos de esta página (fuera de los componentes)
// son internos.
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"
import { useTheme } from "next-themes"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  addNever,
  addTag,
  briefFromPrompt,
  emptyBrief,
  removeCharacter,
  removeNever,
  removeTag,
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
  briefSummaryParts,
  companionsLabel,
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
    <div className={width === "phone" ? "w-[343px] max-w-full" : width === "mid" ? "w-[560px] max-w-full" : undefined}>
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

function Playground() {
  const [brief, setBrief] = useState<PackBrief>(startBrief)
  const [outfit, setOutfit] = useState<OutfitSource>({ kind: "scene" })
  const [query, setQuery] = useState("")
  const [count, setCount] = useState(10)
  const [rows, setRows] = useState<Row[]>([])
  const [locked, setLocked] = useState<ReadonlySet<number>>(new Set())
  const [format, setFormat] = useState<Format>("tags")
  const seed = useRef(0)
  const [undo, setUndo] = useState<{ message: string; brief: PackBrief; rows: Row[] } | null>(null)
  const [folded, setFolded] = useState(false)
  const [offerTaken, setOfferTaken] = useState(false)

  const suggestions = useMemo<TagSuggestion[]>(() => suggest(query), [query])
  const cast = useMemo(() => castPeople(brief.who.map((c) => c.role ?? "girl")), [brief.who])
  const doing = brief.requests.some((r) => r.role === "doing")

  const update = useCallback((fn: (b: PackBrief) => PackBrief) => setBrief((b) => fn(b)), [])

  const onAddTags = useCallback(
    (tags: string[], slot: SlotId) =>
      update((b) =>
        tags.reduce(
          (acc, t) => (slot === "never" ? addNever(acc, t) : addTag(acc, t, OVERRIDES, slot === "who" ? undefined : slot)),
          b,
        ),
      ),
    [update],
  )

  const setLook = (character: string | null, tag: string, off: boolean) =>
    update((b) => ({
      ...b,
      who: b.who.map((c) =>
        c.tag !== character
          ? c
          : { ...c, removedLook: off ? [...c.removedLook.filter((t) => t !== tag), tag] : c.removedLook.filter((t) => t !== tag) },
      ),
    }))

  const scenes = SCENES_60
  const inUse = scenes.length - brief.leftOut.length
  const fit: FitState = inUse >= count ? { kind: "fit", scenes: inUse } : { kind: "reuse", scenes: inUse, reused: count - inUse }

  const onToggleScene = useCallback(
    (id: string) =>
      update((b) => ({ ...b, leftOut: b.leftOut.includes(id) ? b.leftOut.filter((x) => x !== id) : [...b.leftOut, id] })),
    [update],
  )

  const generate = () => {
    const keep = new Map<number, Row>()
    rows.forEach((r, i) => locked.has(i) && keep.set(i, r))
    seed.current += 1
    setRows(makeRows(count, keep, seed.current))
    setFolded(true)
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
  const onAlways = useCallback((tag: string) => update((b) => addTag(b, tag, OVERRIDES, "also")), [update])
  const onNever = useCallback(
    (tag: string) => {
      const touched = rows.filter((r) => r.tokens.includes(tag)).length
      setUndo({ message: `Removed ${tag} from ${touched} ${touched === 1 ? "prompt" : "prompts"}`, brief, rows })
      setBrief(addNever(brief, tag))
      setRows(rows.map((r) => ({ ...r, tokens: r.tokens.filter((t) => t !== tag) })))
    },
    [rows, brief],
  )

  const peopleLabel = brief.people ? companionsLabel(brief.people, cast) : null
  const summary = briefSummaryParts(brief, peopleLabel)

  return (
    <div className="space-y-3">
      {folded ? (
        <BriefSummary parts={summary} onExpand={() => setFolded(false)} />
      ) : (
        <div className="rounded-xl border border-border bg-card p-3">
          <PackBriefPanel
            brief={brief}
            characterInfo={CHARACTER_INFO}
            onAddTags={onAddTags}
            onRemoveTag={(t) => update((b) => removeTag(b, t))}
            onRemoveNever={(t) => update((b) => removeNever(b, t))}
            onRemoveCharacter={(t) => update((b) => (t ? removeCharacter(b, t) : b))}
            onSetRole={(t, role) => update((b) => setCharacterRole(b, t, role))}
            onRemoveTrait={(c, t) => setLook(c, t, true)}
            onRestoreTrait={(c, t) => setLook(c, t, false)}
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
                    onChange: (p: PackPeople) => update((b) => setPeople(b, p)),
                    cast,
                    poseNeedsCompany: true,
                    reason: "From this pose",
                  }
                : null
            }
            changes={{ value: brief.changes, onChange: (v: ChangesAxis) => update((b) => setChanges(b, v)) }}
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

      <GenerateBar count={count} onCountChange={setCount} onGenerate={generate} locked={locked.size} />

      {undo && (
        <UndoNotice
          message={undo.message}
          onUndo={() => {
            setBrief(undo.brief)
            setRows(undo.rows)
            setUndo(null)
          }}
          onDismiss={() => setUndo(null)}
        />
      )}

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
      people={people ? { options: PEOPLE_OPTIONS, value: PEOPLE_OPTIONS[0].people, onChange: noop, cast, reason: "From this pose" } : null}
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
    return { ...b, who: b.who.map((c) => (c.tag === "tifa lockhart" ? { ...c, removedLook: ["long hair"] } : c)) }
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
          <div className="grid gap-4 md:grid-cols-2">
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
          <div className="grid gap-4 lg:grid-cols-2">
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
          <div className="grid gap-4 md:grid-cols-2">
            <Specimen label="People · three options">
              <PeopleLine
                options={PEOPLE_OPTIONS}
                value={people}
                onChange={setPeopleValue}
                cast={{ girls: 1, boys: 0 }}
                reason="From this pose"
              />
              <p className="mt-2 font-mono text-xs text-muted-foreground">value: {people ? peopleKey(people) : "null"}</p>
            </Specimen>
            <Specimen label="People · one option, pose needs company">
              <PeopleLine
                options={[{ people: { girls: 1, boys: 1 }, scenes: 12 }]}
                value={{ girls: 1, boys: 1 }}
                onChange={noop}
                cast={{ girls: 1, boys: 0 }}
                poseNeedsCompany
                reason="From this pose"
              />
            </Specimen>
            <Specimen label="Changes">
              <ChangesSelect value={changes} onChange={setChangesValue} unavailable={["outfit"]} />
            </Specimen>
          </div>
        </Section>

        <Section title="Hoja de contactos" note="Toca una miniatura para dejarla fuera y otra vez para volver a meterla.">
          <div className="grid gap-4 lg:grid-cols-2">
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
          <div className="grid gap-4 lg:grid-cols-2">
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
          <div className="grid gap-4 lg:grid-cols-2">
            <Specimen label="generate bar" width="mid">
              <div className="space-y-3">
                <GenerateBar count={count} onCountChange={setCount} onGenerate={noop} />
                <GenerateBar count={count} onCountChange={setCount} onGenerate={noop} generating />
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
          <div className="grid gap-4 lg:grid-cols-2">
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
