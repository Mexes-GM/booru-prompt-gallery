'use client'

import { useEffect } from 'react'

interface StructuredDataProps {
  type?: 'WebApplication' | 'WebSite' | 'SoftwareApplication'
  name?: string
  description?: string
  url?: string
  applicationCategory?: string
  operatingSystem?: string
}

export function StructuredData({
  type = 'WebApplication',
  name = 'Danbooru Prompt Gallery',
  description = 'Generate prompts from Danbooru image tags. Extract and format tags from posts, removing unnecessary metadata to create clean, ready-to-use prompts for AI art generation.',
  url = 'https://danbooru-prompt-gallery.vercel.app',
  applicationCategory = 'DesignApplication',
  operatingSystem = 'Any'
}: StructuredDataProps) {
  useEffect(() => {
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': type,
      name,
      description,
      url,
      applicationCategory,
      operatingSystem,
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD'
      },
      author: {
        '@type': 'Organization',
        name: 'Danbooru Prompt Gallery'
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: '4.8',
        ratingCount: '150'
      },
      featureList: [
        'AI Art Prompt Generation',
        'Danbooru Tag Extraction',
        'Clean Prompt Formatting',
        'Tag Database Search',
        'Favorites Management',
        'Multiple View Modes'
      ]
    }

    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.textContent = JSON.stringify(structuredData)
    document.head.appendChild(script)

    return () => {
      document.head.removeChild(script)
    }
  }, [type, name, description, url, applicationCategory, operatingSystem])

  return null
}