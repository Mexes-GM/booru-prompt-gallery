// Renders a video in two codecs plus a poster into the site's public/ folder.
// Usage (from this folder, after npm install):
//   npm run render                  the prompt formats video (10.4.0)
//   npm run render -- outfits       the Random outfit video (10.7.0)
//   npm run render -- all           both
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
// The CLI's bin script (not in the package's exports map, so resolve the folder).
const cli = path.join(path.dirname(createRequire(import.meta.url).resolve("@remotion/cli/package.json")), "remotion-cli.js")
const outDir = path.join(here, "..", "public", "whats-new")
const VIDEOS = {
  formats: { composition: "PromptFormats", poster: "PromptFormatsPoster", name: "10.4.0-prompt-formats" },
  outfits: { composition: "RandomOutfit", poster: "RandomOutfitPoster", name: "10.7.0-random-outfit" },
}
const which = process.argv[2] ?? "formats"
const picked = which === "all" ? Object.values(VIDEOS) : [VIDEOS[which]]
if (!picked[0]) {
  console.error(`Unknown video "${which}". Use one of: ${Object.keys(VIDEOS).join(", ")}, all`)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

// 1.25× the 960×720 layout: sharp at the ~560 px the dialog shows it on
// high-density screens, still small to download.
const scale = "--scale=1.25"

function remotion(...args) {
  execFileSync(process.execPath, [cli, ...args], { cwd: here, stdio: "inherit" })
}

// VP9 for browsers that play WebM; H.264 for the rest (Safari). No audio track.
for (const { composition, poster, name } of picked) {
  remotion("render", composition, path.join(outDir, `${name}.webm`), "--codec=vp9", "--crf=46", "--muted", scale)
  remotion("render", composition, path.join(outDir, `${name}.mp4`), "--codec=h264", "--crf=28", "--muted", "--pixel-format=yuv420p", scale)
  remotion("still", poster, path.join(outDir, `${name}-poster.jpg`), "--image-format=jpeg", "--jpeg-quality=82", scale)
}
