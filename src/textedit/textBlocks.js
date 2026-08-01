/**
 * Turning the text already inside a PDF into something a person can edit.
 *
 * pdf.js reports one item per show-text operator. That is somewhere between a
 * word and a line, and never a paragraph — nobody wants to edit "ffi" as a unit.
 * Items are therefore grouped into lines by baseline, and lines into blocks by
 * leading, size and horizontal continuity.
 *
 * All geometry leaves this module as fractions of the page's cropped display
 * box, which is the convention the annotation layer, the search highlights and
 * the redaction marks already use. Using anything else here would put edits in
 * the right place on a plain page and the wrong place on a cropped or rotated
 * one, which is the failure mode that is hardest to notice before export.
 *
 * `layoutTextInBox` lives here rather than in the export module so that the
 * on-screen preview and the exported page wrap and shrink identically. Two
 * implementations of the same fitting rule would drift, and the user would only
 * find out after saving.
 */

import { Util } from 'pdfjs-dist'
import { getPageProxy } from '../utils/pdfRegistry'
import { cropRectInViewport, viewportRotation } from '../viewer/geometry'
import { getBaseFontCSS } from '../utils/richTextUtils'

// --- grouping thresholds ---------------------------------------------------
// All distance thresholds are relative to the em size of the text involved, so
// they hold for 6pt footnotes and 40pt headings alike.

/** Gap between items, over em, that implies a space the PDF never encoded. */
const SPACE_GAP = 0.22
/** Gap on one baseline wide enough to be two columns rather than one sentence. */
const COLUMN_GAP = 2.2
/** Baseline difference still counted as the same line (superscripts, kerning). */
const BASELINE_TOL = 0.32
/** Leading, over em, still counted as the same paragraph. */
const LEADING_MAX = 2.4
/** Font-size ratio still counted as the same paragraph. */
const SIZE_RATIO = 1.35
/** Edge alignment tolerance, over em, when deciding paragraph continuation. */
const EDGE_TOL = 1.6
/** Horizontal overlap a line needs with a block to continue it. */
const OVERLAP_MIN = 0.3
/** How far descenders reach below the baseline, as a fraction of the em. */
const DESCENDER = 0.24
/** Slack above the first line's em box, so tall accents are covered. */
const ASCENT_PAD = 0.04
/** Anything smaller is a rendering artefact, not text a person meant to read. */
const MIN_EM = 1
/** How far back to look for a paragraph to continue. Bounds the grouping cost. */
const BLOCK_SCAN_DEPTH = 16

// --- fitting ---------------------------------------------------------------

/** Smallest fraction of the original size auto-fit is allowed to shrink to. */
export const SHRINK_FLOOR = 0.6
const SHRINK_STEP = 0.05
const MIN_FONT_SIZE = 4

// --- caches ----------------------------------------------------------------

/** geometryKey -> Block[] */
const blockCache = new Map()
const BLOCK_CACHE_LIMIT = 40

/** One rendered page kept for colour sampling. Full-page pixels are not cheap. */
let sampledPage = null

const FAMILY_BY_FALLBACK = {
  serif: 'TimesRoman',
  monospace: 'Courier',
  'sans-serif': 'Helvetica',
}

/**
 * Identity of a page's geometry. Crop and rotation both move every rectangle,
 * so a cached extraction is only valid while they hold.
 */
function geometryKey(page) {
  const c = page.crop
  const crop = c ? `${c.left || 0},${c.right || 0},${c.top || 0},${c.bottom || 0}` : '0'
  return `${page.sourceId}:${page.sourceIndex}:${viewportRotation(page)}:${crop}`
}

/**
 * Editable text blocks for one page.
 *
 * @param {object} page  an EditState page
 * @returns {Promise<Array<object>>} blocks, in reading order
 */
export async function extractTextBlocks(page) {
  const key = geometryKey(page)
  const cached = blockCache.get(key)
  if (cached) return cached

  const proxy = await getPageProxy(page.sourceId, page.sourceIndex)
  const content = await proxy.getTextContent()
  const viewport = proxy.getViewport({ scale: 1, rotation: viewportRotation(page) })
  const crop = cropRectInViewport(page, viewport)
  if (!(crop.width > 0) || !(crop.height > 0)) return []

  const lines = groupLines(collectBoxes(content, viewport, crop, proxy))
  const blocks = groupBlocks(lines)
    .map(block => finishBlock(block, crop))
    .filter(Boolean)

  if (blockCache.size >= BLOCK_CACHE_LIMIT) {
    blockCache.delete(blockCache.keys().next().value)
  }
  blockCache.set(key, blocks)
  return blocks
}

