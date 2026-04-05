# AGENTS.md — Booru Prompt Gallery

## Project Overview
Next.js 15 (App Router) multi-provider image gallery (Danbooru, Rule34, Aibooru, e621, Gelbooru) with prompt analysis capabilities.

Esta es una app web que permite a los creadores de contenido con IA (Especificamente para SDXL) obtener prompts rapidos y limpios a partir de post en paginas de contenido multimedia anime como Danbooru toamndo los tags de cada post y limpiandolos para obtener un prompt usable. Ademas, la app tiene una galeria de imagenes con filtros avanzados y soporte para varios proveedores (Danbooru, Rule34, Aibooru, e621, Gelbooru).

Lo que hace la pagina es solo tomas informacion de las api y formatear esa informacion para que sea usable.

Ademas hay varias opciones para modificar y personalizar el prompt mucho mas.

A continuacion un Articulo que explica en profundidad la app web:
APP LINK: Booru Prompt Gallery - By Mexes

CHANGELOG: Web App: Booru Prompt Gallery V8.2 | Civitai

TL;DR: Web tool to quickly get clean prompts from Danbooru, Gelbooru, e621, and Aibooru. It removes irrelevant tags, makes adding and managing multiple tags easier, categorizes tags (Appearance, Clothing, Pose, Background), merges redundant tags, and much more! The prompts are mostly designed for Illustrious and Pony; there are plans to try to implement a natural language system, but it is not implemented yet.




Hello! About 4 or 5 months ago, I launched this web app to the public. Since then, it has advanced quite a bit, adding more conveniences, APIs, and useful tools for those who generate AI Art. Because of this, I've decided to remake the article and publish it again to organize everything better and to explain all the new features that might be a bit tricky to understand.

What is this?

Booru Prompt Gallery, as its name suggests, is a gallery... of prompts. What it does is take posts from different digital art websites (like Danbooru), extract the tags that describe them, clean them up, and sort them to leave them ready for generating images. It is extremely useful for people who train LoRAs or AI Artists on social media.



Why did I make it?

As a LoRA model trainer, the most time-consuming part for me was testing the model and creating varied, high-quality examples for its release. So, looking to speed up that part, I made this page.



Feature Breakdown

From here on down, I will describe "what it does and how to use it" for all the tools in this app. I tried to accompany all of them with an image to make it easier to understand; as a result, the article looks much longer. It's not as much text as it seems, trust me! (well, maybe it is a bit too much text).

Basic Operation

You can filter by specific tags. For example, let's say you want examples of Frieren: simply put "frieren" in the search bar and it will start showing you only examples that contain her. This works for any booru tag. After that, just look for one you like and you can copy it completely. (Note: You won't get the exact image, but you will get all the characteristics seen in the image; this depends on how well tagged it is). If you prefer, you also have the option to copy only certain categories, like clothing, for example.



Teach Panel

Dividing tags into categories couldn't be done by magic, so I designed this interface for people who want to collaborate by categorizing each tag. There is an LLM system running in the background; meaning, suggestions go through an AI to quickly determine if the suggestion is correct or not. If the AI says it's incorrect or isn't sure, it goes to human review (which is me). Thank you very much to everyone who decides to collaborate!





Options and Filters





API Providers: Depending on the provider you choose, you will see specific content. For example, the "e621" API is for furry content. Generally, I recommend always using Danbooru, as the tagging is more suitable for Illustrious.



Search bar: This is where you put what you want to see in the examples. You can enter characters, actions, clothing, etc. Due to API limitations, you can only type 1 or 2 tags, depending on the active options.



Blacklist: Here you will place the tags for which you do not want to see examples.



Filter button: This is the typical content shield. Toggle it on or off to see (or hide) that type of content. 



Tags to add: An option to add whatever tags you want to all prompts. Useful if you use LoRAs with trigger words or want to apply styles (realistic, photorealistic, sketch, etc.).




Preset saving: Saves the tags to add. Designed for those who manage multiple tag packs.




Tags to remove: Removes tags from the final prompt on all cards. For example, tags like "solo" or "realistic", which are sometimes found in prompts and might not be desired.




Minimum Tag Count: This option ensures that only prompts with more than a certain amount of tags appear. The higher the number, the more detailed prompts you get; I recommend leaving it around 20-30.




Autocomplete: Not sure how the tag appears on Danbooru? There is a simple autocomplete system to help you type them correctly.




Mode Buttons



1. Favorites

By hovering over a card, you can add it to your favorites to always have it handy.





2. Trending

This is a screen to see what is most popular for the day. I made this feature mostly for AI Artists. You can click directly on the cards to send them to the search engine, or right-click to copy the prompt.



3. Merge

By entering Merge mode, you can combine categories between cards. It is very useful when you want to generate certain characters in different poses, clothes, and backgrounds. You can select more than one category on each card and combine as many cards as you want!







In case there is a tag you aren't interested in, you can simply click it and it will be deleted from the final prompt. 
As you scroll down, there is a paper-shaped button that lets you enter this mode without having to scroll all the way back up to the control panel.


4. Feedback

This button isn't a mode per se, but it's there so you can send me reports, requests, and more. I highly appreciate any reports or feature requests; this helps the web app grow much more and become more useful to everyone!





Quick Navigation Controls







Random Button: Ensures you don't always see the latest results, fetching random content instead. Very useful if you're tired of always seeing the same things in the same order.



Refresh Button: Simply reloads the results in case there are new posts, or to restart the random search.



History Button: Opens a side window showing a timeline of all the tags you have copied previously.



Prompt Generation Options







Include Character: Does exactly that: includes character tags in the prompt.



Smart tag combination: If the prompt has, for example, "hair, long hair, white hair", this function combines them into a single tag: "white long hair". It is useful to avoid redundancy and not saturate the tokenizer.



Global Tag Weights: An option designed for users who like to use weights on their tags.

How do tag weights work?

All tags are clickable. Clicking one opens a panel where you can send the tag directly to search, but the interesting part is that you can increase or decrease its weight. If you set it, for example, to 1.5, this weight is applied to the tag and it's ready to copy with the new configuration.

 

If you enable the Global Tag Weights option, you will unlock a new feature:





If you click the planet icon, you will save that tag as "global".



That weight will automatically be applied to all cards containing said tag.



You can modify and change all the weights you want.
  

You can also modify the weights directly from the Panel Manager, right next to the option.


Image Download

As the name implies, you can quickly download the images by hovering over the image and pressing the download button. Useful if you need the image for ControlNet or IP-Adapter.


Support the App

Do you like the app and want to support me? You can do so through Buzz or Ko-fi donations.

It also helps a lot if you leave your feedback and suggestions.


That’s it!

Stay hydrated and don’t forget to blink.


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