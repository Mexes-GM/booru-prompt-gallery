import { SOCIAL_URLS } from "@/lib/constants"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Globe, ExternalLink, ShieldAlert } from "lucide-react"
import GithubMono from '@lobehub/icons/es/Github/components/Mono'

/**
 * Full-screen pause curtain for the Vercel deployment.
 *
 * Rendered server-side as a static page. It does NOT import any client hooks,
 * gallery components, or Supabase clients, so it stops Fluid CPU usage on "/".
 */
export function VercelPauseCurtain() {
  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background p-4 sm:p-8">
      {/* Subtle theme-aware background glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
      
      {/* Decorative ambient elements */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[300px] w-[600px] -translate-x-1/2 rounded-full bg-primary/20 opacity-20 blur-[100px]" />
      <div className="pointer-events-none absolute bottom-0 left-0 -z-10 h-[300px] w-[300px] rounded-full bg-teal-500/10 opacity-20 blur-[100px]" />

      <div className="relative z-10 w-full max-w-lg">
        {/* Site branding */}
        <div className="mb-8 text-center space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20 mb-2">
            <ShieldAlert className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight gradient-text">
            Booru Prompt Gallery
          </h1>
        </div>

        <Card className="relative overflow-hidden border border-border/40 shadow-2xl glass-effect rounded-2xl">
          {/* Subtle top border highlight */}
          <div className="absolute left-0 top-0 h-[1px] w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-50" />

          <CardHeader className="pb-4 pt-6">
            <div className="space-y-3 text-center">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
                  Deployment Paused
                </CardTitle>
              </div>
              <CardDescription className="text-sm leading-relaxed mx-auto max-w-[90%]">
                The primary Vercel deployment has been paused to prevent exceeding free-tier limits.
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-5 pb-6">
            <div className="rounded-xl border border-primary/10 bg-primary/5 p-4 sm:p-5 relative overflow-hidden flex items-start gap-3">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary/50 to-primary/10" />
              <div className="mt-0.5 shrink-0 text-primary">
                <Globe className="h-5 w-5" />
              </div>
              <p className="text-sm leading-relaxed text-foreground/90">
                Please switch to the <strong className="text-foreground font-semibold">Netlify mirror</strong> to continue using the app.
              </p>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-3 sm:flex-row bg-muted/30 pt-6 pb-6 border-t border-border/30">
            <Button
              asChild
              className="w-full rounded-xl bg-primary text-primary-foreground font-medium shadow-lg hover:shadow-xl hover:bg-primary/90 transition-all duration-200 group h-11"
            >
              <a
                href={SOCIAL_URLS.NETLIFY}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Globe className="h-4 w-4 mr-2" />
                Open Netlify Mirror
                <ExternalLink className="h-3.5 w-3.5 opacity-60 ml-1.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            </Button>

            <Button
              asChild
              variant="outline"
              className="w-full rounded-xl border-border/50 hover:bg-secondary/50 transition-colors h-11"
            >
              <a
                href={SOCIAL_URLS.GITHUB}
                target="_blank"
                rel="noopener noreferrer"
              >
                <GithubMono size={16} className="mr-2" />
                View GitHub
              </a>
            </Button>
          </CardFooter>
        </Card>

      </div>
    </main>
  )
}

