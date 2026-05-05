'use client'

import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from '@/hooks/use-toast'

export function LogoutButton() {
  const router = useRouter()
  const supabase = createClient()

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      toast({
        title: "Signed out",
        description: "You have been successfully signed out.",
      })
      router.refresh()
      router.push('/admin/login')
    } catch (error) {
      console.error("Logout error:", error)
      toast({
        title: "Sign out failed",
        description: "Could not sign out. Please try again.",
        variant: "destructive",
      })
    }
  }

  return (
    <Button 
      variant="ghost" 
      size="sm" 
      onClick={handleLogout} 
      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors gap-2"
    >
      <LogOut className="h-4 w-4" />
      Logout
    </Button>
  )
}
