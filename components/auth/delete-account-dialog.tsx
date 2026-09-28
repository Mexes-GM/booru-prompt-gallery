"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { toastError } from "@/lib/toast-error"
import { deleteAccount } from "@/app/actions/account"
import { clearCloudSyncedPreferences } from "@/hooks/use-preferences-sync"

const CONFIRM_WORD = "DELETE"

export function DeleteAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [confirmText, setConfirmText] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (isDeleting) return
    if (!next) setConfirmText("")
    onOpenChange(next)
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    const result = await deleteAccount()
    if (!result.success) {
      setIsDeleting(false)
      toastError({
        title: "Delete failed",
        description: result.message ?? "Could not delete your account.",
        errorSource: "account_delete",
      })
      return
    }
    // The server already removed the user; drop the now-dead local session
    // and this account's cached settings, then start fresh.
    await createClient().auth.signOut({ scope: "local" }).catch(() => {})
    clearCloudSyncedPreferences()
    window.location.assign("/")
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes your account, favorites, folders, saved artists and synced
            settings. It can&apos;t be undone. Consider using &ldquo;Export my data&rdquo; first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="delete-confirm">
            Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
          </Label>
          <Input
            id="delete-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
            disabled={isDeleting}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={confirmText !== CONFIRM_WORD || isDeleting}
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete account"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
