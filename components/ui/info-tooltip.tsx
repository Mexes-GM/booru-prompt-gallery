"use client";

import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { motion } from "framer-motion";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
  children: React.ReactNode;   // El elemento sobre el que se hace hover
  title: string;               // Título de la opción
  description: React.ReactNode;// Explicación detallada
  visual?: React.ReactNode;    // Ejemplo visual opcional (Imagen, Video, Iconos)
  delayDuration?: number;      // Tiempo en ms antes de mostrarse (defecto: 500ms)
  side?: "top" | "bottom" | "left" | "right"; // Dirección del tooltip
  className?: string;          // Clases adicionales
}

export function InfoTooltip({
  children,
  title,
  description,
  visual,
  delayDuration = 500, // Retraso de medio segundo para no saturar al usuario
  side = "top",
  className,
}: InfoTooltipProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip open={isOpen} onOpenChange={setIsOpen}>
        <TooltipTrigger asChild>
          {/* El elemento disparador (ej. un botón o un label) */}
          <span className="cursor-help inline-flex items-center gap-1.5">
            {children}
            <Info className="w-4 h-4 text-muted-foreground/70 hover:text-primary transition-colors" />
          </span>
        </TooltipTrigger>
        
        <TooltipContent
          side={side}
          sideOffset={8}
          className={cn(
            "p-0 w-[340px] sm:w-[380px] bg-background border-border shadow-xl rounded-xl z-[9999]",
            // Sobrescribimos el fondo y padding de shadcn para hacer nuestro diseño custom
            className
          )}
        >
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25, delay: 0.05 }}
              className="flex flex-col overflow-hidden rounded-xl"
            >
              {/* Sección Visual (Opcional) */}
              {visual && (
                <div className="bg-muted/50 flex items-center justify-center p-3 sm:p-4 border-b border-border/40 relative">
                  <div className="absolute inset-0 bg-gradient-to-t from-background/30 to-transparent pointer-events-none" />
                  <div className="relative z-10 w-full">
                    {visual}
                  </div>
                </div>
              )}
              
              {/* Sección de Texto */}
              <div className="p-4 flex flex-col gap-1.5">
                <h4 className="text-[13px] font-semibold text-foreground tracking-tight">
                  {title}
                </h4>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  {description}
                </div>
              </div>
            </motion.div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
