/**
 * Draws the dataset card charts from dist/hf-dataset/tags.parquet (run
 * export-hf-dataset.ts first). Output: dist/hf-dataset/charts/*.html, one
 * self-contained SVG figure each, in the diagram-design editorial skin.
 * Rasterize with scripts/rasterize-charts.py for the README images.
 *
 * Usage: node scripts/export-hf-charts.mjs [--dir=dist/hf-dataset]
 */
import fs from 'fs'
import path from 'path'
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet'

const DIR = path.resolve(process.argv.find((a) => a.startsWith('--dir='))?.slice(6) ?? 'dist/hf-dataset')
const OUT = path.join(DIR, 'charts')
const THRESHOLD = 0.7 // lib/jev-classifier.ts CONFIDENCE_THRESHOLD
const SLOTS = { appearance: 4, clothing: 9, equipment: 2, pose: 8, scenery: 3, creature: 1, other: 6 }

// diagram-design default skin (references/style-guide.md)
const C = {
  paper: '#f5f5f5',
  ink: '#2d3142',
  muted: '#4f5d75',
  accent: '#eb6c36',
  accentTint: 'rgba(235,108,54,0.12)',
  barFill: 'rgba(79,93,117,0.15)',
  grid: 'rgba(45,49,66,0.08)',
  axis: 'rgba(45,49,66,0.25)',
  rule: 'rgba(45,49,66,0.10)',
}
const MONO = `font-family="'Geist Mono', monospace"`
const SANS = `font-family="'Geist', sans-serif"`
const fmt = (n) => n.toLocaleString('en-US')
const pct = (n, total) => `${((n / total) * 100).toFixed(1)}%`

function page({ slug, eyebrow, title, desc, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Geist', system-ui, sans-serif; background: ${C.paper}; color: ${C.ink};
      min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 3rem 2rem; }
    .frame { max-width: 1200px; width: 100%; }
    .eyebrow { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 0.66rem; font-weight: 500;
      letter-spacing: 0.18em; text-transform: uppercase; color: ${C.muted}; margin-bottom: 0.5rem; }
    h1 { font-family: 'Instrument Serif', serif; font-size: clamp(1.5rem, 2.4vw + 0.75rem, 2rem); font-weight: 400;
      letter-spacing: -0.02em; line-height: 1.15; margin-bottom: 1.5rem; }
    svg { width: 100%; min-width: 900px; display: block; }
  </style>
</head>
<body>
  <div class="frame">
    <p class="eyebrow">${eyebrow}</p>
    <h1>${title}</h1>
    <svg viewBox="0 0 1000 520" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${slug}-title ${slug}-desc">
      <title id="${slug}-title">${title}</title>
      <desc id="${slug}-desc">${desc}</desc>
      <rect width="100%" height="100%" fill="${C.paper}"/>
${body}
    </svg>
  </div>
</body>
</html>
`
}

/** Gridlines, y tick labels, axes and the rotated y title for a 0..max column chart. */
function columnAxes(max, step, yTitle) {
  const out = [
    `      <text transform="rotate(-90 24 230)" x="24" y="230" fill="${C.muted}" font-size="7" ${MONO} letter-spacing="0.14em" text-anchor="middle">${yTitle}</text>`,
  ]
  for (let v = step; v <= max; v += step) {
    const y = Math.round(420 - (v / max) * 380)
    out.push(`      <line x1="80" y1="${y}" x2="960" y2="${y}" stroke="${C.grid}" stroke-width="0.8"/>`)
    out.push(`      <text x="72" y="${y + 4}" fill="${C.muted}" font-size="8" ${MONO} text-anchor="end">${fmt(v)}</text>`)
  }
  out.push(`      <text x="72" y="424" fill="${C.muted}" font-size="8" ${MONO} text-anchor="end">0</text>`)
  out.push(`      <line x1="80" y1="40" x2="80" y2="420" stroke="${C.axis}" stroke-width="1"/>`)
  out.push(`      <line x1="80" y1="420" x2="960" y2="420" stroke="${C.axis}" stroke-width="1"/>`)
  return out.join('\n')
}

function legendRow(source, items) {
  const out = [
    `      <line x1="40" y1="464" x2="960" y2="464" stroke="${C.rule}" stroke-width="0.8"/>`,
    `      <text x="40" y="480" fill="${C.muted}" font-size="8" ${MONO} letter-spacing="0.18em">LEGEND</text>`,
    `      <text x="960" y="480" fill="${C.muted}" font-size="8" ${MONO} letter-spacing="0.06em" text-anchor="end">${source}</text>`,
  ]
  let x = 40
  for (const item of items) {
    out.push(`      ${item.key(x)}`)
    out.push(`      <text x="${x + 24}" y="501" fill="${C.muted}" font-size="8.5" ${SANS}>${item.label}</text>`)
    x += item.width
  }
  return out.join('\n')
}

const keyRect = (fill, stroke, dash = '') => (x) =>
  `<rect x="${x}" y="492" width="16" height="10" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`

function categoryBars(rows, snapshot) {
  const approved = rows.filter((r) => r.danbooru_category === 'general' && r.status === 'approved')
  const counts = Object.keys(SLOTS)
    .map((cat) => ({ cat, n: approved.filter((r) => r.category === cat).length }))
    .sort((a, b) => b.n - a.n)
  const max = Math.ceil(counts[0].n / 1000) * 1000
  const pitch = 120
  const barW = 80
  const x0 = 80 + (880 - pitch * counts.length) / 2 + (pitch - barW) / 2
  const body = [columnAxes(max, 1000, 'APPROVED GENERAL TAGS')]
  counts.forEach(({ cat, n }, i) => {
    const focal = i === 0
    const h = Math.round((n / max) * 380)
    const x = x0 + i * pitch
    const y = 420 - h
    const cx = x + barW / 2
    body.push(`      <rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${C.paper}"/>`)
    body.push(
      `      <rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${focal ? C.accentTint : C.barFill}" stroke="${focal ? C.accent : C.muted}" stroke-width="1"/>`
    )
    body.push(
      `      <text x="${cx}" y="${y - 8}" fill="${focal ? C.accent : C.muted}" font-size="8" ${MONO} text-anchor="middle"${focal ? ' font-weight="600"' : ''}>${fmt(n)} · ${pct(n, approved.length)}</text>`
    )
    body.push(`      <text x="${cx}" y="440" fill="${C.ink}" font-size="11" font-weight="600" ${SANS} text-anchor="middle">${cat}</text>`)
    body.push(
      `      <text x="${cx}" y="452" fill="${C.muted}" font-size="8" ${MONO} text-anchor="middle">${SLOTS[cat]} slot${SLOTS[cat] === 1 ? '' : 's'}</text>`
    )
  })
  body.push(
    legendRow(`${fmt(approved.length)} APPROVED GENERAL TAGS · SNAPSHOT ${snapshot}`, [
      { key: keyRect(C.accentTint, C.accent), label: 'clothing · largest category', width: 240 },
      { key: keyRect(C.barFill, C.muted), label: 'other categories', width: 160 },
    ])
  )
  return page({
    slug: 'hf-categories',
    eyebrow: 'Bar chart · Booru Tag Taxonomy',
    title: 'Approved general tags by category',
    desc: `Bar chart of ${fmt(approved.length)} approved general Danbooru tags per taxonomy category; clothing is the largest with ${fmt(counts[0].n)} tags.`,
    body: body.join('\n'),
  })
}

