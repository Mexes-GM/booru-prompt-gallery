"use client"

/**
 * A generated image at full size, over everything (the gallery and Pack): the
 * image fit to the window, with Download, Open in new tab and Close. Escape or
 * a click outside the image closes it, and focus goes back to the control that
 * opened it.
 *
 * Never a link to ComfyUI's own address, which refuses to open from another
 * site. The picture on screen is the same cross-origin <img> the thumbnail
 * already loaded; Download and Open in new tab use the file fetched in CORS
 * mode, as a same-origin blob that is released when the viewer closes.
 */
import { useEffect, useRef, useState, type RefObject } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { AlertCircle, Download, ExternalLink, Loader2, RotateCw, X } from "lucide-react"
import { comfyImageCache, imageFileName } from "@/lib/comfyui/image-view"
import { cn } from "@/lib/utils"
import { VIEWER_TEXT } from "./comfyui-image-viewer-text"

type FileState = { key: string; status: "ready"; objectUrl: string } | { key: string; status: "error" }

/** The image file as a same-origin blob URL while mounted; released on unmount. */
function useImageFile(url: string, attempt: number) {
  const key = `${url}#${attempt}`
  const [state, setState] = useState<FileState | null>(null)
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    comfyImageCache()
      .get(url)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setState({ key, status: "ready", objectUrl })
      })
      .catch(() => {
        if (!cancelled) setState({ key, status: "error" })
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url, key])
  return state && state.key === key ? state : ({ key, status: "loading" } as const)
}

const BAR_BUTTON =
  "relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-overlay/70 px-3 text-sm font-medium text-overlay-foreground " +
  "ring-1 ring-overlay-foreground/15 backdrop-blur-sm transition-[background-color,transform] duration-150 ease-out-strong " +
  "hover:bg-overlay/90 active:scale-[0.97] motion-reduce:active:scale-100 focus-ring pointer-coarse:h-11"

export interface ComfyImageViewerProps {
  /** ComfyUI's `/view` URL of the image. */
  url: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The control that opened it; focus goes back there on close. */
  returnFocusRef?: RefObject<HTMLElement | null>
}

export function ComfyImageViewer({ url, open, onOpenChange, returnFocusRef }: ComfyImageViewerProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-overlay/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[60] flex flex-col outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98] duration-200 ease-out-strong motion-reduce:animate-none"
          onCloseAutoFocus={(e) => {
            const back = returnFocusRef?.current
            if (back?.isConnected) {
              e.preventDefault()
              back.focus({ preventScroll: true })
            }
          }}
        >
          <DialogPrimitive.Title className="sr-only">{VIEWER_TEXT.title}</DialogPrimitive.Title>
          {/* Content mounts only while open (and while it fades out), so the file is fetched then. */}
          <ViewerBody url={url} onClose={() => onOpenChange(false)} />

        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function ViewerBody({ url, onClose }: { url: string; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0)
  const [failedImage, setFailedImage] = useState<number | null>(null)
  const file = useImageFile(url, attempt)
  const imageFailed = failedImage === attempt
  const name = imageFileName(url)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])

  const retry = () => setAttempt((n) => n + 1)
  const ready = file.status === "ready" ? file.objectUrl : null
  const fileFailed = file.status === "error"

  // A click on the backdrop (anything but the image and the bar's controls) closes.
  const pressedBackdrop = useRef(false)
  const isBackdrop = (target: EventTarget) => target instanceof Element && !target.closest("img, a, button, [data-viewer-keep]")

  return (
    <div
      role="presentation"
      className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      // React passes events up through the portal: the card or row under the viewer must not get them.
      onPointerDown={(e) => {
        e.stopPropagation()
        pressedBackdrop.current = isBackdrop(e.target)
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (pressedBackdrop.current && isBackdrop(e.target)) onClose()
        pressedBackdrop.current = false
      }}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {fileFailed && !imageFailed && (
          <p data-viewer-keep className="mr-auto flex items-center gap-1.5 rounded-full bg-overlay/70 py-1.5 pl-3 pr-1.5 text-sm text-overlay-foreground ring-1 ring-overlay-foreground/15 backdrop-blur-sm" role="alert">
            <AlertCircle aria-hidden className="size-4 shrink-0 text-destructive" />
            <span className="min-w-0">{VIEWER_TEXT.fileFailed}</span>
            <button type="button" onClick={retry} className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-medium underline-offset-2 hover:bg-overlay-foreground/10 focus-ring pointer-coarse:h-9">
              <RotateCw aria-hidden className="size-3.5" />
              {VIEWER_TEXT.retry}
            </button>
          </p>
        )}
        <FileAction href={ready} download={name} busy={file.status === "loading"} icon={<Download aria-hidden className="size-4" />}>
          {VIEWER_TEXT.download}
        </FileAction>
        <FileAction href={ready} newTab busy={file.status === "loading"} icon={<ExternalLink aria-hidden className="size-4" />}>
          <span className="max-sm:sr-only">{VIEWER_TEXT.newTab}</span>
        </FileAction>
        <DialogPrimitive.Close ref={closeRef} aria-label={VIEWER_TEXT.close} title={VIEWER_TEXT.close} className={cn(BAR_BUTTON, "w-9 justify-center px-0 pointer-coarse:w-11")}>
          <X aria-hidden className="size-4" />
        </DialogPrimitive.Close>
      </div>

      <div className="relative grid min-h-0 flex-1 place-items-center">
        {imageFailed ? (
          <div data-viewer-keep role="alert" className="flex max-w-sm flex-col items-center gap-3 rounded-xl bg-overlay/70 p-5 text-center text-sm text-overlay-foreground ring-1 ring-overlay-foreground/15">
            <AlertCircle aria-hidden className="size-5 text-destructive" />
            <p className="text-pretty">{VIEWER_TEXT.imageFailed}</p>
            <button type="button" onClick={retry} className={BAR_BUTTON}>
              <RotateCw aria-hidden className="size-4" />
              {VIEWER_TEXT.retry}
            </button>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a local ComfyUI image
          <img
            key={attempt}
            src={url}
            crossOrigin="anonymous"
            alt={VIEWER_TEXT.title}
            onError={() => setFailedImage(attempt)}
            className="absolute inset-0 m-auto max-h-full max-w-full rounded-md object-contain shadow-[0_12px_40px_-8px_rgb(0_0_0/0.5)]"
          />
        )}
      </div>
    </div>
  )
}

/** Download or Open in new tab: a link to the blob once it is in, a disabled button before. */
function FileAction({
  href,
  download,
  newTab,
  busy,
  icon,
  children,
}: {
  href: string | null
  download?: string
  newTab?: boolean
  busy: boolean
  icon: React.ReactNode
  children: React.ReactNode
}) {
  const label = newTab ? VIEWER_TEXT.newTab : VIEWER_TEXT.download
  if (!href) {
    return (
      <button type="button" disabled aria-label={label} aria-busy={busy || undefined} className={cn(BAR_BUTTON, "disabled:pointer-events-none disabled:opacity-50")}>
        {busy ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : icon}
        {children}
      </button>
    )
  }
  return (
    <a
      href={href}
      download={download}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener" : undefined}
      aria-label={label}
      title={label}
      className={BAR_BUTTON}
    >
      {icon}
      {children}
    </a>
  )
}
