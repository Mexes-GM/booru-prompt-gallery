"use client"

/**
 * Bottom site footer: About / Privacy / Terms links and the copyright line.
 * Purely static — no props, no local state.
 */
export function GalleryFooter() {
  return (
    <footer className="mt-12 py-8 border-t border-border/40">
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 text-sm text-muted-foreground">
        <a href="/about" className="hover:text-primary transition-colors">About</a>
        <a href="/privacy" className="hover:text-primary transition-colors">Privacy Policy</a>
        <a href="/terms" className="hover:text-primary transition-colors">Terms of Service</a>
        <span>&copy; {new Date().getFullYear()} Booru Prompt Gallery</span>
      </div>
    </footer>
  )
}
