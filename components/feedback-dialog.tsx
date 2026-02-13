
"use client"

import { useState, memo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
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
import { Textarea } from "@/components/ui/textarea"
import {
    Bug,
    Lightbulb,
    MessageSquare,
    Loader2,
    Check,
    Sparkles,
    Send,
    MessageSquarePlus
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { usePathname } from "next/navigation"

// --- Animation Variants ---
const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1,
            delayChildren: 0.2,
        },
    },
    exit: {
        opacity: 0,
        transition: { duration: 0.2 }
    }
}

const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { type: "spring", stiffness: 400, damping: 20 }
    },
}

// --- Success Animation Component ---
const SuccessAnimation = memo(function SuccessAnimation() {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="relative h-full min-h-[400px] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm p-6 text-center"
        >
            <div className="relative mb-6">
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
                    className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center"
                >
                    <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.2 }}
                        className="w-14 h-14 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/30"
                    >
                        <Check className="w-8 h-8 text-primary-foreground stroke-[3]" />
                    </motion.div>
                </motion.div>

                {/* Decorative particles */}
                {[...Array(6)].map((_, i) => (
                    <motion.div
                        key={i}
                        initial={{ opacity: 1, scale: 0, x: 0, y: 0 }}
                        animate={{
                            opacity: 0,
                            scale: 1,
                            x: Math.cos(i * 60 * (Math.PI / 180)) * 60,
                            y: Math.sin(i * 60 * (Math.PI / 180)) * 60
                        }}
                        transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
                        className="absolute top-1/2 left-1/2 w-2 h-2 bg-primary rounded-full -translate-x-1/2 -translate-y-1/2"
                    />
                ))}
            </div>

            <motion.h3
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-2xl font-bold tracking-tight mb-2"
            >
                Thank You!
            </motion.h3>
            <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-muted-foreground max-w-[260px]"
            >
                Your feedback helps us improve. We appreciate your input.
            </motion.p>
        </motion.div>
    )
})

