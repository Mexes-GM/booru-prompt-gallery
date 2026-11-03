import type React from "react"
import { MotionProvider } from "@/components/motion-provider"

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <MotionProvider>{children}</MotionProvider>
}
