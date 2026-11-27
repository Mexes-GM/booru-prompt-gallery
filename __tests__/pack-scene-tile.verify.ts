/**
 * The contact sheet's tiles and the result rows' post references, without pictures
 * (components/prompt-gallery/pack/scene-tile.ts):
 *   1. the people count, and that it shows only when it differs between scenes;
 *   2. invented scenes and library outfits are named, never shown as a negative post number;
 *   3. a post reference links only for a real post on a known site.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-tile.verify.ts
 */
import assert from "node:assert/strict"
import { peopleText, scenePostHref, sceneThumbs } from "../components/prompt-gallery/pack/scene-tile"

let passed = 0
const check = (name: string, fn: () => void) => {
  try {
    fn()
    passed++
  } catch (err) {
    console.error(`FAIL ${name}`)
    throw err
  }
}

check("people count", () => {
  assert.equal(peopleText({ girls: 1, boys: 0 }), "Solo")
  assert.equal(peopleText({ girls: 1, boys: 1 }), "2 people")
  assert.equal(peopleText({ girls: 2, boys: 1 }), "3 people")
  assert.equal(peopleText(null), "Group")
})

check("the count shows only when it tells scenes apart", () => {
  const same = sceneThumbs([
    { postId: 11, people: { girls: 1, boys: 0 } },
    { postId: 12, people: { girls: 1, boys: 0 } },
  ])
  assert.deepEqual(same, [{ id: "11", postId: 11 }, { id: "12", postId: 12 }])
  const mixed = sceneThumbs([
    { postId: 11, people: { girls: 1, boys: 0 } },
    { postId: 12, people: { girls: 1, boys: 1 } },
  ])
  assert.deepEqual(mixed.map((t) => t.detail), ["Solo", "2 people"])
})

check("scenes with no post are named", () => {
  const [invented, outfit, post] = sceneThumbs([
    { postId: -4, people: { girls: 1, boys: 0 }, invented: true },
    { postId: -8, people: { girls: 1, boys: 0 }, outfitId: 7 },
    { postId: 99, people: { girls: 1, boys: 0 } },
  ])
  assert.equal(invented.name, "Invented")
  assert.equal(invented.spokenName, "Invented scene")
  assert.equal(outfit.name, "Outfit")
  assert.equal(post.name, undefined)
  assert.equal(invented.id, "-4")
})

check("post links", () => {
  assert.equal(scenePostHref("danbooru", { postId: 123 }), "https://danbooru.donmai.us/posts/123")
  assert.equal(scenePostHref("gelbooru", { postId: 5 }), "https://gelbooru.com/index.php?page=post&s=view&id=5")
  assert.equal(scenePostHref("danbooru", { postId: -2, invented: true }), undefined)
  assert.equal(scenePostHref("danbooru", { postId: 3, invented: true }), undefined)
  assert.equal(scenePostHref(undefined, { postId: 3 }), undefined)
  assert.equal(scenePostHref("danbooru", undefined), undefined)
})

console.log(`pack-scene-tile: ${passed} checks passed`)
