'use client'

import { useState, useCallback } from 'react'
import piexif from 'piexifjs'

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

function readUInt32BE(buffer: Uint8Array, offset: number): number {
  return (
    ((buffer[offset] << 24) |
      (buffer[offset + 1] << 16) |
      (buffer[offset + 2] << 8) |
      buffer[offset + 3]) >>>
    0
  )
}

function extractPNGMetadata(uint8Array: Uint8Array): Record<string, string> {
  const metadata: Record<string, string> = {}

  const textDecoder = new TextDecoder('utf-8')
  const latin1Decoder = new TextDecoder('iso-8859-1')

  let offset = 8

  while (offset < uint8Array.length) {
    const length = readUInt32BE(uint8Array, offset)
    offset += 4

    const chunkType = String.fromCharCode(
      uint8Array[offset],
      uint8Array[offset + 1],
      uint8Array[offset + 2],
      uint8Array[offset + 3]
    )
    offset += 4

    if (chunkType === 'tEXt') {
      const chunkData = uint8Array.slice(offset, offset + length)
      const nullIndex = chunkData.indexOf(0)

      if (nullIndex > 0) {
        const keyword = latin1Decoder.decode(chunkData.slice(0, nullIndex))
        const text = textDecoder.decode(chunkData.slice(nullIndex + 1))
        const keyLower = keyword.toLowerCase()

        if (keyLower === 'generation_data') {
          try {
            const data = JSON.parse(text)
            if (data.prompt) metadata.prompt = data.prompt
            if (data.negativePrompt)
              metadata.negativePrompt = data.negativePrompt
            metadata.generation_data = text
          } catch (e) {}
        } else if (
          keyLower === 'prompt' &&
          text.startsWith('{') &&
          text.includes('"class_type"')
        ) {
          try {
            const data = JSON.parse(text)
            
            // Try to identify positive/negative nodes from KSampler
            let posNodeId = null
            let negNodeId = null
            
            for (const key in data) {
              const node = data[key]
              if (node.class_type && node.class_type.startsWith('KSampler')) {
                if (Array.isArray(node.inputs?.positive)) posNodeId = node.inputs.positive[0]
                if (Array.isArray(node.inputs?.negative)) negNodeId = node.inputs.negative[0]
              }
            }

            let comfyPrompt = ''
            
            if (posNodeId && data[posNodeId] && data[posNodeId].class_type.startsWith('CLIPTextEncode')) {
              comfyPrompt = data[posNodeId].inputs?.text || ''
            } else {
              for (const key in data) {
                const node = data[key]
                if (
                  node.class_type === 'CLIPTextEncode' ||
                  node.class_type === 'CLIPTextEncodeSDXL'
                ) {
                  const nodeText = node.inputs?.text
                  if (typeof nodeText === 'string') {
                    comfyPrompt = nodeText
                    break
                  }
                }
              }
            }

            if (comfyPrompt && !metadata.prompt) {
              metadata.prompt = comfyPrompt
            } else if (!metadata.prompt) {
              metadata.prompt = text
            }
          } catch (e) {
            if (!metadata.prompt) metadata.prompt = text
          }
        } else {
          if (keyLower.includes('prompt') && !metadata.prompt) {
            metadata.prompt = text
          } else if (
            keyLower.includes('negative') &&
            !metadata.negativePrompt
          ) {
            metadata.negativePrompt = text
          } else if (keyLower.includes('parameter') && !metadata.parameters) {
            metadata.parameters = text
          } else if (
            keyLower.includes('description') &&
            !metadata.description
          ) {
            metadata.description = text
          } else if (keyLower.includes('comment') && !metadata.comment) {
            metadata.comment = text
          }
        }
      }
    }

    if (chunkType === 'iTXt') {
      try {
        const chunkData = uint8Array.slice(offset, offset + length)
        const nullIndex = chunkData.indexOf(0)

        if (nullIndex > 0) {
          const keyword = latin1Decoder.decode(chunkData.slice(0, nullIndex))
          const compressionFlag = chunkData[nullIndex + 1]

          if (compressionFlag === 0) {
            const nullIndex2 = chunkData.indexOf(0, nullIndex + 3)
            const textOffset = nullIndex2 > 0 ? nullIndex2 + 1 : nullIndex + 3
            const text = textDecoder.decode(chunkData.slice(textOffset))

            const keyLower = keyword.toLowerCase()
            if (keyLower.includes('prompt') && !metadata.prompt) {
              metadata.prompt = text
            } else if (keyLower === 'description' && !metadata.description) {
              metadata.description = text
            }
          }
        }
      } catch (error) {}
    }

    offset += length + 4
  }

  return metadata
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
        const buffer = await file.arrayBuffer()
        const uint8Array = new Uint8Array(buffer)
        const exifMetadata: Record<string, string> = {}

        const isPNG =
          uint8Array.length > 8 &&
          uint8Array[0] === 0x89 &&
          uint8Array[1] === 0x50 &&
          uint8Array[2] === 0x4e &&
          uint8Array[3] === 0x47

        if (!isPNG) {
          try {
            // Only load first 1MB of the image chunk to avoid call stack limits/excessive memory usage
            const chunk = uint8Array.slice(0, Math.min(uint8Array.length, 1024 * 1024))
            
            // Browser-safe conversion of Uint8Array to binary string
            let binaryString = ''
            const len = chunk.byteLength
            for (let i = 0; i < len; i++) {
              binaryString += String.fromCharCode(chunk[i])
            }

            const exifDict = piexif.load(binaryString)

            const exifFieldsToCheck = [
              [piexif.ImageIFD.ImageDescription, 'description'],
              [piexif.ImageIFD.XPComment, 'userComment'],
              [piexif.ImageIFD.XPKeywords, 'keywords'],
              [37510, 'comment'], // UserComment is 37510
            ]

            for (const [tag, key] of exifFieldsToCheck) {
              let value = null
              if (exifDict['0th'] && exifDict['0th'][tag as number]) {
                value = exifDict['0th'][tag as number]
              } else if (exifDict['Exif'] && exifDict['Exif'][tag as number]) {
                value = exifDict['Exif'][tag as number]
              }

              if (value) {
                let strValue = Array.isArray(value) ? value[0] : value
                
                if (typeof strValue === 'string') {
                  strValue = strValue.replace(/^(UNICODE|ASCII)\x00+/ig, '')
                  strValue = strValue.replace(/\x00/g, '')
                  exifMetadata[key] = strValue.trim()
                }
              }
            }
          } catch (exifError) {
            console.debug('EXIF parsing failed')
          }
        }

        if (isPNG || file.type === 'image/png') {
          try {
            const pngMetadata = extractPNGMetadata(uint8Array)
            Object.assign(exifMetadata, pngMetadata)
          } catch (pngError) {
            console.debug('PNG metadata extraction failed:', pngError)
          }
        }

        let foundPrompt =
          exifMetadata.prompt ||
          exifMetadata.parameters ||
          exifMetadata.comment ||
          exifMetadata.userComment ||
          exifMetadata.description ||
          ''

        if (foundPrompt) {
          const negMatch = foundPrompt.match(/negative prompt:/i)
          if (negMatch && negMatch.index !== undefined) {
            foundPrompt = foundPrompt.substring(0, negMatch.index).trim()
          }
          const stepsMatch = foundPrompt.match(/\nsteps:/i)
          if (stepsMatch && stepsMatch.index !== undefined) {
            foundPrompt = foundPrompt.substring(0, stepsMatch.index).trim()
          }
        }

        const result: ExifExtractionResult = {
          success: true,
          prompt: foundPrompt,
          metadata: exifMetadata,
          fileInfo: {
            name: file.name,
            type: file.type,
            size: file.size,
          },
        }

        if (!result.prompt || result.prompt.trim() === '') {
          const err = 'No prompt metadata found in this image'
          setError(err)
          options.onError?.(err)
        }

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
