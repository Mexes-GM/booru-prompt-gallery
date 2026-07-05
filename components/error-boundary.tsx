"use client"

import React from 'react'
import * as Sentry from "@sentry/nextjs"
import { getTranslationState } from '@/lib/sentry-tracing'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
  /** Sentry event id for the captured crash — shown to the user so they can report it. */
  eventId?: string
}

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ComponentType<{ error?: Error; resetError: () => void }>
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private errorHandler: ((event: ErrorEvent) => void) | null = null
  private unhandledRejectionHandler: ((event: PromiseRejectionEvent) => void) | null = null

  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  componentDidMount() {
    // Listen for unhandled errors that might not be caught by componentDidCatch
    this.errorHandler = (event: ErrorEvent) => {
      const error = event.error || new Error(event.message)
      if (this.isDOMManipulationError(error)) {
        console.warn('Global DOM manipulation error caught:', error)
        this.setState({ hasError: true, error })
        event.preventDefault()
      }
    }

    this.unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
      const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason))
      if (this.isDOMManipulationError(error)) {
        console.warn('Global promise rejection with DOM error:', error)
        this.setState({ hasError: true, error })
        event.preventDefault()
      }
    }

    window.addEventListener('error', this.errorHandler)
    window.addEventListener('unhandledrejection', this.unhandledRejectionHandler)
  }

  componentWillUnmount() {
    if (this.errorHandler) {
      window.removeEventListener('error', this.errorHandler)
    }
    if (this.unhandledRejectionHandler) {
      window.removeEventListener('unhandledrejection', this.unhandledRejectionHandler)
    }
  }

  isDOMManipulationError(error: Error): boolean {
    return error.name === 'NotFoundError' || 
           error.message.includes('insertBefore') ||
           error.message.includes('removeChild') ||
           error.message.includes('appendChild') ||
           error.message.includes('The node before which the new node is to be inserted is not a child') ||
           error.message.includes('Failed to execute') && (error.message.includes('insertBefore') || error.message.includes('removeChild'))
  }

  isRenderLoopError(error: Error): boolean {
    return error.message.includes('Maximum update depth exceeded') ||
           error.message.includes('#185')
  }

  // The #185 render loop only reproduced for SIGNED-IN users (auth + favorites
  // resolving on mount drive the re-renders). Detect a Supabase session from
  // localStorage so the crash event is tagged signed_in — a key correlation.
  isSignedIn(): boolean | null {
    try {
      if (typeof localStorage === 'undefined') return null
      return Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k))
    } catch {
      return null
    }
  }

  // Detect whether the page is currently being auto-translated by the browser
  // (Google Translate / Chrome mobile). Delegates to the shared snapshot so the
  // boundary and the Sentry beforeSend hook agree. See SENTRY-FULVOUS-ANCHOR-7.
  isLikelyTranslated(): boolean {
    return getTranslationState().detected
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const translation = getTranslationState()
    const isRenderLoop = this.isRenderLoopError(error)
    const isDom = this.isDOMManipulationError(error)

    const errorType = isRenderLoop ? 'render_loop' : isDom ? 'dom_manipulation' : 'react'
    // #185 / DOM errors are attributed to the browser translator when we can
    // detect it live (Google Translate mutating the DOM under React). The old
    // code tagged #185 as 'cache_loop', which misdirected debugging for months.
    const likelyCause = translation.detected
      ? 'browser_translator'
      : isRenderLoop
        ? 'render_loop'
        : isDom
          ? 'dom_no_translation_detected'
          : 'unknown'

    // Tags/contexts are passed to captureException so they land on THIS event
    // (setTag after capture would only affect subsequent events).
    const signedIn = this.isSignedIn()
    const eventId = Sentry.captureException(error, {
      contexts: {
        react: { componentStack: errorInfo.componentStack },
        translation: translation as unknown as Record<string, unknown>,
        auth: { signedIn },
      },
      tags: {
        error_type: errorType,
        likely_cause: likelyCause,
        page_translated: String(translation.detected),
        signed_in: String(signedIn),
      },
    })
    // Surface the id so the fallback UI can show it and the user can report the
    // exact crash back to us (max info if the fix ever regresses).
    this.setState({ eventId })
  }

  resetError = () => {
    this.setState({ hasError: false, error: undefined, eventId: undefined })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback
        return <FallbackComponent error={this.state.error} resetError={this.resetError} />
      }

      const isRenderLoop = this.state.error ? this.isRenderLoopError(this.state.error) : false

      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="max-w-md w-full space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {isRenderLoop
                  ? 'The app hit a rendering error and reloaded this screen. If it keeps happening, please report it using the code below so we can look into it — reloading usually fixes it in the meantime.'
                  : 'Something went wrong. Try again or reload the page. If it keeps happening, please report the code below.'
                }
              </AlertDescription>
            </Alert>
            
            <div className="flex flex-col gap-2">
              {isRenderLoop && (
                <Button
                  onClick={() => {
                    try {
                      Object.keys(localStorage)
                        .filter(k => k.startsWith('booru_fav_cache_'))
                        .forEach(k => localStorage.removeItem(k))
                    } catch { /* localStorage might be inaccessible */ }
                    window.location.reload()
                  }}
                  className="w-full"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Clear Cache &amp; Retry
                </Button>
              )}
              <Button onClick={this.resetError} className="w-full"{...(isRenderLoop ? { variant: 'outline' as const } : {})}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
              
              <Button 
                variant="outline" 
                onClick={() => window.location.reload()} 
                className="w-full"
              >
                Reload Page
              </Button>
            </div>
            
            {this.state.eventId && (
              <p className="text-xs text-center text-muted-foreground">
                Report code: <code className="font-mono select-all">{this.state.eventId}</code>
              </p>
            )}

            {this.state.error && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">
                  Technical Details
                </summary>
                <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                  {this.state.error.message}
                </pre>
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary