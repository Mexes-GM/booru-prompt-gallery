import { TrendItem } from "@/lib/booru/types"
import { Card } from "@/components/ui/card"
import { User, Copyright } from "lucide-react"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"

interface TrendCardProps {
  item: TrendItem
  onClick: (tag: string) => void
  rank: number
  index: number
}

export function TrendCard({ item, onClick, rank, index }: TrendCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ 
        duration: 0.5, 
        delay: index * 0.05, 
        ease: [0.25, 0.1, 0.25, 1] // Soft ease-out
      }}
      whileHover={{ y: -5 }}
    >
      <Card 
        className="group relative overflow-hidden cursor-pointer border-0 rounded-xl bg-muted/20 hover:bg-muted/40 transition-colors shadow-sm hover:shadow-xl"
        onClick={() => onClick(item.name)}
      >
        <div className="aspect-[3/4] relative overflow-hidden">
          {/* Image with subtle zoom on hover */}
          <div 
            className="absolute inset-0 bg-cover bg-center transition-transform duration-700 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:scale-110"
            style={{ backgroundImage: `url(${item.imageUrl})` }}
          />
          
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

          {/* Content at bottom with slide-up reveal */}
          <div className="absolute bottom-0 left-0 right-0 p-4 transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300 ease-out">
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
            
            <h3 className="text-white font-semibold text-lg leading-tight line-clamp-2 mb-1 group-hover:text-primary-foreground transition-colors">
              {item.name.replace(/_/g, ' ')}
            </h3>
            
            <p className="text-white/50 text-xs font-medium opacity-80 group-hover:opacity-100 transition-opacity">
              {item.count} posts today
            </p>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
