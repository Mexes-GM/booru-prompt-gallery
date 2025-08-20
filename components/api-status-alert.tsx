"use client"

import React, { useState, useEffect } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  AlertTriangle,
  Wifi,
  WifiOff,
  Clock,
  CheckCircle,
  X,
  RefreshCw
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ApiStatus, ApiStatusInfo } from '@/hooks/use-api-status'

interface ApiStatusAlertProps {
  apiStatus: ApiStatusInfo
  onRetry?: () => void
  onDismiss?: () => void
  className?: string
}

const getStatusConfig = (status: ApiStatus) => {
  switch (status) {
    case 'healthy':
      return {
        icon: CheckCircle,
        variant: 'default' as const,
        bgColor: 'bg-green-50 dark:bg-green-950/20',
        borderColor: 'border-green-200 dark:border-green-800',
        iconColor: 'text-green-600 dark:text-green-400',
        textColor: 'text-green-800 dark:text-green-200',
        priority: 0
      }
    case 'slow':
      return {
        icon: Clock,
        variant: 'default' as const,
        bgColor: 'bg-yellow-50 dark:bg-yellow-950/20',
        borderColor: 'border-yellow-200 dark:border-yellow-800',
        iconColor: 'text-yellow-600 dark:text-yellow-400',
        textColor: 'text-yellow-800 dark:text-yellow-200',
        priority: 1
      }
    case 'error':
      return {
        icon: AlertTriangle,
        variant: 'destructive' as const,
        bgColor: 'bg-orange-50 dark:bg-orange-950/20',
        borderColor: 'border-orange-200 dark:border-orange-800',
        iconColor: 'text-orange-600 dark:text-orange-400',
        textColor: 'text-orange-800 dark:text-orange-200',
        priority: 2
      }
    case 'offline':
      return {
        icon: WifiOff,
        variant: 'destructive' as const,
        bgColor: 'bg-red-50 dark:bg-red-950/20',
        borderColor: 'border-red-200 dark:border-red-800',
        iconColor: 'text-red-600 dark:text-red-400',
        textColor: 'text-red-800 dark:text-red-200',
        priority: 3
      }
    default:
      return {
        icon: Wifi,
        variant: 'default' as const,
        bgColor: 'bg-gray-50 dark:bg-gray-950/20',
        borderColor: 'border-gray-200 dark:border-gray-800',
        iconColor: 'text-gray-600 dark:text-gray-400',
        textColor: 'text-gray-800 dark:text-gray-200',
        priority: 0
      }
  }
}

export function ApiStatusAlert({ 
  apiStatus, 
  onRetry, 
  onDismiss, 
  className 
}: ApiStatusAlertProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  
  const config = getStatusConfig(apiStatus.status)
  const Icon = config.icon
  
  // Mostrar alerta solo para estados problemáticos
  const shouldShow = apiStatus.status !== 'healthy' && !isDismissed
  
  // Controlar visibilidad con animación
  useEffect(() => {
    if (shouldShow) {
      setIsVisible(true)
      setIsDismissed(false)
    } else {
      setIsVisible(false)
    }
  }, [shouldShow])
  
  // Auto-dismiss para estados menos críticos después de un tiempo
  useEffect(() => {
    if (apiStatus.status === 'slow' && isVisible) {
      const timer = setTimeout(() => {
        setIsDismissed(true)
      }, 10000) // 10 segundos para alertas de lentitud
      
      return () => clearTimeout(timer)
    }
  }, [apiStatus.status, isVisible])
  
  const handleDismiss = () => {
    setIsDismissed(true)
    onDismiss?.()
  }
  
  const handleRetry = async () => {
    setIsRetrying(true)
    try {
      await onRetry?.()
    } finally {
      setIsRetrying(false)
    }
  }
  
  if (!isVisible) return null
  
  const formatLastSuccess = (date?: Date) => {
    if (!date) return 'Nunca'
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    
    if (minutes < 1) return 'Hace menos de un minuto'
    if (minutes < 60) return `Hace ${minutes} minuto${minutes > 1 ? 's' : ''}`
    if (hours < 24) return `Hace ${hours} hora${hours > 1 ? 's' : ''}`
    return date.toLocaleDateString()
  }
  
  return (
    <div className={cn(
      "fixed top-4 right-4 z-50 max-w-md transition-all duration-300 ease-in-out",
      isVisible ? "translate-x-0 opacity-100" : "translate-x-full opacity-0",
      className
    )}>
      <Alert 
        className={cn(
          "shadow-lg border-l-4 backdrop-blur-sm",
          config.bgColor,
          config.borderColor,
          config.textColor
        )}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3 flex-1">
            <Icon className={cn("h-5 w-5 mt-0.5 flex-shrink-0", config.iconColor)} />
            <div className="flex-1 min-w-0">
              <AlertDescription className="text-sm font-medium mb-1">
                {apiStatus.message}
              </AlertDescription>
              
              {/* Información adicional para errores críticos */}
              {(apiStatus.status === 'error' || apiStatus.status === 'offline') && (
                <div className="text-xs opacity-75 space-y-1">
                  {apiStatus.consecutiveErrors > 1 && (
                    <div>Errores consecutivos: {apiStatus.consecutiveErrors}</div>
                  )}
                  {apiStatus.lastSuccessfulRequest && (
                    <div>Última conexión exitosa: {formatLastSuccess(apiStatus.lastSuccessfulRequest)}</div>
                  )}
                  {apiStatus.responseTime && (
                    <div>Tiempo de respuesta: {apiStatus.responseTime}ms</div>
                  )}
                </div>
              )}
              
              {/* Información de rendimiento para respuestas lentas */}
              {apiStatus.status === 'slow' && apiStatus.responseTime && (
                <div className="text-xs opacity-75">
                  Tiempo de respuesta: {apiStatus.responseTime}ms
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center space-x-1 ml-2">
            {/* Botón de reintentar para errores */}
            {(apiStatus.status === 'error' || apiStatus.status === 'offline') && onRetry && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRetry}
                disabled={isRetrying}
                className={cn(
                  "h-6 w-6 p-0 hover:bg-white/20",
                  config.iconColor
                )}
              >
                <RefreshCw className={cn(
                  "h-3 w-3",
                  isRetrying && "animate-spin"
                )} />
              </Button>
            )}
            
            {/* Botón de cerrar */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              className={cn(
                "h-6 w-6 p-0 hover:bg-white/20",
                config.iconColor
              )}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </Alert>
    </div>
  )
}

// Componente wrapper que maneja múltiples alertas
export function ApiStatusAlertContainer({ 
  apiStatus, 
  onRetry, 
  className 
}: Omit<ApiStatusAlertProps, 'onDismiss'>) {
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set())
  
  const handleDismiss = () => {
    const alertKey = `${apiStatus.status}-${apiStatus.consecutiveErrors}`
    setDismissedAlerts(prev => new Set([...prev, alertKey]))
  }
  
  // Limpiar alertas dismissadas cuando el estado mejora
  useEffect(() => {
    if (apiStatus.status === 'healthy') {
      setDismissedAlerts(new Set())
    }
  }, [apiStatus.status])
  
  const alertKey = `${apiStatus.status}-${apiStatus.consecutiveErrors}`
  const isDismissed = dismissedAlerts.has(alertKey)
  
  if (isDismissed) return null
  
  return (
    <ApiStatusAlert
      apiStatus={apiStatus}
      onRetry={onRetry}
      onDismiss={handleDismiss}
      className={className}
    />
  )
}