
import { Suspense } from "react"
import { getSuggestions } from "@/app/actions/admin"
import { SuggestionsTable } from "./suggestions-table"
import { Loader2 } from "lucide-react"
import { AutoSuggestButton } from "@/components/admin/auto-suggest-button"

export const metadata = {
  title: "Tag Suggestions | Admin",
}

export default async function AdminSuggestionsPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const searchParams = await props.searchParams
  const page = Number(searchParams.page) || 1
  const status = typeof searchParams.status === 'string' ? searchParams.status : 'pending'
  const currentCategory = typeof searchParams.currentCategory === 'string' ? searchParams.currentCategory : undefined
  const suggestedCategory = typeof searchParams.suggestedCategory === 'string' ? searchParams.suggestedCategory : undefined

  const { data, count, totalPages } = await getSuggestions(page, 20, {
    status,
    currentCategory,
    suggestedCategory
  })

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
            <h1 className="text-3xl font-bold tracking-tight">Crowdsourced Suggestions</h1>
            <p className="text-muted-foreground">
            Manage tag category classifications submitted by the community.
            </p>
        </div>
        <AutoSuggestButton />
      </div>
      
      <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
        <SuggestionsTable 
          initialSuggestions={data} 
          totalCount={count}
          currentPage={page}
          totalPages={totalPages}
        />
      </Suspense>
    </div>
  )
}
