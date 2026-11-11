/**
 * Tests for lib/pack/scene/scene.ts (extractScene).
 *
 * Covers:
 *   1. The donor's identity, names, meta, style and layout tags stay out; state tags
 *      go to their unit.
 *   2. People counts become `people`; "solo focus" goes to `pairing`, not to camera.
 *   3. A signature accessory travels only with a complete costume.
 *   4. Another person's traits are their identity and stay behind, unless the source is
 *      about them (a theme most of the pool shares); comparisons between people and
 *      with the donor's canon stay behind too.
 *   8. Surroundings (sky, background, light) belong to the place; garments named after
 *      a work never travel.
 *   5. Unclassified tags need support in the pool.
 *   6. Anchors come from the data ("on bed" yes, "on back" no) and from the pool's place tags.
 *   7. Posts without people give no scene; kinship tags never reach the pairing.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-extract.verify.ts
 */
import { extractScene, normalizeRating, tagGender } from "../lib/pack/scene/scene"
import { createPermanence } from "../lib/pack/scene/permanence"
import { makeAssert, makeContext, makePost } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()

const BASE_TAGS =
  "1girl solo blue_hair long_hair red_eyes large_breasts glasses standing smile looking_at_viewer bedroom bed skirt shirt navel highres comic speech_bubble"

// ── Identity, names and meta out; state in ──
{
  const post = makePost(1, `${BASE_TAGS} test_hero test_series test_artist`, {
    tag_string_character: "test_hero",
    tag_string_copyright: "test_series",
    tag_string_artist: "test_artist",
    tag_string_meta: "highres",
    rating: "explicit",
  })
  const scene = extractScene(post, makeContext())!
  const { units } = scene
  assert(scene !== null && scene.postId === 1, "extracts the post")
  assert(scene.rating === "e", "rating is normalized")
  assert(units.skeleton.join() === "standing", "posture goes to skeleton")
  assert(units.face.join() === "smile", "expression goes to face")
  assert(units.camera.join() === "looking at viewer", "camera tag goes to camera")
  assert(units.place.join() === "bedroom,bed", "scenery goes to place")
  assert(units.outfit.join() === "skirt,shirt", "clothing goes to outfit (signature glasses left out)")
  assert(units.exposure.join() === "navel", "state anatomy goes to exposure")
  assert(units.body.length === 0, "nothing else goes to body")
  const all = Object.values(units).flat()
  for (const gone of ["blue hair", "long hair", "red eyes", "large breasts", "glasses", "test hero", "test series",
    "test artist", "highres", "comic", "speech bubble", "1girl", "solo"]) {
    assert(!all.includes(gone), `${gone} is not part of the scene`)
  }
  assert(scene.people?.girls === 1 && scene.people?.boys === 0, "people from the count tags")
  assert(scene.pairing.join() === "solo", "solo goes to pairing")
  assert(scene.aspect !== undefined && Math.abs(scene.aspect - 800 / 1200) < 1e-9, "aspect is width / height")
  assert(scene.preview === "https://example.test/1.jpg", "preview is kept")
}

// ── solo focus is pairing, not camera ──
{
  const scene = extractScene(makePost(2, "2girls solo_focus standing smile from_above bedroom bed skirt shirt"), makeContext())!
  assert(scene.pairing.includes("solo focus"), "solo focus goes to pairing")
  assert(!scene.units.camera.includes("solo focus"), "solo focus is not a camera tag")
  assert(scene.units.camera.includes("from above"), "real camera tags stay")
}

// ── People counts ──
{
  const two = extractScene(makePost(3, "2girls 1boy hetero standing bedroom"), makeContext())!
  assert(two.people?.girls === 2 && two.people?.boys === 1, "2girls 1boy counted")
  assert(two.pairing.join() === "hetero", "hetero is pairing")
  const open = extractScene(makePost(4, "multiple_girls standing bedroom"), makeContext())!
  assert(open.people === null && open.pairing.includes("multiple girls"), "open count gives null people and keeps the tag")
  const none = extractScene(makePost(5, "standing bedroom"), makeContext())!
  assert(none.people === null, "no count tag gives null people")
  assert(extractScene(makePost(6, "no_humans bedroom bed"), makeContext()) === null, "no humans gives no scene")
  const kin = extractScene(makePost(7, "2girls sisters standing bedroom"), makeContext())!
  assert(!kin.pairing.includes("sisters"), "kinship tags do not reach the pairing")
}

