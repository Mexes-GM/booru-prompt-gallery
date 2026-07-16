'use client'

import * as React from 'react'
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from 'next-themes'

// next-themes injects an inline <script> (via React.createElement) to apply
// the resolved theme class before hydration and avoid a flash-of-wrong-theme.
// It's inert on the client (never executed by React) but Next.js 16 /
// React 19 log a dev-only console warning for any <script> tag in the render
// tree, actionable or not. This is a known upstream limitation of next-themes
// (https://github.com/pacocoursey/next-themes/issues/259) — nothing we can
// fix from our side. Silence just this exact message in development so it
// doesn't clutter the console; all other console.error calls pass through
// untouched.
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  const nextThemesScriptWarning = 'Encountered a script tag while rendering'
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes(nextThemesScriptWarning)) {
      return
    }
    originalConsoleError(...args)
  }
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <>{children}</>
  }

  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
