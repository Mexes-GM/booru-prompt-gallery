/**
 * The result rows' post references (components/prompt-gallery/pack/scene-ref.ts):
 * a post reference links only for a real post on a known site.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/pack-scene-ref.verify.ts
 */
import assert from "node:assert/strict"
import { scenePostHref } from "../components/prompt-gallery/pack/scene-ref"

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

check("post links", () => {
  assert.equal(scenePostHref("danbooru", { postId: 123 }), "https://danbooru.donmai.us/posts/123")
  assert.equal(scenePostHref("gelbooru", { postId: 5 }), "https://gelbooru.com/index.php?page=post&s=view&id=5")
  assert.equal(scenePostHref("danbooru", { postId: -2, invented: true }), undefined)
  assert.equal(scenePostHref("danbooru", { postId: 3, invented: true }), undefined)
  assert.equal(scenePostHref(undefined, { postId: 3 }), undefined)
  assert.equal(scenePostHref("danbooru", undefined), undefined)
})

console.log(`pack-scene-ref: ${passed} checks passed`)
