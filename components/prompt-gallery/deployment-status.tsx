"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { Activity, Globe, Triangle } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { SOCIAL_URLS } from "@/lib/constants"
import { trackExternalLink } from "@/lib/analytics"

type DeploymentStatus = "up" | "down" | "paused" | "unknown"

interface StatusResponse {
  source: "uptimerobot" | "ping" | "none"
  checkedAt: string
  deployments: {
    vercel: { status: DeploymentStatus; url: string }
    netlify: { status: DeploymentStatus; url: string }
  }
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

const STATUS_META: Record<
  DeploymentStatus,
  { dot: string; label: string; ping: boolean }
> = {
  up: { dot: "bg-emerald-500", label: "Operational", ping: true },
  down: { dot: "bg-red-500", label: "Down", ping: false },
  paused: { dot: "bg-amber-500", label: "Paused", ping: false },
  unknown: { dot: "bg-muted-foreground/50", label: "Checking…", ping: false },
}

function StatusPill({
  name,
  href,
  status,
  icon,
}: {
  name: string
  href: string
  status: DeploymentStatus
  icon: React.ReactNode
}) {
  const meta = STATUS_META[status]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackExternalLink(href, "status")}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/30 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          aria-label={`${name} deployment status: ${meta.label}`}
        >
          <span className="relative flex h-2 w-2">
            {meta.ping && (
              <span
                className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${meta.dot}`}
              />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${meta.dot}`} />
          </span>
          {icon}
          <span>{name}</span>
        </a>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <span className="font-semibold">{name}</span>: {meta.label}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Live status badges for the Vercel and Netlify deployments.
 * Data comes from the same-origin /api/status route (UptimeRobot-backed when
 * configured, otherwise live health pings), CDN-cached so this is cheap.
 */
export function DeploymentStatusBadges() {
  const { data } = useSWR<StatusResponse>("/api/status", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  })

  const vercel = data?.deployments.vercel.status ?? "unknown"
  const netlify = data?.deployments.netlify.status ?? "unknown"

  return (
    <TooltipProvider>
      <div className="mt-3 flex w-full justify-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-muted/20 py-1 pl-3 pr-1.5">
          <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Activity className="h-3 w-3" />
            Server Status
          </span>
          <StatusPill
            name="Vercel"
            href={SOCIAL_URLS.VERCEL}
            status={vercel}
            icon={<Triangle className="h-3 w-3 fill-current" />}
          />
          <StatusPill
            name="Netlify"
            href={SOCIAL_URLS.NETLIFY}
            status={netlify}
            icon={<Globe className="h-3 w-3" />}
          />
        </div>
      </div>
    </TooltipProvider>
  )
}

/**
 * "Mirror" button that always points to the *other* deployment.
 * On Netlify it links to the Vercel deployment, and vice versa.
 * Defaults to the Netlify mirror during SSR / before hydration, matching the
 * primary (Vercel) deployment.
 */
export function MirrorLink() {
  const [mirror, setMirror] = useState<{ label: string; href: string }>({
    label: "Netlify Mirror",
    href: SOCIAL_URLS.NETLIFY,
  })

  useEffect(() => {
    const host = window.location.hostname
    if (host.includes("netlify")) {
      setMirror({ label: "Vercel Mirror", href: SOCIAL_URLS.VERCEL })
    } else {
      setMirror({ label: "Netlify Mirror", href: SOCIAL_URLS.NETLIFY })
    }
  }, [])

  return (
    <a
      id="deployment-mirror"
      href={mirror.href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackExternalLink(mirror.href, "mirror")}
      className="inline-flex items-center px-4 py-2 bg-teal-600 hover:bg-teal-500 dark:bg-teal-700 dark:hover:bg-teal-600 text-white text-sm font-medium rounded-full transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 shadow-lg hover:shadow-xl"
    >
      <Globe className="w-4 h-4 mr-2" />
      {mirror.label}
    </a>
  )
}
