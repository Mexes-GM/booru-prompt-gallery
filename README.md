# Booru Prompt Gallery

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat&logo=typescript)](https://www.typescriptlang.org/)

**A multi-provider image gallery that extracts and cleans booru tags into ready-to-use prompts for AI art generation (Illustrious, Pony, SDXL).**

[🌐 Live](https://booru-prompt-gallery.netlify.app) · [📝 Changelog](https://civitai.com/articles/17747) · [☕ Support](https://ko-fi.com/mexes)

---

## What is this?

Booru Prompt Gallery takes posts from digital art websites (Danbooru, Gelbooru, e621, Aibooru, Rule34), extracts their tags, cleans them, and formats them into ready-to-copy prompts. It's designed for LoRA trainers and AI artists who need varied, high-quality prompts quickly.

Instead of manually copying tags from a booru post and cleaning them by hand, you search for a character or concept, browse the results, and copy a clean prompt in one click.

---

## Features

### 🔍 Search & Discovery

- **Multi-provider support** — Danbooru, Gelbooru, e621, Aibooru, and Rule34. Switch between them to access different content pools.
- **Tag search** — Search by character, action, clothing, or any booru tag. Autocomplete helps you find the correct tag format.
- **Random mode** — Get varied results instead of always seeing the latest posts.
- **Blacklist** — Exclude tags you don't want to see.
- **Content filter** — Toggle explicit content on/off with one click.

### 🧹 Prompt Cleaning

- **Tag extraction** — Removes irrelevant metadata, artist tags, rating tags, and redundant information.
- **Smart Tag Exclusion** — 180+ rules that prevent contradictory tags (e.g., a character seen "from behind" won't have "lips" or "cleavage").
- **Category filtering** — Tags are categorized into: **Appearance, Clothing, Pose, Background, Character**. Copy only the categories you need.
- **Smart tag combination** — Merges redundant tags: "hair, long hair, white hair" → "white long hair".
- **Tag removal** — Remove persistent unwanted tags from all prompts (e.g., "solo", "realistic").
- **Minimum tag count** — Only show prompts with enough detail (recommended: 20-30 tags).

### 🎨 Prompt Customization

- **Tags to add** — Inject tags into every prompt. Perfect for LoRA trigger words or style tags ("sketch", "photorealistic").
- **Presets** — Save and load multiple tag packs for different LoRAs or styles.
- **Global Tag Weights** — Assign weights to tags globally. A tag weighted at 1.5 will automatically apply `(tag:1.5)` across all cards.
- **Per-tag weights** — Click any tag to increase or decrease its weight individually.
- **Include/Exclude Character** — Toggle whether character tags appear in the final prompt.

### 📋 Modes

- **Favorites** — Save posts to folders. Syncs across devices via Supabase.
- **Trending** — See what's popular today. Click cards to send them to the search engine.
- **Merge** — Combine categories across multiple posts. Mix character from card A + clothing from card B + background from card C.
- **Feedback** — Report bugs or request features directly from the app.

### 🖼️ Background Options

- **Keep Original** — Leave background tags as-is.
- **Remove All** — Strip all background tags.
- **Replace** — Remove backgrounds, inject custom replacement tags.
- **Random** — Generate unique coherent background colors per card based on dominant colors in the image.

### ⚡ Quick Actions

- **Random button** — Fetch random content to avoid seeing the same results.
- **Refresh button** — Reload results for new posts.
- **History panel** — Timeline of all tags you've copied.
- **Image download** — Download images directly for ControlNet or IP-Adapter.
- **One-click copy** — Copy full prompt or specific categories with a single click.

### 👥 Community

- **Teach Panel** — Help categorize tags. Suggestions go through an LLM verification system before human review.

---

## Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS + shadcn/ui |
| Data Fetching | SWR with infinite scroll |
| Database | Supabase (PostgreSQL) |
| Image Proxy | Cloudflare Workers (edge cache) |
| Error Tracking | Sentry |
| Auth | Supabase Auth (magic links) |
| Animation | Framer Motion |

---

## Quick Start

```bash
git clone https://github.com/Mexes-GM/booru-prompt-gallery.git
cd booru-prompt-gallery
npm install
cp .env.example .env
# Edit .env with your API keys
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

See [`.env.example`](.env.example) for the full list. At minimum:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (admin operations) |
| `NEXT_PUBLIC_IMAGE_PROXY_URL` | Cloudflare Worker for image proxying |
| `DANBOORU_USERNAME` | Danbooru account (for API auth) |
| `DANBOORU_API_KEY` | Danbooru API key |

## Project Structure

```
app/               → Next.js App Router (pages + API routes)
components/
  ui/              → shadcn/ui primitives
  prompt-gallery/  → Gallery-specific components
lib/
  booru/           → Provider implementations (strategy pattern)
  network/         → HTTP client with retries + rate limiting
hooks/             → Custom React hooks
scripts/           → Utilities (seeding, tag analysis)
workers/           → Cloudflare Workers (image proxy)
supabase/          → Database schema + migrations
__tests__/         → Test suite
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run lint` | Run linter |
| `node __tests__/run-tests.cjs` | Run all tests |
| `npx ts-node --transpile-only scripts/analyze-tag-conflicts.ts` | Analyze tag conflict coverage |

## Architecture

### Provider System
Each booru provider implements `IBooruProvider` (Strategy pattern). `lib/booru/factory.ts` instantiates the correct provider based on user selection.

### Smart Tag Exclusion
`lib/tag-conflicts.ts` — 180+ trigger rules preventing contradictory tag combinations. 95.3% coverage across 43 tag families.

### Image Proxy
Danbooru + Gelbooru images route through a Cloudflare Worker for caching and hotlink protection. Other providers serve directly from their CDNs to avoid bandwidth costs.

### Prompt Pipeline
1. Raw post tags → `cleanPrompt()` removes metadata, ratings, deprecated tags
2. Category system separates tags into Appearance / Clothing / Pose / Background / Character
3. Smart tag combination merges redundant modifiers
4. Tag conflicts resolved (e.g., "from behind" blocks frontal anatomy tags)
5. Background options applied
6. Global and per-tag weights applied
7. Final prompt ready to copy

## API Providers

| Provider | Content | Status |
|----------|---------|--------|
| Danbooru | Anime/illustration (best tagging) | ✅ Recommended |
| Gelbooru | Anime/illustration | ✅ |
| e621 | Furry | ✅ |
| Aibooru | AI-generated art | ✅ |
| Rule34 | Explicit content | ✅ |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome!

## License

MIT — see [LICENSE](LICENSE).