/** Drop every cache. Called when the document is closed. */
export function clearTextBlockCache() {
  blockCache.clear()
  sampledPage = null
}

// ---------------------------------------------------------------------------
// Items -> boxes
// ---------------------------------------------------------------------------

function collectBoxes(content, viewport, crop, proxy) {
  const styles = content.styles || {}
  const boxes = []

  for (let i = 0; i < content.items.length; i++) {
    const item = content.items[i]
    // Marked-content markers have no `str` at all; whitespace-only runs carry no
    // glyphs worth editing and are reconstructed from inter-item gaps instead.
    if (typeof item.str !== 'string' || item.str.trim() === '') continue
    if (!item.transform || item.vertical) continue

    const tx = Util.transform(viewport.transform, item.transform)
    const em = Math.hypot(tx[2], tx[3])
    if (!(em > MIN_EM)) continue

    // Only text that runs left-to-right ON SCREEN can be edited in a plain
    // horizontal box. Because the viewport already carries the page's rotation,
    // this correctly keeps text on a page whose /Rotate is 90 (authored
    // sideways, displayed upright) and correctly rejects text the user has
    // turned a quarter, which really is sideways on screen.
    if (tx[0] <= 0 || Math.abs(tx[1]) > Math.abs(tx[0]) * 0.05) continue

    const width = item.width * viewport.scale
    if (!(width > 0)) continue

    boxes.push({
      index: i,
      str: item.str,
      x: tx[4] - crop.x,
      // tx[5] is the baseline: pdf.js positions items on it, not on their box.
      baseline: tx[5] - crop.y,
      width,
      em,
      ...describeFont(item.fontName, styles, proxy),
    })
  }
  return boxes
}

/**
 * Best available description of the font an item was drawn in.
 *
 * pdf.js only ever exposes a fallback family (serif / sans-serif / monospace)
 * through text content. Weight and slant live on the real font object, which
 * reaches the main thread when the page is rendered to canvas — usually true
 * here, since the user is looking at the page they are editing, but not
 * guaranteed, so it is read defensively.
 */
function describeFont(fontName, styles, proxy) {
  const fontFamily = FAMILY_BY_FALLBACK[styles[fontName]?.fontFamily] || 'Helvetica'
  let bold = false
  let italic = false
  try {
    if (proxy.commonObjs?.has?.(fontName)) {
      const font = proxy.commonObjs.get(fontName)
      bold = Boolean(font?.bold)
      italic = Boolean(font?.italic)
    }
  } catch {
    // The page has not been rendered yet; regular weight is the safer guess.
  }
  return { fontFamily, bold, italic }
}

// ---------------------------------------------------------------------------
// Boxes -> lines
// ---------------------------------------------------------------------------

function groupLines(boxes) {
  const sorted = [...boxes].sort((a, b) => (a.baseline - b.baseline) || (a.x - b.x))

  const rows = []
  for (const box of sorted) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(box.baseline - row.baseline) <= BASELINE_TOL * Math.max(row.em, box.em)) {
      row.items.push(box)
      if (box.em > row.em) row.em = box.em
    } else {
      rows.push({ baseline: box.baseline, em: box.em, items: [box] })
    }
  }

  const lines = []
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x)
    let run = []
    const flush = () => {
      if (run.length > 0) lines.push(makeLine(run))
      run = []
    }
    for (const box of row.items) {
      const prev = run[run.length - 1]
      // Two columns share a baseline but not a sentence. Splitting on the gap
      // is what keeps "Name: Ada" and "Date: 1843" from merging into one line.
      if (prev && box.x - (prev.x + prev.width) > COLUMN_GAP * Math.max(prev.em, box.em)) flush()
      run.push(box)
    }
    flush()
  }

  return lines.sort((a, b) => (a.baseline - b.baseline) || (a.x0 - b.x0))
}

function makeLine(items) {
  let text = ''
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (i > 0) {
      const prev = items[i - 1]
      const gap = item.x - (prev.x + prev.width)
      const spaced = gap > SPACE_GAP * Math.max(prev.em, item.em)
      if (spaced && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' '
    }
    text += item.str
  }

  // The longest run decides the line's style: a leading drop cap or a trailing
  // footnote marker should not rename the whole line's font.
  const dominant = items.reduce((a, b) => (b.str.length > a.str.length ? b : a))
  const last = items[items.length - 1]

  return {
    text: text.replace(/\s+$/, ''),
    index: items[0].index,
    baseline: dominant.baseline,
    em: Math.max(...items.map(i => i.em)),
    x0: items[0].x,
    x1: last.x + last.width,
    fontFamily: dominant.fontFamily,
    bold: dominant.bold,
    italic: dominant.italic,
  }
}

