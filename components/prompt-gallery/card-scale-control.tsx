"use client"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ZoomIn, ZoomOut } from "lucide-react"
import { cn } from "@/lib/utils"

export const CARD_SCALE_STEPS = [
  { value: 1, label: "Small", icon: ZoomOut },
  { value: 2, label: "Medium", icon: null },
  { value: 3, label: "Large", icon: ZoomIn },
] as const

interface CardScaleControlProps {
  scaleValue: number[]
  setScaleValue: (value: number[]) => void
  className?: string
}

/** Small / Medium / Large segmented control for the results grid's card size. */
export function CardScaleControl({ scaleValue, setScaleValue, className }: CardScaleControlProps) {
  return (
    <div className={cn("flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5", className)} role="group" aria-label="Card size">
      {CARD_SCALE_STEPS.map((step) => {
        const Icon = step.icon
        const isActive = scaleValue[0] === step.value
        return (
          <Tooltip key={step.value}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setScaleValue([step.value])}
                aria-label={`${step.label} cards`}
                aria-pressed={isActive}
                className={cn("h-8 w-8 rounded-md", isActive ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {Icon ? <Icon className="h-3.5 w-3.5" /> : <span className="text-[10px] font-bold">M</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{step.label} cards</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
