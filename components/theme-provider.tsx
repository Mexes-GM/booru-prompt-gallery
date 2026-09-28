'use client'

import * as React from 'react'
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from 'next-themes'

// next-themes injects an inline <script> (via React.createElement) to apply
// the resolved theme class before hydration and avoid a flash-of-wrong-theme.
// It's inert on the client (never executed by React) but Next.js 16 /
// React 19 log two dev-only console warnings for this pattern, neither
// actionable from our side:
// 1. "Encountered a script tag while rendering" — any <script> tag in the
//    render tree triggers this, regardless of whether it's ever executed.
// 2. "flushSync was called from inside a lifecycle method" — next-themes
//    forces a synchronous class update on <html> when applying the theme,
//    which React 19 now warns about during the initial render pass.
// Both are a known upstream limitation of next-themes
// (https://github.com/pacocoursey/next-themes/issues/259,
// https://github.com/shadcn-ui/ui/issues/10104) — nothing we can fix from
// our side. Silence just these exact messages in development so they don't
// clutter the console; all other console.error calls pass through untouched.
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  const suppressedWarnings = [
    'Encountered a script tag while rendering',
    'flushSync was called from inside a lifecycle method',
  ]
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => {
    if (
      typeof args[0] === 'string' &&
      suppressedWarnings.some((warning) => (args[0] as string).includes(warning))
    ) {
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
