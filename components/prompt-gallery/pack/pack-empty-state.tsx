"use client"

/**
 * Before there is a character: a line saying where to start, a slot for the
 * character search, and a few example cards that fill the pack in one tap.
 */
import { memo, type ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface ExampleBrief {
  id: string
  /** The card in one line, as parts ("Frieren", "witch hat", "reading"). */
  parts: readonly string[]
}

export interface PackEmptyStateProps {
  examples: readonly ExampleBrief[]
  /** The line above the examples. */
  heading?: string
  onPick: (id: string) => void
  /** The character search, placed under the heading. */
  children?: ReactNode
  className?: string
}

export const PackEmptyState = memo(function PackEmptyState({
  examples,
  heading = "Pick a character to start, or try one of these",
  onPick,
  children,
  className,
}: PackEmptyStateProps) {
  return (
    <div className={cn("@container space-y-3", className)}>
      <p className="text-[15px] font-medium text-foreground text-balance">{heading}</p>
      {children}
      {examples.length > 0 && (
        <ul className="grid gap-2 @md:grid-cols-2">
          {examples.map((ex) => {
            const [who, ...rest] = ex.parts
            return (
              <li key={ex.id}>
                <button
                  type="button"
                  onClick={() => onPick(ex.id)}
                  className={cn(
                    "flex w-full min-w-0 flex-col items-start gap-1 rounded-xl border border-border/70 bg-card px-4 py-3 text-left shadow-xs pointer-coarse:min-h-11",
                    "transition-[border-color,background-color,transform] duration-150 ease-out-strong hover:border-foreground/25 active:scale-[0.99] motion-reduce:active:scale-100",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  )}
                >
                  <span className="truncate text-sm font-medium text-foreground">{who}</span>
                  {rest.length > 0 && <span className="w-full truncate text-xs text-muted-foreground">{rest.join(" · ")}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
})
