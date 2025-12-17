'use client'

import { logoutAdmin } from '@/app/actions/auth'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'

export function LogoutButton() {
  const router = useRouter()

  const handleLogout = async () => {
    await logoutAdmin()
    router.refresh()
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground">
      <LogOut className="mr-2 h-4 w-4" />
      Logout
    </Button>
  )
}
