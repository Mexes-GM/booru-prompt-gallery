/**
 * The role of a tag (lib/pack/tag-role.ts): whose it is, whether it lasts, what it is,
 * and where that sends it in the brief and in a scene. Real taxonomy snapshot
 * (public/tags-core.json), permanence data and measured tag relations; a cast of one girl.
 *
 * Covers:
 *   1. A table of tags across every kind of role: tags whose slot already says their role
 *      keep it (hair, eyes, garments, postures, places, style), and tags whose slot is a
 *      topic rather than their role get the role (exposure, actions with objects, states of
 *      garments, signature accessories, the other people, composition, ambience, names).
 *   2. The cast decides whose a gendered tag is; without a cast nothing goes to the others.
 *   3. Without the relations, the rules that need them stay silent (unknown, not a guess).
 *   4. The booru's type: a general tag in a name slot is about a name; an unlisted tag is a name.
 *   5. Every role says why; the same tag in any spelling gets the same role.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-tag-role.verify.ts
 */
import fs from "fs"
import path from "path"
import { createPermanence, type PermanenceData } from "../lib/pack/scene/permanence"
import { parseTagRelations, type TagRelationsFile } from "../lib/tag-relations"
import { briefRouteOf, sceneUnitOf, tagRole, type TagRoleContext } from "../lib/pack/tag-role"
import type { TagKind } from "../lib/pack/scene/scene"
import { makeAssert } from "./fixtures/pack-scene-data"

const { assert, done } = makeAssert()
const root = path.join(__dirname, "..")
const CORE: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, "public/tags-core.json"), "utf8"))
const PERMANENCE: PermanenceData = JSON.parse(fs.readFileSync(path.join(root, "public/tag-permanence.json"), "utf8"))
const overrides: Record<string, string> = {}
for (const [tag, slot] of Object.entries(CORE)) overrides[tag.replace(/_/g, " ")] = slot
const permanence = createPermanence(PERMANENCE, overrides)
const relations = parseTagRelations(JSON.parse(fs.readFileSync(path.join(root, "public/tag-relations.json"), "utf8")) as TagRelationsFile)
const ctx: TagRoleContext = { overrides, permanence, relations, cast: ["girl"] }

/**
 * tag | owner | duration | kind | brief row | scene unit | garment:how or object.
 * "-" is null (no owner, no duration, never travels); an empty last column is nothing extra.
 */
