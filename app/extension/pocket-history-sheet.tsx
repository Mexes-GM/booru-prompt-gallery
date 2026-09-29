"use client"

import { memo, useMemo } from "react"
import { Copy, ExternalLink, History, Loader2, Send, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ClientFormattedDate } from "@/components/ui/client-formatted-date"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { useHistoryPosts } from "@/hooks/use-history-posts"
import { useCardPrompt, type UseCardPromptOptions } from "@/hooks/use-card-prompt"
import { useToast } from "@/hooks/use-toast"
import { favKey } from "@/lib/favorites-logic"
import { getPostUrl } from "@/lib/constants"
import { getGelbooruProxyUrl, getDanbooruCdnUrl, imageReferrerPolicy } from "@/lib/proxy-url"
import type { HistoryItem } from "@/lib/storage"
import type { BooruPost } from "@/lib/api-client"
import { postToParent } from "./pocket-bridge"

interface PocketHistorySheetProps {
  history: HistoryItem[]
  promptOptions: UseCardPromptOptions
  globalWeights: Record<string, number>
  isGlobalWeightsEnabled: boolean
  hasTarget: boolean
  onNoTarget: () => void
  onUsedPrompt: (post: BooruPost) => void
  removeHistoryItem: (id: string) => void
  clearHistory: () => void
}

/**
 * The Pocket's copy history. History entries only store a post snapshot (not
 * the prompt text), exactly like the web app's History view — so each row
 * re-derives its prompt through the shared useCardPrompt pipeline with the
 * CURRENT settings, same as the web History grid does.
 */
export function PocketHistorySheet(props: PocketHistorySheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" className="h-8 w-8 p-0 shadow-sm" title="History" aria-label="Open prompt history">
          <History className="w-3.5 h-3.5" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:w-[400px] flex flex-col gap-0 p-4">
        <SheetHeader className="text-left">
          <SheetTitle className="text-sm font-bold">Prompt History</SheetTitle>
          <SheetDescription className="text-xs">Recently copied or sent prompts, rebuilt with your current settings.</SheetDescription>
        </SheetHeader>
        {/* Mounted only while open (Radix unmounts closed content), so legacy
            entries are hydrated over the network only when actually viewed. */}
        <HistoryList {...props} />
      </SheetContent>
    </Sheet>
  )
}

function HistoryList({ history, removeHistoryItem, clearHistory, ...rowProps }: PocketHistorySheetProps) {
  const { posts, isLoading, total } = useHistoryPosts(history)

  // Newest timestamp + every history row id per post, so a row can show when
  // it was last used and "remove" drops all duplicate entries of that post.
  const meta = useMemo(() => {
    const map = new Map<string, { timestamp: number; ids: string[] }>()
    for (const item of history) {
      const key = favKey(item.post?._provider || item.provider, item.postId)
      const entry = map.get(key)
      if (entry) entry.ids.push(item.id)
      else map.set(key, { timestamp: item.timestamp, ids: [item.id] })
    }
    return map
  }, [history])

  if (history.length === 0) {
    return <p className="text-center text-xs text-muted-foreground py-10">History is empty. Copied and sent prompts show up here.</p>
  }

  return (
    <>
      <ul className="mt-4 flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
        {posts.map((post) => {
          const key = favKey(post._provider || "", post.id)
          const entry = meta.get(key)
          return (
            <HistoryRow
              key={key}
              post={post}
              timestamp={entry?.timestamp}
              onRemove={() => entry?.ids.forEach(removeHistoryItem)}
              {...rowProps}
            />
          )
        })}
        {isLoading && posts.length < total && (
          <li className="flex items-center justify-center gap-2 py-3 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading older entries…
          </li>
        )}
      </ul>
      <Button
        variant="outline"
        size="sm"
        className="mt-3 w-full text-xs text-destructive-text hover:text-destructive-text hover:bg-destructive/10 h-8 shrink-0"
        onClick={clearHistory}
      >
        Clear History
      </Button>
    </>
  )
}

const HistoryRow = memo(function HistoryRow({
  post,
  timestamp,
  onRemove,
  promptOptions,
  globalWeights,
  isGlobalWeightsEnabled,
  hasTarget,
  onNoTarget,
  onUsedPrompt,
}: {
  post: BooruPost
  timestamp?: number
  onRemove: () => void
} & Omit<PocketHistorySheetProps, "history" | "removeHistoryItem" | "clearHistory">) {
  const { toast } = useToast()
  const { displayContent, isAiPost } = useCardPrompt({
    post,
    ...promptOptions,
    globalWeights,
    isGlobalWeightsEnabled,
  })
  const provider = post._provider || "danbooru"

  const rawThumb = post.preview_file_url || post.file_url
  const thumb = !rawThumb
    ? ""
    : provider === "gelbooru" || provider === "rule34"
      ? getGelbooruProxyUrl(rawThumb)
      : getDanbooruCdnUrl(rawThumb) ?? rawThumb

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(displayContent)
      onUsedPrompt(post)
      toast({ title: "Copied", description: "Prompt copied to clipboard." })
    } catch {
      toast({ title: "Couldn't copy", description: "Clipboard access was blocked.", variant: "destructive" })
    }
  }

  const send = () => {
    postToParent({ type: "INJECT_PROMPT", prompt: displayContent })
    onUsedPrompt(post)
    if (!hasTarget) onNoTarget()
    else toast({ title: "Queued", description: "Prompt added to the generation queue." })
  }

  return (
    <li className="border rounded-lg p-2 flex gap-2 bg-card">
      <div className="relative w-12 h-12 shrink-0 rounded-md overflow-hidden bg-muted">
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" loading="lazy" referrerPolicy={imageReferrerPolicy(provider)} className="object-cover w-full h-full" />
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] text-muted-foreground truncate">
            {timestamp ? <ClientFormattedDate timestamp={timestamp} /> : null}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            <a
              href={getPostUrl(provider, post.id, isAiPost)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus-ring"
              aria-label="Open original post"
              title="Open original post"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive-text hover:bg-destructive/10" onClick={onRemove} aria-label="Remove from history">
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <p className="text-[11px] leading-snug line-clamp-2 break-words font-mono text-foreground/90">{displayContent}</p>
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={copy} disabled={!displayContent}>
            <Copy className="h-3 w-3 mr-1" /> Copy
          </Button>
          <Button size="sm" className="h-6 text-[11px] px-2" onClick={send} disabled={!displayContent}>
            <Send className="h-3 w-3 mr-1" /> Send
          </Button>
        </div>
      </div>
    </li>
  )
})
