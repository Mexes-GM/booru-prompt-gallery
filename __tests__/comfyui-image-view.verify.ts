/**
 * Tests for opening a generated image in the app (lib/comfyui/image-view.ts): the
 * shape of Pack's picture box, the download's file name, and the image cache that
 * the viewer, Download and Open in new tab share.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/comfyui-image-view.verify.ts
 */
import { createImageCache, imageFileName, MAX_ASPECT, MIN_ASPECT, previewAspect } from "../lib/comfyui/image-view"

let passed = 0
let failed = 0
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed++
  else {
    failed++
    console.error(`  FAIL: ${label} (got ${a}, want ${e})`)
  }
}

async function main() {
  // previewAspect: the size sent, then the image's own once loaded.
  eq(previewAspect({ width: 832, height: 1216 }), 832 / 1216, "portrait size sent")
  eq(previewAspect({ width: 1216, height: 832 }), 1216 / 832, "landscape size sent")
  eq(previewAspect({ width: 1024, height: 1024 }), 1, "square size sent")
  eq(previewAspect(), 1, "nothing known: square")
  eq(previewAspect({ width: null, height: 1216 }), 1, "half a size: square")
  eq(previewAspect({ width: 0, height: 0 }), 1, "zero size: square")
  eq(previewAspect({ width: 832, height: 1216 }, { width: 1024, height: 1024 }), 1, "the loaded image wins over the size sent")
  eq(previewAspect(null, { width: 896, height: 1152 }), 896 / 1152, "loaded image without a size sent")
  eq(previewAspect({ width: 832, height: 1216 }, { width: 0, height: 0 }), 832 / 1216, "an image with no size yet keeps the size sent")
  eq(previewAspect({ width: 512, height: 4096 }), MIN_ASPECT, "very tall is capped")
  eq(previewAspect({ width: 4096, height: 512 }), MAX_ASPECT, "very wide is capped")

  // imageFileName: ComfyUI's file name, for the download.
  eq(imageFileName("http://127.0.0.1:8188/view?filename=Radblack_normal_00048_.png&subfolder=&type=output"), "Radblack_normal_00048_.png", "file name from the URL")
  eq(imageFileName("http://127.0.0.1:8188/view?filename=a%20b.webp&subfolder=x&type=output"), "a b.webp", "decoded file name")
  eq(imageFileName("http://127.0.0.1:8188/view?filename=..%2F..%2Fsecret.png"), "secret.png", "no folders in the name")
  eq(imageFileName("http://127.0.0.1:8188/view?subfolder=&type=output"), "comfyui-image.png", "no file name: a default")
  eq(imageFileName("not a url"), "comfyui-image.png", "not a URL: a default")

  // createImageCache: one request per image, a failure is not kept, the oldest go first.
  const calls: string[] = []
  let fail = false
  const cache = createImageCache(async (url) => {
    calls.push(url)
    if (fail) throw new Error("down")
    return new Blob([url])
  }, 2)

  const a1 = cache.get("a")
  const a2 = cache.get("a")
  eq(a1 === a2, true, "the same URL shares one request")
  await a1
  eq(calls, ["a"], "fetched once")

  fail = true
  await cache.get("b").catch(() => {})
  eq(cache.has("b"), false, "a failed fetch is not kept")
  fail = false
  await cache.get("b")
  eq(calls, ["a", "b", "b"], "after a failure, the next get fetches again")

  cache.get("a") // a is now the most recent
  await cache.get("c")
  eq([cache.has("a"), cache.has("b"), cache.has("c")], [true, false, true], "over the limit the least recently used goes")

  console.log(`comfyui-image-view: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

void main()