function confidenceHistogram(rows, snapshot) {
  const general = rows.filter((r) => r.danbooru_category === 'general')
  const bins = [
    { label: '< 0.30', lo: 0, hi: 0.3 },
    { label: '0.30–0.49', lo: 0.3, hi: 0.5 },
    { label: '0.50–0.69', lo: 0.5, hi: THRESHOLD },
    { label: '0.70–0.79', lo: THRESHOLD, hi: 0.8 },
    { label: '0.80–0.89', lo: 0.8, hi: 0.9 },
    { label: '0.90–0.99', lo: 0.9, hi: 1 },
    { label: '1.00', lo: 1, hi: Infinity },
  ].map((b) => ({ ...b, n: general.filter((r) => r.confidence >= b.lo && r.confidence < b.hi).length }))
  const max = Math.ceil(Math.max(...bins.map((b) => b.n)) / 1500) * 1500
  const pitch = 120
  const barW = 80
  const x0 = 80 + (880 - pitch * bins.length) / 2 + (pitch - barW) / 2
  const body = [columnAxes(max, 1500, 'GENERAL TAGS')]
  const below = bins.filter((b) => b.hi <= THRESHOLD).reduce((s, b) => s + b.n, 0)
  bins.forEach((b, i) => {
    const review = b.hi <= THRESHOLD
    const h = Math.round((b.n / max) * 380)
    const x = x0 + i * pitch
    const y = 420 - h
    body.push(`      <rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${C.paper}"/>`)
    body.push(
      review
        ? `      <rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="rgba(45,49,66,0.02)" stroke="rgba(45,49,66,0.35)" stroke-width="1" stroke-dasharray="4,3"/>`
        : `      <rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${C.barFill}" stroke="${C.muted}" stroke-width="1"/>`
    )
    body.push(`      <text x="${x + barW / 2}" y="${y - 8}" fill="${C.muted}" font-size="8" ${MONO} text-anchor="middle">${fmt(b.n)}</text>`)
    body.push(`      <text x="${x + barW / 2}" y="440" fill="${C.ink}" font-size="11" font-weight="600" ${SANS} text-anchor="middle">${b.label}</text>`)
  })
  // Threshold: the one focal mark, in the gutter between the last review bin and the first approved one.
  const tx = x0 + 3 * pitch - (pitch - barW) / 2
  body.push(`      <line x1="${tx}" y1="40" x2="${tx}" y2="420" stroke="${C.accent}" stroke-width="1.2" stroke-dasharray="5,4"/>`)
  body.push(`      <rect x="${tx - 112}" y="44" width="104" height="28" rx="2" fill="${C.paper}"/>`)
  body.push(`      <text x="${tx - 12}" y="56" fill="${C.accent}" font-size="8" font-weight="600" ${MONO} text-anchor="end" letter-spacing="0.06em">← NEEDS_REVIEW</text>`)
  body.push(`      <text x="${tx - 12}" y="68" fill="${C.muted}" font-size="8" ${MONO} text-anchor="end">${fmt(below)} · ${pct(below, general.length)}</text>`)
  body.push(`      <rect x="${tx + 8}" y="44" width="104" height="28" rx="2" fill="${C.paper}"/>`)
  body.push(`      <text x="${tx + 12}" y="56" fill="${C.accent}" font-size="8" font-weight="600" ${MONO} letter-spacing="0.06em">APPROVED →</text>`)
  body.push(
    `      <text x="${tx + 12}" y="68" fill="${C.muted}" font-size="8" ${MONO}>${fmt(general.length - below)} · ${pct(general.length - below, general.length)}</text>`
  )
  body.push(
    legendRow(`${fmt(general.length)} GENERAL TAGS · JEV CONFIDENCE · SNAPSHOT ${snapshot}`, [
      { key: keyRect(C.barFill, C.muted), label: 'approved · slot assigned', width: 180 },
      { key: keyRect('rgba(45,49,66,0.02)', 'rgba(45,49,66,0.35)', '4,3'), label: 'needs_review · other:unclassified', width: 220 },
      { key: (x) => `<line x1="${x}" y1="497" x2="${x + 16}" y2="497" stroke="${C.accent}" stroke-width="1.2" stroke-dasharray="5,4"/>`, label: `${THRESHOLD.toFixed(2)} threshold`, width: 140 },
    ])
  )
  return page({
    slug: 'hf-confidence',
    eyebrow: 'Histogram · Booru Tag Taxonomy',
    title: 'Classifier confidence for general tags',
    desc: `Histogram of classifier confidence for ${fmt(general.length)} general tags; ${fmt(below)} fall under the ${THRESHOLD.toFixed(2)} threshold and are left as needs_review.`,
    body: body.join('\n'),
  })
}

