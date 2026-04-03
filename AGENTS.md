# AGENTS.md — Booru Prompt Gallery

## Project Overview
Next.js 15 (App Router) multi-provider image gallery (Danbooru, Rule34, Aibooru, e621, Gelbooru) with prompt analysis capabilities.

**Stack**: Next.js 15, React 19, Edge Runtime, TypeScript, Tailwind CSS, Shadcn/UI, Supabase, SWR, Framer Motion, Sentry.

---

## Commands & Workflows

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Lint | `npm run lint` |
| Update version | `npm run version:update` |

### Testing (Custom Framework)
**Note**: We do not use Jest or Vitest. Tests are standalone `.spec.ts` scripts located in the `__tests__/` directory.

- **Run all tests**: `node __tests__/run-tests.cjs`
- **Run a single test**: 
  ```bash
  npx ts-node --transpile-only __tests__/your-test.spec.ts
  ```
- **Add a new test**: Create `__tests__/your-test.spec.ts` and add `require('./your-test.spec.ts')` to `__tests__/run-tests.cjs`.

---

## Code Style & Conventions

### Naming
- **Components/Files**: kebab-case (e.g., `image-card.tsx`, `prompt-analyzer.ts`)
- **TypeScript Types/Interfaces**: PascalCase (e.g., `BooruPost`, `SearchOptions`)
- **Variables/Functions**: camelCase
- **CSS Custom Properties**: kebab-case with `--` prefix

### Imports
- **Alias**: Use `@/` path alias for all internal imports (e.g., `@/components/...`, `@/lib/...`).
- **Order**: React/Next → External libraries → Internal `@/` → Relative paths.
- **Icons**: Exclusively use `lucide-react`.

### TypeScript & Linting
- Strict mode is enabled (`strict: true`). Write fully typed code.
- Define explicit interfaces for all API responses (see `lib/booru/types.ts`).
- Avoid `any`, `@ts-ignore`, and `ban-ts-comment` wherever possible.
- Use `interface` for object shapes, and `type` for unions/intersections.

### React / Next.js
- **Server Components by Default**: Prioritize React Server Components and Next.js SSR capabilities.
- **Client Components**: Restrict `'use client'` to minimal, isolated components requiring interactivity, hooks, or browser APIs.
- **Data Fetching**: Prefer `SWR` (`useSWR`, `useSWRInfinite`) for client-side data fetching.
- **States**: Implement loading and error handling states for all data-fetching components.
- **HTML**: Leverage semantic HTML elements throughout.

### Styling & UI
- Use Tailwind CSS with CSS variables for theming (refer to `tailwind.config.ts`).
- Use Shadcn/UI primitives located in `components/ui/`.
- Use `cn()` from `@/lib/utils` for conditional class merging.
- Define custom animations in `tailwind.config.ts` (e.g., `fade-in`, `slide-up`).

### Error Handling & Logging
- **Boundaries**: Implement robust error boundaries and error logging mechanisms.
- **Sentry**: Use `@sentry/nextjs` for production error tracking.
- **Network Errors**: Handle external API calls through `lib/network/smart-fetch.ts` (handles retries, 429 rate limits, and timeouts).
- **API Routes**: Return appropriate HTTP status codes.

---

## Architecture & File Organization

- `app/` — Routing and page layouts exclusively. Complex logic must be moved to `lib/` or custom hooks.
- `components/ui/` — Reusable Shadcn primitives.
- `components/prompt-gallery/` — Domain-specific components.
- `lib/booru/` — Implements the Strategy/Factory pattern for different image providers. **Never hardcode provider logic in components.**
- `lib/api-client.ts` — Main API interface for the frontend.
- `lib/network/` — Centralized API calls, `smart-fetch`, and retry logic.
- `app/api/` — Backend API routes (Edge/Node).
- `supabase/schema.sql` — Database structure context.
- `hooks/` — Custom React hooks.

### Specific Technical Patterns
- **Streaming**: Large file handling and downloads *must* use Web Streams (e.g., `app/api/download`) to prevent memory exhaustion.
- **Prompt Cleaning**: Use `lib/cleanPrompt.ts` utilities for tag processing.
- **Supabase & Auth**:
  - Client initialization is in `lib/supabase.ts`.
  - Admin/Server functions use `lib/supabase-admin.ts` (requires Service Role Key).
  - Auth uses a custom JWT implementation via `jose` (`lib/session.ts`) for Admin access, not standard Supabase Auth.

---

## Agentic AI Rules (Copilot/Cursor)
- **General Rule**: Adhere precisely to user specifications and acknowledge uncertainty rather than speculating.
- **Code Generation**: Produce correct, current, bug-free, fully functional, secure, and efficient code without emitting placeholders, todos, or incomplete sections.
- **Readability vs Performance**: Emphasize readability over performance optimization unless instructed otherwise.
- **Environment**: Node >= 24.12.0 is required. Never commit `.env` or secrets.
- **Skills (Copilot Instructions)**: Always utilize available skills. Specifically, ensure the `vercel-react-best-practices` skill is used where appropriate, and use `chrome-devtools-mcp` if debugging.