const TABLE = `
navel | character | state | aspect | Also | exposure |
nipples | character | state | aspect | Also | exposure |
closed eyes | character | state | aspect | Also | face |
cleavage | character | state | aspect | Also | exposure |
collarbone | character | state | aspect | Also | exposure |
midriff | character | state | aspect | Also | exposure |
pussy | character | state | aspect | Also | exposure |
thighs | character | state | aspect | Also | exposure |
nude | character | state | aspect | Also | exposure |
teeth | character | state | aspect | Also | exposure |
tongue | character | state | aspect | Also | exposure |
armpits | character | state | aspect | Also | exposure |
between breasts | character | state | aspect | Also | exposure |
half-closed eyes | character | state | aspect | Also | face |
hair over one eye | character | state | aspect | Also | body |
messy hair | character | state | aspect | Also | body |
wet hair | character | state | aspect | Also | body |
shiny skin | character | state | aspect | Also | exposure |
nail polish | character | state | aspect | Also | exposure |
upper body | character | state | aspect | Also | exposure |
blue eyes | character | permanent | aspect | Who | - |
large breasts | character | permanent | aspect | Who | - |
long hair | character | permanent | aspect | Who | - |
black hair | character | permanent | aspect | Who | - |
red eyes | character | permanent | aspect | Who | - |
short hair | character | permanent | aspect | Who | - |
bald | character | permanent | aspect | Who | - |
animal ears | character | permanent | aspect | Who | - |
tail | character | permanent | aspect | Who | - |
breasts | character | permanent | aspect | Who | - |
dark skin | character | permanent | aspect | Who | - |
ponytail | character | permanent | aspect | Who | - |
twintails | character | permanent | aspect | Who | - |
freckles | character | permanent | aspect | Who | - |
abs | character | permanent | aspect | Who | - |
dark-skinned male | others | permanent | aspect | Others | body |
muscular male | others | permanent | aspect | Others | body |
faceless male | others | permanent | aspect | Others | body |
interracial | others | permanent | aspect | Others | body |
size difference | others | permanent | aspect | Others | body |
male pubic hair | others | state | aspect | Others | body |
old man | others | permanent | aspect | Others | body |
penis | others | state | aspect | Others | body |
testicles | others | state | aspect | Others | body |
fox girl | character | permanent | aspect | Who | - |
mature female | character | permanent | aspect | Who | - |
dark-skinned female | character | permanent | aspect | Who | - |
genderswap | character | permanent | aspect | Who | - |
hetero | scene | - | composition | People | pairing |
yuri | scene | - | composition | People | pairing |
multiple girls | scene | - | composition | People | pairing |
male focus | scene | - | composition | People | pairing |
2boys | scene | - | composition | People | pairing |
solo | scene | - | composition | People | pairing |
1girl | scene | - | composition | People | pairing |
1boy | scene | - | composition | People | pairing |
solo focus | scene | - | composition | People | pairing |
couple | scene | - | composition | People | pairing |
yaoi | scene | - | composition | People | pairing |
multiple boys | scene | - | composition | People | pairing |
female focus | scene | - | composition | People | pairing |
siblings | scene | - | composition | People | pairing |
shirt lift | character | state | garment-state | Doing | outfit | shirt:moved
panties aside | character | state | garment-state | Doing | outfit | panties:moved
open jacket | character | state | garment-state | Wearing | outfit | jacket:worn
clothes lift | character | state | garment-state | Doing | outfit | *:moved
clothes pull | character | state | garment-state | Doing | outfit | *:moved
skirt lift | character | state | garment-state | Doing | outfit | skirt:moved
no panties | character | state | garment-state | Doing | outfit | panties:off
torn clothes | character | state | garment-state | Doing | outfit | *:worn
open clothes | character | state | garment-state | Doing | outfit | *:worn
bra pull | character | state | garment-state | Doing | outfit | bra:moved
dress lift | character | state | garment-state | Doing | outfit | dress:moved
hood down | character | state | garment-state | Doing | outfit | hood:moved
unworn hat | character | state | garment-state | Doing | outfit | hat:off
open shirt | character | state | garment-state | Wearing | outfit | shirt:worn
no bra | character | state | garment-state | Doing | outfit | bra:off
jacket partially removed | character | state | garment-state | Doing | outfit | jacket:off
panties around one leg | character | state | garment-state | Doing | outfit | panties:moved
fingerless gloves | character | state | garment | Wearing | outfit |
bikini | character | state | garment | Wearing | outfit |
school uniform | character | state | garment | Wearing | outfit |
thighhighs | character | state | garment | Wearing | outfit |
skirt | character | state | garment | Wearing | outfit |
shirt | character | state | garment | Wearing | outfit |
jacket | character | state | garment | Wearing | outfit |
dress | character | state | garment | Wearing | outfit |
kimono | character | state | garment | Wearing | outfit |
black skirt | character | state | garment | Wearing | outfit |
crop top | character | state | garment | Wearing | outfit |
boots | character | state | garment | Wearing | outfit |
panties | character | state | garment | Wearing | outfit |
bra | character | state | garment | Wearing | outfit |
choker | character | state | garment | Wearing | outfit |
gloves | character | state | garment | Wearing | outfit |
earrings | character | state | garment | Wearing | outfit |
alternate costume | character | state | garment | Wearing | - |
hat | character | permanent | garment | Who | outfit |
glasses | character | permanent | garment | Who | outfit |
hair ornament | character | permanent | garment | Who | outfit |
hair ribbon | character | permanent | garment | Who | outfit |
bow | character | permanent | garment | Who | outfit |
hairband | character | permanent | garment | Who | outfit |
witch hat | character | permanent | garment | Who | outfit |
eyepatch | character | permanent | garment | Who | outfit |
reading | character | state | action | Doing | skeleton |
carrying | character | state | action | Doing | skeleton |
holding sword | character | state | action | Doing | skeleton | sword
holding cup | character | state | action | Doing | skeleton | cup
holding umbrella | character | state | action | Doing | skeleton | umbrella
holding weapon | character | state | action | Doing | skeleton | weapon
drinking | character | state | action | Doing | skeleton |
book | scene | state | object | Also | extras |
sword | scene | state | object | Also | extras |
cup | scene | state | object | Also | extras |
umbrella | scene | state | object | Also | extras |
weapon | scene | state | object | Also | extras |
gun | scene | state | object | Also | extras |
katana | scene | state | object | Also | extras |
food | scene | state | object | Also | extras |
phone | scene | state | object | Also | extras |
bird | scene | state | object | Also | extras |
cat | scene | state | object | Also | extras |
sitting | character | state | action | Doing | skeleton |
standing | character | state | action | Doing | skeleton |
lying | character | state | action | Doing | skeleton |
spread legs | character | state | action | Doing | skeleton |
on back | character | state | action | Doing | skeleton |
kneeling | character | state | action | Doing | skeleton |
arms up | character | state | action | Doing | skeleton |
princess carry | character | state | action | Doing | skeleton |
hug | character | state | action | Doing | skeleton |
sex | character | state | action | Doing | skeleton |
kiss | character | state | action | Doing | skeleton |
holding | character | state | action | Doing | skeleton |
hand on own hip | character | state | action | Doing | skeleton |
running | character | state | action | Doing | skeleton |
fighting stance | character | state | action | Doing | skeleton |
sweat | character | state | action | Doing | skeleton |
v | character | state | action | Doing | skeleton |
grabbing own breast | character | state | action | Doing | skeleton |
grabbing another's breasts | character | state | action | Doing | skeleton |
presenting own body | character | state | action | Doing | skeleton |
girl on top | character | state | action | Doing | skeleton |
:d | character | state | expression | Also | face |
smile | character | state | expression | Also | face |
blush | character | state | expression | Also | face |
open mouth | character | state | expression | Also | face |
tears | character | state | expression | Also | face |
from behind | scene | state | framing | Also | camera |
cowboy shot | scene | state | framing | Also | camera |
looking at viewer | scene | state | framing | Also | camera |
full body | scene | state | framing | Also | camera |
from above | scene | state | framing | Also | camera |
pov | scene | state | framing | Also | camera |
night | scene | state | ambience | Ambience | place |
sunset | scene | state | ambience | Ambience | place |
rain | scene | state | ambience | Ambience | place |
day | scene | state | ambience | Ambience | place |
sky | scene | state | ambience | Ambience | place |
cloud | scene | state | ambience | Ambience | place |
water | scene | state | ambience | Ambience | place |
beach | scene | state | place | Where | place |
classroom | scene | state | place | Where | place |
outdoors | scene | state | place | Where | place |
indoors | scene | state | place | Where | place |
bedroom | scene | state | place | Where | place |
simple background | scene | state | place | Where | place |
white background | scene | state | place | Where | place |
two-tone background | scene | state | place | Where | place |
flower | scene | state | object | Where | place |
bed | scene | state | object | Where | place |
chair | scene | state | object | Where | place |
monochrome | picture | - | style | Style | - |
censored | picture | - | style | Style | - |
speech bubble | picture | - | style | Style | - |
heart | picture | - | style | Style | - |
realistic | picture | - | style | Style | - |
no lineart | picture | - | style | Style | - |
greyscale | picture | - | style | Style | - |
sketch | picture | - | style | Style | - |
english text | picture | - | style | Style | - |
border | picture | - | style | Style | - |
chibi | picture | - | style | Style | - |
20s | picture | - | style | Style | - |
@somebody | name | - | name | Style | - |
tifa lockhart | name | - | name | Who | - |
bkub | name | - | name | Style | - |
artist name | picture | - | style | Style | - |
final fantasy vii | name | - | name | Style | - |
wolf boy | others | permanent | aspect | Others | body |
fishing | - | - | unknown | Style | loose |
floral print | - | - | unknown | Style | loose |
makeup | - | - | unknown | Style | loose |
xyzzy plugh | - | - | unknown | Style | loose |
`

