"use client"

import { useEffect, useState } from "react"
import { useReducedMotion } from "framer-motion"
import { trackExternalLink } from "@/lib/analytics"
import { SOCIAL_URLS } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { derivePostPrompt, type DerivePostPromptOptions } from "@/lib/prompt/derive-post-prompt"
import { parseTagString } from "@/lib/weight-utils"
import { splitCommaSeparatedTags } from "@/lib/utils/tag-utils"
import type { BooruPost } from "@/lib/booru/types"

/**
 * Hero above the search panel: site name (the page's h1 since the top header
 * was removed), a one-line pitch, the supported boorus, the author credit and
 * social links (CivitAI, Tensor.Art, SeaArt).
 *
 * The right column is a small rotating specimen of the real pipeline, one
 * feature per tab: Clean, Add & exclude, Weights, Merge and Pack. Each tab is
 * a single before → after showing only the tokens that matter, plus a one-line
 * caption. Clean / Add & exclude / Weights are computed with derivePostPrompt,
 * the same function every card uses, on a deliberately short sample post, so
 * the hero shows what the app actually produces. Removed tags are struck
 * through; added or weighted tags are highlighted.
 *
 * All examples are stacked in one grid cell so the panel is as tall as the
 * tallest one (no layout shift on rotation). Auto-rotation pauses on
 * hover/focus and is off under prefers-reduced-motion; the tabs always work.
 *
 * Update notes and the Support / GitHub / Mirror buttons live in the folder
 * tabs docked on the search panel's top edge (UpdateNotesTab, PanelLinkTabs);
 * deployment status is reachable from the corner "⋯" menu.
 */

type Kind = "drop" | "new" | "up" | "down"
type Tok = string | readonly [string, Kind]
const drop = (t: string): Tok => [t, "drop"]
const add = (t: string): Tok => [t, "new"]

interface Row {
  label?: string
  sep: " " | ", "
  tokens: Tok[]
}

interface Example {
  id: string
  tab: string
  before: Row[]
  after: Row[]
  note: string
}

// Short on purpose: just enough tags to show merging, folding and dropping.
const SAMPLE_POST: BooruPost = {
  id: 1,
  file_url: "",
  large_file_url: "",
  preview_file_url: "",
  rating: "g",
  score: 20,
  tag_string: "1girl long_hair aqua_hair twintails white_shirt collared_shirt shirt smile standing highres some_artist",
  tag_string_artist: "some_artist",
  tag_string_character: "",
  tag_string_copyright: "",
  tag_string_meta: "highres",
}

const BASE_OPTIONS: DerivePostPromptOptions = {
  excludeInput: "",
  addInput: "",
  includeCharacters: true,
  optimizeTags: true,
  smartTagExclusion: true,
}

const spaced = (t: string) => t.replaceAll("_", " ").toLowerCase()

const RAW_TAGS = SAMPLE_POST.tag_string.split(" ")

const promptTags = (options: Partial<DerivePostPromptOptions>) =>
  splitCommaSeparatedTags(derivePostPrompt(SAMPLE_POST, { ...BASE_OPTIONS, ...options }).displayContent).map(
    parseTagString,
  )

/** Output tags missing from `baseline` are highlighted as new; weighted ones by direction. */
function promptRow(options: Partial<DerivePostPromptOptions>, baseline: Set<string>): Row {
  return {
    sep: ", ",
    tokens: promptTags(options).map((t): Tok => {
      if (t.weight > 1) return [`(${t.text}:${t.weight})`, "up"]
      if (t.weight < 1) return [`(${t.text}:${t.weight})`, "down"]
      return baseline.has(t.text) ? t.text : add(t.text)
    }),
  }
}

const CLEAN_SET = new Set(promptTags({}).map((t) => t.text))

const POST_ROW: Row = {
  label: "Post",
  sep: " ",
  tokens: RAW_TAGS.map((raw): Tok => (CLEAN_SET.has(spaced(raw)) ? raw : drop(raw))),
}

const EXAMPLES: Example[] = [
  {
    id: "clean",
    tab: "Clean",
    before: [POST_ROW],
    // Compared against the raw post, so merged tags read as new.
    after: [promptRow({}, new Set(RAW_TAGS.map(spaced)))],
    note: "Adjectives merge; artist and metadata stay out.",
  },
  {
    id: "tweak",
    tab: "Add & exclude",
    before: [{ label: "Edit", sep: ", ", tokens: [add("sunset"), add("red scarf"), drop("smile")] }],
    // Compared against the cleaned prompt, so only this tab's change stands out.
    after: [promptRow({ addInput: "sunset, red scarf", excludeInput: "smile" }, CLEAN_SET)],
    note: "Your tags go first; excluded ones never appear.",
  },
  {
    id: "weights",
    tab: "Weights",
    before: [{ label: "Weights", sep: ", ", tokens: [["twintails 1.3", "up"], ["smile 0.8", "down"]] }],
    after: [promptRow({ isGlobalWeightsEnabled: true, globalWeights: { twintails: 1.3, smile: 0.8 } }, CLEAN_SET)],
    note: "Set once, applied to every card.",
  },
  {
    id: "merge",
    tab: "Merge",
    before: [
      { label: "Post A", sep: " ", tokens: ["1girl", "silver_hair", "kimono"] },
      { label: "Post B", sep: " ", tokens: [drop("1girl"), "night", "paper_lantern"] },
    ],
    after: [{ sep: ", ", tokens: ["1girl", "silver hair", "kimono", "night", "paper lantern"] }],
    note: "Several posts, one prompt, no duplicates.",
  },
  {
    id: "pack",
    tab: "Pack",
    before: [
      { label: "Fixed", sep: " ", tokens: ["1girl", "silver_hair"] },
      { label: "Vary", sep: ", ", tokens: ["kimono", "yukata", "maid dress"] },
    ],
    after: [
      { sep: ", ", tokens: ["1girl", "silver hair", add("kimono")] },
      { sep: ", ", tokens: ["1girl", "silver hair", add("yukata")] },
      { sep: ", ", tokens: ["1girl", "silver hair", add("maid dress")] },
    ],
    note: "Fix some tags, vary the rest, export the batch.",
  },
]

