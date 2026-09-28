"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DebouncedInput, DebouncedHTMLInput } from "@/components/ui/debounced-input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SmoothFilterSlider } from "@/components/ui/smooth-filter-slider"
import { ScoreTierControl } from "@/components/prompt-gallery/score-tier-control"
import { Check, ChevronDown, ListPlus, Plus, Save, Trash2, X, Replace, RotateCcw } from "lucide-react"
import { ToastAction } from "@/components/ui/toast"
import { toast } from "@/hooks/use-toast"
import { createTagAppendRule, type TagPreset } from "@/lib/storage"
import type { TagAppendRule } from "@/lib/cleanPrompt"
import { splitCommaSeparatedTags } from "@/lib/utils/tag-utils"
import type { ScoreTier } from "@/lib/api-client"
import { cn } from "@/lib/utils"

/** Shared "density" flag threaded through every sub-section below (plan
 *  U5/3.3) — replaces the old pattern of two fully-separate JSX trees (one
 *  per `if (variant === "compact")` branch) with one tree per control whose
 *  classes/copy/tooltip-visual presence are chosen by this single flag. Same
 *  idea SmoothFilterSlider/ScoreTierControl already used internally. */
type PanelVariant = "full" | "compact"

/** Default from use-booru-search.ts — what "Reset" returns the tag-count filter to. */
const DEFAULT_TAG_COUNT = 5

/** Character post counts are heavy-tailed, so quick picks beat a linear 0–10k slider. */
const CHARACTER_COUNT_PRESETS = [
  { label: "Off", value: 0 },
  { label: "100", value: 100 },
  { label: "500", value: 500 },
  { label: "1k", value: 1000 },
  { label: "5k", value: 5000 },
]

interface PanelSectionProps extends React.HTMLAttributes<HTMLElement> {
  title: string
  hint: string
  activeCount: number
  onReset: () => void
  resetLabel: string
  compact: boolean
}

/**
 * One titled group of the panel. The header carries the only "what does this
 * group affect" hint (instead of repeating it on every field) plus an
 * active-count summary and a Reset that only appears when something is set.
 */
function PanelSection({ title, hint, activeCount, onReset, resetLabel, compact, children, className, ...rest }: PanelSectionProps) {
  return (
    <section className={cn(compact ? "py-3 first:pt-0 last:pb-0" : "py-4 first:pt-0 last:pb-0", className)} {...rest}>
      <div className={cn("flex min-h-6 items-center gap-2", compact ? "mb-2" : "mb-3")}>
        <h3 className={cn("shrink-0 font-semibold uppercase tracking-wider text-foreground/80", compact ? "text-[10px]" : "text-[11px]")}>
          {title}
        </h3>
        <span className={cn("truncate text-muted-foreground/70", compact ? "text-[10px]" : "text-[11px]")}>{hint}</span>
        {activeCount > 0 && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-medium">
              {activeCount} active
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReset}
              aria-label={resetLabel}
              className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              Reset
            </Button>
          </div>
        )}
      </div>
      <div className={compact ? "flex flex-col gap-3" : "space-y-4"}>{children}</div>
    </section>
  )
}

/** InfoTooltip demo visual for "Tags to Add" — full variant only. */
const ADD_TAGS_VISUAL = (
  <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
    <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Input:</span>
        <span className="bg-success-soft text-success-text border border-success-border px-1.5 py-0.5 rounded">masterpiece, best quality</span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Original:</span>
        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo, looking at viewer</span>
      </div>
    </div>

    <div className="flex items-center gap-2 mt-1 px-1">
      <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
      <div className="flex flex-wrap gap-1">
        <span className="bg-success-soft border border-success-border text-success-text px-1.5 py-0.5 rounded flex items-center gap-0.5"><Check className="w-3 h-3" /> masterpiece, best quality</span>
        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo, looking at viewer</span>
      </div>
    </div>
  </div>
)

/** InfoTooltip demo visual for "Tags to Exclude" — full variant only. */
const EXCLUDE_TAGS_VISUAL = (
  <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
    <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Input:</span>
        <span className="bg-destructive-soft text-destructive-text border border-destructive-border px-1.5 py-0.5 rounded">realistic, 3d</span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Original:</span>
        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo, realistic, 3d, hat</span>
      </div>
    </div>

    <div className="flex items-center gap-2 mt-1 px-1">
      <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
      <div className="flex flex-wrap gap-1">
        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo, hat</span>
        <span className="bg-destructive/10 border border-destructive/20 text-destructive-text line-through px-1.5 py-0.5 rounded"><X className="w-2.5 h-2.5 inline mr-0.5" />realistic, 3d</span>
      </div>
    </div>
  </div>
)

