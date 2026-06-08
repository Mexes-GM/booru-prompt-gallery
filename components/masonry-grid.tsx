"use client"

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { BooruPost } from "@/lib/api-client"
import { useIsMobile } from "@/hooks/use-mobile"

interface MasonryGridProps {
  items: BooruPost[]
  renderItem: (item: BooruPost, width: number, height: number, index: number) => React.ReactNode
  scale?: "small" | "medium" | "large"
  gap?: number
}

export const SCALE_CONFIG = {
  small: { minColumnWidth: 160, footerHeight: 116 },
  medium: { minColumnWidth: 220, footerHeight: 144 },
  large: { minColumnWidth: 280, footerHeight: 180 },
}

const SCROLL_BUCKET_SIZE = 400
const OVERSCAN_MOBILE = 300
const OVERSCAN_DESKTOP = 600

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}

const MasonryItem = React.memo(({
  pos,
  renderItem,
  isInitial,
}: {
  pos: { x: number; y: number; width: number; height: number; item: BooruPost; index: number }
  renderItem: (item: BooruPost, w: number, h: number, index: number) => React.ReactNode
  isInitial: boolean
}) => {
  const staggerIndex = pos.index % 8
  return (
    <div
      className={`absolute${isInitial ? " masonry-item-enter" : ""}`}
      style={{
        width: pos.width,
        height: pos.height,
        left: 0,
        top: 0,
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
        contain: "layout style paint",
      }}
    >
      <div
        className="masonry-item-inner"
        style={isInitial ? { animationDelay: `${staggerIndex * 30}ms` } : { opacity: 1, transform: "scale(1)" }}
      >
        {renderItem(pos.item, pos.width, pos.height, pos.index)}
      </div>
    </div>
  )
})
MasonryItem.displayName = "MasonryItem"

export function MasonryGrid({ items, renderItem, scale = "medium", gap = 16 }: MasonryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [windowHeight, setWindowHeight] = useState(0)
  const isMobile = useIsMobile()

  // Usar refs en lugar de state para el scroll — evita re-renders a 60fps
  const scrollTopRef = useRef(0)
  const [scrollBucket, setScrollBucket] = useState(0)
  const lastBucketRef = useRef(-1)
  const tickingRef = useRef(false)

  // Trackear si los items acaban de montar (para animación inicial)
  const prevItemsLengthRef = useRef(0)
  const [showInitialAnimation, setShowInitialAnimation] = useState(true)

  useEffect(() => {
    if (typeof window === "undefined") return

    const handleScroll = () => {
      if (!tickingRef.current) {
        tickingRef.current = true
        requestAnimationFrame(() => {
          scrollTopRef.current = window.scrollY
          const bucket = Math.floor(window.scrollY / SCROLL_BUCKET_SIZE)
          if (bucket !== lastBucketRef.current) {
            lastBucketRef.current = bucket
            setScrollBucket(bucket)
          }
          tickingRef.current = false
        })
      }
    }

    const handleResize = () => {
      setWindowHeight(window.innerHeight)
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth)
      }
    }

    handleResize()
    // Forzar actualización inicial del bucket
    scrollTopRef.current = window.scrollY
    lastBucketRef.current = Math.floor(window.scrollY / SCROLL_BUCKET_SIZE)
    setScrollBucket(lastBucketRef.current)

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

  // ResizeObserver separado para cambios de container
  useEffect(() => {
    if (!containerRef.current) return

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const observer = new ResizeObserver((entries) => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        for (const entry of entries) {
          // Ignorar cambios minúsculos (< 5px) para evitar reorganizaciones por sub-píxeles
          // O scrollbars overlay que varían fraccionalmente
          const newWidth = Math.round(entry.contentRect.width)
          // Ignorar cambios menores a 20px (como la aparición de la barra de desplazamiento de Windows que suele ser de ~17px)
          // Esto previene que el grid se reorganice completamente y las tarjetas salten de columna
          if (Math.abs(newWidth - containerWidth) > 20) {
            setContainerWidth(newWidth)
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

  // Detectar si es carga inicial (primeros items)
  useEffect(() => {
    if (items.length > 0 && prevItemsLengthRef.current === 0) {
      setShowInitialAnimation(true)
      // Deshabilitar animación inicial después de 600ms
      const timer = setTimeout(() => setShowInitialAnimation(false), 600)
      prevItemsLengthRef.current = items.length
      return () => clearTimeout(timer)
    }
    prevItemsLengthRef.current = items.length
  }, [items.length])

  const debouncedContainerWidth = useDebounce(containerWidth, 50)

  // Calcular layout del masonry
  const layout = useMemo(() => {
    if (debouncedContainerWidth === 0) return { positions: [], totalHeight: 0 }

    const config = SCALE_CONFIG[scale]

    let columnCount = Math.floor((debouncedContainerWidth + gap) / (config.minColumnWidth + gap))

    if (isMobile) {
      if (scale === "small") columnCount = 3
      else if (scale === "medium") columnCount = 2
      else if (scale === "large") columnCount = 1
    } else {
      columnCount = Math.max(1, columnCount)
    }

    const columnWidth = Math.floor((debouncedContainerWidth - (columnCount - 1) * gap) / columnCount)
    const columnHeights = new Array(columnCount).fill(0)
    const positions: {
      x: number; y: number; width: number; height: number; item: BooruPost; index: number
    }[] = []

    const MAX_ASPECT_RATIO = 2.5

    items.forEach((item, index) => {
      const minHeight = Math.min(...columnHeights)
      const columnIndex = columnHeights.indexOf(minHeight)

      const imgWidth = item.width || 200
      const imgHeight = item.height || 300
      let aspectRatio = imgHeight / imgWidth

      if (aspectRatio > MAX_ASPECT_RATIO) {
        aspectRatio = MAX_ASPECT_RATIO
      }

      const imageDisplayHeight = columnWidth * aspectRatio
      const itemHeight = imageDisplayHeight + config.footerHeight

      positions.push({
        x: columnIndex * (columnWidth + gap),
        y: minHeight,
        width: columnWidth,
        height: itemHeight,
        item,
        index,
      })

      columnHeights[columnIndex] += itemHeight + gap
    })

    const totalHeight = Math.max(...columnHeights)

    return { positions, totalHeight }
  }, [items, debouncedContainerWidth, scale, gap, isMobile])

  // Virtualización: solo renderizar ítems en viewport + overscan
  // Usa scrollTopRef (sin causar re-render) para el cálculo, pero depende de scrollBucket
  // para activar el recálculo de visibleItems
  const visibleItems = useMemo(() => {
    if (!containerRef.current || layout.positions.length === 0) return layout.positions

    const scrollTop = scrollTopRef.current
    const containerTop = containerRef.current.offsetTop
    const overscan = isMobile ? OVERSCAN_MOBILE : OVERSCAN_DESKTOP
    const renderTop = Math.max(0, scrollTop - containerTop - overscan)
    const renderBottom = scrollTop - containerTop + windowHeight + overscan

    return layout.positions.filter((pos) => {
      return pos.y + pos.height > renderTop && pos.y < renderBottom
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.positions, scrollBucket, windowHeight, isMobile])

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ height: layout.totalHeight }}
    >
      {visibleItems.map((pos) => (
        <MasonryItem
          key={`${(pos.item as any)._provider || (pos.item as any).provider || "post"}-${pos.item.id}`}
          pos={pos}
          renderItem={renderItem}
          isInitial={showInitialAnimation}
        />
      ))}
    </div>
  )
}