// ---------------------------------------------------------------------------
// Lines -> blocks
// ---------------------------------------------------------------------------

function groupBlocks(lines) {
  const blocks = []
  for (const line of lines) {
    let target = null
    const from = Math.max(0, blocks.length - BLOCK_SCAN_DEPTH)
    for (let i = blocks.length - 1; i >= from; i--) {
      if (continuesBlock(blocks[i], line)) { target = blocks[i]; break }
    }

    if (target) {
      target.lines.push(line)
      target.baseline = line.baseline
      target.em = Math.max(target.em, line.em)
      target.x0 = Math.min(target.x0, line.x0)
      target.x1 = Math.max(target.x1, line.x1)
      target.lastX0 = line.x0
      target.lastX1 = line.x1
    } else {
      blocks.push({
        lines: [line],
        baseline: line.baseline,
        em: line.em,
        x0: line.x0, x1: line.x1,
        lastX0: line.x0, lastX1: line.x1,
      })
    }
  }
  return blocks
}

/**
 * Whether a line belongs to the paragraph a block has open.
 *
 * Deliberately conservative. Over-merging is the worse error: it produces a
 * block that spans unrelated text, and the cover rectangle then wipes out
 * something the user never meant to touch.
 */
function continuesBlock(block, line) {
  const em = Math.max(block.em, line.em)
  const gap = line.baseline - block.baseline
  if (gap <= 0 || gap > LEADING_MAX * em) return false

  const ratio = block.em > line.em ? block.em / line.em : line.em / block.em
  if (ratio > SIZE_RATIO) return false

  const overlap = Math.min(block.x1, line.x1) - Math.max(block.x0, line.x0)
  const narrower = Math.min(block.x1 - block.x0, line.x1 - line.x0)
  if (!(narrower > 0) || overlap < OVERLAP_MIN * narrower) return false

  const tol = EDGE_TOL * em
  return Math.abs(line.x0 - block.lastX0) < tol
    || Math.abs(line.x1 - block.lastX1) < tol
    || Math.abs((line.x0 + line.x1) - (block.lastX0 + block.lastX1)) < 2 * tol
}

function finishBlock(block, crop) {
  const { lines } = block
  const text = lines.map(l => l.text).join('\n')
  if (text.trim() === '') return null

  const fontSize = dominantSize(lines)
  const lineHeight = medianLeading(lines) || fontSize * 1.2
  const dominant = lines.reduce((a, b) => (b.text.length > a.text.length ? b : a))

  const first = lines[0]
  const last = lines[lines.length - 1]
  const top = first.baseline - first.em * (1 + ASCENT_PAD)
  // pdf.js measures an item from its baseline up, so the measured box stops
  // where descenders start. Without this the tails of g, y and p survive the
  // cover rectangle and sit under the replacement text.
  const bottom = last.baseline + fontSize * DESCENDER

  return {
    // Stable across re-extraction of the same page: the index of the leftmost
    // item on the block's first line. Edits reference it, so it must not move.
    id: `blk${first.index}`,
    rect: {
      x: block.x0 / crop.width,
      y: top / crop.height,
      width: Math.max(block.x1 - block.x0, 1) / crop.width,
      height: Math.max(bottom - top, 1) / crop.height,
    },
    /** First line's baseline, as a fraction of display height from the top. */
    baseline: first.baseline / crop.height,
    text,
    lineCount: lines.length,
    fontSize,
    lineHeight,
    fontFamily: dominant.fontFamily,
    bold: dominant.bold,
    italic: dominant.italic,
    align: detectAlign(lines, fontSize),
  }
}

/** The size most of the block's characters are set in. */
function dominantSize(lines) {
  const weights = new Map()
  for (const line of lines) {
    const key = Math.round(line.em * 10) / 10
    weights.set(key, (weights.get(key) || 0) + Math.max(1, line.text.length))
  }
  let best = lines[0].em
  let bestWeight = -1
  for (const [size, weight] of weights) {
    if (weight > bestWeight) { bestWeight = weight; best = size }
  }
  return best
}

function medianLeading(lines) {
  if (lines.length < 2) return 0
  const deltas = []
  for (let i = 1; i < lines.length; i++) deltas.push(lines[i].baseline - lines[i - 1].baseline)
  deltas.sort((a, b) => a - b)
  return deltas[Math.floor(deltas.length / 2)]
}

