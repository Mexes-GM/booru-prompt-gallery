"use client"

import useSWR from 'swr'
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { GitBranch } from "lucide-react"
import { apiUrl } from "@/lib/api-client"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function VersionDisplay() {
  const { data, error, isLoading } = useSWR(apiUrl('/api/version'), fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false
  })

  if (error || isLoading || !data) return null

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center cursor-help">
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 font-mono text-muted-foreground border-muted-foreground/30 hover:bg-muted/50 transition-colors">
              <GitBranch className="h-3 w-3" />
              v{data.version}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          <div className="space-y-1">
            <p className="font-semibold">Current Version</p>
            <p>v{data.version}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
