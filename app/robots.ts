import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin/'],
      },
      {
        userAgent: 'Googlebot',
        allow: '/',
      },
    ],
 sitemap: `${process.env.NEXT_PUBLIC_APP_URL || 'https://booru-prompt-gallery.netlify.app'}/sitemap.xml`,
 host: process.env.NEXT_PUBLIC_APP_URL || 'https://booru-prompt-gallery.netlify.app',
  }
}
