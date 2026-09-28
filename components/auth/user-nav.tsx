"use client"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useState } from "react"
import { useUser } from "@/hooks/use-user"
import { LoginDialog } from "./login-dialog"
import { LogOut, User as UserIcon, Download, Trash2 } from "lucide-react"
import { toastError } from "@/lib/toast-error"
import { createClient } from "@/lib/supabase/client"
import { clearCloudSyncedPreferences } from "@/hooks/use-preferences-sync"
import { exportAccountData } from "@/app/actions/account"
import { DeleteAccountDialog } from "./delete-account-dialog"

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function UserNav() {
  const { user, loading } = useUser()
  const supabase = createClient()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  if (loading) {
    return <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
  }

  if (!user) {
    return (
      <LoginDialog>
        <Button variant="ghost" size="sm" className="gap-2 relative overflow-hidden group">
          <span className="absolute inset-0 bg-primary/10 translate-y-[100%] group-hover:translate-y-0 transition-transform duration-300" />
          <UserIcon className="h-4 w-4 text-muted-foreground group-hover:text-primary-text transition-colors" />
          <span className="hidden sm:inline font-medium text-muted-foreground group-hover:text-foreground transition-colors">Sign In</span>
        </Button>
      </LoginDialog>
    )
  }

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      // Don't leave this account's settings behind for whoever uses this
      // browser next (they'd see them, and the next sign-in would merge them).
      // A full reload resets every hook that already read them into state.
      clearCloudSyncedPreferences()
      window.location.assign("/")
    } catch (error) {
      console.error("Logout error:", error)
      toastError({
        title: "Sign out failed",
        description: "Could not sign out. Please try again.",
        errorSource: "user_logout",
      })
    }
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const result = await exportAccountData()
      if (!result.success) throw new Error(result.message)
      downloadJson(`booru-gallery-data-${new Date().toISOString().slice(0, 10)}.json`, result.data)
    } catch (error) {
      toastError({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Could not export your data.",
        errorSource: "account_export",
      })
    } finally {
      setIsExporting(false)
    }
  }

  const initials = user.email
    ? user.email.slice(0, 2).toUpperCase()
    : "U"

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-9 w-9 rounded-full ring-offset-background transition-all hover:ring-2 hover:ring-primary/20 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
          <Avatar className="h-9 w-9 border border-border/50">
            <AvatarImage src={user.user_metadata.avatar_url} alt={user.email || ""} />
            <AvatarFallback className="bg-primary/5 text-primary-text font-medium">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64 p-2" align="end" forceMount>
        <DropdownMenuLabel className="font-normal p-2">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user.user_metadata.full_name || "User"}</p>
            <p className="text-xs leading-none text-muted-foreground">
              {user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleExport} disabled={isExporting} className="cursor-pointer p-2">
          <Download className="mr-2 h-4 w-4" />
          <span>{isExporting ? "Preparing export…" : "Export my data"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="cursor-pointer p-2 text-destructive-text focus:bg-destructive/5 focus:text-destructive-text">
          <Trash2 className="mr-2 h-4 w-4" />
          <span>Delete account</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer p-2 text-destructive-text focus:bg-destructive/5 focus:text-destructive-text">
          <LogOut className="mr-2 h-4 w-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  )
}
