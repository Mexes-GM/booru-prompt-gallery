/**
 * Utility functions for consistent API response handling
 * Centralizes headers, error responses, and status codes
 */

import { NextResponse } from 'next/server'

/**
 * Standard headers for JSON API responses
 * Includes caching directives and content type
 */
export const JSON_RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0'
} as const

/**
 * Headers for health check responses
 * Includes all standard headers plus X-Health-Check identifier
 */
export const HEALTH_CHECK_HEADERS = {
  ...JSON_RESPONSE_HEADERS,
  'X-Health-Check': 'true'
} as const

/**
 * Creates a successful JSON response with standard headers
 * @param data The response data
 * @param status HTTP status code (default: 200)
 * @param additionalHeaders Optional additional headers to merge
 */
export const successResponse = <T>(
  data: T,
  status: number = 200,
  additionalHeaders: Record<string, string> = {}
) => {
  return NextResponse.json(data, {
    status,
    headers: {
      ...JSON_RESPONSE_HEADERS,
      ...additionalHeaders
    }
  })
}

/**
 * Creates an error JSON response with standard headers
 * @param error The error message or error object
 * @param status HTTP status code (default: 500)
 * @param additionalHeaders Optional additional headers to merge
 */
export const errorResponse = (
  error: Error | string,
  status: number = 500,
  additionalHeaders: Record<string, string> = {}
) => {
  const message = error instanceof Error ? error.message : String(error)
  
  return NextResponse.json(
    {
      error: message,
      timestamp: new Date().toISOString()
    },
    {
      status,
      headers: {
        ...JSON_RESPONSE_HEADERS,
        ...additionalHeaders
      }
    }
  )
}

/**
 * Creates a health check response with appropriate headers
 * @param data The health check data
 * @param status HTTP status code
 */
export const healthCheckResponse = <T extends Record<string, unknown>>(
  data: T,
  status: number = 200
) => {
  return NextResponse.json(data, {
    status,
    headers: HEALTH_CHECK_HEADERS
  })
}

/**
 * Safe error handler for try-catch blocks
 * Extracts error message from various error types
 * @param error Unknown error object
 * @returns Formatted error message
 */
export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'Unknown error occurred'
}
