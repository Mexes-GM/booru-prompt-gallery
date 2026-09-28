"use client"

import { GithubIcon } from "@/components/icons/brand-icons"
import { MirrorLink } from "@/components/prompt-gallery/deployment-status"
import { SupportButton } from "@/components/prompt-gallery/support-button"
import { PANEL_TAB_CLASS } from "@/components/prompt-gallery/panel-tab-styles"
import { trackExternalLink } from "@/lib/analytics"
import { SOCIAL_URLS } from "@/lib/constants"

/**
 * Right-hand group of folder tabs on the search panel's top edge: Support,
 * GitHub and the mirror deployment. These used to be the pill buttons in the
 * hero. Labels collapse to icons on mobile so they fit next to Update Notes.
 */
export function PanelLinkTabs() {
  return (
    <div className="flex items-end gap-1">
      <SupportButton />
      <a
        id="github-repo"
        href={SOCIAL_URLS.GITHUB}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackExternalLink(SOCIAL_URLS.GITHUB, 'github')}
        aria-label="View on GitHub"
        className={PANEL_TAB_CLASS}
      >
        <GithubIcon size={14} aria-hidden="true" />
        <span className="hidden sm:inline">GitHub</span>
      </a>
      <MirrorLink />
    </div>
  )
}
