import { Loader2 } from "lucide-react"

/**
 * Static app-shell shown while the heavy client-only PromptGallery bundle loads.
 *
 * Why this exists: the home page renders PromptGallery via next/dynamic with
 * `ssr: false`, so before this change the only thing painted after TTFB was a
 * lone centered spinner — a poor LCP candidate and ~5.4s LCP on mobile.
 *
 * This shell paints a meaningful, above-the-fold structure immediately:
 *   - the real <h1> title (the LCP element), styled identically to the live
 *     header so the swap to the interactive header causes no layout shift,
 *   - the real hero <h2> + subtitle <p>, with the exact same markup/classes as
 *     PromptGallery's hero. The subtitle paragraph is the measured LCP element,
 *     so rendering it server-side here paints it at TTFB instead of waiting for
 *     the heavy client bundle (perf plan P2a). Identical markup means the swap
 *     to the interactive hero produces no layout shift.
 *   - a skeleton search bar and a skeleton card grid to fill the viewport.
 *
 * It is a pure presentational component (no hooks / browser APIs) so it can be
 * rendered on the server as the dynamic import's loading fallback.
 */
export function AppShell() {
  return (
    <div className="min-h-screen bg-background" aria-busy="true" aria-label="Loading gallery">
      {/* Header — mirrors the live header markup to avoid CLS on hydration */}
      <header className="w-full border-b glass-effect">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <h1 className="text-lg sm:text-2xl font-bold text-foreground leading-tight sm:leading-normal">
                Booru<span className="hidden sm:inline"> </span>
                <br className="sm:hidden" />Prompt Gallery
              </h1>
              <span className="text-[10px] sm:text-xs font-medium bg-muted text-muted-foreground rounded px-1.5 py-0 sm:px-2 sm:py-1 h-fit">
                By Mexes
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-md bg-muted animate-pulse" />
              <div className="h-8 w-8 rounded-md bg-muted animate-pulse" />
            </div>
          </div>
        </div>
      </header>

      {/* Main — matches PromptGallery's <main> padding so the hero does not shift */}
      <main className="container mx-auto px-4 py-4 sm:py-8">
        {/* Hero — identical markup to PromptGallery's hero so the LCP <p> paints
            at TTFB and the swap to the interactive hero causes no layout shift. */}
        <div className="w-full max-w-6xl mx-auto mb-4 sm:mb-8 space-y-4 sm:space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Discover AI Art Prompts</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base px-4">
              Generate prompts from Danbooru, Aibooru, Rule34, Gelbooru and e621 image collections.
              Extract and format tags from posts or access AI-generated prompts directly,
              creating clean, ready-to-use prompts for your AI art generation.
            </p>
          </div>
        </div>

        {/* Skeleton controls + grid */}
        <div className="mx-auto mb-6 h-11 w-full max-w-2xl rounded-lg bg-muted animate-pulse" />
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg bg-muted animate-pulse"
              style={{ height: 220 + ((i * 37) % 140) }}
            />
          ))}
        </div>
      </main>

      {/* Subtle spinner so users on very slow connections still get feedback */}
      <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/70" />
      </div>
    </div>
  )
}
