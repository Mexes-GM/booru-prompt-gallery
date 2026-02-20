
import { Suspense } from "react"
import { getAILogs } from "@/app/actions/admin"
import { Loader2, CheckCircle, AlertCircle, Bot } from "lucide-react"
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
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination"

export const metadata = {
  title: "AI Logs | Admin",
}

export default async function AdminLogsPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const searchParams = await props.searchParams
  const page = Number(searchParams.page) || 1
  
  const { data, count, totalPages } = await getAILogs(page, 50)

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                <Bot className="h-8 w-8 text-blue-500" />
                AI Automation Logs
            </h1>
            <p className="text-muted-foreground">
            History of AI classification actions and auto-approvals.
            </p>
        </div>
        <div className="text-sm text-muted-foreground">
            Total Actions: {count}
        </div>
      </div>
      
      <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
        <Card>
            <CardHeader className="px-6 py-4 border-b bg-muted/20">
                <CardTitle className="text-base">Event Log</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Time</TableHead>
                            <TableHead>Tag</TableHead>
                            <TableHead>User Suggestion</TableHead>
                            <TableHead>AI Decision</TableHead>
                            <TableHead>Model</TableHead>
                            <TableHead>Action</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center">
                                    No logs found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            data.map((log: any) => (
                                <TableRow key={log.id}>
                                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                        {new Date(log.created_at).toLocaleString()}
                                    </TableCell>
                                    <TableCell className="font-medium">{log.tag_name}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline">{log.suggested_category}</Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col gap-1">
                                            <span className="font-semibold text-xs text-blue-600 dark:text-blue-400">
                                                {log.ai_prediction}
                                            </span>
                                            {log.confidence && log.confidence !== 'low' && (
                                                <span className="text-[10px] text-muted-foreground">
                                                    Confidence: {log.confidence}
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground truncate max-w-[150px]" title={log.model_used}>
                                        {log.model_used?.split('/').pop() || 'Unknown'}
                                    </TableCell>
                                    <TableCell>
                                        {log.action_taken === 'auto_approved' ? (
                                            <Badge className="bg-green-500 hover:bg-green-600 flex w-fit items-center gap-1">
                                                <CheckCircle className="h-3 w-3" /> Auto-Approved
                                            </Badge>
                                        ) : (
                                            <Badge variant="secondary" className="flex w-fit items-center gap-1">
                                                <AlertCircle className="h-3 w-3" /> Queued
                                            </Badge>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>

        {totalPages > 1 && (
            <div className="mt-4">
                 <Pagination>
                    <PaginationContent>
                        {page > 1 && (
                        <PaginationItem>
                            <PaginationPrevious href={`/admin/logs?page=${page - 1}`} />
                        </PaginationItem>
                        )}
                        <PaginationItem>
                            <PaginationLink isActive>{page}</PaginationLink>
                        </PaginationItem>
                        {page < totalPages && (
                        <PaginationItem>
                            <PaginationNext href={`/admin/logs?page=${page + 1}`} />
                        </PaginationItem>
                        )}
                    </PaginationContent>
                </Pagination>
            </div>
        )}
      </Suspense>
    </div>
  )
}
