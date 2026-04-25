"use client"

import { Button } from '@/components/ui/button'
import { AlertTriangle, Home } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Link from 'next/link'

export default function AuthCodeErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold">Authentication Error</h1>
        </div>

        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            The authentication link may have expired or already been used. Please try signing in again.
          </AlertDescription>
        </Alert>

        <div className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link href="/">
              <Home className="h-4 w-4 mr-2" />
              Go to Home
            </Link>
          </Button>
        </div>

        <div className="text-center text-sm text-muted-foreground">
          <p>If this problem persists, please use the feedback button to report it.</p>
        </div>
      </div>
    </div>
  )
}
