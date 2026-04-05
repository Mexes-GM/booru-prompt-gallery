import { NextResponse } from 'next/server'
import { PROVIDER_URLS, PROVIDER_REFERERS } from '@/lib/constants'
import { healthCheckResponse, getErrorMessage } from '@/lib/utils/api-response'

export const runtime = 'edge'

const API_CONFIG = {
  timeout: 5000, // 5 segundos de timeout
}

export async function GET() {
  const startTime = Date.now()
  
  try {
    // Verificar conectividad con las APIs externas
    const healthChecks = await Promise.allSettled([
      // Verificar Danbooru
      fetch(`${PROVIDER_URLS.DANBOORU}/posts.json?limit=1`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(API_CONFIG.timeout)
      }),
      fetch(`${PROVIDER_URLS.AIBOORU}/posts.json?limit=1`, {
        method: 'HEAD', 
        signal: AbortSignal.timeout(API_CONFIG.timeout)
      }),
      fetch(`${PROVIDER_REFERERS.RULE34}index.php?page=dapi&s=post&q=index&json=1&limit=1`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(API_CONFIG.timeout)
      })
    ])
    
    const responseTime = Date.now() - startTime
    
    // Analizar resultados de las verificaciones
    const danbooruStatus = healthChecks[0].status === 'fulfilled' && healthChecks[0].value.ok
    const aibooruStatus = healthChecks[1].status === 'fulfilled' && healthChecks[1].value.ok
    const rule34Status = healthChecks[2].status === 'fulfilled' && healthChecks[2].value.ok
    
    const allHealthy = danbooruStatus && aibooruStatus && rule34Status
    const partiallyHealthy = danbooruStatus || aibooruStatus || rule34Status
    
    let status: 'healthy' | 'degraded' | 'unhealthy'
    let message: string
    
    if (allHealthy) {
      status = 'healthy'
      message = 'Todos los servicios funcionando correctamente'
    } else if (partiallyHealthy) {
      status = 'degraded'
      const workingServices = [
        danbooruStatus && 'Danbooru',
        aibooruStatus && 'Aibooru',
        rule34Status && 'Rule34'
      ].filter(Boolean).join(', ')
      const failingServices = [
        !danbooruStatus && 'Danbooru',
        !aibooruStatus && 'Aibooru',
        !rule34Status && 'Rule34'
      ].filter(Boolean).join(', ')
      message = `Servicio parcialmente disponible - ${workingServices} funcionando, ${failingServices} con problemas`
    } else {
      status = 'unhealthy'
      message = 'Servicios externos no disponibles'
    }
    
    const healthData = {
      status,
      message,
      timestamp: new Date().toISOString(),
      responseTime,
      services: {
        danbooru: {
          status: danbooruStatus ? 'healthy' : 'unhealthy',
          error: healthChecks[0].status === 'rejected' ? healthChecks[0].reason?.message : null
        },
        aibooru: {
          status: aibooruStatus ? 'healthy' : 'unhealthy', 
          error: healthChecks[1].status === 'rejected' ? healthChecks[1].reason?.message : null
        },
        rule34: {
          status: rule34Status ? 'healthy' : 'unhealthy',
          error: healthChecks[2].status === 'rejected' ? healthChecks[2].reason?.message : null
        }
      }
    }
    
    // Retornar código de estado apropiado
    const httpStatus = allHealthy ? 200 : partiallyHealthy ? 207 : 503
    
    return healthCheckResponse(healthData, httpStatus)
    
  } catch (error) {
    const responseTime = Date.now() - startTime
    const errorMessage = getErrorMessage(error)
    
    return healthCheckResponse(
      {
        status: 'unhealthy',
        message: `Error en verificación de salud: ${errorMessage}`,
        timestamp: new Date().toISOString(),
        responseTime,
        error: errorMessage
      },
      503
    )
  }
}