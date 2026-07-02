"use client"
import { Moon, Sun, Monitor } from "lucide-react"
import { useTheme } from "next-themes"
import { TooltipProvider } from "@/components/ui/tooltip"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function ThemeToggle() {
  const { setTheme, theme } = useTheme()

  return (
    <TooltipProvider>
      <DropdownMenu>
        <Tooltip>
          {/* Tooltip anchors to a span wrapper, NOT the same node as DropdownMenuTrigger.
              Nesting two `asChild` triggers on one element composes 3 refs and triggers a
              Radix setState-on-ref-detach loop (React #185). See SENTRY-FULVOUS-ANCHOR-7/S. */}
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="focus-ring" aria-label="Toggle theme">
                  <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                  <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                  <span className="sr-only">Toggle theme</span>
                </Button>
              </DropdownMenuTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent>Toggle theme</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="glass-effect">
          <DropdownMenuItem onClick={() => setTheme("light")} className="cursor-pointer">
            <Sun className="mr-2 h-4 w-4" />
            <span>Light</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("dark")} className="cursor-pointer">
            <Moon className="mr-2 h-4 w-4" />
            <span>Dark</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("system")} className="cursor-pointer">
            <Monitor className="mr-2 h-4 w-4" />
            <span>System</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  )
}
