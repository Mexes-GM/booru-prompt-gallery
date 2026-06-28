"use client"

import { useState, useMemo, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Check, ChevronDown, Folder, Plus, Heart, Loader2, Star, Bookmark, Flame, Zap, Sparkles, Image as ImageIcon, Moon, Sun, Ghost, Cat, Dog, Gamepad2, Music, Camera, Palette, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FavoriteFolder } from "@/hooks/use-booru-favorites"

export const iconMap: Record<string, LucideIcon> = {
    Folder, Star, Heart, Bookmark, Flame, Zap, Sparkles, Image: ImageIcon, Moon, Sun, Ghost, Cat, Dog, Gamepad2, Music, Camera, Palette
}

export const renderIcon = (name?: string | null, props: Record<string, unknown> = {}) => {
    const Icon = iconMap[name || 'Folder'] || Folder
    return <Icon {...props} />
}

interface SaveFavoriteButtonProps {
    folders: FavoriteFolder[]
    selectedFolderIds?: string[]
    isFavorited: boolean
    onToggleFavorite: (folderId: string | null | undefined) => void
    onCreateFolder: (name: string, icon?: string | null) => Promise<FavoriteFolder | null>
    className?: string
}

export function SaveFavoriteButton({
    folders,
    selectedFolderIds = [],
    isFavorited,
    onToggleFavorite,
    onCreateFolder,
    className = ""
}: SaveFavoriteButtonProps) {
    const [open, setOpen] = useState(false)
    const [isCreating, setIsCreating] = useState(false)

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [newFolderName, setNewFolderName] = useState("")
    const [newFolderIcon, setNewFolderIcon] = useState<string>("Folder")

    const handleOpenCreateModal = (query: string) => {
        setNewFolderName(query)
        setOpen(false)
        setIsModalOpen(true)
    }

    const handleCreateFolderModal = async () => {
        if (!newFolderName.trim() || isCreating) return
        setIsCreating(true)
        const newFolder = await onCreateFolder(newFolderName, newFolderIcon)
        if (newFolder) {
            onToggleFavorite(newFolder.id)
            setIsModalOpen(false)
            setNewFolderName("")
            setNewFolderIcon("Folder")
        }
        setIsCreating(false)
    }

    const handleSelectFolder = (folderId: string | null) => {
        onToggleFavorite(folderId)
        // Multi-select behavior: we do not close the popover
    }

    return (
        <div className={`flex items-stretch shadow-sm rounded-full overflow-hidden ${className}`}>
            {/* Main Action Button */}
            <Button
                variant="secondary"
                className={`rounded-none rounded-l-full h-8 px-2.5 transition-all ${isFavorited
                    ? "bg-red-500 text-white hover:bg-red-600"
                    : "bg-background/80 hover:bg-background/95 backdrop-blur-md text-muted-foreground hover:text-foreground"
                    }`}
                onClick={(e) => {
                    e.stopPropagation()
                    onToggleFavorite(undefined)
                }}
            >
                <motion.div
                    whileHover={{ scale: 1.15 }}
                    whileTap={{ scale: 0.85 }}
                    animate={isFavorited ? {
                        scale: [1, 1.4, 1],
                        rotate: [0, -15, 15, -10, 0]
                    } : { scale: 1, rotate: 0 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                >
                    <Heart className={`h-4 w-4 ${isFavorited ? "fill-current" : ""}`} />
                </motion.div>
            </Button>

            {/* Board Selector */}
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="secondary"
                        className={`rounded-none rounded-r-full h-8 px-1.5 border-l transition-all flex items-center justify-center ${isFavorited
                            ? "bg-red-500 text-white hover:bg-red-600 border-red-600"
                            : "bg-background/80 hover:bg-background/95 backdrop-blur-md text-muted-foreground hover:text-foreground border-border/50"
                            }`}
                        onClick={(e) => {
                            e.stopPropagation()
                        }}
                    >
                        <motion.div
                            whileHover={{ y: 2 }}
                            whileTap={{ scale: 0.9 }}
                            transition={{ type: "spring", stiffness: 400, damping: 10 }}
                        >
                            <ChevronDown className="h-3 w-3" />
                        </motion.div>
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    className="w-56 p-0 rounded-xl shadow-xl overflow-hidden"
                    align="end"
                    sideOffset={8}
                    collisionPadding={8}
                    avoidCollisions={true}
                    hideWhenDetached={true}
                    onClick={(e) => e.stopPropagation()}
                >
                    <FolderPopoverContent
                        folders={folders}
                        selectedFolderIds={selectedFolderIds}
                        isFavorited={isFavorited}
                        onSelectFolder={handleSelectFolder}
                        onOpenCreateModal={handleOpenCreateModal}
                    />
                </PopoverContent>
            </Popover>

            {/* Create Folder Modal */}
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>Create Folder</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-5 py-4">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="folder-name">Name</Label>
                            <Input
                                id="folder-name"
                                placeholder="E.g. Cool Art, Reference..."
                                value={newFolderName}
                                onChange={e => setNewFolderName(e.target.value)}
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label>Choose an Icon</Label>
                            <div className="grid grid-cols-8 gap-2 mt-1">
                                {Object.keys(iconMap).map(iconName => {
                                    return (
                                        <motion.div
                                            key={iconName}
                                            whileHover={{ scale: 1.1 }}
                                            whileTap={{ scale: 0.9 }}
                                        >
                                            <Button
                                                variant={newFolderIcon === iconName ? "default" : "outline"}
                                                size="icon"
                                                className={`h-9 w-9 w-full ${newFolderIcon === iconName ? "bg-red-500 hover:bg-red-600 text-white border-none shadow-md" : ""}`}
                                                onClick={() => setNewFolderIcon(iconName)}
                                            >
                                                {renderIcon(iconName, { className: "h-4 w-4" })}
                                            </Button>
                                        </motion.div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            disabled={!newFolderName.trim() || isCreating}
                            onClick={handleCreateFolderModal}
                            className="bg-red-500 hover:bg-red-600 text-white"
                        >
                            {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Create
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function FolderPopoverContent({
    folders,
    selectedFolderIds,
    isFavorited,
    onSelectFolder,
    onOpenCreateModal
}: {
    folders: FavoriteFolder[]
    selectedFolderIds: string[]
    isFavorited: boolean
    onSelectFolder: (id: string | null) => void
    onOpenCreateModal: (query: string) => void
}) {
    const [searchQuery, setSearchQuery] = useState("")
    const [activeValue, setActiveValue] = useState("")

    return (
        <Command
            shouldFilter={true}
            value={activeValue}
            onValueChange={setActiveValue}
        >
            <CommandInput
                placeholder="Search folders..."
                value={searchQuery}
                onValueChange={setSearchQuery}
                className="border-none focus:ring-0 h-9 text-xs"
            />
            <CommandList
                className="max-h-[220px]"
                onMouseLeave={() => setActiveValue("clear-hover")}
            >
                <CommandEmpty className="px-2 py-3">
                    <p className="text-xs text-muted-foreground text-center">No folders found</p>
                </CommandEmpty>
                <CommandItem value="clear-hover" className="hidden" aria-hidden="true" />
                <CommandGroup heading="All Folders">
                    <CommandItem
                        value="Uncategorized"
                        onSelect={() => onSelectFolder(null)}
                        className={`flex items-center gap-2 cursor-pointer py-1.5 rounded-md m-0.5 transition-colors 
                                        ${selectedFolderIds.length === 0 && isFavorited ? "bg-primary/15 text-primary hover:bg-primary/25 data-[selected=true]:bg-primary/25" : "hover:bg-accent hover:text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"}
                                    `}
                    >
                        <div className={`w-6 h-6 rounded-md flex items-center justify-center ${selectedFolderIds.length === 0 && isFavorited ? "bg-primary/20" : "bg-muted"}`}>
                            <Folder className={`h-3 w-3 ${selectedFolderIds.length === 0 && isFavorited ? "text-primary" : "text-muted-foreground"}`} />
                        </div>
                        <span className="flex-1 font-medium text-xs">Uncategorized</span>
                        <AnimatePresence>
                            {selectedFolderIds.length === 0 && isFavorited && (
                                <motion.div
                                    initial={{ scale: 0, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0, opacity: 0 }}
                                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                >
                                    <Check className="h-3 w-3 text-primary" />
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </CommandItem>
                    {folders.map((folder) => {
                        const isSelected = selectedFolderIds.includes(folder.id) && isFavorited;
                        return (
                            <CommandItem
                                key={folder.id}
                                value={folder.name}
                                onSelect={() => onSelectFolder(folder.id)}
                                className={`flex items-center gap-2 cursor-pointer py-1.5 rounded-md m-0.5 transition-colors 
                                                ${isSelected ? "bg-primary/15 text-primary hover:bg-primary/25 data-[selected=true]:bg-primary/25" : "hover:bg-accent hover:text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"}
                                            `}
                            >
                                <div className={`w-6 h-6 rounded-md flex items-center justify-center ${isSelected ? "bg-primary/20" : "bg-muted"}`}>
                                    {renderIcon(folder.icon, { className: `h-3 w-3 ${isSelected ? "text-primary" : "text-muted-foreground"}` })}
                                </div>
                                <span className="flex-1 font-medium text-xs truncate">{folder.name}</span>
                                <AnimatePresence>
                                    {isSelected && (
                                        <motion.div
                                            initial={{ scale: 0, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            exit={{ scale: 0, opacity: 0 }}
                                            transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                        >
                                            <Check className="h-3 w-3 text-primary" />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </CommandItem>
                        );
                    })}
                </CommandGroup>
            </CommandList>
            <div className="p-1 border-t">
                <Button
                    size="sm"
                    variant="ghost"
                    className="w-full h-8 rounded-md justify-start flex items-center gap-2 text-xs font-semibold"
                    onClick={() => {
                        onOpenCreateModal(searchQuery) /* pre-fill */
                    }}
                >
                    <Plus className="h-3 w-3" />
                    Create folder
                </Button>
            </div>
        </Command>
    )
}
