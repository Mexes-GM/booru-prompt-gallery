'use client'

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Sparkles } from "lucide-react"
import { generateAutoSuggestions } from "@/app/actions/auto-suggestions"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

export function AutoSuggestButton() {
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    const handleGenerate = async () => {
        setLoading(true)
        try {
            toast.info("Mining new tags from Danbooru randomly...")
            const result = await generateAutoSuggestions()
            
            if (result.success) {
                toast.success(`Generated ${result.count} new suggestions!`)
                router.refresh()
            } else {
                toast.error(`Error: ${result.error}`)
            }
        } catch (e) {
            toast.error("Failed to generate suggestions")
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
