"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { GraduationCap, GripVertical, Check, Layers, BrainCircuit } from "lucide-react"

export function TeachWelcomeModal({ triggerOpen }: { triggerOpen?: boolean }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (triggerOpen) {
      setOpen(true)
    }
  }, [triggerOpen])

  useEffect(() => {
    // Check if the user has already seen the welcome modal
    const hasSeenWelcome = localStorage.getItem("hasSeenTeachWelcome")
    if (!hasSeenWelcome) {
      setOpen(true)
    }
  }, [])

  const handleClose = () => {
    setOpen(false)
    localStorage.setItem("hasSeenTeachWelcome", "true")
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-primary/10 rounded-full">
              <BrainCircuit className="h-6 w-6 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-2xl">Introducing the Category Tag Ecosystem</DialogTitle>
              <DialogDescription className="text-base pt-1">
                A new way to organize tags and contribute to the community.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-8 py-6">
          
          {/* Feature 1: Copy by Category */}
          <div className="grid grid-cols-[48px_1fr] gap-4">
            <div className="mt-1 bg-blue-500/10 h-12 w-12 rounded-xl flex items-center justify-center">
              <Layers className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="space-y-2">
              <h4 className="text-base font-semibold">Copy by Category</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Need only the outfit or the pose? You can now copy specific parts of a prompt! Click the arrow next to the "Copy" button to select exactly what you need: 
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-muted/50 border rounded-md text-xs font-medium text-foreground">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span> Appearance
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-muted/50 border rounded-md text-xs font-medium text-foreground">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span> Clothing
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-muted/50 border rounded-md text-xs font-medium text-foreground">
                  <span className="w-2 h-2 rounded-full bg-purple-500"></span> Pose
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-muted/50 border rounded-md text-xs font-medium text-foreground">
                  <span className="w-2 h-2 rounded-full bg-orange-500"></span> Scenery
                </span>
              </div>
            </div>
          </div>

          {/* Feature 2: Teach System */}
          <div className="grid grid-cols-[48px_1fr] gap-4">
            <div className="mt-1 bg-purple-500/10 h-12 w-12 rounded-xl flex items-center justify-center">
              <GraduationCap className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="space-y-2">
              <h4 className="text-base font-semibold">Teach & Contribute</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Our classification system learns from you! If you see tags in <span className="font-medium text-foreground">Unclassified</span> or in the wrong category, open the <span className="font-medium text-foreground">Teach</span> panel. 
                Simply drag and drop tags to their correct home. Your suggestions help improve the auto-classification for everyone.
              </p>
            </div>
          </div>

          {/* Feature 3: Community Consensus */}
          <div className="grid grid-cols-[48px_1fr] gap-4">
            <div className="mt-1 bg-orange-500/10 h-12 w-12 rounded-xl flex items-center justify-center">
              <GripVertical className="h-6 w-6 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="space-y-2">
              <h4 className="text-base font-semibold">Community Consensus</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Collaborate with other users! In the Teach modal, tags with colored borders indicate suggestions pending approval.
              </p>
              <div className="flex gap-2 pt-1">
                 <div className="text-[10px] px-2 py-1 rounded border border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300">
                    Suggested: Appearance
                 </div>
                 <div className="text-[10px] px-2 py-1 rounded border border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300">
                    Suggested: Clothing
                 </div>
              </div>
            </div>
          </div>

          {/* Feature 4: Future Vision */}
          <div className="grid grid-cols-[48px_1fr] gap-4 bg-muted/30 p-4 rounded-xl border border-dashed">
            <div className="mt-1 h-12 w-12 rounded-xl flex items-center justify-center">
              <span className="text-2xl">🚀</span>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your contributions help categorize tags to streamline the workflow. Additionally, once the database is robust enough, it will be published to help the community, enabling its use in projects like prompt creators.
              </p>
            </div>
          </div>

        </div>

        <DialogFooter className="sm:justify-end gap-2">
          <Button onClick={handleClose} className="w-full sm:w-auto min-w-[120px]">
            <Check className="mr-2 h-4 w-4" /> Got it!
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
