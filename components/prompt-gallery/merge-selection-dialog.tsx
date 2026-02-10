import { useState, useEffect, useMemo } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { BooruPost } from '@/lib/booru/types'
import { TagCategory, classifyTags } from '@/lib/tag-classifier'
import Image from 'next/image'

interface MergeSelectionDialogProps {
    post: BooruPost | null
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: (post: BooruPost, parts: Set<TagCategory>) => void
    initialSelection?: Set<TagCategory>
}

export function MergeSelectionDialog({
    post,
    open,
    onOpenChange,
    onConfirm,
    initialSelection
}: MergeSelectionDialogProps) {
    const [selectedParts, setSelectedParts] = useState<Set<TagCategory>>(new Set())

    // Reset or load initial selection when post changes
    useEffect(() => {
        if (open && post) {
            if (initialSelection) {
                setSelectedParts(new Set(initialSelection))
            } else {
                setSelectedParts(new Set())
            }
        }
    }, [open, post, initialSelection])

    const classifiedTags = useMemo(() => {
        if (!post) return null
        const tags = post.tag_string.split(' ').filter(Boolean)
        return classifyTags(tags)
    }, [post])

    if (!post || !classifiedTags) return null

    const categories: { id: TagCategory; label: string; icon: string }[] = [
        { id: 'appearance', label: 'Appearance', icon: '👤' },
        { id: 'clothing', label: 'Attire', icon: '👕' },
        { id: 'pose', label: 'Pose', icon: '💃' },
        { id: 'scenery', label: 'Scene', icon: '🌄' },
        { id: 'other', label: 'Other', icon: '📦' },
    ]

    const togglePart = (part: TagCategory) => {
        setSelectedParts(prev => {
            const next = new Set(prev)
            if (next.has(part)) {
                next.delete(part)
            } else {
                next.add(part)
            }
            return next
        })
    }

    const handleConfirm = () => {
        onConfirm(post, selectedParts)
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Merge Prompt Selection</DialogTitle>
                    <DialogDescription>
                        Select which parts of this image you want to include in your merged prompt.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 py-4 flex-1 overflow-hidden">
                    {/* Thumbnail */}
                    <div className="relative aspect-[2/3] w-full md:w-full rounded-md overflow-hidden bg-muted border">
                        <Image
                            src={post.preview_file_url || post.file_url}
                            alt="Post thumbnail"
                            fill
                            className="object-cover"
                            unoptimized // External URLs
                        />
                    </div>

                    {/* Selection List */}
                    <div className="space-y-4 overflow-y-auto pr-2">
                        {categories.map(category => {
                            const count = classifiedTags[category.id].length
                            if (count === 0) return null

                            return (
                                <div key={category.id} className="border rounded-md p-3 space-y-2">
                                    <div className="flex items-center space-x-2">
                                        <Checkbox
                                            id={`category-${category.id}`}
                                            checked={selectedParts.has(category.id)}
                                            onCheckedChange={() => togglePart(category.id)}
                                        />
                                        <Label htmlFor={`category-${category.id}`} className="flex-1 font-medium cursor-pointer flex items-center">
                                            <span className="mr-2 text-lg">{category.icon}</span>
                                            {category.label}
                                            <Badge variant="secondary" className="ml-2 text-xs">
                                                {count} tags
                                            </Badge>
                                        </Label>
                                    </div>

                                    {selectedParts.has(category.id) && (
                                        <div className="pl-8 text-xs text-muted-foreground leading-relaxed">
                                            {classifiedTags[category.id].slice(0, 10).join(', ')}
                                            {count > 10 && ` +${count - 10} more`}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleConfirm}>Confirm Selection</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
