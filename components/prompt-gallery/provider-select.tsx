"use client"

import { useState } from "react"
import { usePostHog } from "posthog-js/react"
import { Check, ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"
import type { BooruProvider } from "@/lib/api-client"
import { userPreferences } from "@/lib/storage"
import { shouldConfirmProvider, ADULT_ONLY_PROVIDER } from "@/lib/nsfw-consent"
import { cn } from "@/lib/utils"

const PROVIDERS = ['danbooru', 'gelbooru', 'aibooru', 'rule34', 'e621'] as const

const PROVIDER_LABELS: Record<typeof PROVIDERS[number], string> = {
  danbooru: 'Danbooru',
  gelbooru: 'Gelbooru',
  aibooru: 'Aibooru',
  rule34: 'Rule34',
  e621: 'e621',
}

interface ProviderSelectProps {
  booruProvider: BooruProvider
  setBooruProvider: (provider: BooruProvider) => void
  /** Called after the switch so the host can leave Favorites/History views
   *  and fire its own tracking. */
  onProviderChange: (provider: BooruProvider) => void
  className?: string
}

/**
 * Booru provider picker, docked as the prefix of the search input: the
 * provider is a set-once choice, so it doesn't need a prominent spot.
 */
export function ProviderSelect({ booruProvider, setBooruProvider, onProviderChange, className }: ProviderSelectProps) {
  // Capa 3: first-time confirmation before switching to the adult-only Rule34
  // provider (which cannot be rating-filtered). Once acknowledged, switching is
  // instant. Applies the same side effects as a normal provider switch.
  const [rule34DialogOpen, setRule34DialogOpen] = useState(false)
  const posthog = usePostHog()

  const applyProvider = (p: BooruProvider) => {
    setBooruProvider(p)
    onProviderChange(p)
    posthog.capture('provider_changed', { provider: p })
  }

  const handleSelectProvider = (p: BooruProvider) => {
    if (p === booruProvider) return
    if (shouldConfirmProvider(p, userPreferences.getRule34Acknowledged())) {
      setRule34DialogOpen(true)
      return
    }
    applyProvider(p)
  }

  const confirmRule34 = () => {
    userPreferences.setRule34Acknowledged(true)
    applyProvider(ADULT_ONLY_PROVIDER as BooruProvider)
    setRule34DialogOpen(false)
    posthog.capture('rule34_consent_confirmed')
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-tour="provider"
            aria-label={`Booru provider: ${PROVIDER_LABELS[booruProvider as typeof PROVIDERS[number]] ?? booruProvider}`}
            className={cn(
              "flex h-full shrink-0 items-center gap-1.5 border-r border-input bg-muted/40 px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              className
            )}
          >
            {PROVIDER_LABELS[booruProvider as typeof PROVIDERS[number]] ?? booruProvider}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Search posts from</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {PROVIDERS.map((p) => (
            <DropdownMenuItem key={p} onSelect={() => handleSelectProvider(p)} className="justify-between cursor-pointer">
              {PROVIDER_LABELS[p]}
              {booruProvider === p && <Check className="h-4 w-4 text-primary-text" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Capa 3: Rule34 adult-only confirmation (first time only) */}
      <AlertDialog open={rule34DialogOpen} onOpenChange={setRule34DialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to Rule34?</AlertDialogTitle>
            <AlertDialogDescription>
              Rule34 hosts exclusively explicit / adult (18+) content and, unlike
              the other providers, its results cannot be filtered to Safe — the
              Safe/NSFW toggle is disabled while it&apos;s selected. Only continue
              if you are of legal age and want to see this material. You can switch
              back to another provider at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={confirmRule34}>
              Continue to Rule34
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
