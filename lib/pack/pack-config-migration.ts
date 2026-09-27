/**
 * One-time migration from the per-archetype Pack Mode config (V1) to the
 * single unified config (V2) — see the design spec
 * `docs/superpowers/specs/2026-09-27-pack-mode-simplification-design.md` §7.1.
 * Pure function: no storage reads/writes here, callers pass in what they read.
 */
import type { PackModeConfig, PackModeConfigByKind, PackModeConfigV2, PackModeKind } from '../storage'
import { PACK_ARCHETYPES, type PackArchetypeId } from '../tag-taxonomy'
import { DEFAULT_VARIETY_LEVEL } from './variety-presets'

const DEFAULT_PROMPT_COUNT = 10

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
      axisMinCounts: {},
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
