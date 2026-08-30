"use client"

import Image from "next/image"
import GithubMono from '@lobehub/icons/es/Github/components/Mono'
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
 * (CivitAI, Tensor.Art, SeaArt, Buy Me a Coffee, GitHub, mirror), deployment status
 * badges, and the announcements carousel. No local state of its own — the
 * announcements open/dismiss state is owned by the caller since dismissing
 * also needs to persist to localStorage.
 */
export function GalleryHero({ isAnnouncementsOpen, onDismissAnnouncements }: GalleryHeroProps) {
  return (
    <div className="text-center space-y-3">
      <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-balance">Discover AI Art Prompts</h2>
      <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base px-4 text-pretty leading-relaxed">
        Generate prompts from Danbooru, Aibooru, Rule34, Gelbooru and e621 image collections.
        Extract and format tags from posts or access AI-generated prompts directly,
        creating clean, ready-to-use prompts for your AI art generation.
      </p>

      {/* Social Links Section */}
      <div className="pt-2 sm:pt-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          More of my work
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                id="social-civitai"
                href={SOCIAL_URLS.CIVITAI_PROFILE}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackExternalLink(SOCIAL_URLS.CIVITAI_PROFILE, 'social')}
                className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted/50 transition-[background-color,transform] duration-200 hover:-translate-y-0.5 active:scale-95 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
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
                className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted/50 transition-[background-color,transform] duration-200 hover:-translate-y-0.5 active:scale-95 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
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
                className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted/50 transition-[background-color,transform] duration-200 hover:-translate-y-0.5 active:scale-95 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
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
            id="support-buymeacoffee"
            href={SOCIAL_URLS.BUY_ME_A_COFFEE}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackExternalLink(SOCIAL_URLS.BUY_ME_A_COFFEE, 'support')}
          >
            <Image
              src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=☕&slug=Mexes&button_colour=FFDD00&font_colour=000000&font_family=Poppins&outline_colour=000000&coffee_colour=ffffff"
              alt="Buy me a coffee"
              width={180}
              height={40}
              unoptimized
              className="h-10 w-auto transition-transform duration-200 hover:scale-105 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none"
            />
          </a>

          <a
            id="github-repo"
            href={SOCIAL_URLS.GITHUB}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackExternalLink(SOCIAL_URLS.GITHUB, 'github')}
            className="inline-flex items-center px-4 py-2 bg-gray-800 hover:bg-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 text-white text-sm font-medium rounded-full transition-[transform,background-color,box-shadow] duration-200 hover:scale-105 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 shadow-lg hover:shadow-xl"
          >
            <GithubMono size={16} className="mr-2" />
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
