"use client"

import { useState, useMemo, memo } from "react"
import useSWR from "swr"
import { Flame, Loader2, AlertCircle } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { TrendCard } from "./trend-card"
import { TrendItem } from "@/lib/booru/types"

interface TrendSheetProps {
  onSelectTag: (tag: string) => void
}

export const TrendSheet = memo(function TrendSheet({ onSelectTag }: TrendSheetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("character")

  // Only fetch when open
  const { data: trends, error, isLoading } = useSWR<TrendItem[]>(
    isOpen ? '/api/trends' : null,
    async (url) => {
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error('Failed to fetch')
      }
      const data = await res.json()
      return data
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 3600000, // 1 hour
    }
  )

  const filteredTrends = useMemo(() => {
    if (!trends) return []
    return trends.filter(t => t.type === activeTab)
  }, [trends, activeTab])

  const handleTagClick = (tag: string) => {
    setIsOpen(false)
    onSelectTag(tag)
  }

  const renderGrid = (items: TrendItem[]) => (
    <motion.div
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 pb-2"
      initial="hidden"
      animate="visible"
      exit="hidden"
      variants={{
        visible: { transition: { staggerChildren: 0.05 } },
        hidden: {}
      }}
    >
      <AnimatePresence mode="popLayout">
        {items.map((item, index) => (
          <TrendCard
            key={item.name}
            item={item}
            rank={index + 1}
            index={index}
            onClick={handleTagClick}
          />
        ))}
      </AnimatePresence>
    </motion.div>
  )

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <div className="inline-block">
          <InfoTooltip
            hideIcon
            side="bottom"
            title="Trending Today"
            description="Discover what's currently popular on Danbooru today. Explore the top trending characters and franchises from the last 24 hours to find new inspiration for your generations."
          >
            <Button
              type="button"
              variant="secondary"
              className="h-9 px-3 bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:hover:bg-orange-900/50"
            >
              <Flame className="h-4 w-4 mr-2" />
              <span className="text-xs font-medium">Trending</span>
            </Button>
          </InfoTooltip>
        </div>
      </DialogTrigger>
      <DialogContent className="max-w-4xl h-[90vh] sm:h-[80vh] flex flex-col p-0 gap-0 bg-background/95 backdrop-blur-md overflow-hidden duration-500 ease-in-out">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="flex flex-col h-full"
        >
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <div className="flex flex-col items-center justify-center w-full">
              <div className="space-y-1 text-center">
                <DialogTitle className="flex items-center justify-center gap-2 text-xl font-bold">
                  <span className="p-1.5 bg-orange-500/10 rounded-full">
                    <Flame className="h-5 w-5 text-orange-500 fill-orange-500" />
                  </span>
                  Trending Now
                </DialogTitle>
                <DialogDescription className="text-center">
                  Most popular characters and franchises active today on Danbooru.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-hidden relative w-full">
            {isLoading ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"
              >
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p>Analyzing trends...</p>
              </motion.div>
            ) : error ? (
              <div className="p-6">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Failed to load trends. Please try again later.
                  </AlertDescription>
                </Alert>
              </div>
            ) : (
              <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col w-full">
                <div className="px-6 py-2 border-b bg-background/50 shrink-0">
                  <TabsList className="grid w-full max-w-[400px] grid-cols-2 bg-muted/50 p-1 mx-auto">
                    {["character", "copyright"].map((tab) => (
                      <TabsTrigger
                        key={tab}
                        value={tab}
                        className="relative z-10 data-[state=active]:bg-transparent data-[state=active]:shadow-none transition-none"
                      >
                        <span className="relative z-20 text-sm font-medium">
                          {tab === "character" ? "Characters" : "Series"}
                        </span>
                        {activeTab === tab && (
                          <motion.div
                            layoutId="active-tab-indicator"
                            className="absolute inset-0 z-10 bg-background rounded-sm shadow-sm"
                            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                          />
                        )}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>

                <ScrollArea className="flex-1 w-full">
                  <div className="px-6 py-6">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                      >
                        {filteredTrends.length > 0 && renderGrid(filteredTrends)}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </ScrollArea>
              </Tabs>
            )}
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  )
})
