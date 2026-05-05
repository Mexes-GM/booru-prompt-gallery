"use client"

import { motion } from "framer-motion"
import { Search, Shield, Ban, Zap, Ghost, Clock } from "lucide-react"
import { cn } from "@/lib/utils"

interface NoResultsStateProps {
  className?: string;
}

const REASONS = [
  {
    type: 'nsfw',
    title: 'NSFW Filter Enabled',
    description: 'You might be searching for adult content while your Safe filter is active. Try changing the rating filter.',
    icon: Shield,
    colorClass: 'text-green-500',
    bgClass: 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900/50',
  },
  {
    type: 'blacklist',
    title: 'Blacklisted Tags',
    description: 'One or more of your search tags might be blocked in your active Blacklist.',
    icon: Ban,
    colorClass: 'text-red-500',
    bgClass: 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/50',
  },
  {
    type: 'opposites',
    title: 'Conflicting Tags',
    description: 'Your search contains tags that contradict each other (e.g. 1girl + 2girls).',
    icon: Zap,
    colorClass: 'text-yellow-600 dark:text-yellow-500',
    bgClass: 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-900/50',
  },
  {
    type: 'missing',
    title: 'Unknown Tag',
    description: 'The tag might be misspelled or does not exist in the selected database.',
    icon: Ghost,
    colorClass: 'text-slate-500',
    bgClass: 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800',
  },
  {
    type: 'ratelimit',
    title: 'Service Busy',
    description: 'The image provider is temporarily rate-limiting requests. Results should appear if you wait a moment and try again.',
    icon: Clock,
    colorClass: 'text-amber-600 dark:text-amber-500',
    bgClass: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50',
  }
]

export function NoResultsState({
  className,
}: NoResultsStateProps) {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
    },
  }

  return (
    <motion.div
      className={cn(
        'text-center py-8 px-4 sm:py-12 sm:px-6 w-full max-w-4xl mx-auto',
        className
      )}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="mb-10">
        <div className="flex justify-center mb-4">
          <div className="p-4 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 text-primary">
            <Search className="w-8 h-8 sm:w-10 sm:h-10" />
          </div>
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold mb-3 text-foreground">
          No Results Found
        </h2>
        <p className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto">
          We couldn&apos;t find any images matching your search. Here are some common reasons why:
        </p>
      </motion.div>

      {/* Grid of Reasons */}
      <motion.div 
        variants={itemVariants}
        className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left"
      >
        {REASONS.map((reason) => {
          const Icon = reason.icon
          return (
            <div 
              key={reason.type}
              className={cn(
                "p-4 sm:p-5 rounded-xl border transition-all duration-300 hover:scale-[1.02]",
                reason.bgClass
              )}
            >
              <div className="flex items-start gap-4">
                <div className={cn("p-2 rounded-lg bg-background shadow-sm", reason.colorClass)}>
                  <Icon className="w-6 h-6 sm:w-5 sm:h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-1">
                    {reason.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {reason.description}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </motion.div>
    </motion.div>
  )
}