/** InfoTooltip demo visual for "Find & Replace" — full variant only. */
const FIND_REPLACE_VISUAL = (
  <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
    <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Find:</span>
        <span className="bg-warning-soft text-warning-text border border-warning-border px-1.5 py-0.5 rounded">league, long hair</span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Replace:</span>
        <span className="bg-warning-soft text-warning-text border border-warning-border px-1.5 py-0.5 rounded">league of legends, short hair</span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Original:</span>
        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">jinx (league), long hair</span>
      </div>
    </div>

    <div className="flex items-center gap-2 mt-1 px-1">
      <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
      <div className="flex flex-wrap gap-1">
        <span className="bg-warning-soft border border-warning-border text-warning-text px-1.5 py-0.5 rounded flex items-center gap-0.5"><Replace className="w-3 h-3" /> jinx (league of legends)</span>
        <span className="bg-warning-soft border border-warning-border text-warning-text px-1.5 py-0.5 rounded flex items-center gap-0.5"><Replace className="w-3 h-3" /> short hair</span>
      </div>
    </div>
    <div className="flex items-center gap-2 px-1">
      <span className="text-muted-foreground font-medium min-w-[70px]">Untouched:</span>
      <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">league of champions, very long hair</span>
    </div>
  </div>
)

/** InfoTooltip demo visual for "Minimum Tag Count" — full variant only. */
const TAG_COUNT_VISUAL = (
  <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
    <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Config:</span>
        <span className="bg-info-soft text-info-text border border-info-border px-1.5 py-0.5 rounded font-mono">{">"} 20 Tags</span>
      </div>
    </div>

    <div className="flex flex-col gap-2 mt-1 px-1">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2 bg-primary/5 rounded border border-border gap-2">
        <span className="text-foreground line-clamp-1 flex-1">1girl, solo, short hair...</span>
        <Badge variant="destructive" className="shrink-0 whitespace-nowrap">15 Tags (Hidden)</Badge>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2 bg-primary/10 rounded border border-primary/20 gap-2">
        <span className="text-foreground line-clamp-1 flex-1 font-medium">1girl, solo, detailed face, green eyes...</span>
        <Badge className="bg-info hover:bg-info text-info-foreground shrink-0 whitespace-nowrap">42 Tags (Visible)</Badge>
      </div>
    </div>
  </div>
)

/** InfoTooltip demo visual for Append rules — full variant only. */
const APPEND_VISUAL = (
  <div className="w-full flex flex-col gap-2 p-1.5 text-[10px]">
    <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border/50">
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Find:</span>
        <span className="bg-primary/10 text-primary-text border border-primary/20 px-1.5 py-0.5 rounded">neko</span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Append:</span>
        <span className="bg-primary/10 text-primary-text border border-primary/20 px-1.5 py-0.5 rounded">animal ears, cat ears, cat tail</span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
        <span className="text-muted-foreground font-medium min-w-[70px]">Original:</span>
        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo, neko</span>
      </div>
    </div>

    <div className="flex items-center gap-2 mt-1 px-1">
      <span className="text-muted-foreground font-medium min-w-[70px]">Result:</span>
      <div className="flex flex-wrap gap-1">
        <span className="px-1.5 py-0.5 rounded text-foreground bg-primary/5 font-mono">1girl, solo, neko</span>
        <span className="bg-primary/10 border border-primary/20 text-primary-text px-1.5 py-0.5 rounded flex items-center gap-0.5"><Plus className="w-3 h-3" /> animal ears, cat ears, cat tail</span>
      </div>
    </div>
  </div>
)

/** Both rule kinds in one tooltip, in the order the pipeline applies them. */
const TAG_RULES_VISUAL = (
  <div className="w-full flex flex-col gap-1">
    <span className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Replace</span>
    {FIND_REPLACE_VISUAL}
    <span className="px-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Append</span>
    {APPEND_VISUAL}
  </div>
)

/**
 * A single Find → Replace row as edited in the rules dialog. Only exists while
 * the dialog is open: the persisted/pipeline format is still the pair of
 * comma-separated strings (findInput/replaceInput, paired by index), which
 * derive-post-prompt, use-card-prompt, bulk-send and Pack Mode all read.
 */
interface ReplaceRow {
  id: string
  find: string
  replace: string
}

let replaceRowSeq = 0
const nextReplaceRowId = () => `replace-${++replaceRowSeq}`

/** Pair list → rows. A length mismatch surfaces as incomplete rows instead of being silently ignored. */
function parseReplaceRows(findInput: string, replaceInput: string): ReplaceRow[] {
  const finds = splitCommaSeparatedTags(findInput)
  const replaces = splitCommaSeparatedTags(replaceInput)
  return Array.from({ length: Math.max(finds.length, replaces.length) }, (_, i) => ({
    id: nextReplaceRowId(),
    find: finds[i] ?? "",
    replace: replaces[i] ?? "",
  }))
}

/** Commas are the pair-list separator, so a comma inside one side would shift every later pair. */
const hasComma = (value: string) => value.includes(",")

function getReplaceRowIssue(row: ReplaceRow): string | null {
  if (hasComma(row.find) || hasComma(row.replace)) return "One tag per side — commas aren't allowed here."
  if (!row.find.trim() || !row.replace.trim()) return "Complete both fields before this rule can apply."
  return null
}

const isCompleteAppendRule = (rule: TagAppendRule) => !!rule.find.trim() && rule.append.length > 0

interface TagRulesEditorProps {
  findInput: string
  replaceInput: string
  setFindInput: (value: string) => void
  setReplaceInput: (value: string) => void
  appendRules: TagAppendRule[]
  setAppendRules: (rules: TagAppendRule[]) => void
  compact?: boolean
  /** Main-panel label: plain "Find & replace rules" text, no ⓘ tooltip. */
  embedded?: boolean
}

