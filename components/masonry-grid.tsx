"use client"

import React, { useState, useEffect, useRef, useMemo } from "react"
import { BooruPost } from "@/lib/api-client"
import { useIsMobile } from "@/hooks/use-mobile"
import { motion, AnimatePresence } from "framer-motion"

interface MasonryGridProps {
  items: BooruPost[]
  renderItem: (item: BooruPost, width: number, height: number) => React.ReactNode
  scale?: "small" | "medium" | "large"
  gap?: number
}

// Constants for layout
export const SCALE_CONFIG = {
  small: { minColumnWidth: 160, footerHeight: 116 },
  medium: { minColumnWidth: 220, footerHeight: 144 },
  large: { minColumnWidth: 280, footerHeight: 180 },
}

// Helper to debounce resize events
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

const MasonryItem = React.memo(({
  pos,
  renderItem
}: {
  pos: { x: number, y: number, width: number, height: number, item: BooruPost, index: number },
  renderItem: (item: BooruPost, w: number, h: number) => React.ReactNode
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, x: pos.x, y: pos.y + 40 }}
      animate={{
        opacity: 1,
        scale: 1,
        x: pos.x,
        y: pos.y
      }}
      exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.1 } }}
      transition={{
        duration: 0.2,
        ease: "easeOut",
        delay: (pos.index % 8) * 0.03, // Reduced stagger delay and count
      }}
      className="absolute"
      style={{
        width: pos.width,
        height: pos.height,
        left: 0,
        top: 0,
        willChange: "transform, opacity"
      }}
    >
      {renderItem(pos.item, pos.width, pos.height)}
    </motion.div>
  )
})
MasonryItem.displayName = "MasonryItem"

export function MasonryGrid({ items, renderItem, scale = "medium", gap = 16 }: MasonryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [windowHeight, setWindowHeight] = useState(0)
  const isMobile = useIsMobile()

  // Update window dimensions and scroll position
  useEffect(() => {
    if (typeof window === "undefined") return

    let ticking = false
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setScrollTop(window.scrollY)
          ticking = false
        })
        ticking = true
      }
    }

    const handleResize = () => {
      setWindowHeight(window.innerHeight)
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth)
      }
    }

    // Initial values
    handleResize()
    handleScroll()

    // Fallback for environments where resize might not fire immediately or width reads 0 (e.g. Remotion)
    if (containerRef.current && containerRef.current.clientWidth === 0) {
       setContainerWidth(1200)
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    window.addEventListener("resize", handleResize, { passive: true })

    return () => {
      window.removeEventListener("scroll", handleScroll)
      window.removeEventListener("resize", handleResize)
    }
  }, [])

  // Update container width on resize via ResizeObserver
  // This is a separate effect to avoid conflicts with window resize listener
  useEffect(() => {
    if (!containerRef.current) return

    // Use ResizeObserver only if the container has changed significantly
    // and window resize didn't capture the change (e.g., sidebar collapse)
    let timeoutId: NodeJS.Timeout | null = null

    const observer = new ResizeObserver((entries) => {
      // Debounce ResizeObserver updates to avoid excessive state updates
      if (timeoutId) clearTimeout(timeoutId)
      
      timeoutId = setTimeout(() => {
        for (const entry of entries) {
          // Only update if there's a meaningful change (>1px difference)
          if (Math.abs(entry.contentRect.width - containerWidth) > 1) {
            setContainerWidth(entry.contentRect.width)
          }
        }
      }, 50)
    })

    observer.observe(containerRef.current)
    
    return () => {
      observer.disconnect()
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [containerWidth])

  const debouncedContainerWidth = useDebounce(containerWidth, 50)

  // Calculate Layout
  const layout = useMemo(() => {
    if (debouncedContainerWidth === 0) return { positions: [], totalHeight: 0 }

    const config = SCALE_CONFIG[scale]

    // Calculate number of columns
    let columnCount = Math.floor((debouncedContainerWidth + gap) / (config.minColumnWidth + gap))

    if (isMobile) {
      // Mobile specific column counts
      if (scale === 'small') columnCount = 3
      else if (scale === 'medium') columnCount = 2
      else if (scale === 'large') columnCount = 1
    } else {
      columnCount = Math.max(1, columnCount)
    }

    // Calculate actual column width
    // (containerWidth - (columnCount - 1) * gap) / columnCount
    const columnWidth = Math.floor((debouncedContainerWidth - (columnCount - 1) * gap) / columnCount)

    // Initialize column heights
    const columnHeights = new Array(columnCount).fill(0)
    const positions: { x: number; y: number; width: number; height: number; item: BooruPost; index: number }[] = []

    items.forEach((item, index) => {
      // Find shortest column
      const minHeight = Math.min(...columnHeights)
      const columnIndex = columnHeights.indexOf(minHeight)

      // Calculate item height
      // Default aspect ratio 2:3 if dimensions missing
      const imgWidth = item.width || 200
      const imgHeight = item.height || 300
      let aspectRatio = imgHeight / imgWidth

      // Limit max aspect ratio to prevent extremely long cards
      // This handles cases like long comic strips breaking the layout
      const MAX_ASPECT_RATIO = 2.5
      if (aspectRatio > MAX_ASPECT_RATIO) {
        aspectRatio = MAX_ASPECT_RATIO
      }

      const imageDisplayHeight = columnWidth * aspectRatio
      const itemHeight = imageDisplayHeight + config.footerHeight

      // Store position
      positions.push({
        x: columnIndex * (columnWidth + gap),
        y: minHeight,
        width: columnWidth,
        height: itemHeight,
        item,
        index,
      })

      // Update column height
      columnHeights[columnIndex] += itemHeight + gap
    })

    const totalHeight = Math.max(...columnHeights)

    return { positions, totalHeight }
  }, [items, debouncedContainerWidth, scale, gap, isMobile])

  // Virtualization
  // Render items that are within the viewport + overscan
  const visibleItems = useMemo(() => {
    if (!containerRef.current) return layout.positions

    const containerTop = containerRef.current.offsetTop
    const overscan = isMobile ? 200 : 500
    const renderTop = Math.max(0, scrollTop - containerTop - overscan)
    const renderBottom = scrollTop - containerTop + windowHeight + overscan

    return layout.positions.filter((pos) => {
      return (pos.y + pos.height > renderTop) && (pos.y < renderBottom)
    })
  }, [layout.positions, scrollTop, windowHeight, isMobile])

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ height: layout.totalHeight }}
    >
      <AnimatePresence mode="popLayout">
        {visibleItems.map((pos) => (
          <MasonryItem
            key={`${(pos.item as any)._provider || (pos.item as any).provider || 'post'}-${pos.item.id}`}
            pos={pos}
            renderItem={renderItem}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}