/**
 * Which edge the block is set against, so a re-wrapped replacement keeps the
 * shape of the original. Checked left first: it is by far the most common, and
 * for a block whose lines happen to be equal width every answer draws the same.
 */
function detectAlign(lines, fontSize) {
  if (lines.length < 2) return 'left'
  const tol = Math.max(1.5, fontSize * 0.15)
  const spread = (values) => Math.max(...values) - Math.min(...values)

  if (spread(lines.map(l => l.x0)) <= tol) return 'left'
  if (spread(lines.map(l => l.x1)) <= tol) return 'right'
  if (spread(lines.map(l => (l.x0 + l.x1) / 2)) <= tol) return 'center'
  return 'left'
}

// ---------------------------------------------------------------------------
// Fitting replacement text
// ---------------------------------------------------------------------------

/**
 * Fit replacement text into the block it replaces.
 *
 * A PDF cannot reflow: the paragraphs around an edit are fixed marks on the
 * page and will not move aside. Text that grows therefore has to go somewhere.
 * This shrinks it to as little as SHRINK_FLOOR of the original size, and if it
 * still does not fit, lets the remainder overflow the block.
 *
 * Overflow rather than truncation is a deliberate choice. Dropping the tail of
 * what the user typed would keep the page tidy while quietly losing their
 * words; an overlap is ugly, but it is visible on screen before saving and can
 * be fixed. Silent data loss cannot.
 *
 * @param {string}   text
 * @param {object}   box     {boxWidth, boxHeight, fontSize, lineHeight} in points
 * @param {function} measure (text, size) => width in the same units
 * @returns {{lines: string[], fontSize: number, lineHeight: number, overflow: boolean}}
 */
export function layoutTextInBox(text, { boxWidth, boxHeight, fontSize, lineHeight }, measure) {
  const baseSize = fontSize > 0 ? fontSize : 11
  const baseLeading = lineHeight > 0 ? lineHeight : baseSize * 1.2

  let result = null
  for (let scale = 1; scale >= SHRINK_FLOOR - 1e-9; scale -= SHRINK_STEP) {
    const size = Math.max(MIN_FONT_SIZE, baseSize * scale)
    const leading = baseLeading * (size / baseSize)
    const lines = wrapText(text, boxWidth, size, measure)
    const used = (lines.length - 1) * leading + size * (1 + DESCENDER)

    result = { lines, fontSize: size, lineHeight: leading, overflow: used > boxHeight + 0.5 }
    if (!result.overflow || size <= MIN_FONT_SIZE) break
  }
  return result
}

function wrapText(text, maxWidth, size, measure) {
  const out = []
  for (const paragraph of String(text ?? '').split('\n')) {
    if (paragraph === '' || !(maxWidth > 0)) {
      out.push(paragraph)
      continue
    }

    let line = ''
    for (const word of paragraph.split(/(\s+)/)) {
      if (word === '') continue
      const candidate = line + word
      if (line !== '' && measure(candidate, size) > maxWidth) {
        out.push(line.replace(/\s+$/, ''))
        // A wrap absorbs the space that caused it, so the next line does not
        // start indented by one space.
        line = /^\s+$/.test(word) ? '' : word
      } else {
        line = candidate
      }
    }
    out.push(line.replace(/\s+$/, ''))
  }
  return out
}

/**
 * A text measurer backed by the browser, for the on-screen preview.
 *
 * Browser metrics for Arial are close to but not identical to the Helvetica
 * metrics pdf-lib will use, so a line that only just fits on screen may wrap
 * differently in the exported file. Close enough to show the user what they are
 * getting; exact agreement would need the AFM tables loaded in the viewer.
 */
export function cssTextMeasurer(fontFamily, bold, italic) {
  const context = measuringContext()
  const family = getBaseFontCSS(fontFamily || 'Helvetica')
  const prefix = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`
  return (text, size) => {
    if (!context) return text.length * size * 0.5
    context.font = `${prefix}${size}px ${family}`
    return context.measureText(text).width
  }
}

let measureContext
function measuringContext() {
  if (measureContext === undefined) {
    measureContext = document.createElement('canvas').getContext('2d') || null
  }
  return measureContext
}

// ---------------------------------------------------------------------------
// Colour sampling
// ---------------------------------------------------------------------------

const SAMPLE_TIMEOUT_MS = 8_000
const MAX_SAMPLES = 20_000
/** How far a colour must sit from the paper before it counts as ink. */
const INK_DISTANCE = 48

/**
 * The paper colour behind a block, and the colour of its ink.
 *
 * Covering an edit with a white rectangle is right on a white page and obvious
 * vandalism on a coloured or scanned one, so the cover colour is read from the
 * page itself. Sampling is cosmetic: if the render fails for any reason this
 * falls back to black on white rather than blocking the edit.
 *
 * @returns {Promise<{background: string, color: string}>} hex colours
 */
export async function sampleBlockAppearance(page, rect) {
  const fallback = { background: '#FFFFFF', color: '#000000' }

  let image
  try {
    image = await renderPageForSampling(page)
  } catch {
    return fallback
  }

  const x0 = clampIndex(Math.floor(rect.x * image.width), image.width)
  const y0 = clampIndex(Math.floor(rect.y * image.height), image.height)
  const x1 = clampIndex(Math.ceil((rect.x + rect.width) * image.width), image.width)
  const y1 = clampIndex(Math.ceil((rect.y + rect.height) * image.height), image.height)
  if (x1 <= x0 || y1 <= y0) return fallback

  const step = Math.max(1, Math.ceil(Math.sqrt(((x1 - x0) * (y1 - y0)) / MAX_SAMPLES)))
  const buckets = new Map()
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const offset = (y * image.width + x) * 4
      const r = image.data[offset]
      const g = image.data[offset + 1]
      const b = image.data[offset + 2]
      // Quantised to 5 bits per channel so antialiasing does not scatter the
      // paper colour across hundreds of near-identical buckets.
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
      const bucket = buckets.get(key)
      if (bucket) {
        bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b
      } else {
        buckets.set(key, { n: 1, r, g, b })
      }
    }
  }
  if (buckets.size === 0) return fallback

  // Glyphs cover a minority of any text block, so the commonest colour is paper.
  let paper = null
  for (const bucket of buckets.values()) if (!paper || bucket.n > paper.n) paper = bucket

  let ink = null
  for (const bucket of buckets.values()) {
    if (bucketDistance(bucket, paper) < INK_DISTANCE) continue
    if (!ink || bucket.n > ink.n) ink = bucket
  }

  return {
    background: bucketHex(paper),
    color: ink ? bucketHex(ink) : (bucketLuminance(paper) > 128 ? '#000000' : '#FFFFFF'),
  }
}

async function renderPageForSampling(page) {
  const key = geometryKey(page)
  if (sampledPage?.key === key) return sampledPage

  // A hidden tab does not composite, so a pdf.js render there can hang until
  // the timeout below expires — a measured 8s stall behind a busy indicator for
  // a colour nobody is currently looking at. Take the default instead.
  if (document.visibilityState === 'hidden') throw new Error('Page is not visible')

  const proxy = await getPageProxy(page.sourceId, page.sourceIndex)
  const viewport = proxy.getViewport({ scale: 1, rotation: viewportRotation(page) })
  const crop = cropRectInViewport(page, viewport)
  const width = Math.max(1, Math.round(crop.width))
  const height = Math.max(1, Math.round(crop.height))

  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height })
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)

  const task = proxy.render({
    canvasContext: context,
    viewport,
    transform: [1, 0, 0, 1, -crop.x, -crop.y],
  })

  // pdf.js renders through the document's compositing pipeline, which can stall
  // indefinitely in a backgrounded tab. This is only used to pick a colour, so
  // a bounded wait and a white fallback beats a click that never resolves.
  let timer
  try {
    await Promise.race([
      task.promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Page render timed out')), SAMPLE_TIMEOUT_MS)
      }),
    ])
  } catch (err) {
    task.cancel()
    throw err
  } finally {
    clearTimeout(timer)
  }

  const { data } = context.getImageData(0, 0, width, height)
  // Release the backing store now; one page of pixels is enough to keep.
  canvas.width = 0
  canvas.height = 0

  sampledPage = { key, data, width, height }
  return sampledPage
}

const clampIndex = (value, limit) => Math.max(0, Math.min(limit, value))

const bucketLuminance = (bucket) => (
  (0.299 * bucket.r + 0.587 * bucket.g + 0.114 * bucket.b) / bucket.n
)

function bucketDistance(a, b) {
  const dr = a.r / a.n - b.r / b.n
  const dg = a.g / a.n - b.g / b.n
  const db = a.b / a.n - b.b / b.n
  return Math.hypot(dr, dg, db)
}

function bucketHex(bucket) {
  const channel = (sum) => {
    const value = Math.round(sum / bucket.n)
    return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')
  }
  return `#${channel(bucket.r)}${channel(bucket.g)}${channel(bucket.b)}`.toUpperCase()
}
