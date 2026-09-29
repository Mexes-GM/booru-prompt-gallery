import type { Metadata } from "next"
import type React from "react"

export const metadata: Metadata = {
  title: "Booru Prompt Gallery - Pocket Extension",
  description: "A pocket version of Booru Prompt Gallery optimized for browser sidebars.",
}

/**
 * The root layout's theme bootstrap (lib/theme/theme-bootstrap.ts) already
 * applies the resolved theme before paint; this adds the `extension-mode`
 * class up front too, so the pocket UI inside the sidebar iframe opens with
 * its compact layout instead of flashing the full one.
 */
const extensionModeBootstrap = `(function () {
  try {
    document.documentElement.classList.add("extension-mode");
  } catch (e) {}
})();`

export default function ExtensionLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: extensionModeBootstrap }} />
      {children}
    </>
  )
}
