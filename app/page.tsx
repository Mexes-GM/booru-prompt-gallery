import type { Metadata } from "next"
import PageClient from "./page-client"

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
