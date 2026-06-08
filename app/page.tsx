import type { Metadata } from "next"
import PageClient from "./page-client"

// ISR: cache the HTML shell for 1 hour — avoids a serverless invocation
export const revalidate = 3600

export const metadata: Metadata = {
  title: "Booru Prompt Gallery - By Mexes",
}

export default function DanbooruPromptGenerator() {
  return <PageClient />
}
