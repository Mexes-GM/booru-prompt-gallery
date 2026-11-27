/**
 * The pack's clothes set in Wearing alone (lib/pack/brief-pack.ts): which library styles a pack
 * offers, how much of each library outfit goes in a prompt (PackBrief.outfitDetail), that the
 * detail reaches the engine's arguments, and that saved packs keep it (and older ones still load).
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-outfit-detail.verify.ts
 */
import assert from "node:assert/strict"
import { addOutfitStyle, emptyBrief, removeOutfitStyle, setOutfitDetail, type PackBrief } from "../lib/pack/brief"
import { briefFromCharacters } from "../lib/pack/brief-history"
import {
  briefIdentity,
  briefPackArgs,
  coreKeyOf,
  menuOutfit,
  packLibraryOutfits,
  packOutfitDetail,
  packOutfitStyles,
  type BriefOutfit,
  type ResolvedLook,
} from "../lib/pack/brief-pack"
import { readSavedPack, savedPackToStore, type SavedPackInput } from "../lib/pack/saved-pack"
import { ADULT_OUTFIT_STYLES, DEFAULT_OUTFIT_STYLES, OUTFIT_STYLES, type Outfit } from "../lib/outfit-swap"
import type { Permanence } from "../lib/pack/scene/permanence"

let passed = 0
const check = (name: string, fn: () => void) => {
  try {
    fn()
    passed++
  } catch (err) {
    console.error(`FAIL: ${name}`)
    throw err
  }
}
/** Through storage: localStorage holds JSON text. */
const stored = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

// Two outfits with more than their main pieces: legwear, jewelry, a bag.
const LIBRARY: Outfit[] = [
  {
    id: 0,
    style: "summer",
    slots: {
      top: ["white shirt", "collared shirt", "short sleeves"],
      bottom: ["denim shorts"],
      footwear: ["sneakers"],
      legwear: ["white socks"],
      accents: ["necklace"],
      handheld: ["handbag"],
    },
  },
  {
    id: 1,
    style: "lingerie",
    slots: { underwear: ["black bra", "black panties"], legwear: ["black thighhighs"] },
  },
  {
    id: 2,
    style: "winter",
    slots: { outfit: ["coat"], legwear: ["pantyhose"], headwear: ["beanie"] },
  },
]

// ── Which styles a pack offers ───────────────────────────────────────────────────

check("every library style is offered, the adult ones only above Safe", () => {
  const safe = packOutfitStyles("sfw")
  assert.deepEqual(safe, OUTFIT_STYLES.filter((s) => !ADULT_OUTFIT_STYLES.includes(s)))
  assert.ok(!safe.includes("lingerie") && !safe.includes("sexy"))
  for (const rating of ["explicit", "questionable", "both"] as const) {
    assert.deepEqual(packOutfitStyles(rating), [...OUTFIT_STYLES], `${rating}: every style`)
  }
})

check("the styles don't follow the gallery's Random outfit choice", () => {
  // The gallery's own default leaves Lingerie and Sexy out; the pack offers them above Safe anyway.
  assert.ok(!DEFAULT_OUTFIT_STYLES.includes("lingerie"))
  assert.ok(packOutfitStyles("explicit").includes("lingerie"))
  // The function takes the rating alone: nothing of the gallery's settings can reach it.
  assert.equal(packOutfitStyles.length, 1)
})

// ── The detail on the brief ──────────────────────────────────────────────────────

check("detail: main pieces by default, full when chosen, whole outfits without a style", () => {
  const brief = briefFromCharacters(["tifa lockhart"])
  assert.equal(brief.outfitDetail, undefined, "a new pack doesn't set it")
  assert.equal(packOutfitDetail(brief), "full", "no style: the library only lends garments, whole")
  const styled = addOutfitStyle(brief, "summer")
  assert.equal(packOutfitDetail(styled), "simple", "a style: main pieces by default")
  const full = setOutfitDetail(styled, "full")
  assert.equal(full.outfitDetail, "full")
  assert.equal(packOutfitDetail(full), "full")
  assert.equal(packOutfitDetail(setOutfitDetail(full, "simple")), "simple")
  // The same detail again changes nothing (no new history entry).
  assert.equal(setOutfitDetail(full, "full"), full)
  // Removing the last style keeps the choice for the next one.
  const unstyled = removeOutfitStyle(full, "summer")
  assert.equal(unstyled.outfitDetail, "full")
  assert.equal(packOutfitDetail(unstyled), "full")
  assert.equal(packOutfitDetail(addOutfitStyle(unstyled, "winter")), "full")
  // The input brief is never changed.
  assert.equal(styled.outfitDetail, undefined)
})

check("a change of detail is a change of the pack (coreKeyOf)", () => {
  const styled = addOutfitStyle(emptyBrief(), "summer")
  const keys = new Set([coreKeyOf(styled), coreKeyOf(setOutfitDetail(styled, "simple")), coreKeyOf(setOutfitDetail(styled, "full"))])
  assert.equal(keys.size, 3)
})

// ── The library at the pack's detail ─────────────────────────────────────────────

