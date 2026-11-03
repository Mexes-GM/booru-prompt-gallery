import { AppShell } from "@/components/prompt-gallery/app-shell"

/**
 * Route-level loading UI. Renders the same shell the gallery shows while its
 * bundle loads, so there is one loading layout instead of two.
 */
export default function Loading() {
  return <AppShell />
}
