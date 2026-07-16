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
import { useRouter } from "next/navigation"
import { useUser } from "@/hooks/use-user"
import { LoginDialog } from "./login-dialog"
import { LogOut, User as UserIcon, RefreshCw } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { toastError } from "@/lib/toast-error"
import { motion } from "framer-motion"
import { createClient } from "@/lib/supabase/client"

export function UserNav() {
  const { user, loading } = useUser()
  const router = useRouter()
  const supabase = createClient()

  if (loading) {
    return <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
  }

  if (!user) {
    return (
      <LoginDialog>
        <Button variant="ghost" size="sm" className="gap-2 relative overflow-hidden group">
          <span className="absolute inset-0 bg-primary/10 translate-y-[100%] group-hover:translate-y-0 transition-transform duration-300" />
          <UserIcon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
          <span className="hidden sm:inline font-medium text-muted-foreground group-hover:text-foreground transition-colors">Sign In</span>
        </Button>
      </LoginDialog>
    )
  }

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      toast({
        title: "Signed out",
        description: "You have been successfully signed out.",
      })
      router.refresh()
    } catch (error) {
      console.error("Logout error:", error)
      toastError({
        title: "Sign out failed",
        description: "Could not sign out. Please try again.",
        errorSource: "user_logout",
      })
    }
  }

  const initials = user.email
    ? user.email.slice(0, 2).toUpperCase()
    : "U"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-9 w-9 rounded-full ring-offset-background transition-all hover:ring-2 hover:ring-primary/20 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
          <Avatar className="h-9 w-9 border border-border/50">
            <AvatarImage src={user.user_metadata.avatar_url} alt={user.email || ""} />
            <AvatarFallback className="bg-primary/5 text-primary font-medium">{initials}</AvatarFallback>
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

        <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer p-2 text-destructive focus:bg-destructive/5 focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
