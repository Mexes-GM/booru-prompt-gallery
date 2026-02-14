import { useState, memo } from "react"
import { TrendItem } from "@/lib/booru/types"
import { Card } from "@/components/ui/card"
import { User, Copyright, Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import { motion, AnimatePresence } from "framer-motion"
import { useToast } from "@/hooks/use-toast"
import Image from "next/image"

interface TrendCardProps {
  item: TrendItem
  onClick: (tag: string) => void
  rank: number
  index: number
}

const PARTICLES = Array.from({ length: 12 })

function TrendCardComponent({ item, onClick, rank, index }: TrendCardProps) {
  const [isCopied, setIsCopied] = useState(false)
  const { toast } = useToast()

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation() // Prevent context menu
    navigator.clipboard.writeText(item.name)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)

    toast({
      title: "Copied to clipboard",
      description: item.name,
      duration: 1500,
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: index * 0.05,
        ease: [0.25, 0.1, 0.25, 1]
      }}
      whileHover={{ y: -5 }}
    >
      <Card
        className="group relative overflow-hidden cursor-pointer border-0 rounded-xl bg-muted/20 hover:bg-muted/40 transition-colors shadow-sm hover:shadow-xl"
        onClick={() => onClick(item.name)}
        onContextMenu={handleRightClick}
      >
        <div className="aspect-[3/4] relative overflow-hidden">
          {/* Image with subtle zoom on hover */}
          <div className="absolute inset-0 transition-transform duration-700 ease-in-out group-hover:scale-110">
            <Image
              src={item.imageUrl}
              alt={item.name}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
              loading="lazy"
              unoptimized={true} // External URLs usually need this unless configured in next.config
            />
          </div>

          {/* Clean darkening overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-500" />

          {/* Rank - Enhanced visibility with Medal Colors */}
          <div className={cn(
            "absolute top-2 left-3 font-black text-5xl italic tracking-tighter select-none transition-all duration-300 z-10",
            rank === 1 ? "text-yellow-400 drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] scale-110" :
              rank === 2 ? "text-slate-300 drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] scale-105" :
                rank === 3 ? "text-orange-400 drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] scale-105" :
                  "text-white/50 group-hover:text-white/90 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]"
          )}>
            {rank}
          </div>

          {/* Copy Hint (Visible on hover if not copied) */}
          {!isCopied && (
            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20">
              <div className="bg-black/40 backdrop-blur-sm rounded-full p-1.5 text-white/70 border border-white/10">
                <Copy className="h-3.5 w-3.5" />
              </div>
            </div>
          )}

          {/* Content at bottom with slide-up reveal */}
          <div className="absolute bottom-0 left-0 right-0 p-4 transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300 ease-out z-10">
            <div className="flex items-center gap-2 mb-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-75">
              {item.type === 'character' ? (
                <User className="h-3 w-3 text-blue-300" />
              ) : (
                <Copyright className="h-3 w-3 text-purple-300" />
              )}
              <span className="text-[10px] uppercase tracking-wider font-medium text-white/70">
                {item.type}
              </span>
            </div>

            <h3 className="text-white font-semibold text-lg leading-tight line-clamp-2 mb-1 group-hover:text-primary-foreground transition-colors text-shadow-sm">
              {item.name.replace(/_/g, ' ')}
            </h3>

            <p className="text-white/50 text-xs font-medium opacity-80 group-hover:opacity-100 transition-opacity">
              {item.count} posts today
            </p>
          </div>

          <AnimatePresence>
            {isCopied && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px]"
              >
                <div className="relative flex flex-col items-center justify-center">
                  {/* Particle Explosion */}
                  {PARTICLES.map((_, i) => (
                    <motion.div
                      key={i}
                      initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                      animate={{
                        x: Math.cos(i * (360 / PARTICLES.length) * (Math.PI / 180)) * 60,
                        y: Math.sin(i * (360 / PARTICLES.length) * (Math.PI / 180)) * 60,
                        scale: [0, 1.5, 0],
                        opacity: [1, 1, 0]
                      }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                      className="absolute w-1.5 h-1.5 bg-green-400 rounded-full shadow-[0_0_8px_rgba(74,222,128,0.8)]"
                    />
                  ))}

                  {/* Success Circle */}
                  <motion.div
                    initial={{ scale: 0, rotate: -45 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="bg-gradient-to-br from-green-400 to-green-600 rounded-full p-4 shadow-[0_0_20px_rgba(74,222,128,0.4)] relative z-10"
                  >
                    <Check className="h-8 w-8 text-white stroke-[3px]" />
                  </motion.div>

                  {/* Text */}
                  <motion.span
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ delay: 0.1 }}
                    className="mt-3 text-white font-bold tracking-widest text-sm uppercase drop-shadow-lg"
                  >
                    Copied
                  </motion.span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Card>
    </motion.div >
  )
}

export const TrendCard = memo(TrendCardComponent)
