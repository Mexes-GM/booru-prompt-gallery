'use client'

import { useState, useCallback } from 'react'

export interface ExifExtractionResult {
  success: boolean
  prompt?: string
  metadata?: Record<string, string>
  fileInfo?: {
    name: string
    type: string
    size: number
  }
  error?: string
}

export interface UseImageExifOptions {
  onSuccess?: (result: ExifExtractionResult) => void
  onError?: (error: string) => void
}

/**
 * Hook for handling image file drops and extracting EXIF metadata
 * Supports PNG, JPEG, and WebP formats
 */
export function useImageExif(options: UseImageExifOptions = {}) {
  const [isLoading, setIsLoading] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const extractExif = useCallback(
    async (file: File): Promise<ExifExtractionResult | null> => {
      // Validate file type
      const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp']
      if (!allowedMimeTypes.includes(file.type)) {
        const err = 'Only PNG, JPEG, and WebP files are supported'
        setError(err)
        options.onError?.(err)
        return null
      }

      // Validate file size (max 50MB)
      const maxSize = 50 * 1024 * 1024
      if (file.size > maxSize) {
        const err = 'File size exceeds 50MB limit'
        setError(err)
        options.onError?.(err)
        return null
      }

      setIsLoading(true)
      setError(null)

      try {
        const formData = new FormData()
        formData.append('file', file)

        const response = await fetch('/api/extract-exif', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to extract metadata')
        }

        const result: ExifExtractionResult = await response.json()
        options.onSuccess?.(result)
        return result
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        setError(errorMessage)
        options.onError?.(errorMessage)
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [options]
  )

  const handleDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragActive(true)
    },
    []
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragActive(false)
    },
    []
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragActive(false)

      const files = e.dataTransfer.files
      if (files.length === 0) return

      const file = files[0]
      await extractExif(file)
    },
    [extractExif]
  )

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.currentTarget.files
      if (!files || files.length === 0) return

      const file = files[0]
      await extractExif(file)
    },
    [extractExif]
  )

  return {
    isLoading,
    isDragActive,
    error,
    extractExif,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileInputChange,
    clearError: () => setError(null),
  }
}
