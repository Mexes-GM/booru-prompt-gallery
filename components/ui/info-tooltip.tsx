"use client";

import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { motion } from "framer-motion";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Detects touch / no-hover devices so the info affordance can switch from a
 * hover Tooltip (pointer devices) to a tap Popover (touch devices). Radix
 * Tooltip only opens on hover/focus, so on touch it would never show.
 */
function useCoarsePointer() {
  const [coarse, setCoarse] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(hover: none), (pointer: coarse)");
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return coarse;
}

interface InfoTooltipProps {
  children: React.ReactNode;   // Element the affordance wraps
  title: string;               // Option title
  description: React.ReactNode;// Detailed explanation
  visual?: React.ReactNode;    // Optional visual example (image, video, icons)
  delayDuration?: number;      // Delay in ms before showing on hover (default: 500ms)
  side?: "top" | "bottom" | "left" | "right"; // Preferred placement
  className?: string;          // Extra classes for the content panel
  hideIcon?: boolean;          // Hide the Info icon and use children as trigger
  triggerClassName?: string;   // Extra classes for the trigger wrapper
}

export function InfoTooltip({
  children,
  title,
  description,
  visual,
  delayDuration = 500, // Half-second delay so hovering doesn't spam the user
  side = "top",
  className,
  hideIcon = false,
  triggerClassName,
}: InfoTooltipProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const coarse = useCoarsePointer();

  const panelClassName = cn(
    // Override shadcn's default background/padding for our custom layout
    "p-0 w-[340px] sm:w-[380px] bg-background border-border shadow-xl rounded-xl z-[9999]",
    className
  );

  const panel = (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 25, delay: 0.05 }}
      className="flex flex-col overflow-hidden rounded-xl"
    >
      {/* Visual section (optional) */}
      {visual && (
        <div className="bg-muted/50 flex items-center justify-center p-3 sm:p-4 border-b border-border/40 relative">
          <div className="absolute inset-0 bg-gradient-to-t from-background/30 to-transparent pointer-events-none" />
          <div className="relative z-10 w-full">{visual}</div>
        </div>
      )}

      {/* Text section */}
      <div className="p-4 flex flex-col gap-1.5">
        <h4 className="text-[13px] font-semibold text-foreground tracking-tight">
          {title}
        </h4>
        <div className="text-xs text-muted-foreground leading-relaxed">
          {description}
        </div>
      </div>
    </motion.div>
  );

  // hideIcon: `children` IS the trigger and is usually an interactive control
  // (a Button that opens a dialog, a toggle, etc.). On touch that control
  // already handles the tap as its own action and a hover tooltip can't show,
  // so render it plain instead of hijacking the tap with an intrusive popover.
  if (hideIcon) {
    if (coarse) return <>{children}</>;

    return (
      <TooltipProvider delayDuration={delayDuration}>
        <Tooltip open={isOpen} onOpenChange={setIsOpen}>
          <TooltipTrigger asChild>{children}</TooltipTrigger>
          <TooltipContent side={side} sideOffset={8} className={panelClassName}>
            {isOpen && panel}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Touch / no-hover: only the Info icon becomes a tap target (a real button),
  // so `children` (labels with htmlFor, plain text, etc.) keep their own
  // behavior and don't get wrapped in an invalid nested button.
  if (coarse) {
    return (
      <span className={cn("inline-flex items-center gap-1.5", triggerClassName)}>
        {children}
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={title}
              // p-1/-m-1 enlarges the tap area without shifting the layout
              onClick={(e) => e.stopPropagation()}
              className="p-1 -m-1 touch-manipulation text-muted-foreground/70 transition-colors hover:text-primary"
            >
              <Info className="w-4 h-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent side={side} sideOffset={8} className={panelClassName}>
            {panel}
          </PopoverContent>
        </Popover>
      </span>
    );
  }

  // Pointer devices: keep the original hover behavior over the whole label+icon.
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip open={isOpen} onOpenChange={setIsOpen}>
        <TooltipTrigger asChild>
          <span className={cn("cursor-help inline-flex items-center gap-1.5", triggerClassName)}>
            {children}
            <Info className="w-4 h-4 text-muted-foreground/70 hover:text-primary transition-colors" />
          </span>
        </TooltipTrigger>
        <TooltipContent side={side} sideOffset={8} className={panelClassName}>
          {isOpen && panel}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
