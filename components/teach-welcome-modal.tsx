"use client"

import { useEffect, useState, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { 
  Carousel, 
  CarouselContent, 
  CarouselItem, 
  CarouselNext, 
  CarouselPrevious,
  type CarouselApi
} from "@/components/ui/carousel"
import { Card, CardContent } from "@/components/ui/card"
import { 
  ShieldBan, 
  Search, 
  Flame, 
  Merge, 
  MessageSquareHeart, 
  Globe, 
  Check, 
  Sparkles,
  ArrowRight,
  MousePointerClick,
  GraduationCap
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"

export function TeachWelcomeModal({ triggerOpen, onOpenChange }: { triggerOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(0)

  // Update this key to force the modal to show again for existing users
  const STORAGE_KEY = "hasSeenFeatureUpdateV2.1"

  useEffect(() => {
    if (triggerOpen) {
      setOpen(true)
    }
  }, [triggerOpen])

  useEffect(() => {
    const hasSeen = localStorage.getItem(STORAGE_KEY)
    if (!hasSeen) {
      // Small delay to ensure smooth hydration/mounting
      const timer = setTimeout(() => setOpen(true), 1000)
      return () => clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!api) return

    setCurrent(api.selectedScrollSnap())

    api.on("select", () => {
      setCurrent(api.selectedScrollSnap())
    })
  }, [api])

  const handleClose = () => {
    setOpen(false)
    if (onOpenChange) onOpenChange(false)
    localStorage.setItem(STORAGE_KEY, "true")
  }

  const slides = useMemo(() => [
    {
      title: "Enhanced Search Tools",
      description: "Find exactly what you want—and hide what you don't.",
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      border: "border-blue-500/20",
      features: [
        {
          icon: ShieldBan,
          title: "Blacklist",
          text: "Filter out unwanted content by adding specific tags to your personal blacklist in the settings."
        },
        {
          icon: Search,
          title: "Autocomplete",
          text: "Not sure how a tag is spelled? Our new autocomplete system helps you find valid Danbooru tags instantly."
        }
      ]
    },
    {
      title: "Creative Workflow",
      description: "Discover trends and combine ideas seamlessly.",
      color: "text-purple-500",
      bg: "bg-purple-500/10",
      border: "border-purple-500/20",
      features: [
        {
          icon: Flame,
          title: "Trending",
          text: "See what's popular today. Click cards to search their prompts, or right-click to copy them directly."
        },
        {
          icon: Merge,
          title: "Merge Mode",
          text: "Combine poses, outfits, and backgrounds from multiple cards to create unique, hybrid prompts."
        }
      ]
    },
    {
      title: "Advanced Tag Control",
      description: "Take full control of your prompt engineering with granular tools.",
      color: "text-orange-500",
      bg: "bg-orange-500/10",
      border: "border-orange-500/20",
      features: [
        {
          icon: MousePointerClick,
          title: "Interactive Tags",
          text: "Click any tag on a card to open its panel. From there, you can adjust its weight or search for it immediately."
        },
        {
          icon: Globe,
          title: "Global Weights",
          text: "Enable 'Global Tag Weights' to see the planet icon. Click it to apply a specific weight to that tag across all cards instantly."
        }
      ]
    },
    {
      title: "Community & Feedback",
      description: "Contribute to the platform's growth and accuracy.",
      color: "text-rose-500",
      bg: "bg-rose-500/10",
      border: "border-rose-500/20",
      features: [
        {
          icon: GraduationCap,
          title: "Teach System",
          text: "Help improve tag classification by moving tags to their correct categories in the Teach panel."
        },
        {
          icon: MessageSquareHeart,
          title: "Feedback",
          text: "Help us grow! Send bug reports or feature requests directly through the new feedback button."
        }
      ]
    }
  ], [])

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-md sm:max-w-xl p-0 gap-0 border-none shadow-2xl bg-background/95 backdrop-blur-xl max-h-[85vh] flex flex-col overflow-hidden">
        
        {/* Header Background Pattern */}
        <div className="absolute top-0 inset-x-0 h-32 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />

        <div className="relative px-6 pt-8 pb-2 shrink-0">
           <DialogHeader>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">What&apos;s New</span>
            </div>
            <DialogTitle className="text-2xl sm:text-3xl font-bold tracking-tight">
              Booru Gallery V8
            </DialogTitle>
            <DialogDescription className="text-base">
              We&apos;ve added powerful new tools to help you create better prompts.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 min-h-0">
          <Carousel setApi={setApi} className="w-full">
            <CarouselContent>
              {slides.map((slide, index) => (
                <CarouselItem key={index}>
                  <div className="grid gap-4 py-1 p-1">
                    <div className={cn("p-4 rounded-xl border flex items-center gap-3", slide.bg, slide.border)}>
                      <h3 className={cn("font-semibold text-lg", slide.color)}>{slide.title}</h3>
                      <div className="h-4 w-px bg-current opacity-20" />
                      <p className="text-sm text-muted-foreground">{slide.description}</p>
                    </div>

                    <div className="grid gap-3">
                      {slide.features.map((feature, i) => (
                        <Card key={i} className="border-muted bg-muted/30 shadow-sm">
                          <CardContent className="p-4 flex gap-4 items-start">
                            <div className={cn("mt-1 p-2 rounded-md bg-background shadow-sm shrink-0", slide.color)}>
                              <feature.icon className="w-5 h-5" />
                            </div>
                            <div className="space-y-1">
                              <h4 className="font-medium leading-none">{feature.title}</h4>
                              <p className="text-sm text-muted-foreground leading-relaxed">
                                {feature.text}
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            
            {/* Hidden navigation buttons for accessibility, custom ones in footer */}
            <div className="hidden">
              <CarouselPrevious />
              <CarouselNext />
            </div>
          </Carousel>
        </div>

        <DialogFooter className="p-6 pt-2 bg-muted/20 border-t flex flex-col sm:flex-row gap-3 sm:justify-between items-center shrink-0">
          {/* Dots Indicator */}
          <div className="flex gap-1.5 order-2 sm:order-1">
            {slides.map((_, index) => (
              <div
                key={index}
                className={cn(
                  "h-2 rounded-full transition-all duration-300 ease-in-out",
                  current === index ? "bg-primary w-6" : "bg-primary/20 w-2"
                )}
              />
            ))}
          </div>

          <div className="flex gap-2 w-full sm:w-auto order-1 sm:order-2">
            {current === slides.length - 1 ? (
              <Button onClick={handleClose} className="w-full sm:w-auto min-w-[100px]" size="lg">
                <Check className="w-4 h-4 mr-2" /> Got it
              </Button>
            ) : (
              <Button 
                onClick={() => api?.scrollNext()} 
                className="w-full sm:w-auto min-w-[100px]"
                size="lg"
              >
                Next <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  )
}
