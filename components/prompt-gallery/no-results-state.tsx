"use client"

import { motion } from "framer-motion"
import { Search, Shield, Ban, Zap, Ghost, Clock } from "lucide-react"
import { cn } from "@/lib/utils"

interface NoResultsStateProps {
  className?: string;
  /** Rating filter is "rating:general" (Safe) — clicking the NSFW reason
   *  switches it to show all content. Omit to render the card as
   *  informational only (e.g. the extension sidepanel, which has its own
   *  compact rating control). */
  isSafeFilterActive?: boolean;
  onToggleRatingFilter?: () => void;
  /** Number of active blacklist entries — drives the "Blacklisted Tags" copy
   *  and whether clicking it can do anything (nothing to clear if it's 0). */
  blacklistCount?: number;
  onClearBlacklist?: () => void;
  /** Refetches the current search — wired to the "Service Busy" reason. */
  onRetry?: () => void;
}

interface Reason {
  type: string
  title: string
  description: string
  icon: typeof Search
  colorClass: string
  bgClass: string
  /** Present only for reasons with a real one-click fix. Reasons without
   *  this (Conflicting Tags, Unknown Tag) stay informational — there's no
   *  safe automatic fix for a specific mistyped or contradictory tag. */
  action?: { label: string; onClick: () => void }
}

export function NoResultsState({
  className,
  isSafeFilterActive,
  onToggleRatingFilter,
  blacklistCount = 0,
  onClearBlacklist,
  onRetry,
}: NoResultsStateProps) {
  const reasons: Reason[] = [
    {
      type: 'nsfw',
      title: 'NSFW Filter Enabled',
      description: isSafeFilterActive
        ? 'You might be searching for adult content while your Safe filter is active. Tap to show all content.'
        : 'You might be searching for adult content while your Safe filter is active. Try changing the rating filter.',
      icon: Shield,
      colorClass: 'text-success-text',
      bgClass: 'bg-success-soft border-success-border',
      action: isSafeFilterActive && onToggleRatingFilter
        ? { label: 'Show all content', onClick: onToggleRatingFilter }
        : undefined,
    },
    {
      type: 'blacklist',
      title: 'Blacklisted Tags',
      description: blacklistCount > 0
        ? `One or more of your search tags might be blocked by your ${blacklistCount}-tag Blacklist. Tap to clear it.`
        : 'One or more of your search tags might be blocked in your active Blacklist.',
      icon: Ban,
      colorClass: 'text-destructive-text',
      bgClass: 'bg-destructive-soft border-destructive-border',
      action: blacklistCount > 0 && onClearBlacklist
        ? { label: 'Clear blacklist', onClick: onClearBlacklist }
        : undefined,
    },
    {
      type: 'opposites',
      title: 'Conflicting Tags',
      description: 'Your search contains tags that contradict each other (e.g. 1girl + 2girls).',
      icon: Zap,
      colorClass: 'text-warning-text',
      bgClass: 'bg-warning-soft border-warning-border',
    },
    {
      type: 'missing',
      title: 'Unknown Tag',
      description: 'The tag might be misspelled or does not exist in the selected database.',
      icon: Ghost,
      colorClass: 'text-muted-foreground',
      bgClass: 'bg-muted/50 border-border',
    },
    {
      type: 'ratelimit',
      title: 'Service Busy',
      description: onRetry
        ? 'The image provider is temporarily rate-limiting requests. Tap to retry now.'
        : 'The image provider is temporarily rate-limiting requests. Results should appear if you wait a moment and try again.',
      icon: Clock,
      colorClass: 'text-warning-text',
      bgClass: 'bg-warning-soft border-warning-border',
      action: onRetry ? { label: 'Retry now', onClick: onRetry } : undefined,
    },
  ]
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
          <div className="p-4 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 text-primary-text">
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
        {reasons.map((reason) => {
          const Icon = reason.icon
          const isActionable = Boolean(reason.action)
          const content = (
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
                {reason.action && (
                  <span className="inline-block mt-2 text-xs font-semibold underline decoration-dotted underline-offset-2">
                    {reason.action.label}
                  </span>
                )}
              </div>
            </div>
          )

          const sharedClassName = cn(
            "p-4 sm:p-5 rounded-xl border transition-all duration-300",
            reason.bgClass,
            isActionable
              ? "hover:scale-[1.02] hover:shadow-md cursor-pointer text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              : "hover:scale-[1.01]"
          )

          return isActionable ? (
            <button
              key={reason.type}
              type="button"
              onClick={reason.action!.onClick}
              className={sharedClassName}
            >
              {content}
            </button>
          ) : (
            <div key={reason.type} className={sharedClassName}>
              {content}
            </div>
          )
        })}
      </motion.div>
    </motion.div>
  )
}
