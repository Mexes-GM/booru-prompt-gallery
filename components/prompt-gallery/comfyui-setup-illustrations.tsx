/**
 * Small drawings of where to click in ComfyUI, for the setup guide. They are
 * deliberately abstract (shapes, one real label) so they stay right when
 * ComfyUI's look changes. Decorative: the steps next to them say the same.
 */
import { MousePointer2, Play, Search } from "lucide-react"
import { BRIDGE_MANAGER_NAME, BRIDGE_PUBLISH_LABEL } from "@/lib/comfyui/bridge"
import { cn } from "@/lib/utils"

function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none select-none overflow-hidden rounded-xl border border-border/70 bg-muted/30 text-[11px] leading-none text-muted-foreground",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/25" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/25" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/25" />
        <span className="ml-2 font-medium text-foreground/70">ComfyUI</span>
      </div>
      {children}
    </div>
  )
}

function Bar({ className }: { className?: string }) {
  return <span className={cn("block h-1.5 rounded-full bg-muted-foreground/20", className)} />
}

/** The pointer resting on the thing to click. */
function Pointer({ className }: { className?: string }) {
  return (
    <MousePointer2
      className={cn("absolute h-4 w-4 fill-foreground text-background drop-shadow-[0_1px_1px_rgb(0_0_0/0.35)]", className)}
      strokeWidth={1.5}
    />
  )
}

/** Custom Nodes Manager: the search with the add-on's name and its Install button. */
export function ManagerIllustration({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-foreground">{BRIDGE_MANAGER_NAME}</span>
          <span className="h-3.5 w-px bg-foreground/70 motion-safe:animate-pulse" />
        </div>
        <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-background px-2.5 py-2.5">
          <span className="h-7 w-7 shrink-0 rounded-md bg-primary/15" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="truncate font-medium text-foreground">{BRIDGE_MANAGER_NAME}</span>
            <Bar className="w-3/4" />
          </div>
          <span className="relative shrink-0">
            <span className="block rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground ring-[3px] ring-primary/20">
              Install
            </span>
            <Pointer className="-bottom-2.5 -right-1.5" />
          </span>
        </div>
        <div className="flex items-center gap-3 px-2.5 py-1 opacity-60">
          <span className="h-7 w-7 shrink-0 rounded-md bg-muted-foreground/15" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Bar className="w-1/2" />
            <Bar className="w-2/3" />
          </div>
          <span className="h-6 w-12 shrink-0 rounded-md bg-muted-foreground/15" />
        </div>
      </div>
    </Frame>
  )
}

/** ComfyUI's top bar: the publish button next to Run, over a hint of the graph. */
export function TopBarIllustration({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <div className="flex items-center gap-2 border-b border-border/60 bg-background/60 px-3 py-2">
        <Bar className="w-8" />
        <Bar className="w-10" />
        <Bar className="hidden w-8 min-[420px]:block" />
        <span className="ml-auto flex items-center gap-1.5">
          <span className="relative">
            <span className="block whitespace-nowrap rounded-md bg-primary px-2 py-1.5 font-medium text-primary-foreground ring-[3px] ring-primary/20">
              {BRIDGE_PUBLISH_LABEL}
            </span>
            <Pointer className="-bottom-2.5 right-3" />
          </span>
          <span className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 font-medium text-foreground/80">
            <Play className="h-3 w-3 fill-current" />
            Run
          </span>
        </span>
      </div>
      <div className="relative h-16 px-3 py-3">
        <span className="absolute left-4 top-3 h-9 w-16 rounded-md border border-border/70 bg-background/70" />
        <span className="absolute left-[5.25rem] top-[1.6rem] h-px w-10 bg-muted-foreground/30" />
        <span className="absolute left-[7.75rem] top-3 h-9 w-16 rounded-md border border-border/70 bg-background/70" />
        <span className="absolute left-[11.75rem] top-[1.6rem] hidden h-px w-10 bg-muted-foreground/30 min-[420px]:block" />
        <span className="absolute left-[14.25rem] top-3 hidden h-9 w-16 rounded-md border border-border/70 bg-background/70 min-[420px]:block" />
      </div>
    </Frame>
  )
}
