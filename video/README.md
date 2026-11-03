# Feature videos

[Remotion](https://www.remotion.dev/) source for the short videos shown in the site's "what's new" dialog
(`components/prompt-gallery/feature-intro-dialog.tsx`). This folder has its own `package.json` and is not part of
the Next.js app: nothing here is bundled, type-checked or linted with the site.

## Render

```bash
cd video
npm install
npm run render
```

`npm run render` renders the prompt formats video; `npm run render -- outfits` renders the Random outfit video, and
`npm run render -- all` both. Each writes three files to `public/whats-new/`:

| File | What it is |
|---|---|
| `10.4.0-prompt-formats.webm` | VP9, 1200×900, 30 fps, no audio |
| `10.4.0-prompt-formats.mp4` | H.264 fallback for browsers without WebM |
| `10.4.0-prompt-formats-poster.jpg` | Poster frame (`POSTER_FRAME` in `src/chapters.ts`) |
| `10.7.0-random-outfit.webm` / `.mp4` / `-poster.jpg` | Same, for the Random outfit video (`POSTER_FRAME` in `src/outfit-chapters.ts`) |

`npm run studio` opens Remotion Studio to preview and scrub the composition. `npm run typecheck` checks the source.

## What's in it

- `src/FeatureIntro.tsx` — the composition: five chapters, timed in `src/chapters.ts`.
- `src/ui.tsx` — the site's card, menus, select and switch, drawn at 1.6× their real size with the dark theme
  tokens from `app/globals.css` (copied into `src/theme.ts`).
- `src/data.ts` — the card's prompt in each format.
- `public/danbooru-5513008.jpg` — the post shown on the card ([Danbooru #5513008](https://danbooru.donmai.us/posts/5513008),
  rating general, art by maiii_(smaii_i)).

If you change chapter timings, update `CHAPTERS` in `components/prompt-gallery/feature-intro-dialog.tsx` too: the
dialog lists the chapters, seeks to them and highlights the one playing (seconds = frames / 30).

## Card text

Every prompt in `src/data.ts` is the converter's real output, copied from the site's own card. After a converter
change, collect them again:

1. Run the site (`npm run dev` in the repo root) with the Danbooru source and default Customize prompt options.
2. Search `id:5513008`.
3. Paste this in the browser console and copy the result into `src/data.ts`:

```js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const card = () => document.querySelector('img[alt^="danbooru post 5513008"]').closest(".group")
const read = () => {
  const p = card().querySelector("p")
  return p ? [...p.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim() : null
}
async function as(format, full) {
  localStorage.setItem("prompt-format", JSON.stringify(format))
  localStorage.setItem("prompt-full-detail", JSON.stringify(full))
  window.dispatchEvent(new CustomEvent("booru-storage-update", { detail: { key: "prompt-format" } }))
  await sleep(3500)
  // The tag format has no paragraph: take the card text between the overlays and the Copy button.
  return read() ?? card().innerText.replace(/^[\s\S]*?Full prompt\n/, "").replace(/\nCopy$/, "")
}
const out = { tags: await as("tags", false), anima: await as("anima", false), flux2: await as("flux2", false), flux2Full: await as("flux2", true) }
await as("tags", false)
copy(JSON.stringify(out, null, 2))
```

The "Copy only" counts in `POST.categoryCounts` come from the card's ▾ menu.

## Random outfit video (10.7.0)

- `src/RandomOutfit.tsx` — the composition (`RandomOutfit`, poster still `RandomOutfitPoster`): four chapters, timed in
  `src/outfit-chapters.ts`. It reuses the card and controls from `src/ui.tsx` and draws the Outfit tray from
  `components/prompt-gallery/prompt-generation-options-panel.tsx` and Pack Builder's Clothing row from
  `components/prompt-gallery/pack-category-list.tsx`.
- `src/outfit-data.ts` — the card text, the outfit counts and the Pack Mode pool chips.
- `public/danbooru-12450891.jpg` — the post shown on the card ([Danbooru #12450891](https://danbooru.donmai.us/posts/12450891),
  rating general, art by miyahara_takuya).

As with the first video, keep `CHAPTERS` in `components/prompt-gallery/feature-intro-dialog.tsx` in step with
`src/outfit-chapters.ts` (seconds = frames / 30).

### Card text

Every string in `src/outfit-data.ts` is the site's own output for this post, copied from its card: Danbooru source,
default Customize prompt options (NSFW off, so Lingerie and Sexy stay off), changing only the Outfit settings named in
the comment above each string:

- `OUTFIT_TAGS.original` — Outfit: Keep original.
- `OUTFIT_TAGS.first` — Random outfit with the default styles and Main pieces.
- `OUTFIT_TAGS.second` / `secondFull` — Party switched off, then Main pieces / Full outfit.
- `OUTFIT_FLUX2` — the same outfit as `secondFull` in FLUX.2 · Krea 2 with Keep every detail on; `OUTFIT_SENTENCES`
  is the outfit's part of that text.
- `OUTFIT_COUNTS` — the outfit count above the style tiles, with the default styles and with Party off.
- `PACK_POOL` — Pack Mode with Clothing set to Outfit library (safe pack, Party off, Full outfit): the note's counts
  and the first chips of the pool.

The random outfit depends on the post and the outfit library, so after a change to either, search `id:12450891`, set
the Outfit options above one by one and copy the card text again (the tags format has no paragraph: copy the card text
between the overlays and the Copy button, as in the script above).
