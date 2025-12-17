
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar" // I'll need to create this or use a simple div
import { Separator } from "@/components/ui/separator"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"

import { checkAdminAuth } from "@/app/actions/auth"
import AdminLoginPage from "./login/page"
import { LogoutButton } from "@/components/admin-logout-button"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const isAuthenticated = await checkAdminAuth()

  if (!isAuthenticated) {
    return <AdminLoginPage />
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4 justify-between">
        <div className="flex items-center gap-2">
          <h1 className="font-semibold text-lg">Booru Gallery Admin</h1>
          <Separator orientation="vertical" className="mr-2 h-4" />
          <nav className="flex items-center gap-4 text-sm font-medium">
              <a href="/admin/suggestions" className="transition-colors hover:text-foreground/80 text-foreground">Suggestions</a>
              <a href="/" className="transition-colors hover:text-foreground/80 text-foreground/60">Back to App</a>
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