const rows = TABLE.trim().split("\n").map((line) => line.split("|").map((cell) => cell.trim()))
assert(rows.length >= 150, `the table has at least 150 tags (${rows.length})`)
const orNull = (cell: string) => (cell === "-" ? null : cell)

// 1. The table.
for (const [tag, owner, duration, kind, route, unit, extra] of rows) {
  const role = tagRole(tag, ctx)
  const got = [role.owner, role.duration, role.kind, briefRouteOf(role), sceneUnitOf(role)]
  const want = [orNull(owner), orNull(duration), kind, route, orNull(unit)]
  assert(got.every((value, i) => value === want[i]), `${tag}: ${want.join(" / ")} (got ${got.join(" / ")}; ${role.rule})`)
  if (extra?.includes(":")) {
    const [garment, how] = extra.split(":")
    assert(role.garment === garment && role.how === how, `${tag}: garment ${extra} (got ${role.garment}:${role.how})`)
  } else if (extra) {
    assert(role.object === extra, `${tag}: object ${extra} (got ${role.object})`)
  }
}

// 1b. An action that needs an object it doesn't name says so; one that names it doesn't.
assert(tagRole("drinking", ctx).needsObject === true, "drinking needs an object")
assert(tagRole("holding sword", ctx).needsObject === undefined, "holding sword names its object")
assert(tagRole("flower", ctx).fixture === true && tagRole("sword", ctx).fixture === undefined, "a prop is part of the place, a sword is not")
assert(tagRole("hetero", ctx).source === "form" && tagRole("siblings", ctx).source === "permanence", "composition by form or by the permanence data")

