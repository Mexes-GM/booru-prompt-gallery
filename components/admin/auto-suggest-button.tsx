'use client'

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Sparkles } from "lucide-react"
import { generateAutoSuggestions } from "@/app/actions/auto-suggestions"
import { toast } from "@/hooks/use-toast"
import { toastError } from "@/lib/toast-error"
import { useRouter } from "next/navigation"

export function AutoSuggestButton() {
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    const handleGenerate = async () => {
        setLoading(true)
        try {
            toast({ title: "Mining new tags from Danbooru randomly..." })
            const result = await generateAutoSuggestions()
            
            if (result.success) {
                toast({ title: `Generated ${result.count} new suggestions!` })
                router.refresh()
            } else {
                toastError({ title: "Error", description: String(result.error), errorSource: "admin_auto_suggest", reportable: false })
            }
        } catch (e) {
            toastError({ title: "Error", description: "Failed to generate suggestions", errorSource: "admin_auto_suggest", reportable: false })
        } finally {
            setLoading(false)
        }
    }

    return (
        <Button 
            onClick={handleGenerate} 
            disabled={loading}
            variant="secondary"
        >
            {loading ? (
                <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Mining Tags...
                </>
            ) : (
                <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Auto-Generate Proposals
                </>
            )}
        </Button>
    )
}
