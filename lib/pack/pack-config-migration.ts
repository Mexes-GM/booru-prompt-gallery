/**
 * One-time migration from the per-archetype Pack Mode config (V1) to the
 * single unified config (V2) — see the design spec
 * `docs/superpowers/specs/2026-09-27-pack-mode-simplification-design.md` §7.1.
 * Pure function: no storage reads/writes here, callers pass in what they read.
 */
import type { PackModeConfig, PackModeConfigByKind, PackModeConfigV2, PackModeKind } from '../storage'
import type { PackPreferences } from '../storage'
import { splitCommaSeparatedTags } from '../utils/tag-utils'
import { normalizeTagForPack } from './pack-generator'
import { PACK_ARCHETYPES, type PackArchetypeId } from '../tag-taxonomy'
import { DEFAULT_VARIETY_LEVEL } from './variety-presets'
import { DEFAULT_SCENE_SETTINGS, type ScenePackSettings } from './scene-pack'

const DEFAULT_PROMPT_COUNT = 10

/**
 * Per-category counts of a new Classic pack: Equipment and Creature start Off (0),
 * since objects and animals drawn at random rarely belong to the scene. A saved
 * config keeps whatever it says.
 */
export const DEFAULT_AXIS_MIN_COUNTS: Readonly<Record<string, number>> = { equipment: 0, creature: 0 }

/**
 * Upgrades a V1 config saved with the retired `activeSlots` whitelist (it
 * can't be translated into locks faithfully) to the archetype's current
 * locks. Ported from the old `migrateSavedConfigs` in `hooks/use-pack-mode.ts`.
 */
function upgradeLegacyActiveSlots(
  kind: PackModeKind,
  cfg: PackModeConfig & { activeSlots?: string[] }
): PackModeConfig {
  if (!('activeSlots' in cfg) || cfg.lockedSlots) return cfg
  const archetype = PACK_ARCHETYPES[kind as PackArchetypeId]
  if (!archetype) return cfg
  const { activeSlots: _retired, ...rest } = cfg
  return {
    ...rest,
    lockedCategories: [...archetype.lockedCategories],
    lockedSlots: [...(archetype.lockedSlots ?? [])],
  }
}

function hasCustomAxisSettings(cfg: PackModeConfig): boolean {
  return (
    Object.keys(cfg.axisTagModes ?? {}).length > 0 ||
    Object.keys(cfg.axisMinCounts ?? {}).length > 0
  )
}

/**
 * If `v2` already exists, returns it unchanged. Otherwise derives a V2 config
 * from the V1 map's `lastKind` entry (falling back to the legacy `clothing`
 * alias, then to the archetype's own defaults when no config was ever saved).
 */
export function migratePackConfig(
  v2: PackModeConfigV2 | null,
  v1ByKind: PackModeConfigByKind,
  lastKind: PackModeKind
): PackModeConfigV2 {
  if (v2) return v2

  const rawByKind: PackModeConfigByKind = { ...v1ByKind }
  if (rawByKind.clothing && !rawByKind.wardrobe) rawByKind.wardrobe = rawByKind.clothing

  const rawV1 = rawByKind[lastKind]
  const v1 = rawV1 ? upgradeLegacyActiveSlots(lastKind, rawV1) : null

  if (!v1) {
    const archetype = PACK_ARCHETYPES[lastKind as PackArchetypeId] ?? PACK_ARCHETYPES.character
    return {
      lockedCategories: [...archetype.lockedCategories],
      lockedSlots: [...(archetype.lockedSlots ?? [])],
      mutedSlots: [],
      varietyLevel: DEFAULT_VARIETY_LEVEL,
      axisTagModes: {},
      axisMinCounts: { ...DEFAULT_AXIS_MIN_COUNTS },
      promptCount: DEFAULT_PROMPT_COUNT,
      manualAxisValues: {},
    }
  }

  return {
    lockedCategories: [...v1.lockedCategories],
    lockedSlots: [...(v1.lockedSlots ?? [])],
    mutedSlots: [...(v1.mutedSlots ?? [])],
    varietyLevel: hasCustomAxisSettings(v1) ? 'custom' : DEFAULT_VARIETY_LEVEL,
    axisTagModes: { ...(v1.axisTagModes ?? {}) },
    axisMinCounts: { ...v1.axisMinCounts },
    promptCount: v1.promptCount ?? DEFAULT_PROMPT_COUNT,
    manualAxisValues: { ...v1.manualAxisValues },
  }
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

/** The outfit picked per character, keeping only name -> outfit-name strings. */
function savedOutfits(value: unknown): Pick<ScenePackSettings, 'characterOutfits'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return entries.length > 0 ? { characterOutfits: Object.fromEntries(entries) } : {}
}

