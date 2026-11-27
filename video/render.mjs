// Renders a video in two codecs plus a poster into the site's public/ folder.
// Usage (from this folder, after npm install):
//   npm run render                  the prompt formats video (10.4.0)
//   npm run render -- outfits       the Random outfit video (10.7.0)
//   npm run render -- comfyui       the Send to ComfyUI video (10.9.0)
//   npm run render -- setup-loops   the ComfyUI setup guide's two loops
//   npm run render -- all           all of them
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
// The CLI's bin script (not in the package's exports map, so resolve the folder).
const cli = path.join(path.dirname(createRequire(import.meta.url).resolve("@remotion/cli/package.json")), "remotion-cli.js")
const publicDir = path.join(here, "..", "public")
// "What's new" videos: 1.25× the 960×720 layout, sharp at the ~560 px the
// dialog shows them on high-density screens, still small to download.
const WHATS_NEW = { dir: "whats-new", scale: "--scale=1.25", posterSuffix: "-poster.jpg", webmCrf: 46, mp4Crf: 28 }
// Setup guide loops: 960×480 as drawn, for a ~530 px wide step; the poster is
// also what reduced motion shows. Short and flat, so a finer quality stays small.
const SETUP = { dir: "comfyui-setup", scale: "--scale=1", posterSuffix: ".jpg", webmCrf: 36, mp4Crf: 24 }
const VIDEOS = {
  formats: [{ ...WHATS_NEW, composition: "PromptFormats", poster: "PromptFormatsPoster", name: "10.4.0-prompt-formats" }],
  outfits: [{ ...WHATS_NEW, composition: "RandomOutfit", poster: "RandomOutfitPoster", name: "10.7.0-random-outfit" }],
  comfyui: [{ ...WHATS_NEW, composition: "SendToComfy", poster: "SendToComfyPoster", name: "10.9.0-send-to-comfyui" }],
  "setup-loops": [
    { ...SETUP, composition: "ComfyInstallLoop", poster: "ComfyInstallLoopPoster", name: "install" },
    { ...SETUP, composition: "ComfyPublishLoop", poster: "ComfyPublishLoopPoster", name: "publish" },
  ],
}
const which = process.argv[2] ?? "formats"
const picked = which === "all" ? Object.values(VIDEOS).flat() : VIDEOS[which]
if (!picked) {
  console.error(`Unknown video "${which}". Use one of: ${Object.keys(VIDEOS).join(", ")}, all`)
  process.exit(1)
}

function remotion(...args) {
  execFileSync(process.execPath, [cli, ...args], { cwd: here, stdio: "inherit" })
}

// VP9 for browsers that play WebM; H.264 for the rest (Safari). No audio track.
for (const { dir, scale, posterSuffix, webmCrf, mp4Crf, composition, poster, name } of picked) {
  const outDir = path.join(publicDir, dir)
  mkdirSync(outDir, { recursive: true })
  remotion("render", composition, path.join(outDir, `${name}.webm`), "--codec=vp9", `--crf=${webmCrf}`, "--muted", scale)
  remotion("render", composition, path.join(outDir, `${name}.mp4`), "--codec=h264", `--crf=${mp4Crf}`, "--muted", "--pixel-format=yuv420p", scale)
  remotion("still", poster, path.join(outDir, `${name}${posterSuffix}`), "--image-format=jpeg", "--jpeg-quality=82", scale)
}
