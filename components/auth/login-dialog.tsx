"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { Loader2, Mail, ArrowRight, CheckCircle2 } from "lucide-react"
import * as Sentry from "@sentry/nextjs"
import { toast } from "@/hooks/use-toast"
import { motion, AnimatePresence } from "framer-motion"
import Link from "next/link"

export function LoginDialog({ children }: { children?: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(false)
  const [email, setEmail] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const supabase = createClient()


  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setIsLoading(true)
      Sentry.addBreadcrumb({
        category: "auth",
        message: "User initiated magic link login",
        level: "info"
      })
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (error) throw error
      setIsSuccess(true)
    } catch (error) {
      const msg = error instanceof Error ? error.message : ""
      // The "For security purposes, you can only request this after N seconds"
      // rate-limit is an expected, user-facing condition — surface it via toast
      // but don't report it to Sentry (was a recurring non-actionable issue).
      const isExpectedRateLimit =
        /for security purposes|only request this after|rate limit|too many/i.test(msg)
      if (!isExpectedRateLimit) {
        Sentry.captureException(error, {
          tags: { context: "magic_link_login" }
        })
      }
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      })
      setIsLoading(false)
    }
  }

  const resetState = (open: boolean) => {
    setIsOpen(open)
    if (!open) {
      setTimeout(() => {
        setIsSuccess(false)
        setIsLoading(false)
        setEmail("")
      }, 300)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={resetState}>
      <DialogTrigger asChild>
        {children || <Button variant="outline">Sign In</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px] p-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl">
        <div className="p-6">
          <AnimatePresence mode="wait">
            {!isSuccess ? (
              <motion.div
                key="login-form"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                <DialogHeader>
                  <DialogTitle className="text-2xl font-bold tracking-tight text-center">Welcome!</DialogTitle>
                  <DialogDescription className="text-center">
                    Sign in to save favorites and preferences.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">

                  <form onSubmit={handleMagicLink} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email" className="sr-only">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="email"
                          type="email"
                          placeholder="name@example.com"
                          className="pl-9 h-11 bg-muted/30 border-border/50 focus:border-primary/50 focus:bg-background transition-all"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          disabled={isLoading}
                        />
                      </div>
                    </div>
                    <Button type="submit" disabled={isLoading} className="w-full h-11 font-medium group">
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          Send Magic Link
                          <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                        </>
                      )}
                    </Button>
                  </form>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="success-message"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center justify-center py-8 text-center space-y-4"
              >
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                  <CheckCircle2 className="h-8 w-8 text-primary" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-semibold">Check your email</h3>
                  <p className="text-sm text-muted-foreground max-w-[250px] mx-auto">
                    We&apos;ve sent a magic link to <span className="font-medium text-foreground">{email}</span>
                  </p>
                </div>
                <Button variant="outline" onClick={() => resetState(false)} className="mt-4">
                  Close
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="p-4 bg-muted/30 border-t border-border/50 text-center text-xs text-muted-foreground">
          By signing in, you agree to our <Link href="/terms" className="underline hover:text-primary" onClick={() => resetState(false)}>Terms of Service</Link> and <Link href="/privacy" className="underline hover:text-primary" onClick={() => resetState(false)}>Privacy Policy</Link>.
        </div>
      </DialogContent>
    </Dialog>
  )
}
