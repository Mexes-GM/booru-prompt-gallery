# Contributing to Booru Prompt Gallery

Thanks for your interest in contributing! This project helps AI artists extract and clean prompts from booru image boards.

## Getting Started

1. Fork the repo
2. Clone your fork
3. Copy `.env.example` to `.env` and fill in the required variables (see [README.md](README.md))
4. Install dependencies: `npm install`
5. Start dev server: `npm run dev`

## Project Structure

- `app/` — Next.js App Router pages and API routes
- `components/` — React components (UI primitives in `ui/`, gallery components in `prompt-gallery/`)
- `lib/` — Core logic (booru providers, prompt cleaning, tag conflicts, utilities)
- `hooks/` — Custom React hooks
- `scripts/` — Utility scripts (seeding, analysis)
- `workers/` — Cloudflare Workers (image proxy)
- `supabase/` — Database schema and migrations

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS + shadcn/ui
- **Data Fetching**: SWR
- **Database**: Supabase (PostgreSQL)

## Code Style

- Components/Files: kebab-case
- Types/Interfaces: PascalCase
- Variables/Functions: camelCase
- Use `@/` path alias for all internal imports
- Icons: `lucide-react` only

## Testing

```bash
# Run all tests
node __tests__/run-tests.cjs

# Run a single test
npx ts-node --transpile-only __tests__/your-test.spec.ts
```

## Pull Requests

- Keep changes focused and minimal
- Match existing code style
- Add tests for new functionality
- Update the `Update Notes` panel if adding user-facing features

## Questions?

Open an issue or use the Feedback button in the app.
