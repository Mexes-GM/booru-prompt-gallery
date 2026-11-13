import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PackKitPreview } from "./preview"

export const metadata: Metadata = {
  title: "Pack kit",
  robots: { index: false, follow: false },
}

// Vista previa de los componentes de components/prompt-gallery/pack. Solo en desarrollo.
export default function PackKitPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <PackKitPreview />
}
