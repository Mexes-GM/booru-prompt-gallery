"use client"

import { useState, useEffect, useRef, useCallback } from 'react'
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
  checkInterval?: number // Intervalo de verificación en ms
  slowThreshold?: number // Umbral de latencia lenta en ms
  maxConsecutiveErrors?: number // Máximo de errores consecutivos antes de marcar como offline
}

const DEFAULT_OPTIONS: UseApiStatusOptions = {
  checkInterval: 30000, // 30 segundos
  slowThreshold: 3000, // 3 segundos
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
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastCheckRef = useRef<Date>(new Date())
  const consecutiveErrorsRef = useRef(0)
  const lastSuccessfulRequestRef = useRef<Date>(new Date())
  const lastToastRef = useRef<string | null>(null)

  // Función para verificar el estado de la API
  const checkApiHealth = useCallback(async (): Promise<void> => {
    const startTime = Date.now()
    
    try {
      // Verificar endpoint de salud
      const response = await fetch('/api/health', {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache'
        }
      })
      
      const responseTime = Date.now() - startTime
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      // Reset contador de errores consecutivos
      consecutiveErrorsRef.current = 0
      lastSuccessfulRequestRef.current = new Date()
      
      // Determinar estado basado en tiempo de respuesta
      if (responseTime > optsRef.current.slowThreshold!) {
        setApiStatus({
          status: 'slow',
          message: `API respondiendo lentamente (${responseTime}ms)`,
          responseTime,
          consecutiveErrors: 0,
          lastSuccessfulRequest: lastSuccessfulRequestRef.current
        })
      } else {
        setApiStatus({
          status: 'healthy',
          message: 'API funcionando correctamente',
          responseTime,
          consecutiveErrors: 0,
          lastSuccessfulRequest: lastSuccessfulRequestRef.current
        })
      }
      
    } catch (error) {
      consecutiveErrorsRef.current += 1
      const errorObj = error instanceof Error ? error : new Error(String(error))
      
      // Determinar si es un error temporal o la API está completamente caída
      if (consecutiveErrorsRef.current >= optsRef.current.maxConsecutiveErrors!) {
        setApiStatus({
          status: 'offline',
          message: 'API no disponible - Múltiples intentos fallidos',
          lastError: errorObj,
          consecutiveErrors: consecutiveErrorsRef.current,
          lastSuccessfulRequest: lastSuccessfulRequestRef.current
        })
      } else {
        setApiStatus({
          status: 'error',
          message: `Error temporal en la API (${errorObj.message})`,
          lastError: errorObj,
          consecutiveErrors: consecutiveErrorsRef.current,
          lastSuccessfulRequest: lastSuccessfulRequestRef.current
        })
      }
    }
    
    lastCheckRef.current = new Date()
  }, [])

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

  // Nota: Verificaciones automáticas desactivadas
  // Solo se monitorea cuando se hacen llamadas reales a la API

  return {
    apiStatus,
    checkApiHealth,
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