// 2. The cast decides whose a gendered tag is.
const boys: TagRoleContext = { overrides, permanence, relations, cast: ["boy"] }
assert(tagRole("dark-skinned male", boys).owner === "character", "a boy's trait is the character's in a cast of boys")
assert(tagRole("penis", boys).owner === "character" && tagRole("pussy", boys).owner === "others", "exposure belongs to whoever has it")
assert(tagRole("fox girl", boys).owner === "others", "a girl's word in a cast of boys is someone else")
const mixed: TagRoleContext = { overrides, permanence, relations, cast: ["girl", "boy"] }
const nobody: TagRoleContext = { overrides, permanence, relations }
for (const c of [mixed, nobody]) {
  assert(tagRole("dark-skinned male", c).owner === "character", "with a mixed or unknown cast, a gendered trait stays the character's")
  assert(tagRole("penis", c).owner === "character", "with a mixed or unknown cast, the affinity decides nothing")
  assert(tagRole("interracial", c).owner === "others", "a comparison between people is the others' whatever the cast")
}

// 3. Without the relations: the rules that read them stay silent.
const bare: TagRoleContext = { overrides, permanence, cast: ["girl"] }
assert(tagRole("drinking", bare).kind === "unknown", "drinking has no slot: without the relations it is unknown")
assert(tagRole("girl on top", bare).kind === "unknown", "girl on top: without the relations it is unknown")
assert(tagRole("holding sword", bare).kind === "action" && tagRole("holding sword", bare).object === "sword", "the grip verb needs no relations")
assert(tagRole("sword", bare).kind === "object" && tagRole("sword", bare).rule === "object.slot", "a thing is a thing by its slot")
assert(tagRole("shirt lift", bare).kind === "garment-state", "the garment-state form needs no relations")

// 4. The booru's type.
const KINDS: Record<string, TagKind> = { "artist name": "general", signature: "general", "some newname": "unlisted", "made up (some work)": "general", "some work": "copyright" }
const typed: TagRoleContext = { overrides, permanence, relations, cast: ["girl"], tagKind: (t) => KINDS[t] }
assert(tagRole("artist name", typed).owner === "picture" && tagRole("signature", typed).kind === "style", "a general tag in a name slot is about a name: text in the picture")
assert(tagRole("artist name", ctx).owner === "picture", "the relations measure only general tags: one they list is not a name")
assert(tagRole("artist name", bare).owner === "name" && tagRole("signature", ctx).owner === "name", "with neither the booru's type nor the relations, the slot says name")
assert(tagRole("some newname", typed).kind === "name", "a tag the booru doesn't list is a name it never typed")
assert(tagRole("made up (some work)", typed).kind === "name", "a tag qualified by a work the booru knows is a name")
assert(tagRole("some newname", ctx).kind === "unknown", "without the booru, an unknown word stays unknown")

// 5. Why, and spelling.
for (const [tag] of rows) assert(tagRole(tag, ctx).why.length > 0, `${tag}: says why`)
assert(tagRole("Holding_Sword", ctx).tag === "holding sword" && tagRole("Holding_Sword", ctx).kind === "action", "spelling: case and underscores")
assert(tagRole("star \\(sky\\)", ctx).tag === "star (sky)", "spelling: parentheses escaped for the generators")
assert(tagRole("SHIRT_LIFT", ctx).garment === "shirt", "spelling: the garment of an underscored tag")

done()