/** Squarified treemap (Bruls et al.) of items sorted descending, in rect {x, y, w, h}. */
function squarify(items, rect) {
  const total = items.reduce((s, i) => s + i.n, 0)
  const scale = (rect.w * rect.h) / total
  const out = []
  let rest = items.map((i) => ({ ...i, a: i.n * scale }))
  let { x, y, w, h } = rect
  const worst = (row, side) => {
    const s = row.reduce((t, r) => t + r.a, 0)
    return Math.max(...row.map((r) => Math.max((side * side * r.a) / (s * s), (s * s) / (side * side * r.a))))
  }
  while (rest.length) {
    const side = Math.min(w, h)
    const row = [rest[0]]
    let i = 1
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) row.push(rest[i++])
    rest = rest.slice(i)
    const s = row.reduce((t, r) => t + r.a, 0)
    if (w >= h) {
      const rw = s / h
      let cy = y
      for (const r of row) {
        out.push({ ...r, x, y: cy, w: rw, h: r.a / rw })
        cy += r.a / rw
      }
      x += rw
      w -= rw
    } else {
      const rh = s / w
      let cx = x
      for (const r of row) {
        out.push({ ...r, x: cx, y, w: r.a / rh, h: rh })
        cx += r.a / rh
      }
      y += rh
      h -= rh
    }
  }
  return out
}

