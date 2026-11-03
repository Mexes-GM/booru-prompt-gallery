import { SOCIAL_URLS } from "@/lib/constants"

/**
 * The text half of the gallery hero: h1, pitch, supported boorus and author
 * credit. Static and hook-free on purpose: AppShell renders it as the loading
 * fallback and GalleryHero renders it in the live page, so the two cannot
 * drift apart. Pass `onSocialClick` for analytics; it is optional so the
 * component stays usable without any client code.
 */

const BOORUS = ["Danbooru", "Aibooru", "Rule34", "Gelbooru", "e621", "e6AI"]

const SOCIALS = [
  { id: "social-civitai", label: "CivitAI", href: SOCIAL_URLS.CIVITAI_PROFILE },
  { id: "social-tensor", label: "Tensor.Art", href: SOCIAL_URLS.TENSOR_ART },
  { id: "social-seaart", label: "SeaArt", href: SOCIAL_URLS.SEAART },
]

export function HeroText({ onSocialClick }: { onSocialClick?: (href: string) => void }) {
  return (
    <div className="space-y-3 sm:space-y-5">
      <h1 className="text-3xl sm:text-5xl font-semibold tracking-tighter text-balance leading-[1.05]">
        Booru Prompt Gallery
      </h1>
      <p className="max-w-md text-base sm:text-lg text-muted-foreground text-pretty leading-snug">
        Pick a post, get a prompt you can paste straight into your generator.
      </p>

      <p className="font-mono text-xs text-muted-foreground leading-relaxed">{BOORUS.join(" · ")}</p>

      <p className="text-sm text-muted-foreground">
        By Mexes
        <span aria-hidden="true" className="mx-2 text-muted-foreground/40">/</span>
        {SOCIALS.map((s, i) => (
          <span key={s.id}>
            {i > 0 && <span aria-hidden="true" className="mx-1.5 text-muted-foreground/40">·</span>}
            <a
              id={s.id}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onSocialClick ? () => onSocialClick(s.href) : undefined}
              aria-label={`Visit Mexes on ${s.label}`}
              className="rounded-sm pointer-coarse:relative pointer-coarse:py-2 pointer-coarse:after:absolute pointer-coarse:after:-inset-y-[5px] pointer-coarse:after:-inset-x-px pointer-coarse:after:content-[''] underline decoration-muted-foreground/30 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {s.label}
            </a>
          </span>
        ))}
      </p>
    </div>
  )
}