/**
 * The engine fields of a saved config, with defaults for configs saved before
 * they existed (or with values this version doesn't know): the scenes engine,
 * with each scene option at its default. The classic fields are not touched,
 * so an old config keeps reading exactly as before.
 */
export function packEngineConfig(config: Pick<PackModeConfigV2, 'engine' | 'sceneSettings'>): {
  engine: 'scenes' | 'classic'
  sceneSettings: ScenePackSettings
} {
  const saved: Partial<ScenePackSettings> =
    config.sceneSettings && typeof config.sceneSettings === 'object' ? config.sceneSettings : {}
  return {
    engine: pick(config.engine, ['scenes', 'classic'], 'scenes'),
    sceneSettings: {
      mix: pick(saved.mix, ['faithful', 'remix'], DEFAULT_SCENE_SETTINGS.mix),
      clothing: pick(saved.clothing, ['scene', 'library', 'base', 'own', 'character'], DEFAULT_SCENE_SETTINGS.clothing),
      scenery: pick(saved.scenery, ['scene', 'vary', 'plain', 'picked'], DEFAULT_SCENE_SETTINGS.scenery),
      extras: typeof saved.extras === 'boolean' ? saved.extras : DEFAULT_SCENE_SETTINGS.extras,
      inventedScenes: saved.inventedScenes === true,
      ...savedOutfits(saved.characterOutfits),
    },
  }
}

export const DEFAULT_PACK_PREFERENCES: Readonly<PackPreferences> = {
  promptCount: DEFAULT_PROMPT_COUNT,
  neverDefaults: [],
  includeSensitive: false,
}

/** Preferences in range: a whole count from 1 to 100, normalized tags without repeats. */
export function sanitizePackPreferences(prefs: PackPreferences): PackPreferences {
  const count = Number.isFinite(prefs.promptCount) ? Math.round(prefs.promptCount) : DEFAULT_PROMPT_COUNT
  const neverDefaults: string[] = []
  for (const tag of prefs.neverDefaults) {
    const name = normalizeTagForPack(tag)
    if (name && !neverDefaults.includes(name)) neverDefaults.push(name)
  }
  return {
    promptCount: Math.min(100, Math.max(1, count)),
    neverDefaults,
    includeSensitive: prefs.includeSensitive === true,
  }
}

/**
 * The preferences Pack Mode starts with: the saved ones when they exist, else those
 * the old config carries (count and the "Never include" text), else the defaults.
 * The rest of the old config is engine tuning the redesign retires, so it is not
 * migrated; the old config itself is left as it is.
 */
export function migratePackPreferences(saved: PackPreferences | null, v2: PackModeConfigV2 | null): PackPreferences {
  if (saved) return sanitizePackPreferences(saved)
  if (!v2) return sanitizePackPreferences(DEFAULT_PACK_PREFERENCES)
  return sanitizePackPreferences({
    promptCount: v2.promptCount,
    neverDefaults: splitCommaSeparatedTags(v2.neverIncludeText ?? ''),
    includeSensitive: false,
  })
}
