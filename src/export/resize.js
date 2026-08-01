/**
 * Page resize, applied during export.
 *
 * The panel records intent on the page (`page.resize`); nothing is rebuilt until
 * the single export pass runs, so resizing composes with crop, rotation and
 * annotations instead of racing them.
 *
 * Implementation note, because it deviates from the obvious approach:
 * this does NOT embed the page as a Form XObject and draw it onto a fresh page.
 * It resizes the page in place — the box is moved and the existing content
 * stream is wrapped in a transform. Three reasons:
 *
 *   1. embedPages() captures only /Contents and /Resources. Every interactive
 *      annotation — links, form fields, existing markup — is dropped on the
 *      floor, silently. That is what the tool this replaces did.
 *   2. Flattening a page into an XObject breaks its /StructParents mapping, so
 *      a tagged (accessible) PDF stops being one.
 *   3. Creating a page means the caller has to swap it into the page tree
 *      mid-write. Resizing in place keeps the export contract intact: one page
 *      in, same page out.
 *
 * The tradeoff: wrapping assumes the source content stream balances its q/Q
 * operators. Unbalanced streams are rare and malformed; an XObject would isolate
 * them, at the cost of everything above.
 */

import { PDFArray, PDFDict, PDFName, PDFNumber } from 'pdf-lib'

export const PT_PER_INCH = 72
export const PT_PER_MM = 72 / 25.4

/** PDF page dimensions are limited to 14400 units (200 inches) by the spec. */
export const MIN_PAGE_PT = 36
export const MAX_PAGE_PT = 14400

/** Presets in points, portrait. The panel swaps them for landscape. */
export const PAGE_PRESETS = [
  { id: 'letter', label: 'Letter', note: '8.5 × 11 in', width: 612, height: 792 },
  { id: 'legal', label: 'Legal', note: '8.5 × 14 in', width: 612, height: 1008 },
  { id: 'a4', label: 'A4', note: '210 × 297 mm', width: 595.28, height: 841.89 },
  { id: 'a3', label: 'A3', note: '297 × 420 mm', width: 841.89, height: 1190.55 },
  { id: 'a5', label: 'A5', note: '148 × 210 mm', width: 419.53, height: 595.28 },
  { id: 'tabloid', label: 'Tabloid', note: '11 × 17 in', width: 792, height: 1224 },
]

export const RESIZE_MODES = [
  { id: 'scale', label: 'Scale content to fit', note: 'Keeps the whole page, aspect ratio unchanged.' },
  { id: 'center', label: 'Centre at original size', note: 'Content is not scaled. Anything past the new edge is cut off.' },
]

/** Orient a size without changing which dimension the user typed where. */
export function orientSize({ width, height }, orientation) {
  const flip = orientation === 'landscape' ? height > width : width > height
  return flip ? { width: height, height: width } : { width, height }
}

/**
 * Resize one page.
 *
 * `config` is a page's `resize` entry — `{ width, height, mode }` — or a map of
 * pageId -> entry, scoped by `ctx.pageId` the way `state.ocr` is. Width and
 * height are the size the reader sees, so they are given in display space and
 * swapped back into unrotated page space here when the page is turned a quarter
 * turn. Getting that backwards produces a landscape page for a portrait request
 * on exactly the pages that were rotated.
 *
 * @param {import('pdf-lib').PDFPage} target page currently being written
 * @param {object} config  `state.pages[i].resize`, or pageId -> that
 * @param {object} ctx     { pdfDoc, getFont, pageIndex, pageCount, pageId,
 *                           rgb, degrees, hexToRgb }
 * @returns {Promise<void>}
 */
