import { SCALE_CONFIG } from "@/components/scale-config"
import { HeroText, HERO_GRID_CLASS } from "@/components/prompt-gallery/hero-text"

/**
 * Static loading shell shown while the client-only PromptGallery bundle loads
 * (the home page loads it with next/dynamic and `ssr: false`).
 *
 * It follows the live page's structure so the swap moves little:
 *   - the real hero text, rendered by the same HeroText component GalleryHero
 *     uses (the pitch paragraph is the LCP element, so it paints at TTFB);
 *   - a frame where the specimen goes: a bordered panel on the right from `sm`,
 *     a 44px "See what it does" bar on phones;
 *   - a skeleton of the search panel: folder tabs, search row, mode bar, options;
 *   - card-shaped grid cells (image, prompt well, Copy stub) using the medium
 *     column width from SCALE_CONFIG, two columns on phones.
 *
 * The blocks are decorative (aria-hidden) and do not animate. Loading is
 * announced through a status line; after a few seconds a "still loading" note
 * appears, and after a while a failure message with a reload link. Both are
 * driven by CSS, so they work before React has hydrated, and they disappear
 * with the shell once the gallery mounts.
 *
 * Pure presentational (no hooks / browser APIs) so it renders on the server.
 */

const GRID_CELLS = 12

// Slow-load note at ~4s, then replaced by the failure message at 15s.
const SHELL_TIMERS_CSS = `
@keyframes shell-slow{0%,26%{visibility:hidden}27%,99%{visibility:visible}100%{visibility:hidden}}
@keyframes shell-failed{to{visibility:visible}}
.shell-slow{visibility:hidden;animation:shell-slow 15s step-end forwards}
.shell-failed{visibility:hidden;animation:shell-failed 0s 15s forwards}
`

const block = "rounded-md border border-border/70 bg-muted/60"

export function AppShell() {
  return (
    <div className="relative min-h-screen bg-background">
      <style>{SHELL_TIMERS_CSS}</style>

      {/* Corner controls — mirrors SiteCornerMenu: "Sign in" pill + icon button */}
      <div aria-hidden="true" className="absolute right-4 top-3 z-30 flex items-center gap-1 sm:right-6 sm:top-4">
        <div className={`h-10 w-[93px] rounded-full ${block}`} />
        <div className="h-10 w-10 rounded-md" />
      </div>

      <main id="main-content" aria-busy="true" className="container mx-auto px-4 py-4 sm:py-8">
        <p role="status" className="sr-only">
          Loading the gallery…
        </p>

        <div className="w-full max-w-6xl mx-auto mb-4 sm:mb-8 space-y-4 sm:space-y-6">
          <div className={HERO_GRID_CLASS}>
            <HeroText />

            <div aria-hidden="true">
              <div
                className={`flex min-h-11 items-center px-4 text-sm text-muted-foreground sm:hidden ${block}`}
              >
                See what it does
              </div>
              <div className={`hidden h-[217px] sm:block ${block}`} />
            </div>
          </div>

          {/* Search panel: mt-14 leaves room for the folder tabs, as on the live page */}
          <div aria-hidden="true" className="relative !mt-14 rounded-xl border border-border bg-card/60">
            <div className="absolute bottom-full inset-x-3 sm:inset-x-6 mb-px flex items-end justify-between gap-2">
              <div className={`h-9 w-28 rounded-b-none ${block}`} />
              <div className="flex gap-2">
                <div className={`h-9 w-20 rounded-b-none ${block}`} />
                <div className={`hidden h-9 w-20 rounded-b-none sm:block ${block}`} />
              </div>
            </div>
            <div className="space-y-5 p-4 sm:p-6">
              <div className="space-y-2">
                <div className={`h-11 ${block}`} />
                <div className="h-5 w-2/3 rounded-md bg-muted/40" />
                <div className="h-5 w-1/2 rounded-md bg-muted/40 sm:hidden" />
              </div>
              <div className={`h-10 sm:hidden ${block}`} />
              <div className="flex flex-wrap gap-2">
                <div className={`h-10 w-24 ${block}`} />
                <div className={`h-10 w-24 ${block}`} />
                <div className={`h-10 w-24 ${block}`} />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className={`h-24 md:h-[69px] ${block}`} />
                <div className={`h-24 md:h-[69px] ${block}`} />
              </div>
            </div>
          </div>
        </div>

        {/* Card-shaped cells: two columns on phones, medium column width from `sm` */}
        <div
          aria-hidden="true"
          className="grid grid-cols-2 gap-4 sm:[grid-template-columns:repeat(auto-fill,minmax(var(--shell-col),1fr))]"
          style={{ "--shell-col": `${SCALE_CONFIG.medium.minColumnWidth}px` } as React.CSSProperties}
        >
          {Array.from({ length: GRID_CELLS }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-lg border border-border/70">
              <div className="aspect-[3/4] bg-muted/60" />
              <div
                className="flex flex-col justify-between gap-2 p-2"
                style={{ height: SCALE_CONFIG.medium.footerHeight }}
              >
                <div className="flex-1 rounded-md bg-muted/40" />
                <div className="h-8 w-20 rounded-md bg-muted/60" />
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Slow / failed load feedback. Shown by CSS timers, so no JS is needed. */}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 flex justify-center">
        <p
          className="shell-slow rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm"
        >
          Still loading… this is taking longer than usual.
        </p>
        <p
          role="alert"
          className="shell-failed pointer-events-auto absolute rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm"
        >
          Couldn’t load the gallery. Check your connection, then{" "}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full reload is the point */}
          <a href="/" className="font-medium underline underline-offset-4">
            reload the page
          </a>
          .
        </p>
      </div>
    </div>
  )
}
