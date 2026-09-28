"use client"

import { useState, useRef, useCallback, useLayoutEffect } from 'react'
import { useToast } from '@/hooks/use-toast'
import { toastError } from '@/lib/toast-error'

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
  maxConsecutiveErrors?: number // Maximum consecutive errors before marking as offline
}

const DEFAULT_OPTIONS: UseApiStatusOptions = {
  maxConsecutiveErrors: 3
}

export function useApiStatus(options: UseApiStatusOptions = {}) {
  const { toast } = useToast()
  const optsRef = useRef({ ...DEFAULT_OPTIONS, ...options })
  useLayoutEffect(() => {
    optsRef.current = { ...DEFAULT_OPTIONS, ...options }
  })
  
  const [apiStatus, setApiStatus] = useState<ApiStatusInfo>({
    status: 'healthy',
    message: 'API is working correctly',
    consecutiveErrors: 0
  })
  
  const consecutiveErrorsRef = useRef(0)
  const lastSuccessfulRequestRef = useRef<Date>(new Date())



  // Reports an error from other components
  const reportError = useCallback((error: Error, responseTime?: number) => {
    consecutiveErrorsRef.current += 1
    
    const isOffline = consecutiveErrorsRef.current >= optsRef.current.maxConsecutiveErrors!
    
    if (isOffline) {
      setApiStatus({
        status: 'offline',
        message: 'API unavailable - multiple errors reported',
        lastError: error,
        responseTime,
        consecutiveErrors: consecutiveErrorsRef.current,
        lastSuccessfulRequest: lastSuccessfulRequestRef.current
      })
    } else {
      setApiStatus({
        status: 'error',
        message: `API error: ${error.message}`,
        lastError: error,
        responseTime,
        consecutiveErrors: consecutiveErrorsRef.current,
        lastSuccessfulRequest: lastSuccessfulRequestRef.current
      })
    }
    
    // Only show a toast for critical (offline) errors
    if (isOffline) {
      toastError({
        title: "API offline",
        description: "The API is not responding. Check your internet connection.",
        errorSource: "api_status_offline",
      })
    }
  }, [toast])

  // Reports a slow response
  const reportSlowResponse = useCallback((responseTime: number) => {
    setApiStatus({
      status: 'slow',
      message: `API responding slowly (${responseTime}ms)`,
      responseTime,
      consecutiveErrors: consecutiveErrorsRef.current,
      lastSuccessfulRequest: lastSuccessfulRequestRef.current
    })
    
    // Only show a toast if it's extremely slow (>10 seconds)
    if (responseTime > 10000) {
      toast({
        title: "Very slow connection",
        description: `The API is taking a long time to respond (${Math.round(responseTime/1000)}s).`,
        variant: "default",
      })
    }
  }, [toast])

  // Reports a successful response
  const reportSuccess = useCallback((responseTime?: number) => {
    consecutiveErrorsRef.current = 0
    lastSuccessfulRequestRef.current = new Date()
    
    setApiStatus({
      status: 'healthy',
      message: 'API is working correctly',
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

// Simplified hook for components that only need the state
export function useApiStatusSimple() {
  const { apiStatus } = useApiStatus()
  return apiStatus
}