/**
 * "Tag rules" — Find & Replace and Find & Append edited as rows in one dialog,
 * so the panel only needs a fixed-height summary button no matter how many
 * rules exist. Replace rules are listed first because the prompt pipeline
 * applies them before appends (cleanPrompt: wordReplacements → tagAppendRules).
 * Edits apply live; incomplete rows are dropped when the dialog closes.
 */
function TagRulesEditor({
  findInput,
  replaceInput,
  setFindInput,
  setReplaceInput,
  appendRules = [],
  setAppendRules,
  compact = false,
  embedded = false,
}: TagRulesEditorProps) {
  const [open, setOpen] = useState(false)
  const [replaceRows, setReplaceRows] = useState<ReplaceRow[]>([])
  const safeAppendRules = appendRules || []

  // Closed-state summary reads straight from the persisted values.
  const replaceCount = Math.min(splitCommaSeparatedTags(findInput).length, splitCommaSeparatedTags(replaceInput).length)
  const appendCount = safeAppendRules.filter(isCompleteAppendRule).length

  const commitReplaceRows = (rows: ReplaceRow[]) => {
    setReplaceRows(rows)
    const valid = rows.filter((row) => !getReplaceRowIssue(row))
    setFindInput(valid.map((row) => row.find.trim()).join(", "))
    setReplaceInput(valid.map((row) => row.replace.trim()).join(", "))
  }

  const updateReplaceRow = (id: string, update: Partial<ReplaceRow>) =>
    commitReplaceRows(replaceRows.map((row) => row.id === id ? { ...row, ...update } : row))
  const addReplaceRow = () => setReplaceRows([...replaceRows, { id: nextReplaceRowId(), find: "", replace: "" }])
  const removeReplaceRow = (id: string) => commitReplaceRows(replaceRows.filter((row) => row.id !== id))

  const updateAppendRule = (id: string, update: Partial<TagAppendRule>) =>
    setAppendRules(safeAppendRules.map((rule) => rule.id === id ? { ...rule, ...update } : rule))
  const addAppendRule = () => setAppendRules([...safeAppendRules, createTagAppendRule()])
  const removeAppendRule = (id: string) => setAppendRules(safeAppendRules.filter((rule) => rule.id !== id))

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setReplaceRows(parseReplaceRows(findInput, replaceInput))
    } else {
      // Drop rows that can't apply instead of letting them sit there inert
      // across sessions. Re-serializing also normalizes a legacy mismatched
      // pair list (e.g. 3 finds / 2 replaces) to only the pairs that applied.
      commitReplaceRows(replaceRows.filter((row) => !getReplaceRowIssue(row)))
      const complete = safeAppendRules.filter(isCompleteAppendRule)
      if (complete.length !== safeAppendRules.length) setAppendRules(complete)
    }
    setOpen(next)
  }

  const inputClassName = "h-9 text-sm bg-background/50"
  const summary = [
    replaceCount > 0 && `${replaceCount} replace`,
    appendCount > 0 && `${appendCount} append`,
  ].filter(Boolean).join(" · ")

  return (
    <div className={compact ? "flex flex-col gap-1" : "space-y-2"}>
      {compact ? (
        <Label className="text-xs font-semibold">Tag rules</Label>
      ) : embedded ? (
        <span className="text-sm font-medium text-foreground">Find &amp; replace rules</span>
      ) : (
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-2">
          <InfoTooltip
            title="Tag rules"
            description="Rewrite specific tags in every prompt. Replace swaps a tag for another — handy for outdated booru renames (Danbooru changed 'jinx (league of legends)' to 'jinx (league)', but models were trained on the old tag) or swaps like 'long hair' → 'short hair'. Append keeps a tag and adds extra tags right after it. Matching is always EXACT — the full plain tag or the full content inside parentheses, never a partial substring — so 'league of champions' or 'very long hair' are never touched. Parentheses are optional: 'league' and '(league)' both work. Replace rules run first; rules never chain."
            visual={TAG_RULES_VISUAL}
          >
            Tag rules
          </InfoTooltip>
          <span className="text-[10px] font-normal text-muted-foreground/70">(Replace or append exact tags)</span>
        </span>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label={summary ? `Manage tag rules (${summary})` : "Manage tag rules"}
            className={compact ? "h-8 w-full justify-between px-2.5 text-xs bg-background/50" : "h-9 w-full justify-between px-3 text-sm bg-background/50"}
          >
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <ListPlus className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
              Manage rules
            </span>
            {summary && (
              <span className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{summary}</span>
            )}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[540px] p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-5 pb-3">
            <DialogTitle className="text-base font-semibold">Tag rules</DialogTitle>
            <DialogDescription className="text-xs">
              Exact-tag matches only. Replace rules run first, then append rules; rules never chain.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-[400px] border-t border-border/50">
            <div className="px-5 py-4 flex flex-col gap-5">
              <TagRulesGroup
                icon={<Replace className="h-3.5 w-3.5" />}
                title="Replace"
                description="Swap a tag for another."
                addLabel="Add replace rule"
                onAdd={addReplaceRow}
                emptyText="No replace rules yet."
              >
                {replaceRows.map((row, index) => {
                  const issue = getReplaceRowIssue(row)
                  return (
                    <TagRuleRow
                      key={row.id}
                      onRemove={() => removeReplaceRow(row.id)}
                      removeLabel={`Delete replace rule ${index + 1}`}
                      issue={issue}
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
                        <div className="space-y-1">
                          <Label htmlFor={`replace-find-${row.id}`} className="text-[10px] font-medium text-muted-foreground">Find tag</Label>
                          <DebouncedInput
                            id={`replace-find-${row.id}`}
                            value={row.find}
                            onChange={(find) => updateReplaceRow(row.id, { find })}
                            debounceTime={400}
                            placeholder="league"
                            className={inputClassName}
                            aria-label={`Tag to find for replace rule ${index + 1}`}
                          />
                        </div>
                        <span className="pb-2.5 text-muted-foreground" aria-hidden>→</span>
                        <div className="space-y-1">
                          <Label htmlFor={`replace-with-${row.id}`} className="text-[10px] font-medium text-muted-foreground">Replace with</Label>
                          <DebouncedInput
                            id={`replace-with-${row.id}`}
                            value={row.replace}
                            onChange={(replace) => updateReplaceRow(row.id, { replace })}
                            debounceTime={400}
                            placeholder="league of legends"
                            className={inputClassName}
                            aria-label={`Replacement tag for replace rule ${index + 1}`}
                          />
                        </div>
                      </div>
                    </TagRuleRow>
                  )
                })}
              </TagRulesGroup>

              <TagRulesGroup
                icon={<Plus className="h-3.5 w-3.5" />}
                title="Append"
                description="Keep a tag and add more right after it."
                addLabel="Add append rule"
                onAdd={addAppendRule}
                emptyText="No append rules yet."
              >
                {safeAppendRules.map((rule, index) => (
                  <TagRuleRow
                    key={rule.id}
                    onRemove={() => removeAppendRule(rule.id)}
                    removeLabel={`Delete append rule ${index + 1}`}
                    issue={isCompleteAppendRule(rule) ? null : "Complete both fields before this rule can apply."}
                  >
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.5fr)]">
                      <div className="space-y-1">
                        <Label htmlFor={`append-find-${rule.id}`} className="text-[10px] font-medium text-muted-foreground">Find tag</Label>
                        <DebouncedInput
                          id={`append-find-${rule.id}`}
                          value={rule.find}
                          onChange={(find) => updateAppendRule(rule.id, { find })}
                          debounceTime={400}
                          placeholder="neko"
                          className={inputClassName}
                          aria-label={`Source tag for append rule ${index + 1}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`append-tags-${rule.id}`} className="text-[10px] font-medium text-muted-foreground">Tags to append</Label>
                        <DebouncedInput
                          id={`append-tags-${rule.id}`}
                          value={rule.append.join(", ")}
                          onChange={(value) => updateAppendRule(rule.id, { append: splitCommaSeparatedTags(value) })}
                          debounceTime={400}
                          placeholder="animal ears, cat ears, cat tail"
                          className={inputClassName}
                          aria-label={`Tags to append for rule ${index + 1}`}
                        />
                      </div>
                    </div>
                  </TagRuleRow>
                ))}
              </TagRulesGroup>
            </div>
          </ScrollArea>

          <DialogFooter className="p-4 bg-secondary/20 border-t border-border/50 flex-row justify-end">
            <Button size="sm" onClick={() => handleOpenChange(false)} className="px-6">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TagRulesGroup({ icon, title, description, addLabel, onAdd, emptyText, children }: {
  icon: React.ReactNode
  title: string
  description: string
  addLabel: string
  onAdd: () => void
  emptyText: string
  children: React.ReactNode[]
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h4 className="text-xs font-semibold">{title}</h4>
        <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">{description}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onAdd} className="ml-auto h-7 shrink-0 px-2 text-xs">
          <Plus className="mr-1 h-3.5 w-3.5" />
          {addLabel}
        </Button>
      </div>
      {children.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        children
      )}
    </section>
  )
}

function TagRuleRow({ onRemove, removeLabel, issue, children }: {
  onRemove: () => void
  removeLabel: string
  issue: string | null
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-2.5 shadow-sm">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          className="h-9 w-9 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive-text"
          aria-label={removeLabel}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {issue && (
        <p className="mt-2 text-[10px] text-warning-text">{issue}</p>
      )}
    </div>
  )
}

interface TagsManagementPanelProps {
  addInput: string
  setAddInput: (value: string) => void
  isPresetDialogOpen: boolean
  setIsPresetDialogOpen: (open: boolean) => void
  presetName: string
  setPresetName: (value: string) => void
  savePreset: () => void
  presets: TagPreset[]
  loadPreset: (preset: TagPreset) => void
  deletePreset: (id: string, e: React.MouseEvent) => void

  excludeInput: string
  setExcludeInput: (value: string) => void

  /** "Find" side of the Find & Replace list (comma-separated, paired by index with replaceInput/setReplaceInput).
   *  Edited as rows in the Tag rules dialog; this string pair stays the persisted/pipeline format. */
  findInput: string
  setFindInput: (value: string) => void
  /** "Replace" side of the Find & Replace list (comma-separated, paired by index with findInput/setFindInput). */
  replaceInput: string
  setReplaceInput: (value: string) => void
  tagAppendRules: TagAppendRule[]
  setTagAppendRules: (rules: TagAppendRule[]) => void

  tagCountFilter: string
  setTagCountFilter: (value: string) => void
  setAppliedTagCountFilter: (value: string) => void
  isTagCountSupported: boolean
  isTagCountValid: boolean

  /** Quality floor (Palanca 1, docs/prompt-genericness-mitigation-plan.md §7-§8): score:>=N tier. */
  scoreTier: ScoreTier
  setScoreTier: (value: ScoreTier) => void
  setAppliedScoreTier: (value: ScoreTier) => void

  characterCountFilter: string
  setCharacterCountFilter: (value: string) => void
  setAppliedCharacterCountFilter: (value: string) => void
  includeCharacters: boolean

  /**
   * "full" (default) is the desktop 2-column panel with InfoTooltip visuals.
   * "compact" renders the same controls with the Pocket's tighter markup
   * (smaller inputs/icons, no InfoTooltip visual demos) so a narrow sidebar
   * can host it without the tooltips overflowing. Both variants render from
   * ONE JSX tree, branching per-control on `isCompact` — no
   * logic is duplicated, and there is no separate compact/full copy of the
   * markup to keep in sync.
   */
  variant?: "full" | "compact"

  /**
   * Main-panel layout (full variant only): renders one section's controls
   * bare — no card, no uppercase section header — so they can sit inside a
   * ControlSection ("Search filters" / "Customize prompt"), with plain-language
   * labels + hints instead of ⓘ tooltips and preset-only numeric filters.
   */
  embedded?: boolean
  /** Which section to render. Defaults to both. */
  section?: "all" | "filters" | "edits"
  /** Embedded "filters": the blacklist editor trigger, shown as a row. */
  blacklistSlot?: React.ReactNode
  blacklistCount?: number
  /** Embedded "edits": the Tag Exclusion switch lives under Tags to Add,
   *  since it only ever affects that list. */
  smartTagExclusion?: boolean
  setSmartTagExclusion?: (value: boolean) => void
}

/** Quick picks for the embedded tag-count filter (5 = the default floor). */
const TAG_COUNT_PRESETS = [
  { label: "5+", value: 5 },
  { label: "15+", value: 15 },
  { label: "25+", value: 25 },
  { label: "40+", value: 40 },
  { label: "60+", value: 60 },
]

/**
 * Left column of the "Advanced Filters & Options" panel, in two sections:
 * "Search filters" (minimum tag count, score floor, minimum character posts —
 * change what's fetched) and "Prompt edits" (Tags to Add with presets, Tags to
 * Exclude, Tag rules = Find & Replace + Find & Append — only reshape the final prompt).
 */
export function TagsManagementPanel({
  addInput,
  setAddInput,
  isPresetDialogOpen,
  setIsPresetDialogOpen,
  presetName,
  setPresetName,
  savePreset,
  presets,
  loadPreset,
  deletePreset,
  excludeInput,
  setExcludeInput,
  findInput,
  setFindInput,
  replaceInput,
  setReplaceInput,
  tagAppendRules = [],
  setTagAppendRules,
  tagCountFilter,
  setTagCountFilter,
  setAppliedTagCountFilter,
  isTagCountSupported,
  isTagCountValid,
  scoreTier,
  setScoreTier,
  setAppliedScoreTier,
  characterCountFilter,
  setCharacterCountFilter,
  setAppliedCharacterCountFilter,
  includeCharacters,
  variant = "full",
  embedded = false,
  section = "all",
  blacklistSlot,
  blacklistCount = 0,
  smartTagExclusion,
  setSmartTagExclusion,
}: TagsManagementPanelProps) {
  const isCompact = variant === "compact"
  const isEmbedded = embedded && !isCompact

  // Section summaries: how many controls deviate from their defaults
  // (use-booru-search.ts: tag count "5", score "off", character count "0").
  // Disabled controls don't count — they aren't affecting anything.
  const activeFilterCount =
    (isTagCountSupported && (parseInt(tagCountFilter) || DEFAULT_TAG_COUNT) > DEFAULT_TAG_COUNT ? 1 : 0) +
    (scoreTier !== "off" ? 1 : 0) +
    (includeCharacters && (parseInt(characterCountFilter) || 0) > 0 ? 1 : 0)

  const hasTagRules =
    (splitCommaSeparatedTags(findInput).length > 0 && splitCommaSeparatedTags(replaceInput).length > 0) ||
    (tagAppendRules || []).some(isCompleteAppendRule)
  const activeEditCount =
    (addInput.trim() ? 1 : 0) +
    (excludeInput.trim() ? 1 : 0) +
    (hasTagRules ? 1 : 0)

  const resetFilters = () => {
    setTagCountFilter(String(DEFAULT_TAG_COUNT))
    setAppliedTagCountFilter(String(DEFAULT_TAG_COUNT))
    setScoreTier("off")
    setAppliedScoreTier("off")
    setCharacterCountFilter("0")
    setAppliedCharacterCountFilter("0")
  }

  // Prompt edits can hold long hand-typed tag lists, so clearing them is
  // undoable from the toast instead of being a one-click data loss.
  const resetEdits = () => {
    const snapshot = { addInput, excludeInput, findInput, replaceInput, tagAppendRules: tagAppendRules || [] }
    setAddInput("")
    setExcludeInput("")
    setFindInput("")
    setReplaceInput("")
    setTagAppendRules([])
    toast({
      title: "Prompt edits cleared",
      action: (
        <ToastAction
          altText="Undo clearing prompt edits"
          onClick={() => {
            setAddInput(snapshot.addInput)
            setExcludeInput(snapshot.excludeInput)
            setFindInput(snapshot.findInput)
            setReplaceInput(snapshot.replaceInput)
            setTagAppendRules(snapshot.tagAppendRules)
          }}
        >
          Undo
        </ToastAction>
      ),
    })
  }

  const filtersBody = (
      <>
        <SmoothFilterSlider
          variant={isCompact ? "compact" : undefined}
          min={5}
          max={100}
          step={1}
          presets={isEmbedded ? TAG_COUNT_PRESETS : undefined}
          hideInput={isEmbedded}
          hint={isEmbedded ? "More tags, richer prompts" : undefined}
          value={tagCountFilter}
          onChange={setTagCountFilter}
          onCommit={setAppliedTagCountFilter}
          disabled={!isTagCountSupported}
          labelPrefix={isEmbedded ? "Minimum tags per post" : isCompact ? "Minimum Tags" : "Minimum Tag Count"}
          tooltipTitle="Minimum Tag Count"
          tooltipDescription={isCompact
            ? "Only shows prompts that have at least this number of tags. Recommended between 20 and 30 for detailed prompts."
            : "This option ensures that only prompts with more than a certain amount of tags appear. The higher the number, the more detailed prompts you get; recommended around 20-30."}
          tooltipVisual={isCompact ? undefined : TAG_COUNT_VISUAL}
          inputId="tag-count"
          isInputValid={isTagCountValid}
          maxInput={1000}
          ariaLabel={isCompact ? "Minimum tags" : "Minimum tag count"}
          disabledReason="not supported by this booru"
        />
        <ScoreTierControl
          variant={isCompact ? "compact" : undefined}
          label={isEmbedded ? "Post quality" : undefined}
          hint={isEmbedded ? "Higher score, better tagged" : undefined}
          value={scoreTier}
          onChange={setScoreTier}
          onCommit={setAppliedScoreTier}
        />
        <SmoothFilterSlider
          variant={isCompact ? "compact" : undefined}
          min={0}
          max={10000}
          step={100}
          presets={CHARACTER_COUNT_PRESETS}
          hideInput={isEmbedded}
          hint={isEmbedded ? "Min. posts per character" : undefined}
          value={characterCountFilter}
          onChange={setCharacterCountFilter}
          onCommit={setAppliedCharacterCountFilter}
          disabled={!includeCharacters}
          labelPrefix={isEmbedded ? "Only known characters" : isCompact ? "Minimum Character Posts" : "Minimum Character Post Count"}
          tooltipTitle={isCompact ? "Minimum Character Posts" : "Minimum Character Post Count"}
          tooltipDescription={isCompact
            ? "Filters images to only include characters with more posts accumulated in the booru database, avoiding obscure characters."
            : "This option ensures that only posts containing characters with a minimum amount of booru posts appear. Useful for filtering out obscure characters."}
          inputId="character-count"
          isInputValid={!!characterCountFilter && /^\d+$/.test(characterCountFilter)}
          maxInput={1000000}
          ariaLabel={isCompact ? "Minimum character posts" : "Minimum character post count"}
          disabledReason={isEmbedded ? "turn on character names" : "turn on Character Tags"}
        />
      </>
  )

  const editsBody = (
      <>
        {/* Tags to Add */}
        <div className={isCompact ? "flex flex-col gap-1" : "space-y-2"}>
          {isCompact ? (
            <div className="flex items-center justify-between">
              <Label htmlFor="add-tags-input" className="text-xs font-semibold">Tags to Add</Label>
            </div>
          ) : isEmbedded ? (
            <label htmlFor="add-tags" className="text-sm font-medium text-foreground">Add to every prompt</label>
          ) : (
            <label htmlFor="add-tags" className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <InfoTooltip
                title="Tags to Add"
                description="An option to add whatever tags you want to all prompts. Useful if you use LoRAs with trigger words or want to apply styles (realistic, photorealistic, sketch, etc.)."
                visual={ADD_TAGS_VISUAL}
              >
                Tags to Add
              </InfoTooltip>
            </label>
          )}
          <div className={isCompact
            ? "flex h-8 w-full items-center rounded-md border border-input bg-background/50 pl-2 pr-1 text-xs shadow-sm focus-within:ring-1 focus-within:ring-ring"
            : "flex h-9 w-full items-center rounded-md border border-input bg-background/50 pl-3 pr-1 text-sm shadow-sm transition-colors focus-within:outline-none focus-within:ring-1 focus-within:ring-ring"}
          >
            <DebouncedHTMLInput
              id={isCompact ? "add-tags-input" : "add-tags"}
              value={addInput}
              onChange={setAddInput}
              debounceTime={400}
              placeholder="masterpiece, best quality..."
              aria-label="Tags to include input"
              className="flex-1 bg-transparent border-none p-0 placeholder:text-muted-foreground focus:outline-none h-full min-w-0"
            />
            <div className={isCompact ? "flex items-center gap-0.5 shrink-0 ml-1" : "flex items-center gap-0.5 ml-1.5 shrink-0"}>
              {addInput && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setAddInput("")}
                  className={cn("text-muted-foreground hover:text-foreground rounded-full", isCompact ? "h-5 w-5" : "h-6 w-6")}
                  aria-label="Clear added tags"
                >
                  <X className={isCompact ? "h-2.5 w-2.5" : "h-3 w-3"} />
                </Button>
              )}

              <div className={isCompact ? "h-3.5 w-px bg-border mx-0.5" : "h-4 w-px bg-border mx-1"} />

              {isCompact ? (
                <>
                  <Dialog open={isPresetDialogOpen} onOpenChange={setIsPresetDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" title="Save Tag Preset">
                        <Save className="h-3 w-3" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[350px]">
                      <DialogHeader>
                        <DialogTitle className="text-sm font-bold">Save Tag Preset</DialogTitle>
                        <DialogDescription className="text-xs">
                          Enter a name to save this list of &quot;Tags to Add&quot; — a tag preset only stores this one field, not the rest of your options.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3 py-2 text-xs">
                        <div className="space-y-1">
                          <Label className="text-xs font-medium">Preset Name</Label>
                          <DebouncedInput value={presetName} onChange={setPresetName} debounceTime={300} placeholder="My awesome preset" className="h-8 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium">Tags</Label>
                          <div className="p-2 bg-muted rounded text-[10px] font-mono break-all max-h-20 overflow-y-auto">
                            {addInput || <span className="text-muted-foreground italic">No tags entered</span>}
                          </div>
                        </div>
                      </div>
                      <DialogFooter className="flex-row gap-1 justify-end">
                        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setIsPresetDialogOpen(false)}>Cancel</Button>
                        <Button size="sm" className="h-8 text-xs" onClick={savePreset} disabled={!presetName.trim() || !addInput.trim()}>Save</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" title="Load Tag Preset">
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[180px] text-xs">
                      <DropdownMenuLabel className="text-[10px]">Saved Tag Presets</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {presets.length === 0 ? (
                        <div className="p-2 text-center text-muted-foreground text-[10px]">
                          No saved tag presets
                        </div>
                      ) : (
                        presets.map(preset => (
                          <DropdownMenuItem key={preset.id} className="justify-between group cursor-pointer text-xs" onClick={() => loadPreset(preset)}>
                            <span className="truncate mr-1">{preset.name}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 text-destructive-text hover:text-destructive-text hover:bg-destructive/10 shrink-0"
                              onClick={(e) => deletePreset(preset.id, e)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <div className="flex items-center">
                  <Dialog open={isPresetDialogOpen} onOpenChange={setIsPresetDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground rounded-r-none" title="Save Tag Preset" aria-label="Save current 'Tags to Add' list as a tag preset">
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Save Tag Preset</DialogTitle>
                        <DialogDescription>
                          Enter a name to save this &quot;Tags to Add&quot; list. A tag preset only stores this one field, not the rest of your options.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>Preset Name</Label>
                          <DebouncedInput value={presetName} onChange={setPresetName} debounceTime={300} placeholder="My awesome preset" />
                        </div>
                        <div className="space-y-2">
                          <Label>Tags</Label>
                          <div className="p-2 bg-muted rounded-md text-sm font-mono break-all max-h-32 overflow-y-auto">
                            {addInput || <span className="text-muted-foreground italic">No tags entered</span>}
                          </div>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsPresetDialogOpen(false)}>Cancel</Button>
                        <Button onClick={savePreset} disabled={!presetName.trim() || !addInput.trim()}>Save</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-6 min-w-[1.5rem] text-muted-foreground hover:text-foreground rounded-l-none" title="Load Tag Preset" aria-label="Load a saved tag preset">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[240px]">
                      <DropdownMenuLabel>Saved Tag Presets</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {presets.length === 0 ? (
                        <div className="p-2 text-sm text-center text-muted-foreground">
                          No saved tag presets
                        </div>
                      ) : (
                        presets.map(preset => (
                          <DropdownMenuItem key={preset.id} className="justify-between group cursor-pointer" onClick={() => loadPreset(preset)}>
                            <span className="truncate mr-2">{preset.name}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-destructive-text hover:text-destructive-text hover:bg-destructive/10"
                              onClick={(e) => deletePreset(preset.id, e)}
                              aria-label={`Delete tag preset ${preset.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tag Exclusion — moved here from the generation options on the main
            panel: it only ever filters the "Tags to Add" list above. */}
        {isEmbedded && setSmartTagExclusion && (
          <div className="-mt-1 flex items-center justify-between gap-3">
            <label htmlFor="smart-exclusion-embedded" className="flex cursor-pointer flex-col gap-0.5">
              <span className="text-sm text-foreground">Skip added tags that don&apos;t fit the image</span>
              <span className="text-xs text-muted-foreground">e.g. no face tags when the post is a back view</span>
            </label>
            <Switch
              id="smart-exclusion-embedded"
              checked={!!smartTagExclusion}
              onCheckedChange={setSmartTagExclusion}
              className="shrink-0"
            />
          </div>
        )}

        {/* Tags to Exclude */}
        <div className={isCompact ? "flex flex-col gap-1" : "space-y-2"}>
          {isCompact ? (
            <div className="flex items-center justify-between">
              <Label htmlFor="exclude-tags-input" className="text-xs font-semibold">Tags to Exclude</Label>
            </div>
          ) : isEmbedded ? (
            <label htmlFor="exclude-tags" className="text-sm font-medium text-foreground">Remove from every prompt</label>
          ) : (
            <label htmlFor="exclude-tags" className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <InfoTooltip
                title="Tags to Exclude"
                description="Removes tags from the final prompt text, but keeps the post visible. For example, tags like 'solo' or 'realistic' which are sometimes found in prompts and might not be desired. Different from -tag in search (server-side, hides the post entirely from results) or Blacklist (client-side, also hides the whole post)."
                visual={EXCLUDE_TAGS_VISUAL}
              >
                Tags to Exclude
              </InfoTooltip>
            </label>
          )}
          <div className="relative">
            <DebouncedInput
              id={isCompact ? "exclude-tags-input" : "exclude-tags"}
              value={excludeInput}
              onChange={setExcludeInput}
              debounceTime={400}
              placeholder={isCompact ? "bad quality, watermark, signature..." : "bad quality, watermark..."}
              className={isCompact ? "h-8 text-xs bg-background/50 pr-7" : "h-9 text-sm bg-background/50"}
              aria-label="Tags to exclude input"
            />
            {excludeInput && (
              <button
                type="button"
                onClick={() => setExcludeInput("")}
                aria-label="Clear excluded tags"
                className={cn(
                  "absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground flex items-center justify-center rounded-full hover:bg-muted",
                  isCompact ? "h-5 w-5" : "h-6 w-6"
                )}
              >
                <X className={isCompact ? "h-2.5 w-2.5" : "h-3 w-3"} />
              </button>
            )}
          </div>
        </div>

        <TagRulesEditor
          findInput={findInput}
          replaceInput={replaceInput}
          setFindInput={setFindInput}
          setReplaceInput={setReplaceInput}
          appendRules={tagAppendRules}
          setAppendRules={setTagAppendRules}
          compact={isCompact}
          embedded={isEmbedded}
        />
      </>
  )

  if (isEmbedded) {
    const resetLink = (label: string, onClick: () => void) => (
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onClick} className="h-8 text-xs text-muted-foreground hover:text-foreground">
          <RotateCcw className="mr-1.5 h-3 w-3" />
          {label}
        </Button>
      </div>
    )
    return (
      <div className="flex flex-col gap-5">
        {section !== "edits" && (
          <>
            {filtersBody}
            {blacklistSlot ? (
              // The reset button lives beside the blacklist card instead of on
              // its own row, so toggling a filter never changes the panel's
              // height: the card shrinks leftwards while the button's grid
              // column grows from 0fr to 1fr.
              <div className="flex items-stretch">
                <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">Blacklist</span>
                    <span
                      className="truncate text-xs text-muted-foreground"
                      title={`Posts with these tags are never shown${blacklistCount > 0 ? ` · ${blacklistCount} tag${blacklistCount === 1 ? "" : "s"}` : ""}`}
                    >
                      Posts with these tags are never shown{blacklistCount > 0 ? ` · ${blacklistCount} tag${blacklistCount === 1 ? "" : "s"}` : ""}
                    </span>
                  </div>
                  {blacklistSlot}
                </div>
                <div
                  aria-hidden={activeFilterCount === 0}
                  className={cn(
                    "flex shrink-0 overflow-hidden transition-[max-width,opacity] duration-300 ease-out motion-reduce:transition-none",
                    activeFilterCount > 0 ? "max-w-40 opacity-100" : "max-w-0 opacity-0"
                  )}
                >
                  <button
                    type="button"
                    onClick={resetFilters}
                    tabIndex={activeFilterCount > 0 ? 0 : -1}
                    className="ml-2 flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border/60 bg-background/40 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset filters
                  </button>
                </div>
              </div>
            ) : (
              activeFilterCount > 0 && resetLink("Reset filters", resetFilters)
            )}
          </>
        )}
        {section !== "filters" && (
          <>
            {editsBody}
            {activeEditCount > 0 && resetLink("Clear tag edits", resetEdits)}
          </>
        )}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col divide-y divide-border/60", !isCompact && "bg-muted/30 border rounded-xl p-4")}>
      {/* Query filters (E15/2.6) come FIRST: they decide WHICH posts are
          fetched from the booru API, which happens before any of the prompt
          edits below reshape the text of a post already on screen. */}
      <PanelSection
        title="Search filters"
        hint="Changes what's fetched"
        activeCount={activeFilterCount}
        onReset={resetFilters}
        resetLabel="Reset search filters to defaults"
        compact={isCompact}
      >
        {filtersBody}
      </PanelSection>

      <PanelSection
        title="Prompt edits"
        hint="Only the final prompt text"
        activeCount={activeEditCount}
        onReset={resetEdits}
        resetLabel="Clear all prompt edits"
        compact={isCompact}
        data-tour={isCompact ? undefined : "tags-to-add"}
      >
        {editsBody}
      </PanelSection>
    </div>
  )
}
