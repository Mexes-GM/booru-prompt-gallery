/**
 * Tests for lib/pack/scene/scene.ts (extractScene).
 *
 * Covers:
 *   1. The donor's identity, names, meta, style and layout tags stay out; state tags
 *      go to their unit.
 *   2. People counts become `people`; "solo focus" goes to `pairing`, not to camera.
 *   3. A signature accessory travels only with a complete costume.
 *   4. A partner of the other gender keeps their traits; two people of the subject's
 *      gender drop every identity tag; one-gender scenes drop them too.
 *   5. Unclassified tags need support in the pool.
 *   6. Anchors come from the data ("on bed" yes, "on back" no) and from the pool's place tags.
 *   7. Posts without people give no scene; kinship tags never reach the pairing.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-extract.verify.ts
 */
import { extractScene, normalizeRating, tagGender } from "../lib/pack/scene/scene"
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
  assert(units.body.join() === "navel", "state anatomy goes to body")
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
  const pair = extractScene(makePost(10, "1girl 1boy hetero blue_hair beard muscular_male large_breasts horns standing"), makeContext())!
  assert(pair.units.body.includes("beard") && pair.units.body.includes("muscular male"), "partner traits of the other gender are kept")
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

// ── Unclassified tags and support ──
{
  const post = makePost(13, "1girl standing bedroom smile unknown_thing rare_thing")
  const supported = extractScene(post, makeContext({ poolSupport: (tag) => (tag === "unknown thing" ? 3 : 1) }))!
  assert(supported.units.loose.join() === "unknown thing", "unclassified tag with support travels with its scene")
  const open = extractScene(post, makeContext())!
  assert(open.units.loose.length === 2, "without a support function nothing is filtered by support")
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
