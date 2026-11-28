/**
 * Opening a generated image in the app instead of at ComfyUI's own address.
 *
 * ComfyUI refuses a cross-site navigation to its `/view` URL (no Origin header),
 * and the app is always on another site than the user's ComfyUI, so a link to
 * the image can never open. A fetch in CORS mode sends the Origin and gets the
 * file; the viewer shows, downloads and opens it as a same-origin blob.
 */

/** Width over height of a preview box: the image's own size once it loaded, else the size sent. */
export function previewAspect(
  sent?: { width?: number | null; height?: number | null } | null,
  loaded?: { width: number; height: number } | null,
): number {
  const pick = (w?: number | null, h?: number | null) => (w && h && w > 0 && h > 0 ? w / h : null)
  const ratio = pick(loaded?.width, loaded?.height) ?? pick(sent?.width, sent?.height) ?? 1
  // Very tall or wide images would make a row too tall or the box too flat; they show cropped.
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, ratio))
}

export const MIN_ASPECT = 1 / 2
export const MAX_ASPECT = 2

/** The file name ComfyUI saved the image under, for the download. */
export function imageFileName(url: string): string {
  try {
    const name = new URL(url).searchParams.get("filename")?.split(/[\\/]/).pop()?.trim()
    if (name) return name
  } catch {
    // Not a URL: fall through.
  }
  return "comfyui-image.png"
}

export type ImageFetcher = (url: string) => Promise<Blob>

/**
 * The image files fetched so far, by URL, so the viewer, Download and Open in
 * new tab share one request. A failed fetch is not kept, so Retry fetches
 * again. Keeps the last `limit` files.
 */
export function createImageCache(fetcher: ImageFetcher, limit = 6) {
  const entries = new Map<string, Promise<Blob>>()
  return {
    get(url: string): Promise<Blob> {
      const hit = entries.get(url)
      if (hit) {
        // Most recent last.
        entries.delete(url)
        entries.set(url, hit)
        return hit
      }
      const pending = fetcher(url)
      entries.set(url, pending)
      pending.catch(() => {
        if (entries.get(url) === pending) entries.delete(url)
      })
      while (entries.size > limit) {
        const oldest = entries.keys().next().value as string
        entries.delete(oldest)
      }
      return pending
    },
    has: (url: string) => entries.has(url),
  }
}

/** ComfyUI's image in CORS mode, reusing the copy the thumbnail already loaded when the browser kept it. */
export async function fetchComfyImage(url: string): Promise<Blob> {
  const res = await fetch(url, { mode: "cors", cache: "force-cache" })
  if (!res.ok) throw new Error(`ComfyUI answered ${res.status}`)
  return res.blob()
}

let shared: ReturnType<typeof createImageCache> | null = null

/** The app's one image cache. */
export function comfyImageCache() {
  shared ??= createImageCache(fetchComfyImage)
  return shared
}
