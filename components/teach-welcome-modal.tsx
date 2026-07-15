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
  Upload,
  ImagePlus,
  Eraser,
  Wand2,
  Dices,
  Image as ImageIcon,
  Info,
  Check, 
  Sparkles,
  ArrowRight,
  Users
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"

export function TeachWelcomeModal({ triggerOpen, onOpenChange }: { triggerOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(0)

  // Update this key to force the modal to show again for existing users
  const STORAGE_KEY = "hasSeenFeatureUpdateV9.0"

  useEffect(() => {
    if (triggerOpen) {
      setOpen(true)
    }
  }, [triggerOpen])

  // Auto-open disabled — modal only opens when triggered manually from the header

  useEffect(() => {
    if (!api) return

    setCurrent(api.selectedScrollSnap())

    const onSelect = () => setCurrent(api.selectedScrollSnap())
    api.on("select", onSelect)

    return () => {
      api?.off("select", onSelect)
    }
  }, [api])

  const handleClose = () => {
    setOpen(false)
    if (onOpenChange) onOpenChange(false)
    localStorage.setItem(STORAGE_KEY, "true")
  }

  const slides = useMemo(() => [
    {
      title: "Import & Clean Prompts",
      description: "Extract prompts directly from your images.",
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      border: "border-blue-500/20",
      features: [
        {
          icon: ImagePlus,
          title: "Import & Clean",
          text: "Paste an existing prompt or extract one directly from an image. It will automatically be processed through our internal prompt cleaner—removing irrelevant tags, reorganizing categories, and optimizing it just like prompts fetched directly from the APIs."
        },
        {
          icon: Eraser,
          title: "Smart Tag Exclusion",
          text: "Automatically resolves logical conflicts between your base prompt and added tags. It detects contradictions (like adding facial features to a back-view, or conflicting clothing) and disables them to keep your prompt accurate."
        }
      ]
    },
    {
      title: "Variations & Merge Modes",
      description: "Generate creative alternatives and hybrids easily.",
      color: "text-purple-500",
      bg: "bg-purple-500/10",
      border: "border-purple-500/20",
      features: [
        {
          icon: Wand2,
          title: "Prompt Variations",
          text: "Select multiple prompts and format them into Wildcard variations ({ promptA | promptB }). Perfect for quickly creating diverse examples."
        },
        {
          icon: Dices,
          title: "Randomize",
          text: "Not sure what to mix? Use the new random button in both Merge and Variation modes to let the app generate unexpected prompt combinations for you."
        }
      ]
    },
    {
      title: "Backgrounds & Guidance",
      description: "More control over settings and clearer UI explanations.",
      color: "text-orange-500",
      bg: "bg-orange-500/10",
      border: "border-orange-500/20",
      features: [
        {
          icon: ImageIcon,
          title: "Background Options",
          text: "Take control of your backgrounds with advanced replacement tags, easily allowing you to set transparent, simple, or custom backgrounds for your generated prompts."
        },
        {
          icon: Info,
          title: "Helpful Tooltips",
          text: "We've added detailed Info Tooltips across all options to explain exactly what each feature does. Hover over any info icon to learn more!"
        }
      ]
    },
    {
      title: "Character Popularity Insights",
      description: "Discover how popular characters are across the booru.",
      color: "text-pink-500",
      bg: "bg-pink-500/10",
      border: "border-pink-500/20",
      features: [
        {
          icon: Users,
          title: "Character Post Count",
          text: "Each card now displays a small indicator in the bottom-left corner showing the maximum post count of all characters in that image. This helps recognize how accurate the character will be when generating it; the more posts it has, the more likely the base model knows the character and can generate it correctly."
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
              Booru Gallery V9.0
            </DialogTitle>
            <DialogDescription className="text-base">
              We&apos;ve added powerful new tools to help you create better prompts.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 min-h-0">
          <Carousel setApi={setApi} className="w-full">
            <CarouselContent>
              {slides.map((slide) => (
                <CarouselItem key={slide.title}>
                  <div className="grid gap-4 py-1 p-1">
                    <div className={cn("p-4 rounded-xl border flex items-center gap-3", slide.bg, slide.border)}>
                      <h3 className={cn("font-semibold text-lg", slide.color)}>{slide.title}</h3>
                      <div className="h-4 w-px bg-current opacity-20" />
                      <p className="text-sm text-muted-foreground">{slide.description}</p>
                    </div>

                    <div className="grid gap-3">
                      {slide.features.map((feature) => (
                        <Card key={feature.title} className="border-muted bg-muted/30 shadow-sm">
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
            {slides.map((slide, index) => (
              <div
                key={slide.title}
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
