"use client"

import dynamic from "next/dynamic"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { ClassifiedTags } from "@/lib/tag-classifier"

const TeachModal = dynamic(() => import("@/components/teach-modal").then(m => m.TeachModal), { ssr: false, loading: () => null })
const TeachWelcomeModal = dynamic(() => import("@/components/teach-welcome-modal").then(m => m.TeachWelcomeModal), { ssr: false, loading: () => null })
const ReversePromptParserModal = dynamic(() => import("@/components/prompt-gallery/reverse-prompt-parser-modal").then(m => m.ReversePromptParserModal), { ssr: false, loading: () => null })
const GlobalWeightsModal = dynamic(() => import("@/components/prompt-gallery/global-weights-modal").then(m => m.GlobalWeightsModal), { ssr: false, loading: () => null })

interface GalleryModalsProps {
  // Teach modal
  teachModalData: { open: boolean; tags: ClassifiedTags | null }
  setTeachModalData: React.Dispatch<React.SetStateAction<{ open: boolean; tags: ClassifiedTags | null }>>
  onTeachSuccess: () => void

  // Teach welcome modal
  showWelcomeModal: boolean
  setShowWelcomeModal: (open: boolean) => void

  // Global weights modal
  isGlobalWeightsModalOpen: boolean
  setIsGlobalWeightsModalOpen: (open: boolean) => void
  globalWeights: Record<string, number>
  onRemoveGlobalWeight: (tag: string) => void
  onClearGlobalWeights: () => void
  onGlobalWeightChange: (tag: string, weight: number) => void

  // Reverse prompt parser modal
  isReverseParserModalOpen: boolean
  setIsReverseParserModalOpen: (open: boolean) => void
  onImportRawPrompt: (prompt: string) => void

  // Folder delete confirmation
  folderToDelete: { id: string; name: string } | null
  setFolderToDelete: (folder: { id: string; name: string } | null) => void
  onConfirmDeleteFolder: () => void
}

/**
 * Groups all the "floating" modals/dialogs owned by PromptGallery that aren't
 * tied to a specific always-visible panel: the tag-teaching modal + its
 * one-time welcome modal, the global tag weights modal, the reverse prompt
 * parser modal, and the folder-delete confirmation dialog. Pure composition —
 * all state and handlers are owned by the caller and passed in explicitly.
 */
export function GalleryModals({
  teachModalData,
  setTeachModalData,
  onTeachSuccess,
  showWelcomeModal,
  setShowWelcomeModal,
  isGlobalWeightsModalOpen,
  setIsGlobalWeightsModalOpen,
  globalWeights,
  onRemoveGlobalWeight,
  onClearGlobalWeights,
  onGlobalWeightChange,
  isReverseParserModalOpen,
  setIsReverseParserModalOpen,
  onImportRawPrompt,
  folderToDelete,
  setFolderToDelete,
  onConfirmDeleteFolder,
}: GalleryModalsProps) {
  return (
    <>
      {teachModalData.tags && (
        <TeachModal
          open={teachModalData.open}
          onOpenChange={(open) => setTeachModalData(prev => ({ ...prev, open }))}
          initialClassifiedTags={teachModalData.tags}
          onSuccess={onTeachSuccess}
        />
      )}
      <TeachWelcomeModal triggerOpen={showWelcomeModal} onOpenChange={setShowWelcomeModal} />

      <GlobalWeightsModal
        open={isGlobalWeightsModalOpen}
        onOpenChange={setIsGlobalWeightsModalOpen}
        weights={globalWeights}
        onRemoveWeight={onRemoveGlobalWeight}
        onClearWeights={onClearGlobalWeights}
        onSaveWeight={onGlobalWeightChange}
      />

      <ReversePromptParserModal
        open={isReverseParserModalOpen}
        onOpenChange={setIsReverseParserModalOpen}
        onImport={onImportRawPrompt}
      />

      <AlertDialog open={!!folderToDelete} onOpenChange={(open) => !open && setFolderToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the folder &quot;{folderToDelete?.name}&quot;. Any favorited post within this folder will be moved back to the &quot;Uncategorized&quot; section if they are not part of any other folder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onConfirmDeleteFolder}
            >
              Delete Folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
