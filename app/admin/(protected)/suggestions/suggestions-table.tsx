'use client'

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { TagSuggestion, approveSuggestion, rejectSuggestion } from "@/app/actions/admin"
import { formatSubcategoryLabel } from "@/lib/tag-taxonomy"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { toastError } from "@/lib/toast-error"
import { Check, X, Filter, Loader2 } from "lucide-react"

interface SuggestionsTableProps {
  initialSuggestions: TagSuggestion[]
  totalCount: number
  currentPage: number
  totalPages: number
}

export function SuggestionsTable({ 
  initialSuggestions, 
  totalCount,
  currentPage,
  totalPages
}: SuggestionsTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  
  const [isProcessing, setIsProcessing] = useState<string | null>(null)
  
  const handleAction = async (type: 'approve' | 'reject', id: string) => {
    setIsProcessing(id)
    try {
      if (type === 'approve') {
        await approveSuggestion(id)
        toast({ title: "Suggestion Approved", description: "Tag category has been updated." })
      } else {
        await rejectSuggestion(id)
        toast({ title: "Suggestion Rejected", description: "Suggestion status updated." })
      }
      router.refresh()
    } catch (error) {
      toastError({
        title: "Error",
        description: error instanceof Error ? error.message : "Something went wrong",
        errorSource: "admin_suggestion_update",
      })
    } finally {
      setIsProcessing(null)
    }
  }

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== 'all') {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    params.set('page', '1') // Reset to page 1 on filter change
    router.push(`?${params.toString()}`)
  }

  const statusFilter = searchParams.get('status') || 'pending'

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Suggestions ({totalCount})</CardTitle>
            <div className="flex gap-2">
              <Select 
                value={statusFilter} 
                onValueChange={(val) => updateFilter('status', val)}
              >
                <SelectTrigger className="w-[180px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="all">All Status</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <CardDescription>Review and manage user submitted tag category changes.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tag Name</TableHead>
                  <TableHead>Current Category</TableHead>
                  <TableHead>Suggested Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialSuggestions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                      No suggestions found.
                    </TableCell>
                  </TableRow>
                ) : (
                  initialSuggestions.map((suggestion) => (
                    <TableRow key={suggestion.id}>
                      <TableCell className="font-medium">
                        {suggestion.tags?.name || 'Unknown Tag'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{suggestion.current_category}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 items-start">
                          <Badge variant={suggestion.suggested_category === suggestion.current_category ? "outline" : "secondary"} className="bg-info-soft text-info-text hover:bg-info/25">
                            {suggestion.suggested_category}
                          </Badge>
                          {suggestion.suggested_subcategory && (
                            <span className="text-[11px] text-muted-foreground font-mono">
                              › {formatSubcategoryLabel(suggestion.suggested_subcategory)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={
                            suggestion.status === 'approved' ? 'default' : 
                            suggestion.status === 'rejected' ? 'destructive' : 'outline'
                          }
                          className={suggestion.status === 'approved' ? 'bg-success hover:bg-success/90 text-success-foreground' : ''}
                        >
                          {suggestion.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(suggestion.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </TableCell>
                      <TableCell className="text-right">
                        {suggestion.status === 'pending' && (
                          <div className="flex justify-end gap-2">
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-8 w-8 p-0 text-success-text border-success-border hover:bg-success-soft hover:text-success-text"
                              onClick={() => handleAction('approve', suggestion.id)}
                              disabled={!!isProcessing}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-8 w-8 p-0 text-destructive-text border-destructive-border hover:bg-destructive-soft hover:text-destructive-text"
                              onClick={() => handleAction('reject', suggestion.id)}
                              disabled={!!isProcessing}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
             <div className="flex items-center justify-end space-x-2 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                   const params = new URLSearchParams(searchParams.toString())
                   params.set('page', (currentPage - 1).toString())
                   router.push(`?${params.toString()}`)
                }}
                disabled={currentPage <= 1}
              >
                Previous
              </Button>
              <div className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                   const params = new URLSearchParams(searchParams.toString())
                   params.set('page', (currentPage + 1).toString())
                   router.push(`?${params.toString()}`)
                }}
                disabled={currentPage >= totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
