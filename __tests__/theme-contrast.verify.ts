/**
 * Text on tinted fills (`bg-primary/15`, `bg-muted/60`…) keeps WCAG AA in both
 * themes. Reads the shipped tokens from app/globals.css and the pairs the UI uses
 * from lib/theme/palette.mjs, composites the tint over each surface the way the
 * browser paints it (sRGB alpha blend) and checks the text against the result.
 *
 * Run with: npx ts-node --project __tests__/tsconfig.json __tests__/theme-contrast.verify.ts
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ramps, tintedPairs, uiBoundaries, uiBoundaryMinContrast } from "../lib/theme/palette.mjs"

type Oklch = [number, number, number]
type Rgb = [number, number, number]

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${label}`)
  }
}

const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8")

/** Token values of one theme block, e.g. `.dark {` → { primary: [L, C, H], … }. */
function themeTokens(selector: string): Record<string, Oklch> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`app/globals.css: missing "${selector} {" block`)
  const block = css.slice(start, css.indexOf("}", start))
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g)].map((m) => [m[1], [+m[2], +m[3], +m[4]] as Oklch]),
  )
}

function toSrgb([L, C, H]: Oklch): Rgb {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return linear.map((v) => {
    const c = Math.min(1, Math.max(0, v))
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
  }) as Rgb
}

const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** `bg-{tint}/{alpha}` painted over `surface`. */
const composite = (tint: Rgb, alpha: number, surface: Rgb) => tint.map((v, i) => alpha * v + (1 - alpha) * surface[i]) as Rgb

const themes = { light: themeTokens(".light"), dark: themeTokens(".dark") } as const

for (const [theme, tokens] of Object.entries(themes) as [keyof typeof themes, Record<string, Oklch>][]) {
  const min = ramps[theme].minContrast
  for (const { fg, tint, alpha, over } of tintedPairs) {
    for (const surface of over) {
      for (const pct of alpha) {
        const ratio = contrast(toSrgb(tokens[fg]), composite(toSrgb(tokens[tint]), pct / 100, toSrgb(tokens[surface])))
        assert(ratio >= min, `${theme} ${fg} on ${tint}/${pct} over ${surface}: ${ratio.toFixed(2)}:1 (needs ${min}:1)`)
      }
    }
  }
}

for (const [theme, tokens] of Object.entries(themes) as [keyof typeof themes, Record<string, Oklch>][]) {
  for (const { color, over } of uiBoundaries) {
    for (const surface of over) {
      const ratio = contrast(toSrgb(tokens[color]), toSrgb(tokens[surface]))
      assert(ratio >= uiBoundaryMinContrast, `${theme} ${color} border over ${surface}: ${ratio.toFixed(2)}:1 (needs ${uiBoundaryMinContrast}:1)`)
    }
  }
}

console.log(`theme-contrast: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
