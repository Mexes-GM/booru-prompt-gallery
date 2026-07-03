"use client"

import Image from "next/image"
import { Github } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AnnouncementsCarousel } from "@/components/prompt-gallery/announcements-carousel"
import { DeploymentStatusBadges, MirrorLink } from "@/components/prompt-gallery/deployment-status"
import { trackExternalLink } from "@/lib/analytics"
import { SOCIAL_URLS } from "@/lib/constants"
import pkg from "@/package.json"

interface GalleryHeroProps {
  isAnnouncementsOpen: boolean
  onDismissAnnouncements: () => void
}

/**
 * Static hero section above the search panel: tagline, social/support links
 * (CivitAI, Tensor.Art, SeaArt, Ko-fi, GitHub, mirror), deployment status
 * badges, and the announcements carousel. No local state of its own — the
 * announcements open/dismiss state is owned by the caller since dismissing
 * also needs to persist to localStorage.
 */
export function GalleryHero({ isAnnouncementsOpen, onDismissAnnouncements }: GalleryHeroProps) {
  return (
    <div className="text-center space-y-2">
      <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Discover AI Art Prompts</h2>
      <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base px-4">
        Generate prompts from Danbooru, Aibooru, Rule34, Gelbooru and e621 image collections.
        Extract and format tags from posts or access AI-generated prompts directly,
        creating clean, ready-to-use prompts for your AI art generation.
      </p>

      {/* Social Links Section */}
      <div className="pt-2 sm:pt-4 space-y-3">
        <p className="text-muted-foreground text-sm">
          More of my work here
        </p>
        <div className="flex items-center justify-center space-x-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                id="social-civitai"
                href={SOCIAL_URLS.CIVITAI_PROFILE}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackExternalLink(SOCIAL_URLS.CIVITAI_PROFILE, 'social')}
                className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                aria-label="Visit Mexes on CivitAI"
              >
                <Image
                  src="https://www.google.com/s2/favicons?domain=civitai.com&sz=64"
                  alt="CivitAI"
                  width={24}
                  height={24}
                  className="w-6 h-6 filter grayscale hover:grayscale-0 transition-all duration-200"
                />
              </a>
            </TooltipTrigger>
            <TooltipContent>Visit Mexes on CivitAI</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <a
                id="social-tensor"
                href={SOCIAL_URLS.TENSOR_ART}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackExternalLink(SOCIAL_URLS.TENSOR_ART, 'social')}
                className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                aria-label="Visit Mexes on Tensor.Art"
              >
                <Image
                  src="https://www.google.com/s2/favicons?domain=tensor.art&sz=64"
                  alt="Tensor.Art"
                  width={24}
                  height={24}
                  className="w-6 h-6 filter grayscale hover:grayscale-0 transition-all duration-200"
                />
              </a>
            </TooltipTrigger>
            <TooltipContent>Visit Mexes on Tensor.Art</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <a
                id="social-seaart"
                href={SOCIAL_URLS.SEAART}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackExternalLink(SOCIAL_URLS.SEAART, 'social')}
                className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                aria-label="Visit Mexes on SeaArt AI"
              >
                <Image
                  src="https://www.google.com/s2/favicons?domain=seaart.ai&sz=64"
                  alt="SeaArt AI"
                  width={24}
                  height={24}
                  className="w-6 h-6 filter grayscale hover:grayscale-0 transition-all duration-200"
                />
              </a>
            </TooltipTrigger>
            <TooltipContent>Visit Mexes on SeaArt AI</TooltipContent>
          </Tooltip>
        </div>

        {/* Social Links - Horizontal */}
        <div className="flex items-center justify-center gap-3 mt-3 flex-wrap w-full">
          <a
            id="support-kofi"
            href={SOCIAL_URLS.KO_FI}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackExternalLink(SOCIAL_URLS.KO_FI, 'support')}
            className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white text-sm font-medium rounded-full transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 shadow-lg hover:shadow-xl"
          >
            <Image
              src="https://www.google.com/s2/favicons?domain=ko-fi.com&sz=64"
              alt="Ko-fi"
              width={16}
              height={16}
              className="w-4 h-4 mr-2"
            />
            Support me on Ko-fi
          </a>

          <a
            id="github-repo"
            href={SOCIAL_URLS.GITHUB}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackExternalLink(SOCIAL_URLS.GITHUB, 'github')}
            className="inline-flex items-center px-4 py-2 bg-gray-800 hover:bg-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 text-white text-sm font-medium rounded-full transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 shadow-lg hover:shadow-xl"
          >
            <Github className="w-4 h-4 mr-2" />
            View on GitHub
          </a>

          <MirrorLink />
        </div>

        {/* Deployment status badges (Vercel / Netlify) */}
        <DeploymentStatusBadges />

        {/* Announcements Panel */}
        {isAnnouncementsOpen && (
          <AnnouncementsCarousel
            version={pkg.version}
            onDismiss={onDismissAnnouncements}
          />
        )}
      </div>
    </div>
  )
}