check("packLibraryOutfits: main pieces or the whole outfit, only the styles given", () => {
  const simple = packLibraryOutfits(LIBRARY, packOutfitStyles("sfw"), "simple")
  const full = packLibraryOutfits(LIBRARY, packOutfitStyles("sfw"), "full")
  assert.deepEqual(simple.map((o) => o.outfitId), [0, 2], "lingerie stays out at Safe")
  assert.deepEqual(simple[0], { outfitId: 0, tags: ["white shirt", "collared shirt", "denim shorts", "sneakers"], style: "summer" })
  assert.deepEqual(full[0].tags, ["white shirt", "collared shirt", "short sleeves", "denim shorts", "white socks", "sneakers", "necklace", "handbag"])
  assert.deepEqual(simple[1].tags, ["coat"])
  assert.deepEqual(full[1].tags, ["coat", "pantyhose", "beanie"])
  assert.deepEqual(packLibraryOutfits(LIBRARY, packOutfitStyles("explicit"), "simple").map((o) => o.outfitId), [0, 1, 2])
})

// ── It reaches the engine ────────────────────────────────────────────────────────

const OVERRIDES: Record<string, string> = { "tifa lockhart": "other:character", "black hair": "appearance:hair" }
const permanence = (): Permanence => "identity"
const TIFA: ResolvedLook = { look: ["black hair"], subject: ["1girl", "solo"], source: "pool" }

/** As usePackBriefScenes builds the engine's arguments: the library at the brief's detail. */
function engineArgs(brief: PackBrief) {
  const who = briefIdentity({ brief, looks: { "tifa lockhart": TIFA }, permanence, overrides: OVERRIDES })
  const styles = packOutfitStyles("sfw")
  return briefPackArgs(brief, who, {
    overrides: OVERRIDES,
    permanence,
    count: 4,
    seed: 1,
    people: { girls: 1, boys: 0 },
    outfit: { kind: "scene" },
    clean: (t) => t.join(", "),
    outfitStyles: (brief.outfitStyles ?? []).filter((s) => (styles as string[]).includes(s)),
    outfitLibrary: packLibraryOutfits(LIBRARY, styles, packOutfitDetail(brief)),
  })
}

check("the detail reaches ScenePackArgs.outfitLibrary", () => {
  const styled = addOutfitStyle(briefFromCharacters(["tifa lockhart"]), "summer")
  const simpleArgs = engineArgs(styled)
  assert.deepEqual(simpleArgs.requests?.outfitStyles, ["summer"])
  const summer = (args: ReturnType<typeof engineArgs>) => args.outfitLibrary?.find((o) => o.outfitId === 0)?.tags
  assert.deepEqual(summer(simpleArgs), ["white shirt", "collared shirt", "denim shorts", "sneakers"])
  const fullArgs = engineArgs(setOutfitDetail(styled, "full"))
  assert.ok(summer(fullArgs)?.includes("white socks") && summer(fullArgs)?.includes("necklace"))
  // The library is chosen in Wearing only: the outfit menu's old "library" choice draws nothing.
  assert.equal(simpleArgs.library, undefined)
  assert.equal(simpleArgs.settings.clothing, "scene")
})

// ── Saved packs ──────────────────────────────────────────────────────────────────

const input = (brief: PackBrief, outfit: BriefOutfit = { kind: "scene" }): SavedPackInput => ({
  brief,
  outfit,
  provider: "danbooru",
  gallerySearch: "tifa_lockhart rating:general",
  result: null,
})

check("a saved pack keeps its detail", () => {
  const brief = setOutfitDetail(addOutfitStyle(briefFromCharacters(["tifa lockhart"]), "summer"), "full")
  const back = readSavedPack(stored(savedPackToStore(input(brief), 1)))
  assert.ok(back)
  assert.equal(back.brief.outfitDetail, "full")
  assert.deepEqual(back.brief, brief)
})

check("an older saved pack, without a detail, loads with main pieces", () => {
  const older = addOutfitStyle(briefFromCharacters(["tifa lockhart"]), "summer")
  assert.ok(!("outfitDetail" in older))
  const back = readSavedPack(stored(savedPackToStore(input(older), 1)))
  assert.ok(back, "loads")
  assert.equal(back.brief.outfitDetail, undefined)
  assert.equal(packOutfitDetail(back.brief), "simple")
})

check("an older saved pack with the library as its outfit loads, and reads as each scene's", () => {
  const back = readSavedPack(stored(savedPackToStore(input(briefFromCharacters(["tifa lockhart"]), { kind: "library" }), 1)))
  assert.ok(back, "loads")
  assert.deepEqual(menuOutfit(back.outfit), { kind: "scene" })
  assert.deepEqual(menuOutfit({ kind: "usual" }), { kind: "usual" })
  assert.deepEqual(menuOutfit({ kind: "official", name: "Cowgirl" }), { kind: "official", name: "Cowgirl" })
  assert.deepEqual(menuOutfit(undefined), { kind: "scene" })
})

check("a broken detail drops the saved value, like any broken field", () => {
  const good = stored(savedPackToStore(input(briefFromCharacters(["tifa lockhart"])), 1)) as Record<string, unknown>
  assert.ok(readSavedPack(good))
  assert.equal(readSavedPack({ ...good, brief: { ...(good.brief as object), outfitDetail: "everything" } }), null)
})

console.log(`pack-outfit-detail: ${passed} checks passed`)
