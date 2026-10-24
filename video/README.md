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

`npm run render` writes three files to `public/whats-new/`:

| File | What it is |
|---|---|
| `10.4.0-prompt-formats.webm` | VP9, 1200×900, 30 fps, no audio |
| `10.4.0-prompt-formats.mp4` | H.264 fallback for browsers without WebM |
| `10.4.0-prompt-formats-poster.jpg` | Poster frame (`POSTER_FRAME` in `src/chapters.ts`) |

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
