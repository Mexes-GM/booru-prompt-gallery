"use client"

import { useState, useRef, useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'

export type ApiStatus = 'healthy' | 'slow' | 'error' | 'offline'

export interface ApiStatusInfo {
  status: ApiStatus
  message: string
  lastError?: Error
  responseTime?: number
  consecutiveErrors: number
  lastSuccessfulRequest?: Date
}

interface UseApiStatusOptions {
  maxConsecutiveErrors?: number // Máximo de errores consecutivos antes de marcar como offline
}

const DEFAULT_OPTIONS: UseApiStatusOptions = {
  maxConsecutiveErrors: 3
}

export function useApiStatus(options: UseApiStatusOptions = {}) {
  const { toast } = useToast()
  const optsRef = useRef({ ...DEFAULT_OPTIONS, ...options })
  optsRef.current = { ...DEFAULT_OPTIONS, ...options }
  
  const [apiStatus, setApiStatus] = useState<ApiStatusInfo>({
    status: 'healthy',
    message: 'API funcionando correctamente',
    consecutiveErrors: 0
  })
  
  const consecutiveErrorsRef = useRef(0)
  const lastSuccessfulRequestRef = useRef<Date>(new Date())



  // Función para reportar errores desde otros componentes
  const reportError = useCallback((error: Error, responseTime?: number) => {
    consecutiveErrorsRef.current += 1
    
    const isOffline = consecutiveErrorsRef.current >= optsRef.current.maxConsecutiveErrors!
    
    if (isOffline) {
      setApiStatus({
        status: 'offline',
        message: 'API no disponible - Múltiples errores reportados',
        lastError: error,
        responseTime,
        consecutiveErrors: consecutiveErrorsRef.current,
        lastSuccessfulRequest: lastSuccessfulRequestRef.current
      })
    } else {
      setApiStatus({
        status: 'error',
        message: `Error en la API: ${error.message}`,
        lastError: error,
        responseTime,
        consecutiveErrors: consecutiveErrorsRef.current,
        lastSuccessfulRequest: lastSuccessfulRequestRef.current
      })
    }
    
    // Mostrar toast solo para errores críticos (offline)
    if (isOffline) {
      toast({
        title: "API sin conexión",
        description: "La API no está respondiendo. Verifica tu conexión a internet.",
        variant: "destructive",
      })
    }
  }, [toast])

  // Función para reportar respuesta lenta
  const reportSlowResponse = useCallback((responseTime: number) => {
    setApiStatus({
      status: 'slow',
      message: `API respondiendo lentamente (${responseTime}ms)`,
      responseTime,
      consecutiveErrors: consecutiveErrorsRef.current,
      lastSuccessfulRequest: lastSuccessfulRequestRef.current
    })
    
    // Mostrar toast solo si es extremadamente lento (>10 segundos)
    if (responseTime > 10000) {
      toast({
        title: "Conexión muy lenta",
        description: `La API está tardando mucho en responder (${Math.round(responseTime/1000)}s).`,
        variant: "default",
      })
    }
  }, [toast])

  // Función para reportar respuesta exitosa
  const reportSuccess = useCallback((responseTime?: number) => {
    consecutiveErrorsRef.current = 0
    lastSuccessfulRequestRef.current = new Date()
    
    setApiStatus({
      status: 'healthy',
      message: 'API funcionando correctamente',
      responseTime,
      consecutiveErrors: 0,
      lastSuccessfulRequest: lastSuccessfulRequestRef.current
    })
  }, [])

  return {
    apiStatus,
    reportError,
    reportSlowResponse,
    reportSuccess
  }
}

// Hook simplificado para usar en componentes que solo necesitan el estado
export function useApiStatusSimple() {
  const { apiStatus } = useApiStatus()
  return apiStatus
}