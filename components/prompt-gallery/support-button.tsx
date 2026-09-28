"use client"

import { Coffee } from "lucide-react"
import { trackExternalLink } from "@/lib/analytics"
import { SOCIAL_URLS } from "@/lib/constants"
import { PANEL_TAB_CLASS } from "@/components/prompt-gallery/panel-tab-styles"
import { cn } from "@/lib/utils"

/** Support tab on the search panel's top edge: links to the Buy Me a Coffee page. Icon-only on mobile. */
export function SupportButton() {
  return (
    <a
      id="support-buymeacoffee"
      href={SOCIAL_URLS.BUY_ME_A_COFFEE}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackExternalLink(SOCIAL_URLS.BUY_ME_A_COFFEE, "support")}
      aria-label="Help keep the site running (Buy Me a Coffee)"
      className={cn(PANEL_TAB_CLASS, "text-primary-text hover:text-primary-text")}
    >
      <Coffee className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-rotate-12 motion-reduce:transform-none" aria-hidden="true" />
      <span className="hidden sm:inline">Help keep the site running</span>
    </a>
  )
}
