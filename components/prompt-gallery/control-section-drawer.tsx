"use client"

import type React from "react"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer"

interface ControlSectionDrawerProps {
  title: string
  summary: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onReset?: () => void
  resetLabel?: string
  children: React.ReactNode
}

/**
 * ControlSection's mobile bottom drawer. In its own module so Vaul loads
 * when a section is first opened, not with the page.
 */
export function ControlSectionDrawer({ title, summary, open, onOpenChange, onReset, resetLabel, children }: ControlSectionDrawerProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90dvh]">
        <div className="border-b px-5 pb-3 pt-2">
          <DrawerTitle className="text-base">{title}</DrawerTitle>
          <DrawerDescription className="text-xs">{summary}</DrawerDescription>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
        <div className="flex gap-2.5 border-t px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {onReset && (
            <Button type="button" variant="outline" onClick={onReset} className="h-12 px-4">
              {resetLabel ?? "Reset"}
            </Button>
          )}
          <Button type="button" onClick={() => onOpenChange(false)} className="h-12 flex-1 text-[15px] font-semibold">
            Done
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
