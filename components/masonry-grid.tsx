"use client"

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { BooruPost } from "@/lib/api-client"
import { useIsMobile } from "@/hooks/use-mobile"

interface MasonryGridProps {
  items: BooruPost[]
  renderItem: (item: BooruPost, width: number, height: number, index: number) => React.ReactNode
  scale?: "small" | "medium" | "large"
  gap?: number
  forceColumns?: number
  /** When provided, virtualization is driven by this element's scroll instead of window */
  scrollContainerRef?: React.RefObject<HTMLElement | null>
  /** Override the footer height used for item height calculation (default comes from SCALE_CONFIG) */
  footerHeightOverride?: number
}

export const SCALE_CONFIG = {
  small: { minColumnWidth: 160, footerHeight: 116 },
  medium: { minColumnWidth: 220, footerHeight: 144 },
  large: { minColumnWidth: 280, footerHeight: 180 },
}

const SCROLL_BUCKET_SIZE = 250
const OVERSCAN_MOBILE = 800
const OVERSCAN_DESKTOP = 1200

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    if (debouncedValue === value) return
    // Apply the first meaningful value immediately so the grid lays out on the
    // first paint (avoids a blank/flashing frame); debounce only later churn
    // such as resize or the iOS dynamic toolbar.
    if (!debouncedValue) {
      setDebouncedValue(value)
      return
    }
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay, debouncedValue])

  return debouncedValue
}