const ROTATE_MS = 6000

const BOORUS = ["Danbooru", "Aibooru", "Rule34", "Gelbooru", "e621"]

const SOCIALS = [
  { id: "social-civitai", label: "CivitAI", href: SOCIAL_URLS.CIVITAI_PROFILE },
  { id: "social-tensor", label: "Tensor.Art", href: SOCIAL_URLS.TENSOR_ART },
  { id: "social-seaart", label: "SeaArt", href: SOCIAL_URLS.SEAART },
]

function Line({ row, gutter }: { row: Row; gutter: string }) {
  return (
    <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-2">
      <span className="select-none text-muted-foreground/60">{gutter}</span>
      <span className="break-words">
        {row.tokens.map((tok, i) => {
          const [text, kind] = typeof tok === "string" ? [tok, undefined] : tok
          return (
            <span key={i}>
              {i > 0 && <span className="text-muted-foreground/50">{row.sep}</span>}
              <span
                className={cn(
                  kind === "drop" && "text-muted-foreground/50 line-through decoration-muted-foreground/60",
                  kind === "new" && "rounded-sm bg-primary/15 px-0.5 text-primary",
                  kind === "up" && "rounded-sm bg-info/15 px-0.5 text-info-text",
                  kind === "down" && "rounded-sm bg-destructive/15 px-0.5 text-destructive-text",
                )}
              >
                {text}
              </span>
            </span>
          )
        })}
      </span>
    </div>
  )
}

function Specimen() {
  const reduceMotion = useReducedMotion()
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (reduceMotion || paused) return
    const id = window.setInterval(() => setActive((i) => (i + 1) % EXAMPLES.length), ROTATE_MS)
    return () => window.clearInterval(id)
  }, [reduceMotion, paused, active])

  return (
    <div
      className="rounded-lg border border-border/70 bg-card/40 font-mono text-[13px] leading-relaxed"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div role="group" aria-label="Examples" className="flex flex-wrap gap-1 border-b border-border/70 px-2 py-1.5">
        {EXAMPLES.map((ex, i) => (
          <button
            key={ex.id}
            type="button"
            aria-pressed={i === active}
            onClick={() => setActive(i)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              i === active
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {ex.tab}
          </button>
        ))}
      </div>

      <div className="grid">
        {EXAMPLES.map((ex, i) => {
          const isActive = i === active
          return (
            <div
              key={ex.id}
              aria-hidden={!isActive}
              className={cn(
                "col-start-1 row-start-1 space-y-2.5 px-4 py-3 transition-opacity duration-300 motion-reduce:transition-none",
                isActive ? "opacity-100" : "pointer-events-none opacity-0",
              )}
            >
              <div className="space-y-1 text-muted-foreground">
                {ex.before.map((row, j) => (
                  <Line key={j} row={row} gutter={row.label ?? ""} />
                ))}
              </div>
              <div className={cn("space-y-1 text-foreground", isActive && "hero-reveal")}>
                {ex.after.map((row, j) => (
                  <Line key={j} row={row} gutter={j === 0 ? "→" : ""} />
                ))}
              </div>
              <p className="font-sans text-xs text-muted-foreground">{ex.note}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function GalleryHero() {
  return (
    <div className="grid gap-8 pt-8 sm:pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center lg:gap-14 lg:pt-10">
      <div className="space-y-5">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tighter text-balance leading-[1.05]">
          Booru Prompt Gallery
        </h1>
        <p className="max-w-md text-base sm:text-lg text-muted-foreground text-pretty leading-snug">
          Pick a post, get a prompt you can paste straight into your generator.
        </p>

        <p className="font-mono text-xs text-muted-foreground/80 leading-relaxed">
          {BOORUS.join(" · ")}
        </p>

        <p className="text-sm text-muted-foreground">
          By Mexes
          <span aria-hidden="true" className="mx-2 text-muted-foreground/40">/</span>
          {SOCIALS.map((s, i) => (
            <span key={s.id}>
              {i > 0 && <span aria-hidden="true" className="mx-1.5 text-muted-foreground/40">·</span>}
              <a
                id={s.id}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackExternalLink(s.href, "social")}
                aria-label={`Visit Mexes on ${s.label}`}
                className="rounded-sm underline decoration-muted-foreground/30 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                {s.label}
              </a>
            </span>
          ))}
        </p>
      </div>

      <Specimen />
    </div>
  )
}
