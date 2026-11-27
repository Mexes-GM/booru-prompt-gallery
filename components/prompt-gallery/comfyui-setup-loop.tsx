"use client"

/**
 * Short muted loops of where to click in ComfyUI, for the setup guide's
 * install and publish steps (made with the site's feature videos, in video/).
 * Decorative: the steps next to them say the same. They load only when their
 * step is on screen; with reduced motion they stay on their first-look poster.
 */
import { useReducedMotion } from "framer-motion"
import { cn } from "@/lib/utils"

export function SetupLoop({ name, className }: { name: "install" | "publish"; className?: string }) {
  const reduced = useReducedMotion()
  const src = `/comfyui-setup/${name}`
  return (
    <div aria-hidden className={cn("pointer-events-none select-none overflow-hidden rounded-xl border border-border/70 bg-muted/30", className)}>
      {reduced ? (
        // eslint-disable-next-line @next/next/no-img-element -- a static poster from public/, no optimization needed
        <img src={`${src}.jpg`} alt="" width={960} height={480} className="block aspect-[2/1] w-full" />
      ) : (
        <video
          className="block aspect-[2/1] w-full"
          poster={`${src}.jpg`}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          disablePictureInPicture
          disableRemotePlayback
        >
          <source src={`${src}.webm`} type="video/webm" />
          <source src={`${src}.mp4`} type="video/mp4" />
        </video>
      )}
    </div>
  )
}
