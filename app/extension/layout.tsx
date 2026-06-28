import type { Metadata } from "next"
import type React from "react"

export const metadata: Metadata = {
  title: "Booru Prompt Gallery - Pocket Extension",
  description: "A pocket version of Booru Prompt Gallery optimized for browser sidebars.",
}

/**
 * Anti-flash theme bootstrap. The shared ThemeProvider only mounts next-themes
 * AFTER hydration (it returns bare children until `mounted`), so the initial
 * HTML carries no theme class and would paint LIGHT for a frame on dark setups.
 * Inside a sidebar iframe this flash is especially jarring. This blocking inline
 * script runs during body parse — before the React app paints — and applies the
 * resolved theme (reading next-themes' "theme" key) plus the `extension-mode`
 * class up front, so the pocket UI opens already in the correct theme.
 */
const themeBootstrap = `(function () {
  try {
    var root = document.documentElement;
    root.classList.add("extension-mode");
    var stored = localStorage.getItem("theme") || "system";
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var isDark = stored === "dark" || (stored !== "light" && prefersDark);
    if (isDark) root.classList.add("dark");
    else root.classList.remove("dark");
  } catch (e) {}
})();`

export default function ExtensionLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      {children}
    </>
  )
}
