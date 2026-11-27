"use client"

import { createContext, useContext } from "react"

/**
 * True while a layer over the gallery (the pack builder) has it paused: still on screen behind the
 * layer, but inert, not scrolling and doing no work of its own. Parts of the gallery that run on a
 * timer read it and stop until the layer closes. Changes only when the layer opens or closes.
 */
export const GalleryPausedContext = createContext(false)

export function useGalleryPaused(): boolean {
  return useContext(GalleryPausedContext)
}
