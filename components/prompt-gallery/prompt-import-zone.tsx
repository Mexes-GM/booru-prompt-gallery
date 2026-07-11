"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePostHog } from "posthog-js/react";

interface PromptImportZoneProps {
  isDragActive: boolean;
  isLoading: boolean;
  error: string | null;
  onDragEnter: (e: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDrop: (e: React.DragEvent<HTMLElement>) => void;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onErrorDismiss: () => void;
  value: string;
  onChange: (value: string) => void;
}

export function PromptImportZone({
  isDragActive,
  isLoading,
  error,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onFileInputChange,
  onErrorDismiss,
  value,
  onChange,
}: PromptImportZoneProps) {
  const [lastFileName, setLastFileName] = useState<string>("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const posthog = usePostHog();

  // Cleanup object URL on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const handleDrop = async (e: React.DragEvent<HTMLElement>) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setLastFileName(files[0].name);
      importFileAsPreview(files[0]);
      posthog.capture('import_used', { method: 'drop', file_type: files[0].type });
    }
    await onDrop(e);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files && files.length > 0) {
      setLastFileName(files[0].name);
      importFileAsPreview(files[0]);
      posthog.capture('import_used', { method: 'file_select', file_type: files[0].type });
    }
    onFileInputChange(e);
  };

  const importFileAsPreview = (file: File) => {
    // Generate object URL for the uploaded/dragged valid image
    if (file.type.startsWith("image/")) {
      const objectUrl = URL.createObjectURL(file);
      setImagePreview(objectUrl);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* SECTION 1: Image Drag & Drop Zone */}
      <div className="space-y-2 flex flex-col border border-border p-3 rounded-xl bg-muted/20">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Extract from Image
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Drag an image or click to upload
            </p>
          </div>
          <input
            type="file"
            id="file-input"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFileChange}
            className="hidden"
            disabled={isLoading}
          />
        </div>

        {/* Error Toast */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              className="px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg flex items-start gap-3 text-sm"
            >
              <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-destructive text-sm">{error}</p>
              </div>
              <button
                onClick={onErrorDismiss}
                className="text-destructive hover:opacity-70 transition-opacity flex-shrink-0"
              >
                ✕
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Drop Zone */}
        <label
          htmlFor="file-input"
          onDragEnter={onDragEnter as React.DragEventHandler<HTMLLabelElement>}
          onDragLeave={onDragLeave as React.DragEventHandler<HTMLLabelElement>}
          onDragOver={onDragOver as React.DragEventHandler<HTMLLabelElement>}
          onDrop={handleDrop as React.DragEventHandler<HTMLLabelElement>}
          className={cn(
            "relative flex flex-col items-center justify-center rounded-lg transition-all duration-200 overflow-hidden cursor-pointer",
            "border-2 border-dashed",
            "px-4 py-4 min-h-[100px] flex-1",
            isDragActive
              ? "border-primary/60 bg-primary/5 scale-[1.01]"
              : "border-border hover:border-border/70 hover:bg-muted/30",
            isLoading && "pointer-events-none opacity-60",
          )}
        >
          {/* Loading State */}
          <AnimatePresence>
            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm z-20 rounded-lg"
              >
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  <div className="text-center">
                    <p className="text-xs font-semibold text-foreground">
                      Extracting metadata...
                    </p>
                    {lastFileName && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {lastFileName}
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Empty State */}
          <AnimatePresence mode="popLayout">
            {!imagePreview && !isLoading && (
              <motion.div
                key="empty"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex flex-col items-center gap-2 text-center pointer-events-none"
              >
                <Upload className="h-6 w-6 text-muted-foreground/60" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Drop image here
                  </p>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPEG, or WebP
                  </p>
                </div>
              </motion.div>
            )}

            {/* Success Image Preview State */}
            {imagePreview && !isLoading && (
              <motion.div
                key="preview"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute inset-0 w-full h-full group flex items-center justify-center bg-muted/10"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreview}
                  alt="Extracted metadata preview"
                  className="absolute inset-0 w-full h-full object-contain rounded-lg opacity-80 group-hover:opacity-40 transition-opacity duration-300"
                />
                
                {/* Hover overlay text */}
                <div className="relative z-10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2 bg-background/80 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-border pointer-events-none shadow-sm">
                  <Upload className="h-4 w-4 text-foreground text-emerald-500" />
                  <span className="text-xs font-semibold text-foreground">
                    Replace Image
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </label>

      </div>

      {/* SECTION 2: Manual Text Input */}
      <div className="space-y-2 flex flex-col border border-border p-3 rounded-xl bg-muted/20">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Paste Prompt
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Enter or paste your prompt directly
          </p>
        </div>

        <textarea
          placeholder="Paste your prompt here, one tag per line or comma-separated..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isLoading}
          className={cn(
            "flex-1 w-full rounded-lg border border-border bg-background",
            "px-3 py-2 font-mono text-sm placeholder:text-muted-foreground/50",
            "focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent",
            "resize-none transition-colors",
            isLoading && "opacity-50 cursor-not-allowed",
            "min-h-[100px]",
          )}
        />
      </div>
    </div>
  );
}