const MasonryItem = React.memo(({
  pos,
  renderItem,
  isInitial,
  fromPos,
}: {
  pos: { x: number; y: number; width: number; height: number; item: BooruPost; index: number }
  renderItem: (item: BooruPost, w: number, h: number, index: number) => React.ReactNode
  isInitial: boolean
  /** Previous (x, y) this same item was rendered at, when a pure reorder just
   *  happened (e.g. History moving a re-copied post to the front). When set,
   *  the item FLIPs from `fromPos` to `pos` instead of snapping directly to
   *  `pos` — see the `useLayoutEffect` below. */
  fromPos?: { x: number; y: number } | null
}) => {
  const staggerIndex = pos.index % 8
  const elRef = useRef<HTMLDivElement>(null)

  // FLIP: if this render carries a `fromPos` different from the new `pos`,
  // paint the element at its OLD position first (synchronously, before the
  // browser's next paint), then let a CSS transition carry it to the new
  // position on the following frame. `transform` is a normal animatable CSS
  // property, so no manual interpolation is needed — just two `transform`
  // writes a frame apart.
  React.useLayoutEffect(() => {
    if (!fromPos) return
    const el = elRef.current
    if (!el) return
    if (fromPos.x === pos.x && fromPos.y === pos.y) return

    el.style.transition = "none"
    el.style.transform = `translate3d(${fromPos.x}px, ${fromPos.y}px, 0)`
    // Force a reflow so the browser commits the "from" transform before we
    // switch to the animated "to" transform on the next frame.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    el.getBoundingClientRect()

    const raf = requestAnimationFrame(() => {
      el.style.transition = ""
      el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromPos, pos.x, pos.y])

  return (
    <div
      ref={elRef}
      className={`absolute${isInitial ? " masonry-item-enter" : ""}${fromPos ? " masonry-item-move" : ""}`}
      role="listitem"
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
        style={isInitial ? { animationDelay: `${staggerIndex * 30}ms` } : undefined}
      >
        {renderItem(pos.item, pos.width, pos.height, pos.index)}
      </div>
    </div>
  )
})
MasonryItem.displayName = "MasonryItem"

type PositionEntry = { x: number; y: number; width: number; height: number; item: BooruPost; index: number }

export function MasonryGrid({ items, renderItem, scale = "medium", gap = 16, forceColumns, scrollContainerRef, footerHeightOverride }: MasonryGridProps) {
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
  const prevItemIdsRef = useRef<Set<number | string>>(new Set())
  const [showInitialAnimation, setShowInitialAnimation] = useState(true)
  // IDs de items genuinamente nuevos (no vistos en el render anterior) que deben
  // animar su entrada. Se calcula por diferencia de ID, no por posición/índice:
  // un prepend (ej. History insertando el post recién copiado al frente) desplaza
  // el índice de TODOS los items existentes +1, así que animar "todo índice >= N"
  // marcaba erróneamente cards viejas como nuevas, produciendo el salto/duplicado
  // visual al copiar un prompt ya presente en el historial.
  const [newItemAnimIds, setNewItemAnimIds] = useState<Set<number | string> | null>(null)
  // Posiciones (x, y) del render ANTERIOR, keyed por item id — solo se llena
  // cuando el `layout` useMemo detecta un reorder puro (mismo set de IDs).
  // Pasado a MasonryItem como `fromPos` para que haga un FLIP manual: pintar
  // en la posición vieja, luego animar hacia la nueva vía CSS transition.
  const prevPositionsByIdRef = useRef<Map<number | string, { x: number; y: number }> | null>(null)

  // Medir el ancho del contenedor de forma SÍNCRONA antes del primer paint.
  // Evita el flash en móvil donde el grid se pintaba con el ancho de fallback
  // (1200px) o vacío durante un frame antes de que el efecto post-paint lo
  // corrigiera.
  React.useLayoutEffect(() => {
    if (containerRef.current) {
      const w = containerRef.current.clientWidth
      if (w > 0) setContainerWidth(w)
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return

    // Determine whether we listen on a custom scroll container or window
    const scrollEl = scrollContainerRef?.current ?? null

    const getScrollTop = () => scrollEl ? scrollEl.scrollTop : window.scrollY
    const getViewportHeight = () => scrollEl ? scrollEl.clientHeight : window.innerHeight

    const handleScroll = () => {
      if (!tickingRef.current) {
        tickingRef.current = true
        requestAnimationFrame(() => {
          scrollTopRef.current = getScrollTop()
          const bucket = Math.floor(scrollTopRef.current / SCROLL_BUCKET_SIZE)
          if (bucket !== lastBucketRef.current) {
            lastBucketRef.current = bucket
            setScrollBucket(bucket)
          }
          tickingRef.current = false
        })
      }
    }

    const handleResize = () => {
      setWindowHeight(getViewportHeight())
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth)
      }
    }

    handleResize()
    // Forzar actualización inicial del bucket
    scrollTopRef.current = getScrollTop()
    lastBucketRef.current = Math.floor(scrollTopRef.current / SCROLL_BUCKET_SIZE)
    setScrollBucket(lastBucketRef.current)

    if (containerRef.current && containerRef.current.clientWidth === 0) {
      setContainerWidth(1200)
    }

    const scrollTarget = (scrollEl ?? window) as EventTarget
    scrollTarget.addEventListener("scroll", handleScroll, { passive: true })
    window.addEventListener("resize", handleResize, { passive: true })

    return () => {
      scrollTarget.removeEventListener("scroll", handleScroll)
      window.removeEventListener("resize", handleResize)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollContainerRef])

  // ResizeObserver separado para cambios de container
  // Mantiene el ancho actual en un ref para comparar dentro del callback sin
  // re-suscribir el observer en cada cambio de ancho (evita churn de
  // disconnect/observe en cada resize, p. ej. la toolbar dinámica de iOS).
  const containerWidthRef = useRef(containerWidth)
  useEffect(() => { containerWidthRef.current = containerWidth }, [containerWidth])

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
          if (Math.abs(newWidth - containerWidthRef.current) > 20) {
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
  }, [])

  // Detectar carga inicial vs. items agregados (scroll infinito o prepend de
  // History). El caso de puro reordenamiento (mismo set de IDs, distinto
  // orden) NO se maneja aquí — se detecta directamente dentro del `layout`
  // useMemo (variable `isPureReorder`), porque ahí es donde ya se tienen las
  // posiciones viejas (`cache.positions`) necesarias para el FLIP; replicar
  // la detección en dos lugares sería redundante y podría desincronizarse.
  useEffect(() => {
    const prev = prevItemsLengthRef.current
    const prevIds = prevItemIdsRef.current
    const currentIds = new Set(items.map(item => item.id))

    if (items.length > 0 && prev === 0) {
      // Carga inicial: animación de entrada de todo el primer lote
      setShowInitialAnimation(true)
      const timer = setTimeout(() => setShowInitialAnimation(false), 600)
      prevItemsLengthRef.current = items.length
      prevItemIdsRef.current = currentIds
      return () => clearTimeout(timer)
    }

    if (items.length !== prev && prev > 0) {
      // Items agregados (al final por scroll infinito, o al frente/medio por
      // History al copiar un post) o quitados: animar únicamente los IDs que
      // no existían en el render anterior. Un post movido de posición (ya
      // estaba en prevIds) NO se re-anima como nuevo.
      const newIds = new Set<number | string>()
      for (const id of currentIds) {
        if (!prevIds.has(id)) newIds.add(id)
      }
      if (newIds.size > 0) {
        setNewItemAnimIds(newIds)
        const timer = setTimeout(() => setNewItemAnimIds(null), 600)
        prevItemsLengthRef.current = items.length
        prevItemIdsRef.current = currentIds
        return () => clearTimeout(timer)
      }
    }

    prevItemsLengthRef.current = items.length
    prevItemIdsRef.current = currentIds
  }, [items])

  const debouncedContainerWidth = useDebounce(containerWidth, 50)

  // --- Incremental layout cache ---
  // Preserves positions of already-laid-out items across renders so that
  // infinite scroll appends never cause existing cards to shift columns.
  // Uses full ID-prefix verification to detect appends vs resets.
  // Three strategies:
  //   'same'   — exact same items + params → return cached (zero work)
  //   'append' — items grew, prefix IDs match → layout only new items
  //   'reset'  — anything else → full recompute + scroll anchoring
  const layoutCacheRef = useRef<{
    positions: PositionEntry[]
    columns: PositionEntry[][]
    columnHeights: number[]
    columnCount: number
    columnWidth: number
    itemIds: (number | string)[]  // Full ID list for prefix verification
    containerWidth: number
    scale: string
    gap: number
    forceColumns: number | undefined
    footerHeightOverride: number | undefined
    totalHeight: number
  }>({
    positions: [],
    columns: [],
    columnHeights: [],
    columnCount: 0,
    columnWidth: 0,
    itemIds: [],
    containerWidth: 0,
    scale: '',
    gap: 0,
    forceColumns: undefined,
    footerHeightOverride: undefined,
    totalHeight: 0,
  })

  // Scroll anchoring: track whether a full recompute happened so we can
  // restore scroll position in useLayoutEffect (before browser paints).
  const scrollAnchorRef = useRef<{
    anchorItemId: number | string | null
    anchorOffsetFromViewport: number
    needsRestore: boolean
  }>({ anchorItemId: null, anchorOffsetFromViewport: 0, needsRestore: false })

  // Calcular layout del masonry (incremental cuando es posible)
  const layout = useMemo(() => {
    if (debouncedContainerWidth === 0) return { positions: [] as PositionEntry[], columns: [] as PositionEntry[][], totalHeight: 0 }

    const config = SCALE_CONFIG[scale]

    let columnCount = forceColumns || Math.floor((debouncedContainerWidth + gap) / (config.minColumnWidth + gap))
 
    if (!forceColumns) {
      if (isMobile) {
        if (scale === "small") columnCount = 3
        else if (scale === "medium") columnCount = 2
        else if (scale === "large") columnCount = 1
      } else {
        columnCount = Math.max(1, columnCount)
      }
    }

    const columnWidth = Math.floor((debouncedContainerWidth - (columnCount - 1) * gap) / columnCount)

    const MAX_ASPECT_RATIO = 2.5
    const cache = layoutCacheRef.current

    // Check if layout parameters changed (requires full recompute regardless of items)
    const paramsMatch = (
      cache.columnCount === columnCount &&
      cache.columnWidth === columnWidth &&
      cache.scale === scale &&
      cache.containerWidth === debouncedContainerWidth &&
      cache.gap === gap &&
      cache.forceColumns === forceColumns &&
      cache.footerHeightOverride === footerHeightOverride
    )

    // Determine cache strategy by verifying item IDs as a prefix match.
    // This catches cases where items are removed from the middle (e.g. tagCounts filter resolving
    // asynchronously between renders).
    let cacheStrategy: 'same' | 'append' | 'reset' = 'reset'

    if (paramsMatch && cache.itemIds.length > 0 && items.length >= cache.itemIds.length) {
      // Verify that ALL cached item IDs match the current items in order
      let prefixMatches = true
      for (let i = 0; i < cache.itemIds.length; i++) {
        if (items[i]?.id !== cache.itemIds[i]) {
          prefixMatches = false
          break
        }
      }

      if (prefixMatches) {
        if (items.length === cache.itemIds.length) {
          cacheStrategy = 'same'
        } else {
          cacheStrategy = 'append'
        }
      }
    }

    // Helper to lay out a single item into the shortest column.
    // Also appends the position to its column bucket (cols) so visibleItems
    // can binary-search per column instead of scanning all positions.
    const layoutItem = (item: BooruPost, index: number, colHeights: number[], cols: PositionEntry[][]): PositionEntry => {
      const minHeight = Math.min(...colHeights)
      const columnIndex = colHeights.indexOf(minHeight)

      const imgWidth = item.width || 200
      const imgHeight = item.height || 300
      let aspectRatio = imgHeight / imgWidth
      if (aspectRatio > MAX_ASPECT_RATIO) aspectRatio = MAX_ASPECT_RATIO

      const imageDisplayHeight = columnWidth * aspectRatio
      const itemHeight = imageDisplayHeight + (footerHeightOverride ?? config.footerHeight)

      const pos: PositionEntry = {
        x: columnIndex * (columnWidth + gap),
        y: minHeight,
        width: columnWidth,
        height: itemHeight,
        item,
        index,
      }

      colHeights[columnIndex] += itemHeight + gap
      cols[columnIndex].push(pos)
      return pos
    }

    let positions: PositionEntry[]
    let columnHeights: number[]
    let columns: PositionEntry[][]

    if (cacheStrategy === 'same') {
      // Exact same items + same params → return cached layout as-is (zero work)
      return { positions: cache.positions, columns: cache.columns, totalHeight: cache.totalHeight }

    } else if (cacheStrategy === 'append') {
      // Items were appended (infinite scroll) — reuse cached positions, only layout new items.
      // Existing cards keep their exact (x, y) coordinates.
      positions = [...cache.positions]
      columnHeights = [...cache.columnHeights]
      columns = cache.columns.map(col => [...col])

      for (let i = cache.itemIds.length; i < items.length; i++) {
        positions.push(layoutItem(items[i], i, columnHeights, columns))
      }

    } else {
      // Full recompute — new search, filter change, resize, items removed from
      // middle, or a pure reorder of the same ID set (e.g. History moving a
      // re-copied post to the front).
      //
      // A pure reorder gets different treatment: skip scroll-anchoring (it
      // would fight the movement animation by re-scrolling under the user
      // while cards are sliding) and instead snapshot the OLD positions keyed
      // by item id into `prevPositionsByIdRef`. MasonryItem reads that as
      // `fromPos` and FLIPs from it to the new position via CSS transition
      // (see MasonryItem's useLayoutEffect above) instead of snapping.
      let isPureReorder = false
      if (cache.itemIds.length > 0 && cache.itemIds.length === items.length) {
        const prevIdSet = new Set(cache.itemIds)
        isPureReorder = items.every(item => prevIdSet.has(item.id))
      }

      if (isPureReorder) {
        prevPositionsByIdRef.current = new Map(
          cache.positions.map(p => [p.item.id, { x: p.x, y: p.y }])
        )
      } else {
        prevPositionsByIdRef.current = null

        // Capture scroll anchor BEFORE recompute for scroll position restoration.
        if (cache.positions.length > 0 && typeof window !== 'undefined' && containerRef.current) {
          const scrollEl = scrollContainerRef?.current ?? null
          const scrollTop = scrollEl ? scrollEl.scrollTop : window.scrollY
          // offsetTop is relative to offsetParent; for internal scroll containers
          // the container itself is the reference, so offsetTop is 0.
          const containerTop = scrollEl ? 0 : containerRef.current.offsetTop
          const relativeScroll = scrollTop - containerTop

          // Find the first cached item whose bottom is below the current scroll position
          for (const pos of cache.positions) {
            if (pos.y + pos.height > relativeScroll) {
              scrollAnchorRef.current = {
                anchorItemId: pos.item.id,
                anchorOffsetFromViewport: pos.y - relativeScroll,
                needsRestore: true,
              }
              break
            }
          }
        }
      }

      columnHeights = new Array(columnCount).fill(0)
      positions = []
      columns = Array.from({ length: columnCount }, () => [] as PositionEntry[])

      for (let i = 0; i < items.length; i++) {
        positions.push(layoutItem(items[i], i, columnHeights, columns))
      }
    }

    const totalHeight = columnHeights.length > 0 ? Math.max(...columnHeights) : 0

    // Update cache for next render
    cache.positions = positions
    cache.columns = columns
    cache.columnHeights = columnHeights
    cache.columnCount = columnCount
    cache.columnWidth = columnWidth
    cache.itemIds = items.map(item => item.id)
    cache.containerWidth = debouncedContainerWidth
    cache.scale = scale
    cache.gap = gap
    cache.forceColumns = forceColumns
    cache.footerHeightOverride = footerHeightOverride
    cache.totalHeight = totalHeight

    return { positions, columns, totalHeight }
  }, [items, debouncedContainerWidth, scale, gap, isMobile, forceColumns, footerHeightOverride, scrollContainerRef])

  // Scroll anchoring: restore scroll position after a full recompute.
  // useLayoutEffect runs synchronously before the browser paints, so the
  // user never sees the jump.
  React.useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current
    if (!anchor.needsRestore || anchor.anchorItemId === null || !containerRef.current) {
      return
    }
    anchor.needsRestore = false

    // Find the anchor item's new position after recompute
    const newPos = layout.positions.find(pos => pos.item.id === anchor.anchorItemId)
    if (!newPos) return

    const scrollEl = scrollContainerRef?.current ?? null
    if (scrollEl) {
      // Internal scroll container: offset is relative to the element itself
      const targetScroll = newPos.y - anchor.anchorOffsetFromViewport
      if (Math.abs(scrollEl.scrollTop - targetScroll) > 2) {
        scrollEl.scrollTop = targetScroll
      }
    } else {
      const containerTop = containerRef.current.offsetTop
      const targetScroll = containerTop + newPos.y - anchor.anchorOffsetFromViewport
      if (Math.abs(window.scrollY - targetScroll) > 2) {
        window.scrollTo({ top: targetScroll, behavior: 'instant' as ScrollBehavior })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout])

  // Consume `prevPositionsByIdRef` after this render's MasonryItems have had
  // a chance to read it as `fromPos` and kick off their FLIP (their own
  // useLayoutEffect runs before this one, since child effects flush before
  // parent effects). Clearing it here means a LATER render — one where
  // `layout` didn't change again — won't keep re-triggering the same FLIP.
  useEffect(() => {
    prevPositionsByIdRef.current = null
  }, [layout])

  // Virtualización: solo renderizar ítems en viewport + overscan.
  // Antes se filtraba O(n) sobre TODAS las posiciones en cada bucket de scroll.
  // Ahora se aprovecha que dentro de cada columna los items están en orden
  // ascendente de `y` y NO se solapan, por lo que tanto `y` como `y + height`
  // son monótonos crecientes. Esto permite un binary search por columna para
  // encontrar el primer item visible, y luego iterar hasta salir del viewport.
  // Coste: O(C·log n + V) en lugar de O(n) por scroll (C = nº columnas,
  // V = items visibles). Depende de `layout` para recalcular al cambiar layout.
  const visibleItems = useMemo(() => {
    if (!containerRef.current || layout.positions.length === 0) return layout.positions

    const scrollTop = scrollTopRef.current
    // For internal scroll containers, the container itself is the scroll root,
    // so containerTop is always 0 (positions are relative to the scroll container).
    const containerTop = scrollContainerRef?.current ? 0 : containerRef.current.offsetTop
    const overscan = isMobile ? OVERSCAN_MOBILE : OVERSCAN_DESKTOP
    const renderTop = Math.max(0, scrollTop - containerTop - overscan)
    const renderBottom = scrollTop - containerTop + windowHeight + overscan

    const result: PositionEntry[] = []
    for (const col of layout.columns) {
      // Binary search: primer índice cuyo borde inferior (y + height) supera renderTop.
      // (y + height) es monótono creciente dentro de la columna.
      let lo = 0
      let hi = col.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (col[mid].y + col[mid].height > renderTop) hi = mid
        else lo = mid + 1
      }
      // Iterar hacia adelante mientras el item empiece antes del fondo del viewport.
      for (let i = lo; i < col.length; i++) {
        const pos = col[i]
        if (pos.y >= renderBottom) break
        result.push(pos)
      }
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.columns, scrollBucket, windowHeight, isMobile])

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ height: layout.totalHeight }}
      role="list"
      aria-label={`${items.length} results`}
    >
      {visibleItems.map((pos) => (
        <MasonryItem
          key={`${(pos.item as any)._provider || (pos.item as any).provider || "post"}-${pos.item.id}`}
          pos={pos}
          renderItem={renderItem}
          isInitial={showInitialAnimation || (newItemAnimIds !== null && newItemAnimIds.has(pos.item.id))}
          fromPos={prevPositionsByIdRef.current?.get(pos.item.id) ?? null}
        />
      ))}
    </div>
  )
}
