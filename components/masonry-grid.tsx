"use client"

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { BooruPost } from "@/lib/api-client"
import { useIsMobile } from "@/hooks/use-mobile"

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

    window.addEventListener("scroll", handleScroll, { passive: true })
    window.addEventListener("resize", handleResize, { passive: true })

    return () => {
      window.removeEventListener("scroll", handleScroll)
      window.removeEventListener("resize", handleResize)
    }
  }, [])

  // Update container width on resize (debounced via ResizeObserver if needed, but window resize handles most cases)
  // For more robustness with sidebar changes etc, we can use ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const debouncedContainerWidth = useDebounce(containerWidth, 200)

  // Calculate Layout
  const layout = useMemo(() => {
    if (debouncedContainerWidth === 0) return { positions: [], totalHeight: 0 }

    const config = SCALE_CONFIG[scale]
    
    // Calculate number of columns
    // Ensure at least 2 columns on mobile if possible, or 1 if very narrow
    let columnCount = Math.floor((debouncedContainerWidth + gap) / (config.minColumnWidth + gap))
    columnCount = Math.max(isMobile ? 2 : 1, columnCount) // Enforce minimum columns

    // Calculate actual column width
    // (containerWidth - (columnCount - 1) * gap) / columnCount
    const columnWidth = Math.floor((debouncedContainerWidth - (columnCount - 1) * gap) / columnCount)

    // Initialize column heights
    const columnHeights = new Array(columnCount).fill(0)
    const positions: { x: number; y: number; width: number; height: number; item: BooruPost }[] = []

    items.forEach((item) => {
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
    const renderTop = Math.max(0, scrollTop - containerTop - 500) // 500px overscan top
    const renderBottom = scrollTop - containerTop + windowHeight + 500 // 500px overscan bottom

    return layout.positions.filter((pos) => {
      return (pos.y + pos.height > renderTop) && (pos.y < renderBottom)
    })
  }, [layout.positions, scrollTop, windowHeight])

  return (
    <div 
      ref={containerRef} 
      className="relative w-full" 
      style={{ height: layout.totalHeight }}
    >
      {visibleItems.map((pos) => (
        <div
          key={pos.item.id}
          className="absolute transition-all duration-300"
          style={{
            transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
            width: pos.width,
            height: pos.height,
          }}
        >
          {renderItem(pos.item, pos.width, pos.height)}
        </div>
      ))}
    </div>
  )
}
