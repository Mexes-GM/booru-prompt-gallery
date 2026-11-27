/**
 * One character per prompt, in turn (PackBrief.castMode 'turns'): who each prompt is for, and the
 * pack made as one run of the scenes engine per character. Each run is the pack of only that
 * character (their identity, outfit and composition, lib/pack/brief-pack.ts briefPackArgs on
 * turnBriefs) with their share of the prompts and a seed of its own; the scenes one run used stay
 * out of the next ones, so two characters don't get the same scene while the pool has others.
 * The runs' prompts are then put back in turn order.
 *
 * Pure apart from the engine it calls; the React side is hooks/use-pack-brief-scenes.ts.
 */
import type { PackPrompt } from './pack-generator'
import type { ScenePool } from './scene/scene-pool'
import { generateScenePackAsync, type AsyncControl, type ScenePackArgs, type ScenePackIssue, type ScenePackResult } from './scene-pack'

/**
 * The character of each of `rows` (the rows a run fills, in order), so that every character has an
 * even share of the whole pack, the rows `kept` (locked, with the character they already show)
 * counted in, and they alternate: each row goes to the character with the fewest rows so far, a
 * tie to the next one in turn from the row's position. 10 rows and 3 characters: 4, 3 and 3,
 * as A B C A B C A B C A.
 */
export function assignTurns(rows: readonly number[], characters: readonly string[], kept: readonly (string | undefined)[] = []): string[] {
  const n = characters.length
  if (n === 0) return []
  const count = new Map(characters.map((c) => [c, 0]))
  for (const c of kept) if (c !== undefined && count.has(c)) count.set(c, count.get(c)! + 1)
  return rows.map((row) => {
    let best = -1
    for (let step = 0; step < n; step++) {
      const i = (((row + step) % n) + n) % n
      if (best < 0 || count.get(characters[i])! < count.get(characters[best])!) best = i
    }
    const who = characters[best]
    count.set(who, count.get(who)! + 1)
    return who
  })
}

/** How many prompts each character has in `order`, in the order the characters first come. */
export function turnShares(order: readonly string[]): Array<{ character: string; share: number }> {
  const out: Array<{ character: string; share: number }> = []
  for (const c of order) {
    const at = out.find((s) => s.character === c)
    if (at) at.share++
    else out.push({ character: c, share: 1 })
  }
  return out
}

/** A seed of its own for the run of the `index`-th character, from the pack's seed. */
export const turnSeed = (seed: number, index: number): number => (index === 0 ? seed : (seed ^ Math.imul(index, 0x9e3779b1)) >>> 0)

/** One character's run: the pool of their composition and the engine's arguments for a pack of only them. */
export interface TurnRun {
  character: string
  pool: ScenePool
  /** Their count and seed are set here (their share, turnSeed). */
  args: ScenePackArgs
}

/** The scenes a prompt was made from that another character's prompt must not take: its scene, or in a one-part pack its donors. */
function scenesOf(prompt: PackPrompt, oneAxis: boolean): number[] {
  const scene = prompt.scene
  if (!scene) return []
  if (!oneAxis) return [scene.postId]
  // A one-part pack repeats one scene for everyone: what is a prompt's own is the part it was lent.
  return (scene.donors ?? []).filter((id) => id !== scene.postId)
}

/**
 * The pack of one character per prompt: each character's run (`runFor`) with their share of `order`
 * (the character of each prompt, assignTurns), one after another. A run leaves out the scenes the
 * runs before it used; when that leaves it short, it runs again without leaving them out and keeps
 * whichever made more prompts (a small pool then shares scenes between characters rather than
 * coming out short). Every prompt says whose it is (`character`). The prompts come back in `order`;
 * a character with fewer prompts than their share leaves the rest to the others' in the same order
 * (the pack is then short by as many). Null when cancelled.
 */
