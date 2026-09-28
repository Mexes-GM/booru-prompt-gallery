# Contributing to Booru Prompt Gallery

Thanks for wanting to help! Bug fixes, new conflict rules, better tag cleaning and UI improvements are all welcome.

## Getting started

1. Fork the repo and clone your fork.
2. Follow [Running it yourself](README.md#running-it-yourself) in the README. In short: `npm install`, copy `.env.example` to `.env.local`, run the worker (`npx wrangler dev` in `workers/booru-image-proxy`), point `NEXT_PUBLIC_IMAGE_PROXY_URL` at it and run `npm run dev`.

You'll need Node.js 24.12+.

## Where things live

| Path | What's there |
|------|--------------|
| `app/` | Pages, admin panel and server actions |
| `components/prompt-gallery/` | The gallery, cards, panels and modes |
| `components/ui/` | shadcn/ui primitives |
| `lib/cleanPrompt.ts` | Prompt cleaning and Smart Tag Combination |
| `lib/tag-conflicts.ts` | Smart Tag Exclusion rules |
| `lib/tag-taxonomy.ts` | The 7 categories and 33 subcategories |
| `lib/prompt/` | How a post becomes a prompt |
| `lib/pack/` | Pack Mode generator and learning |
| `lib/booru/` | Site URLs, tag limits and helpers |
| `lib/theme/` | Color palette (source of the generated theme tokens) |
| `hooks/` | React hooks |
| `workers/booru-image-proxy/` | Cloudflare Worker: data API + image proxy |
| `supabase/migrations/` | Database schema |
| `scripts/` | Data and tag classification scripts |
| `__tests__/` | Verification tests |

## Code style

- Files and components: `kebab-case`. Types: `PascalCase`. Variables and functions: `camelCase`.
- Use the `@/` alias for internal imports.
- Icons come from `lucide-react`.
- Match the code around you: same naming, same comment density, same patterns.
- Don't hardcode colors. They're generated from `lib/theme/palette.mjs`. After changing the palette, run `npm run theme:build` (and `npm run theme:check` to verify contrast). `DESIGN.md` describes the visual system.

## Tests

There's no test framework. Each `__tests__/*.verify.ts` (and `lib/**/*.test.ts`) file checks its own assertions and exits with an error if something fails.

```bash
npm test          # run everything
npm test -- pack  # only the files whose path contains "pack"
```

If you change how prompts are cleaned, combined or generated, add or update a verify file for it.

## Before opening a PR

CI runs these, so it's faster to run them yourself first:

```bash
npm run typecheck
npm test
npm run build
```

If you touched the worker, also run `npx tsc --noEmit` inside `workers/booru-image-proxy`.

Then:

- Keep the PR focused on one thing.
- If it's something users will notice, add a note to the Update Notes panel (`NOTES` in `components/prompt-gallery/update-notes-tab.tsx`).
- If it needs a database change, add a migration in `supabase/migrations/`.

## Questions?

Open an issue, use the Feedback button in the app, or leave a comment on the [Civitai article](https://civitai.com/articles/17747).
