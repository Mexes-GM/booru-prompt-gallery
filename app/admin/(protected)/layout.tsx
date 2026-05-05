import { Separator } from "@/components/ui/separator"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

import { LogoutButton } from "@/components/admin-logout-button"
import Link from "next/link"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    // Should be handled by middleware, but safe fallback
    return redirect('/admin/login')
  }

  // Double check role for safety
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
     return redirect('/')
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4 justify-between">
        <div className="flex items-center gap-2">
          <h1 className="font-semibold text-lg">Booru Gallery Admin</h1>
          <Separator orientation="vertical" className="mr-2 h-4" />
          <nav className="flex items-center gap-4 text-sm font-medium">
              <Link href="/admin/suggestions" className="transition-colors hover:text-foreground/80 text-foreground">Suggestions</Link>
              <Link href="/admin/logs" className="transition-colors hover:text-foreground/80 text-foreground">AI Logs</Link>
              <Link href="/" className="transition-colors hover:text-foreground/80 text-foreground/60">Back to App</Link>
          </nav>
        </div>
        <LogoutButton />
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        {children}
      </div>
    </div>
  )
}