export async function generateTurnsAsync(
  order: readonly string[],
  runFor: (character: string, index: number) => TurnRun | null,
  control: AsyncControl
): Promise<ScenePackResult | null> {
  const shares = turnShares(order)
  const made = new Map<string, PackPrompt[]>()
  const issues: ScenePackIssue[][] = []
  const used: number[] = []
  for (const [index, { character, share }] of shares.entries()) {
    const run = runFor(character, index)
    if (!run) continue
    const oneAxis = !!run.args.changes && run.args.changes !== 'scene'
    const base: ScenePackArgs = { ...run.args, count: share, seed: turnSeed(run.args.seed, index) }
    const apart: ScenePackArgs = used.length > 0 ? { ...base, removedScenes: [...(base.removedScenes ?? []), ...used] } : base
    let out = await generateScenePackAsync(run.pool, apart, control)
    if (!out) return null
    if (out.prompts.length < share && apart !== base) {
      const shared = await generateScenePackAsync(run.pool, base, control)
      if (!shared) return null
      if (shared.prompts.length > out.prompts.length) out = shared
    }
    if (control.cancelled()) return null
    made.set(character, out.prompts.map((p) => ({ ...p, character })))
    issues.push(out.issues)
    for (const p of out.prompts) used.push(...scenesOf(p, oneAxis))
  }
  // In turn order; a short character's places go to the next prompts in line.
  const queues = new Map(Array.from(made, ([c, list]) => [c, [...list]]))
  const prompts: PackPrompt[] = []
  for (const c of order) {
    const next = queues.get(c)?.shift()
    if (next) prompts.push(next)
  }
  return { prompts, shortBy: order.length - prompts.length, issues: mergeTurnIssues(issues, prompts.length) }
}

const peopleKey = (p: { girls: number; boys: number }) => `${p.girls}/${p.boys}`

/**
 * The runs' issues as one pack's: one entry per request and kind, as a single run reports them.
 * Counts of prompts add up; counts of scenes are the largest a run saw (they share the pool); a
 * pack that came out short says how many prompts the whole pack has (`made`).
 */
export function mergeTurnIssues(runs: ReadonlyArray<readonly ScenePackIssue[]>, made: number): ScenePackIssue[] {
  const out: ScenePackIssue[] = []
  const keyOf = (issue: ScenePackIssue): string => {
    switch (issue.kind) {
      case 'needs-company':
      case 'request-dropped': return `${issue.kind}|${issue.role}|${issue.tag}`
      case 'pose-imposed': return `${issue.kind}|${issue.tag}`
      case 'few-scenes':
      case 'scenes-reused': return `${issue.kind}|${issue.tags.join(',')}`
      case 'composition-without-pose': return `${issue.kind}|${issue.tags.join(',')}|${peopleKey(issue.people)}`
      case 'axis-requested': return `${issue.kind}|${issue.axis}|${issue.tags.join(',')}`
      case 'few-variations': return `${issue.kind}|${issue.axis}`
      case 'condition-variety': return `${issue.kind}|${issue.role}`
    }
  }
  const at = new Map<string, number>()
  for (const list of runs) {
    for (const issue of list) {
      const key = keyOf(issue)
      const i = at.get(key)
      if (i === undefined) {
        at.set(key, out.length)
        out.push({ ...issue } as ScenePackIssue)
        continue
      }
      const have = out[i]
      if ((have.kind === 'needs-company' || have.kind === 'pose-imposed') && issue.kind === have.kind) have.prompts += issue.prompts
      else if (have.kind === 'scenes-reused' && issue.kind === 'scenes-reused') {
        have.prompts += issue.prompts
        have.scenes = Math.max(have.scenes, issue.scenes)
      } else if (have.kind === 'few-scenes' && issue.kind === 'few-scenes') have.scenes = Math.max(have.scenes, issue.scenes)
      else if (have.kind === 'composition-without-pose' && issue.kind === have.kind) have.scenes = Math.max(have.scenes, issue.scenes)
      else if (have.kind === 'few-variations' && issue.kind === 'few-variations') have.variations = Math.max(have.variations, issue.variations)
      else if (have.kind === 'condition-variety' && issue.kind === 'condition-variety') {
        have.fromScene += issue.fromScene
        have.fromDonors += issue.fromDonors
        have.fromLibrary += issue.fromLibrary
        have.imposed += issue.imposed
        have.partial += issue.partial
        // The runs leave out each other's scenes, so their forms are mostly different: at most one per prompt.
        have.variants = Math.min(have.variants + issue.variants, have.fromScene + have.fromDonors + have.fromLibrary)
      }
    }
  }
  // Short: the whole pack's prompts, not one run's.
  return out.map((issue) => (issue.kind === 'few-scenes' || issue.kind === 'few-variations' ? { ...issue, prompts: made } : issue))
}
