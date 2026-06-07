import type { Metadata } from "next"
import PageClient from "./page-client"

// ISR: cache the HTML shell for 1 hour — avoids a serverless invocation
// on every page load. The main content is client-rendered anyway.
export const revalidate = 3600

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams
}): Promise<Metadata> {
  const params = await searchParams
  const rawTags = params?.tags
  const tags = Array.isArray(rawTags) ? rawTags[0] : rawTags
  const trimmed = tags?.trim()

  if (trimmed) {
    return {
      title: `${trimmed} | Booru Prompt Gallery`,
    }
  }

  return {
    title: "Booru Prompt Gallery - By Mexes",
  }
}

export default function DanbooruPromptGenerator() {
  return <PageClient />
}
