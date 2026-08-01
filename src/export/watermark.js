/**
 * Watermark: text or an image stamped over every page in scope.
 *
 * All placement is computed in DISPLAY space — origin at the top-left of the
 * page as the reader sees it, y downward, angles counter-clockwise on screen —
 * and mapped into PDF user space only at the point of drawing. Two things fall
 * out of that choice:
 *
 *   - A page carrying /Rotate gets a watermark that reads level against the
 *     page as displayed, instead of one lying on its side.
 *   - The panel preview and the viewer overlay are display space by
 *     construction, so they can share the layout maths below and cannot drift
 *     away from what actually gets written.
 *
 * The geometry helpers are exported for exactly that reason. `applyWatermark`
 * is the only thing the export pass needs.
 */

/** Placement options, in the order the panel offers them. */
export const WATERMARK_POSITIONS = [
  { id: 'center', label: 'Centre' },
  { id: 'tile', label: 'Tiled' },
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
]

/**
 * Ceiling on an uploaded watermark image.
 *
 * The image lives in the edit state as a data URL, and every undo entry holds a
 * structural clone of that state. A 20 MB logo would therefore be paid for
 * sixty times over in history alone, on top of being embedded in the saved
 * file. Five megabytes is already far more than a watermark needs.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * Helvetica's ascender as a fraction of the em, which for this face is also its
 * cap height. The export measures the real embedded font; this constant exists
 * for the preview, which has no font object to ask.
 */
export const ASCENDER_EM = 0.718

/** Margin from the page edge for the corner placements, as a fraction. */
const MARGIN_FRACTION = 0.05

/** Space between tiles, as a fraction of the tile's own size. */
const TILE_GAP_FRACTION = 0.6

/** Upper bound on tiles per page. See watermarkPlacements. */
const MAX_TILES = 240

const clamp = (n, min, max) => Math.min(max, Math.max(min, n))

/** Default watermark settings, merged over anything already stored. */
export function createWatermark(overrides) {
  return {
    kind: 'text',
    text: 'DRAFT',
    dataUrl: null,
    color: '#D0021B',
    fontSize: 72,
    opacity: 0.25,
    /** Degrees counter-clockwise as seen on screen. */
    rotation: 45,
    position: 'center',
    /** Fraction of the page an image watermark is fitted into. */
    imageScale: 0.4,
    /** 'all', or an array of page ids. */
    scope: 'all',
    ...overrides,
  }
}

/**
 * Centres for one watermark on a page, in display space.
 *
 * The item's own size is given unrotated; the rotated bounding box is derived
 * here so corner placements keep their margin and tiles keep their spacing at
 * any angle.
 *
 * @returns {{x:number, y:number}[]}
 */
export function watermarkPlacements({
  boxWidth, boxHeight, itemWidth, itemHeight, position, rotation,
}) {
  if (!(boxWidth > 0) || !(boxHeight > 0) || !(itemWidth > 0) || !(itemHeight > 0)) return []

  const rad = ((rotation || 0) * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const boundW = itemWidth * cos + itemHeight * sin
  const boundH = itemWidth * sin + itemHeight * cos

  if (position === 'tile') {
    let stepX = boundW * (1 + TILE_GAP_FRACTION)
    let stepY = boundH * (1 + TILE_GAP_FRACTION)
    let cols = Math.max(1, Math.ceil(boxWidth / stepX))
    let rows = Math.max(1, Math.ceil(boxHeight / stepY))

    // A small font on a large page can ask for tens of thousands of draws.
    // Spacing the pattern out keeps the page evenly covered; truncating the
    // grid instead would leave half the page bare, which reads as a bug.
    // Rounding up on both axes can overshoot the cap after one pass, so this
    // repeats — the steps grow geometrically, so it converges immediately.
    while (cols * rows > MAX_TILES) {
      const relief = Math.sqrt((cols * rows) / MAX_TILES)
      stepX *= relief
      stepY *= relief
      cols = Math.max(1, Math.ceil(boxWidth / stepX))
      rows = Math.max(1, Math.ceil(boxHeight / stepY))
    }

    // Offsetting by the overhang centres the grid on the page, so the pattern
    // is symmetric rather than flush to the top-left with a bald right edge.
    const offsetX = (boxWidth - cols * stepX) / 2
    const offsetY = (boxHeight - rows * stepY) / 2

    const centres = []
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        centres.push({
          x: offsetX + (col + 0.5) * stepX,
          y: offsetY + (row + 0.5) * stepY,
        })
      }
    }
    return centres
  }

  if (position === 'center' || !position) {
    return [{ x: boxWidth / 2, y: boxHeight / 2 }]
  }

  // One margin for both axes, so a corner watermark sits the same distance from
  // each edge on a page that is much taller than it is wide.
  const margin = Math.min(boxWidth, boxHeight) * MARGIN_FRACTION
  const left = margin + boundW / 2
  const right = boxWidth - margin - boundW / 2
  const top = margin + boundH / 2
  const bottom = boxHeight - margin - boundH / 2

  switch (position) {
    case 'top-left': return [{ x: left, y: top }]
    case 'top-right': return [{ x: right, y: top }]
    case 'bottom-left': return [{ x: left, y: bottom }]
    case 'bottom-right': return [{ x: right, y: bottom }]
    default: return [{ x: boxWidth / 2, y: boxHeight / 2 }]
  }
}

