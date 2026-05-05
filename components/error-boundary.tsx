"use client"

import React from 'react'
import * as Sentry from "@sentry/nextjs"
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
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

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    Sentry.captureException(error, {
      contexts: { react: { componentStack: errorInfo.componentStack } },
    })

    // Check if it's a DOM manipulation error (common with browser translators)
    if (this.isDOMManipulationError(error)) {
      Sentry.setTag('error_type', 'dom_manipulation')
      Sentry.setTag('likely_cause', 'browser_translator')
    }
  }

  resetError = () => {
    this.setState({ hasError: false, error: undefined })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback
        return <FallbackComponent error={this.state.error} resetError={this.resetError} />
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="max-w-md w-full space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Something went wrong. This might be caused by browser translation features.
                Try disabling auto-translate for this site or refresh the page.
              </AlertDescription>
            </Alert>
            
            <div className="flex flex-col gap-2">
              <Button onClick={this.resetError} className="w-full">
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