// ── Signature accessories ──
{
  const plain = extractScene(makePost(8, "1girl glasses hat standing skirt"), makeContext())!
  assert(!plain.units.outfit.includes("glasses") && !plain.units.outfit.includes("hat"), "signature accessories dropped without a full costume")
  const costume = extractScene(makePost(9, "1girl glasses hat maid_outfit standing"), makeContext())!
  assert(costume.units.outfit.includes("glasses") && costume.units.outfit.includes("hat"), "signature accessories kept with a complete costume")
}

// ── Donor identity and the partner rule ──
{
  const pair = extractScene(makePost(10, "1girl 1boy hetero blue_hair beard muscular_male large_breasts horns lion_boy standing"), makeContext())!
  assert(pair.units.body.length === 0, "a partner's traits (hair, body, species) are their identity and stay behind")
  const themed = extractScene(
    makePost(10, "1girl 1boy hetero blue_hair beard muscular_male large_breasts standing"),
    makeContext({ poolShare: (tag) => (tag === "muscular male" ? 0.8 : 0.1) })
  )!
  assert(themed.units.body.join() === "muscular male", "a partner trait most of the pool shares is the source's theme and travels")
  // How the partner is drawn is theirs too (real permanence data).
  const realData = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "../public/tag-permanence.json"), "utf8"))
  const faceless = extractScene(
    makePost(10, "1girl 1boy hetero faceless_male standing smile bedroom bed"),
    makeContext({ permanence: createPermanence(realData, makeContext().overrides) })
  )!
  assert(!Object.values(faceless.units).flat().includes("faceless male") && !faceless.pairing.includes("faceless male"), "faceless male stays behind")
  assert(!pair.units.body.includes("large breasts") && !pair.units.body.includes("horns"), "the subject's own traits are dropped")
  const asBoy = extractScene(makePost(10, "1girl 1boy hetero beard standing"), makeContext({ subject: "boy" }))!
  assert(!asBoy.units.body.includes("beard"), "a trait of the subject's own gender is dropped")
  const crowd = extractScene(makePost(11, "2girls 1boy beard blue_hair standing"), makeContext())!
  assert(!crowd.units.body.includes("beard"), "two people of the subject's gender: every identity tag goes")
  const solo = extractScene(makePost(12, "1girl solo beard standing"), makeContext())!
  assert(!solo.units.body.includes("beard"), "a one-gender scene keeps no identity tag")
  assert(tagGender("beard", "e") === "boy" && tagGender("muscular male", "g") === "boy" && tagGender("blue hair", "g") === null,
    "tagGender reads words and the affinity table")
  assert(tagGender("female body", "g") === "girl", "words of the female spelling are not read as male")
}

// ── Comparisons and the donor's canon ──
{
  const scene = extractScene(
    makePost(17, "1girl 1boy hetero size_difference interspecies standing smile bedroom bed skirt shirt cosplay test_hero_(cosplay) alternate_costume"),
    makeContext({ poolSupport: () => 5 })
  )!
  const all = Object.values(scene.units).flat()
  for (const gone of ["size difference", "interspecies", "cosplay", "test hero (cosplay)", "alternate costume"]) {
    assert(!all.includes(gone) && !scene.pairing.includes(gone), `${gone} stays behind`)
  }
  const theme = extractScene(makePost(17, "1girl 1boy hetero size_difference standing"), makeContext({ poolShare: (tag) => (tag === "size difference" ? 0.9 : 0) }))!
  assert(theme.units.body.includes("size difference"), "a comparison the whole source is about travels")
}

// ── Surroundings belong to the place ──
{
  const ov = { "blurry background": "pose:camera" }
  const scene = extractScene(
    makePost(18, "1girl standing smile from_above park outdoors sunset pink_sky blurry_background skirt"),
    makeContext({ overrides: { ...makeContext().overrides, ...ov }, poolSupport: () => 3 })
  )!
  assert(["park", "outdoors", "sunset", "pink sky", "blurry background"].every((t) => scene.units.place.includes(t)), "sky, light and any background go to the place")
  assert(!scene.units.camera.includes("blurry background") && !scene.units.loose.includes("pink sky"), "not to the camera or the loose tags")
  const unsupported = extractScene(makePost(19, "1girl standing smile park pink_sky skirt"), makeContext({ poolSupport: () => 1 }))!
  assert(!unsupported.units.place.includes("pink sky"), "an unclassified surrounding still needs the pool's support")
}

// ── Garments named after a work ──
{
  const ov: Record<string, string> = {
    "school uniform": "clothing:outfit", "summer uniform": "clothing:outfit", "summer dress": "clothing:top",
    "kuoh academy school uniform": "clothing:outfit", "pom pom (clothes)": "clothing:accents",
    "kita high school uniform (subarashiki hibi)": "clothing:outfit", "academy": "other:unclassified", "high school": "other:unclassified",
  }
  const overrides = { ...makeContext().overrides, ...ov }
  const scene = extractScene(
    makePost(20, "1girl standing smile bedroom school_uniform summer_uniform kuoh_academy_school_uniform pom_pom_(clothes) kita_high_school_uniform_(subarashiki_hibi) mizutsune_(armor)"),
    makeContext({ overrides, poolSupport: () => 3 })
  )!
  const all = Object.values(scene.units).flat()
  assert(scene.units.outfit.includes("school uniform") && scene.units.outfit.includes("summer uniform"), "generic uniforms travel")
  assert(scene.units.outfit.includes("pom pom (clothes)"), "a generic qualifier on a garment is fine")
  for (const gone of ["kuoh academy school uniform", "kita high school uniform (subarashiki hibi)", "mizutsune (armor)"]) {
    assert(!all.includes(gone), `${gone} is the donor's, not the scene's`)
  }
}

// ── Unclassified tags and support ──
{
  const post = makePost(13, "1girl standing bedroom smile unknown_thing rare_thing mystery_name")
  const supported = extractScene(post, makeContext({ poolSupport: (tag) => (tag === "unknown thing" ? 3 : 1) }))!
  assert(supported.units.loose.join() === "unknown thing", "unclassified tag with support travels with its scene")
  const open = extractScene(post, makeContext())!
  assert(open.units.loose.length === 3, "without a support function nothing is filtered by support")
  assert(open.units.loose.includes("mystery name"), "a tag the taxonomy has no entry for is carried when the pool vouches for it")
  // the booru's own type for a tag settles it
  const kinds: Record<string, "artist" | "copyright" | "character" | "meta" | "general"> = {
    "mystery name": "artist", "unknown thing": "general", "rare thing": "copyright",
  }
  const typed = extractScene(post, makeContext({ tagKind: (tag) => kinds[tag] }))!
  assert(typed.units.loose.join() === "unknown thing", "tags the booru types as artist / copyright / character / meta are dropped, general ones stay")
  const unknownKind = extractScene(post, makeContext({ tagKind: () => undefined }))!
  assert(unknownKind.units.loose.length === 3, "no data on the type: the support filter decides")
  const metaPost = extractScene(makePost(16, "1girl standing bedroom bed smile skirt shirt"), makeContext({ tagKind: (tag) => (tag === "skirt" ? "meta" : undefined) }))!
  assert(!metaPost.units.outfit.includes("skirt") && metaPost.units.outfit.includes("shirt"), "the type applies to tags of any unit")
  // a name the database does not know appears with a single character / series
  const spread = extractScene(post, makeContext({ poolSupport: () => 5, poolSources: (tag) => (tag === "unknown thing" ? 3 : 1) }))!
  assert(spread.units.loose.join() === "unknown thing", "an unclassified tag seen with only one character / series is not carried")
}

// ── Anchors ──
{
  const scene = extractScene(makePost(14, "1girl on_bed on_back indoors bed bedroom against_wall wall"), makeContext())!
  assert(scene.anchors.includes("bed") && scene.anchors.includes("wall") && scene.anchors.includes("indoors"), "bed, wall and indoors are anchors")
  assert(!scene.anchors.includes("back"), "'on back' is not an anchor")
  const rug = makePost(15, "1girl on_rug standing")
  assert(extractScene(rug, makeContext())!.anchors.length === 0, "unknown noun is no anchor without the pool")
  assert(extractScene(rug, makeContext({ poolPlace: new Set(["rug"]) }))!.anchors.join() === "rug", "a place tag of the pool makes the noun an anchor")
}

// ── Ratings ──
assert(normalizeRating("general") === "g" && normalizeRating("safe") === "g" && normalizeRating("sensitive") === "s" &&
  normalizeRating("questionable") === "q" && normalizeRating("q") === "q" && normalizeRating("explicit") === "e", "ratings of every provider")

done()