/**
 * Helvetica advance widths in 1/1000 em, straight from the AFM table.
 *
 * The preview has no font object to measure with, so this has to come from
 * somewhere. A per-character-class average was tried first and is not good
 * enough: it runs 11% wide on CONFIDENTIAL — one of the panel's own presets —
 * and 16% wide on mixed-case text, which is enough to put the preview's tile
 * spacing and corner margins visibly out of step with the exported file. Two
 * hundred numbers, held as a string so the source stays readable, is a cheap
 * price for a preview that matches.
 */
const HELVETICA_ASCII = (
  '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 '
  + '556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 '
  + '556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 '
  + '556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 '
  + '500 500 500 334 260 334 584'
).split(' ').map(Number)

const HELVETICA_LATIN1 = (
  '278 333 556 556 556 556 260 556 333 737 370 556 584 333 737 333 400 584 333 333 333 556 '
  + '537 278 333 333 365 556 834 834 834 611 667 667 667 667 667 667 1000 722 667 667 667 667 '
  + '278 278 278 278 722 722 778 778 778 778 778 584 778 722 722 722 722 667 667 611 556 556 '
  + '556 556 556 556 889 500 556 556 556 556 278 278 278 278 556 556 556 556 556 556 556 584 '
  + '611 556 556 556 556 500 556 500'
).split(' ').map(Number)

/**
 * The CP1252 characters the standard-14 fonts still carry outside Latin-1 —
 * the same repertoire src/export/pageStamp.js accepts. Held as codepoint:width
 * pairs because they are scattered across Unicode rather than contiguous. An em
 * dash is worth a full em, and "Acme — Confidential" is a real watermark, so
 * letting it fall through to the stand-in below costs 32pt at 72pt type.
 */
const HELVETICA_EXTRAS = new Map(
  ('8364:556 8218:222 402:556 8222:333 8230:1000 8224:556 8225:556 710:333 '
    + '8240:1000 352:667 8249:333 338:1000 381:611 8216:222 8217:222 8220:333 '
    + '8221:333 8226:350 8211:556 8212:1000 732:333 8482:1000 353:500 8250:333 '
    + '339:944 382:500 376:500')
    .split(' ').map(pair => pair.split(':').map(Number)),
)

/** Stand-in advance for anything no standard font can draw at all. */
const FALLBACK_ADVANCE = 556

/**
 * Helvetica advance width, for the preview.
 *
 * Per-glyph exact across the whole WinAnsi repertoire. pdf-lib additionally
 * applies the AFM kern pairs, which this does not — worth nothing on the
 * presets, about half a percent on a typical phrase, and a few percent on a
 * very short string that happens to be one kerned pair ("To"). That is well
 * inside what tile spacing and a corner margin can absorb; centring does not
 * use the width at all.
 *
 * Characters outside the repertoire are measured at a stand-in width rather
 * than skipped. The export drops them, but the preview still draws whatever
 * the browser has a glyph for, and the preview has to agree with itself about
 * the box that text occupies. The panel warns when a watermark contains any.
 */
export function estimateTextWidth(text, fontSize) {
  let mille = 0
  for (const ch of String(text ?? '')) {
    const cp = ch.codePointAt(0)
    if (cp >= 32 && cp <= 126) mille += HELVETICA_ASCII[cp - 32]
    else if (cp >= 160 && cp <= 255) mille += HELVETICA_LATIN1[cp - 160]
    else mille += HELVETICA_EXTRAS.get(cp) ?? FALLBACK_ADVANCE
  }
  return (mille / 1000) * fontSize
}

/** Size an image watermark is drawn at: fitted inside a fraction of the page. */
export function watermarkImageBox(boxWidth, boxHeight, scale, aspect) {
  const maxWidth = boxWidth * scale
  const maxHeight = boxHeight * scale
  if (!(aspect > 0)) return { width: maxWidth, height: maxHeight }
  const width = Math.min(maxWidth, maxHeight * aspect)
  return { width, height: width / aspect }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Draw the document watermark onto one exported page.
 *
 * @param {import('pdf-lib').PDFPage} target page currently being written
 * @param {object} config `state.doc.watermark`, or null when unset
 * @param {object} ctx    { pdfDoc, getFont, pageIndex, pageCount, pageId,
 *                          rgb, degrees, hexToRgb }
 * @returns {Promise<void>}
 */
export async function applyWatermark(target, config, ctx) {
  if (!config) return
  if (!inScope(config.scope, ctx?.pageId)) return

  // A copy, never the caller's object.
  const settings = createWatermark(config)
  const opacity = clamp(Number(settings.opacity ?? 1), 0, 1)
  if (opacity <= 0) return

  const frame = pageFrame(target)
  if (settings.kind === 'image') await drawImageWatermark(target, settings, ctx, frame, opacity)
  else await drawTextWatermark(target, settings, ctx, frame, opacity)
}

/**
 * Page scoping.
 *
 * An explicit page list with no page id to test against is treated as out of
 * scope. Stamping CONFIDENTIAL across pages the user deliberately excluded is a
 * worse failure than a watermark that does not appear.
 */
function inScope(scope, pageId) {
  if (!Array.isArray(scope)) return true
  if (!pageId) return false
  return scope.includes(pageId)
}

/**
 * The page's user-space box plus the size it presents to the reader.
 * A cropped page is exported with its MediaBox moved onto the crop rectangle,
 * so the origin is read from the box rather than assumed to be (0, 0).
 */
function pageFrame(target) {
  const media = target.getMediaBox()
  // /Rotate is defined only in quarter turns, and a malformed value would
  // otherwise fall through to the unrotated branch while still being added to
  // the drawn angle — a watermark tilted by an arbitrary amount, or by NaN.
  // Snapped the same way src/export/pageStamp.js snaps it.
  const raw = Math.round((target.getRotation().angle || 0) / 90) * 90
  const rotation = ((raw % 360) + 360) % 360
  const quarterTurn = rotation === 90 || rotation === 270
  return {
    media,
    rotation,
    boxWidth: quarterTurn ? media.height : media.width,
    boxHeight: quarterTurn ? media.width : media.height,
  }
}

/** Display space (x right, y down, origin top-left of the page) to user space. */
function toUserSpace(dx, dy, frame) {
  const { media, rotation } = frame
  const mw = media.width
  const mh = media.height

  let px
  let py
  switch (rotation) {
    case 90: px = dy; py = dx; break
    case 180: px = mw - dx; py = dy; break
    case 270: px = mw - dy; py = mh - dx; break
    default: px = dx; py = mh - dy; break
  }
  return { x: media.x + px, y: media.y + py }
}

/**
 * Baseline (or lower-left) anchor that puts an item's centre on a given point.
 *
 * pdf-lib rotates about the anchor it is handed, not about the item's middle,
 * so the anchor has to be walked back from the centre through the same
 * rotation. Placing by x/y alone leaves a rotated watermark hanging off the
 * middle of the page — the further from 0 or 180 degrees, the further off.
 */
function anchorFor(centre, halfWidth, halfHeight, cos, sin) {
  return {
    x: centre.x - halfWidth * cos + halfHeight * sin,
    y: centre.y - halfWidth * sin - halfHeight * cos,
  }
}

async function drawTextWatermark(target, settings, ctx, frame, opacity) {
  const font = await ctx.getFont('Helvetica')
  const text = encodable(font, String(settings.text ?? ''))
  if (!text.trim()) return

  const size = clamp(Number(settings.fontSize) || 72, 1, 2000)
  const width = font.widthOfTextAtSize(text, size)
  // Ascender only. heightAtSize() counts the descender by default, and half of
  // that is not the middle of an upper-case watermark — including it drops the
  // whole stamp visibly below centre.
  const height = font.heightAtSize(size, { descender: false })
  if (!(width > 0) || !(height > 0)) return

  const { r, g, b } = ctx.hexToRgb(settings.color || '#000000')
  const color = ctx.rgb(r, g, b)

  // On screen the user asked for `rotation`; /Rotate turns the page clockwise
  // under it, so user space has to lead by that much to come out level.
  const angle = (Number(settings.rotation) || 0) + frame.rotation
  const rad = (angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const centres = watermarkPlacements({
    boxWidth: frame.boxWidth,
    boxHeight: frame.boxHeight,
    itemWidth: width,
    itemHeight: height,
    position: settings.position,
    rotation: settings.rotation,
  })

  for (const centre of centres) {
    const point = toUserSpace(centre.x, centre.y, frame)
    const anchor = anchorFor(point, width / 2, height / 2, cos, sin)
    target.drawText(text, {
      x: anchor.x,
      y: anchor.y,
      size,
      font,
      color,
      opacity,
      rotate: ctx.degrees(angle),
    })
  }
}

async function drawImageWatermark(target, settings, ctx, frame, opacity) {
  if (!settings.dataUrl) return

  const image = await embedImage(ctx.pdfDoc, settings.dataUrl)
  const scale = clamp(Number(settings.imageScale) || 0.4, 0.02, 1)
  const { width, height } = watermarkImageBox(
    frame.boxWidth, frame.boxHeight, scale, image.width / image.height,
  )
  if (!(width > 0) || !(height > 0)) return

  const angle = (Number(settings.rotation) || 0) + frame.rotation
  const rad = (angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const centres = watermarkPlacements({
    boxWidth: frame.boxWidth,
    boxHeight: frame.boxHeight,
    itemWidth: width,
    itemHeight: height,
    position: settings.position,
    rotation: settings.rotation,
  })

  for (const centre of centres) {
    const point = toUserSpace(centre.x, centre.y, frame)
    const anchor = anchorFor(point, width / 2, height / 2, cos, sin)
    target.drawImage(image, {
      x: anchor.x,
      y: anchor.y,
      width,
      height,
      opacity,
      rotate: ctx.degrees(angle),
    })
  }
}

/**
 * One embed per image per document.
 *
 * pdf-lib writes a fresh copy of the bitmap for every embed call, so embedding
 * the logo again on each page turns a 300 KB image into 60 MB across a
 * 200-page document. Keyed weakly on the output document so nothing is held
 * once the export is finished.
 */
const imageCache = new WeakMap()

function embedImage(pdfDoc, dataUrl) {
  let perDocument = imageCache.get(pdfDoc)
  if (!perDocument) {
    perDocument = new Map()
    imageCache.set(pdfDoc, perDocument)
  }

  if (!perDocument.has(dataUrl)) {
    const isJpeg = /^data:image\/jpe?g/i.test(dataUrl)
    const embedding = (isJpeg ? pdfDoc.embedJpg(dataUrl) : pdfDoc.embedPng(dataUrl))
      .catch(err => {
        // Worth failing the save over: silently dropping the watermark would
        // hand back a file the user believes is marked.
        throw new Error(`The watermark image could not be embedded (${err.message}).`)
      })
    perDocument.set(dataUrl, embedding)
  }
  return perDocument.get(dataUrl)
}

/**
 * Strip characters the standard-14 encoding cannot draw.
 *
 * WinAnsi covers Latin text and nothing else, and pdf-lib throws on anything
 * outside it rather than substituting. Dropping the offending characters keeps
 * the rest of the watermark instead of failing the whole export; the panel
 * warns about this before the file ever gets here.
 */
function encodable(font, text) {
  try {
    font.encodeText(text)
    return text
  } catch {
    // Fall through and salvage what can be drawn.
  }

  let kept = ''
  for (const ch of text) {
    try {
      font.encodeText(ch)
      kept += ch
    } catch {
      // No glyph for this character.
    }
  }
  return kept
}
