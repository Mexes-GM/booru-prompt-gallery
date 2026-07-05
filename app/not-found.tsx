import Link from "next/link"
import type { Metadata } from "next"
import { Home, Search } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "Page Not Found",
  description: "The page you are looking for does not exist. Return to Booru Prompt Gallery to browse and clean AI art prompts.",
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return (
    <main className="container mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center px-4 py-8">
      <Card className="glass-effect w-full text-center">
        <CardHeader>
          <p className="text-6xl font-bold tracking-tight text-primary" aria-hidden="true">
            404
          </p>
          <CardTitle className="mt-2 text-2xl">Page not found</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-muted-foreground">
            The page you&apos;re looking for doesn&apos;t exist or may have been moved.
            Let&apos;s get you back to generating prompts.
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild>
              <Link href="/">
                <Home />
                Back to gallery
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/about">
                <Search />
                Learn what this does
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