export async function applyResize(target, config, ctx) {
  const spec = specFor(config, ctx?.pageId)
  if (!spec) return

  const width = clampDimension(spec.width)
  const height = clampDimension(spec.height)
  if (!width || !height) return

  const rotation = ((target.getRotation().angle % 360) + 360) % 360
  const quarterTurn = rotation === 90 || rotation === 270
  const boxWidth = quarterTurn ? height : width
  const boxHeight = quarterTurn ? width : height

  // The CropBox is what a viewer shows and what this app measured the page as,
  // so it — not the MediaBox — is the rectangle being resized. It falls back to
  // the MediaBox when the page declares no crop.
  const source = target.getCropBox()
  if (!(source.width > 0) || !(source.height > 0)) return

  const scale = spec.mode === 'center'
    ? 1
    : Math.min(boxWidth / source.width, boxHeight / source.height)

  const drawnWidth = source.width * scale
  const drawnHeight = source.height * scale

  // Content scales about the user-space origin, not about the page box, so the
  // shift has to undo the old box origin as well as centre the result. A cropped
  // page does not start at (0, 0).
  const dx = (boxWidth - drawnWidth) / 2 - source.x * scale
  const dy = (boxHeight - drawnHeight) / 2 - source.y * scale

  if (scale !== 1) {
    target.scaleContent(scale, scale)
    target.scaleAnnotations(scale, scale)
  }
  if (dx !== 0 || dy !== 0) {
    target.translateContent(dx, dy)
    translateAnnotations(target, dx, dy)
  }

  // The new box starts at the origin: the export pass places annotations as
  // fractions of the page size with no origin offset, so leaving a page boxed at
  // (left, bottom) would push everything drawn afterwards off by the crop.
  setBoxes(target, boxWidth, boxHeight)

  // resetPosition starts a fresh content stream after the wrappers above.
  // Without it, anything drawn later — every annotation on this page — lands
  // inside the transform and is scaled and shifted a second time.
  target.resetPosition()
}

// ---------------------------------------------------------------------------

/**
 * Resolve the entry that applies to the page being written.
 *
 * Accepts a flat entry or a pageId map so it does not matter whether the caller
 * scopes before the call or leaves `ctx.pageId` to do it. An explicit `pageIds`
 * list on a flat config is honoured for the same reason.
 */
function specFor(config, pageId) {
  if (!config) return null

  if (Number.isFinite(config.width) && Number.isFinite(config.height)) {
    if (Array.isArray(config.pageIds) && pageId && !config.pageIds.includes(pageId)) return null
    return config
  }

  if (!pageId) return null
  const entry = config[pageId]
  if (entry && Number.isFinite(entry.width) && Number.isFinite(entry.height)) return entry
  return null
}

function clampDimension(value) {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(MAX_PAGE_PT, Math.max(1, value))
}

/**
 * Only boxes the page already declares are rewritten. Adding a TrimBox or
 * BleedBox a page never had changes how a printer interprets it.
 */
function setBoxes(target, width, height) {
  target.setMediaBox(0, 0, width, height)
  if (target.node.CropBox()) target.setCropBox(0, 0, width, height)
  if (target.node.BleedBox()) target.setBleedBox(0, 0, width, height)
  if (target.node.TrimBox()) target.setTrimBox(0, 0, width, height)
  if (target.node.ArtBox()) target.setArtBox(0, 0, width, height)
}

/** Annotation keys holding absolute coordinates, x and y alternating. */
const POINT_ARRAYS = ['Rect', 'QuadPoints', 'Vertices', 'L', 'CL']

/**
 * Move interactive annotations with the content.
 *
 * pdf-lib ships scaleAnnotations but no translate counterpart, and centring
 * moves everything. Without this a link keeps its old rectangle while the text
 * it belongs to moves — clickable in the wrong place, which is worse than a
 * link that does not work. /RD is a set of edge distances rather than a
 * position, so it scales but must not be translated; scaleAnnotations already
 * handled it.
 */
function translateAnnotations(target, tx, ty) {
  const annots = target.node.Annots()
  if (!annots) return

  for (let i = 0, len = annots.size(); i < len; i++) {
    const annot = annots.lookup(i)
    if (!(annot instanceof PDFDict)) continue

    for (const key of POINT_ARRAYS) {
      const list = annot.lookup(PDFName.of(key))
      if (list instanceof PDFArray) translatePoints(list, tx, ty)
    }

    const inkLists = annot.lookup(PDFName.of('InkList'))
    if (inkLists instanceof PDFArray) {
      for (let k = 0, strokes = inkLists.size(); k < strokes; k++) {
        const stroke = inkLists.lookup(k)
        if (stroke instanceof PDFArray) translatePoints(stroke, tx, ty)
      }
    }
  }
}

function translatePoints(list, tx, ty) {
  for (let i = 0, len = list.size(); i < len; i++) {
    const value = list.lookup(i)
    if (value instanceof PDFNumber) {
      list.set(i, PDFNumber.of(value.asNumber() + (i % 2 === 0 ? tx : ty)))
    }
  }
}