function compositionTreemap(rows, snapshot) {
  const total = rows.length
  const names = { general: 'General', character: 'Character', copyright: 'Copyright', meta: 'Meta' }
  const items = Object.keys(names)
    .map((k) => ({ k, n: rows.filter((r) => r.danbooru_category === k).length }))
    .sort((a, b) => b.n - a.n)
  const area = { x: 40, y: 40, w: 920, h: 380 }
  const snap = (v) => Math.round(v / 4) * 4
  const cells = squarify(items, area).map((c) => {
    const x0 = snap(c.x)
    const y0 = snap(c.y)
    const x1 = snap(c.x + c.w)
    const y1 = snap(c.y + c.h)
    // 4px gutter on inner edges only, so the block stays flush with the plot area.
    return { ...c, x: x0, y: y0, w: x1 - x0 - (x1 < 960 ? 4 : 0), h: y1 - y0 - (y1 < 420 ? 4 : 0) }
  })
  const drawnTotal = cells.reduce((s, c) => s + c.w * c.h, 0)
  const ramp = [0.16, 0.12, 0.08, 0.06, 0.04]
  const body = []
  const slivers = []
  cells.forEach((c, i) => {
    const share = (c.n / total) * 100
    const err = (c.w * c.h) / drawnTotal / (c.n / total) - 1
    console.log(`  treemap ${c.k}: share ${share.toFixed(2)}% drawn error ${(err * 100).toFixed(1)}%`)
    const focal = c.k === 'general'
    const fill = focal ? 'rgba(235,108,54,0.16)' : `rgba(45,49,66,${ramp[i]})`
    const stroke = focal ? `stroke="${C.accent}" stroke-width="1.5"` : `stroke="rgba(45,49,66,0.30)" stroke-width="1"`
    body.push(`      <rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="2" fill="${C.paper}"/>`)
    body.push(`      <rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="2" data-share="${share.toFixed(2)}" fill="${fill}" ${stroke}/>`)
    // Name + value fit from ~104px; the mapping line ("→ other:copyright", 9px mono) needs 140.
    if (c.w >= 104 && c.h >= 64) {
      body.push(`      <text x="${c.x + 16}" y="${c.y + 28}" fill="${C.ink}" font-size="13" font-weight="600" ${SANS}>${names[c.k]}</text>`)
      body.push(`      <text x="${c.x + 16}" y="${c.y + 44}" fill="${C.muted}" font-size="9" ${MONO}>${fmt(c.n)} · ${share.toFixed(1)}%</text>`)
      if (focal) {
        body.push(`      <text x="${c.x + 16}" y="${c.y + 60}" fill="${C.accent}" font-size="9" ${MONO}>labelled into 33 slots</text>`)
      } else if (c.w >= 140) {
        body.push(`      <text x="${c.x + 16}" y="${c.y + 60}" fill="${C.muted}" font-size="9" ${MONO}>→ other:${c.k}</text>`)
      }
    } else {
      slivers.push({ ...c, share })
      if (c.w >= 12 && c.h >= 12) {
        const cx = c.x + c.w / 2
        const cy = c.y + c.h / 2
        body.push(`      <circle cx="${cx}" cy="${cy}" r="5" fill="${C.ink}"/>`)
        body.push(`      <text x="${cx}" y="${cy + 3}" fill="${C.paper}" font-size="7" font-weight="600" ${SANS} text-anchor="middle">i</text>`)
      }
    }
  })
  const legend = [
    { key: keyRect('rgba(235,108,54,0.16)', C.accent), label: 'general · labelled into 33 slots', width: 200 },
    { key: keyRect('rgba(45,49,66,0.16)', 'rgba(45,49,66,0.30)'), label: 'mapped by Danbooru type · stronger contrast is larger', width: 300 },
    ...slivers.map((s) => ({
      key: (x) => `<circle cx="${x + 8}" cy="497" r="5" fill="${C.ink}"/><text x="${x + 8}" y="500" fill="${C.paper}" font-size="7" font-weight="600" ${SANS} text-anchor="middle">i</text>`,
      label: `${names[s.k]} · ${fmt(s.n)}, ${s.share.toFixed(1)}% — too small to label`,
      width: 240,
    })),
  ]
  body.push(legendRow(`AREA = TAG COUNT · ${fmt(total)} TAGS · SNAPSHOT ${snapshot}`, legend))
  return page({
    slug: 'hf-composition',
    eyebrow: 'Treemap · Booru Tag Taxonomy',
    title: 'Tags by Danbooru type',
    desc: `Treemap of ${fmt(total)} tags by Danbooru type; the ${fmt(items.find((i) => i.k === "general").n)} general tags are the ones labelled into slots.`,
    body: body.join('\n'),
  })
}

async function main() {
  const file = await asyncBufferFromFile(path.join(DIR, 'tags.parquet'))
  const rows = await parquetReadObjects({ file, columns: ['danbooru_category', 'category', 'status', 'confidence'] })
  const snapshot = fs.statSync(path.join(DIR, 'tags.parquet')).mtime.toISOString().slice(0, 10)
  fs.mkdirSync(OUT, { recursive: true })
  const charts = {
    'composition.html': compositionTreemap(rows, snapshot),
    'categories.html': categoryBars(rows, snapshot),
    'confidence.html': confidenceHistogram(rows, snapshot),
  }
  for (const [name, html] of Object.entries(charts)) fs.writeFileSync(path.join(OUT, name), html, 'utf8')
  console.log(`Wrote ${Object.keys(charts).length} charts to ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
