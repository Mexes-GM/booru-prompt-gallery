// Renders the video in two codecs plus a poster into the site's public/ folder.
// Usage: npm run render  (from this folder, after npm install)
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
// The CLI's bin script (not in the package's exports map, so resolve the folder).
const cli = path.join(path.dirname(createRequire(import.meta.url).resolve("@remotion/cli/package.json")), "remotion-cli.js")
const outDir = path.join(here, "..", "public", "whats-new")
const name = "10.4.0-prompt-formats"
mkdirSync(outDir, { recursive: true })

// 1.25× the 960×720 layout: sharp at the ~560 px the dialog shows it on
// high-density screens, still small to download.
const scale = "--scale=1.25"

function remotion(...args) {
  execFileSync(process.execPath, [cli, ...args], { cwd: here, stdio: "inherit" })
}

// VP9 for browsers that play WebM; H.264 for the rest (Safari). No audio track.
remotion("render", "PromptFormats", path.join(outDir, `${name}.webm`), "--codec=vp9", "--crf=46", "--muted", scale)
remotion("render", "PromptFormats", path.join(outDir, `${name}.mp4`), "--codec=h264", "--crf=28", "--muted", "--pixel-format=yuv420p", scale)
remotion("still", "PromptFormatsPoster", path.join(outDir, `${name}-poster.jpg`), "--image-format=jpeg", "--jpeg-quality=82", scale)
