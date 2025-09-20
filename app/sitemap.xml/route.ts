import { MetadataRoute } from 'next'

export async function GET(): Promise<Response> {
  const sitemap: MetadataRoute.Sitemap = [
    {
      url: 'https://danbooru-prompt-gallery.vercel.app',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: 'https://danbooru-prompt-gallery.vercel.app/api/posts',
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 0.8,
    },
    {
      url: 'https://danbooru-prompt-gallery.vercel.app/api/tags',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.7,
    },
  ]

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${sitemap
    .map(
      (item) => `
    <url>
      <loc>${item.url}</loc>
      <lastmod>${
        item.lastModified
          ? typeof item.lastModified === 'string'
            ? item.lastModified
            : item.lastModified.toISOString()
          : ''
      }</lastmod>
      <changefreq>${item.changeFrequency}</changefreq>
      <priority>${item.priority}</priority>
    </url>`
    )
    .join('')}
</urlset>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200',
    },
  })
}