export function FeedbackDialog() {
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [success, setSuccess] = useState(false)
    const [type, setType] = useState<string>("bug")
    const [content, setContent] = useState("")
    const [contact, setContact] = useState("")
    const { toast } = useToast()
    const pathname = usePathname()

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!content.trim()) return

        setLoading(true)
        try {
            const response = await fetch("/api/feedback", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    type,
                    content,
                    contact_info: contact,
                    honeypot: "",
                    metadata: {
                        user_agent: navigator.userAgent,
                        pathname: pathname,
                        screen_size: `${window.innerWidth}x${window.innerHeight}`,
                    },
                }),
            })

            if (!response.ok) {
                const data = await response.json()
                throw new Error(data.message || "Failed to submit")
            }

            setSuccess(true)

            setTimeout(() => {
                setOpen(false)
                setTimeout(() => {
                    setSuccess(false)
                    setContent("")
                    setContact("")
                    setType("bug")
                }, 300)
            }, 2500)

        } catch (error) {
            toast({
                title: "Error",
                description: "Could not send feedback. Please try again.",
                variant: "destructive",
            })
        } finally {
            setLoading(false)
        }
    }

    const feedbackTypes = [
        { id: "bug", label: "Bug Report", icon: Bug, color: "text-red-500", bg: "bg-red-500/10", borderColor: "#ef4444" },
        { id: "feature", label: "Feature", icon: Lightbulb, color: "text-amber-500", bg: "bg-amber-500/10", borderColor: "#f59e0b" },
        { id: "general", label: "General", icon: MessageSquare, color: "text-blue-500", bg: "bg-blue-500/10", borderColor: "#3b82f6" },
    ]

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1 h-9 px-4 transition-all bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:hover:bg-violet-900/50"
                >
                    <MessageSquarePlus className="h-4 w-4" />
                    <span className="hidden sm:inline font-medium">Feedback</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden gap-0 border-0 shadow-2xl">
                <AnimatePresence mode="wait">
                    {success ? (
                        <SuccessAnimation key="success" />
                    ) : (
                        <div key="form" className="relative flex flex-col bg-background">
                            {/* Decorative Header Background */}
                            <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />

                            <DialogHeader className="p-6 pb-2 z-10">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="p-2 bg-primary/10 rounded-lg">
                                        <Sparkles className="w-5 h-5 text-primary" />
                                    </div>
                                    <DialogTitle className="text-xl">Feedback & Suggestions</DialogTitle>
                                </div>
                                <DialogDescription className="text-base">
                                    Help us build a better gallery. What&apos;s on your mind?
                                </DialogDescription>
                            </DialogHeader>

                            <motion.form
                                variants={containerVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                onSubmit={handleSubmit}
                                className="p-6 pt-2 space-y-6 z-10"
                            >
                                {/* Type Selection */}
                                <motion.div variants={itemVariants} className="space-y-3">
                                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        I want to...
                                    </Label>
                                    <div className="grid grid-cols-3 gap-3">
                                        {feedbackTypes.map((item) => (
                                            <label
                                                key={item.id}
                                                className="relative cursor-pointer group"
                                            >
                                                <input
                                                    type="radio"
                                                    name="feedback-type"
                                                    value={item.id}
                                                    checked={type === item.id}
                                                    onChange={(e) => setType(e.target.value)}
                                                    className="peer sr-only"
                                                    aria-label={item.label}
                                                />
                                                <div className={cn(
                                                    "relative z-10 flex flex-col items-center justify-center p-3 rounded-xl border-2 border-transparent bg-secondary/30 transition-all duration-200",
                                                    "hover:bg-secondary/60 hover:scale-[1.02]",
                                                    "peer-checked:bg-background peer-checked:shadow-sm"
                                                )}>
                                                    <item.icon className={cn("w-6 h-6 mb-2 transition-colors", type === item.id ? item.color : "text-muted-foreground")} />
                                                    <span className={cn("text-xs font-medium transition-colors", type === item.id ? "text-foreground" : "text-muted-foreground")}>
                                                        {item.label}
                                                    </span>
                                                </div>
                                                {type === item.id && (
                                                    <motion.div
                                                        layoutId="active-ring"
                                                        className="absolute inset-0 z-20 rounded-xl border-2 pointer-events-none"
                                                        style={{ borderColor: item.borderColor }}
                                                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                                    />
                                                )}
                                            </label>
                                        ))}
                                    </div>
                                </motion.div>

                                {/* Content Input */}
                                <motion.div variants={itemVariants} className="space-y-2">
                                    <Label htmlFor="content" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        Details
                                    </Label>
                                    <Textarea
                                        id="content"
                                        placeholder={
                                            type === 'bug' ? "What happened? How can we reproduce it?" :
                                                type === 'feature' ? "What would you like to see added?" :
                                                    "Tell us what you think..."
                                        }
                                        value={content}
                                        onChange={(e) => setContent(e.target.value)}
                                        className="min-h-[120px] resize-none bg-secondary/20 focus:bg-background transition-colors border-transparent focus:border-input focus:ring-1 focus:ring-primary/20"
                                        required
                                    />
                                </motion.div>

                                {/* Contact Input */}
                                <motion.div variants={itemVariants} className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <Label htmlFor="contact" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                            Contact
                                        </Label>
                                        <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">Optional</span>
                                    </div>
                                    <Input
                                        id="contact"
                                        placeholder="Discord Username (for follow-up)"
                                        value={contact}
                                        onChange={(e) => setContact(e.target.value)}
                                        className="h-10 bg-secondary/20 focus:bg-background transition-colors border-transparent focus:border-input focus:ring-1 focus:ring-primary/20"
                                    />
                                </motion.div>

                                {/* Footer */}
                                <motion.div variants={itemVariants} className="pt-2">
                                    <Button
                                        type="submit"
                                        disabled={loading}
                                        className="w-full h-11 text-base shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all hover:-translate-y-0.5"
                                    >
                                        {loading ? (
                                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                        ) : (
                                            <Send className="mr-2 h-4 w-4" />
                                        )}
                                        Submit Feedback
                                    </Button>
                                </motion.div>
                            </motion.form>
                        </div>
                    )}
                </AnimatePresence>
            </DialogContent>
        </Dialog>
    )
}
