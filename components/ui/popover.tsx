"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"
import { useCloseOnScroll } from "@/hooks/use-close-on-scroll"

type PopoverProps = React.ComponentProps<typeof PopoverPrimitive.Root> & {
  /**
   * Close when the page scrolls (default: on for non-modal popovers). Radix
   * repositions its fixed-position content from JS on scroll, one frame late,
   * so an open popover jitters behind its trigger — closing avoids it. Turn
   * off for triggers that don't move with the page (fixed/sticky footers).
   */
  closeOnScroll?: boolean
}

/** Radix Popover Root, plus close-on-scroll (see `closeOnScroll`). Works
 *  controlled (`open` + `onOpenChange`) or uncontrolled (`defaultOpen`). */
function Popover({ open: openProp, defaultOpen, onOpenChange, closeOnScroll, modal, ...props }: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : uncontrolledOpen

  const handleOpenChange = React.useCallback((next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }, [isControlled, onOpenChange])

  // Modal popovers lock page scroll already.
  useCloseOnScroll(open, () => handleOpenChange(false), (closeOnScroll ?? true) && !modal)

  return <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange} modal={modal} {...props} />
}

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none origin-(--radix-popover-content-transform-origin) ease-out-strong data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent }
