/**
 * Invisible OCR text layer.
 *
 * Recognized words are written into the page with text rendering mode 3, so the
 * exported file is searchable, selectable and copyable while looking byte-for-
 * byte identical on screen. pdf-lib has no API for the render mode, so the
 * content-stream operators are pushed directly.
 *
 * Nothing here ever draws visible ink. A scanned page whose OCR is wrong is a
 * page with imperfect search; a scanned page with visible OCR text stamped over
 * it is a corrupted document, and there is no version of that tradeoff worth
 * taking.
 */

import {
  beginText, endText, popGraphicsState, pushGraphicsState,
  setCharacterSqueeze, setFontAndSize, setTextMatrix, setTextRenderingMode,
  showText, TextRenderingMode,
} from 'pdf-lib'

/**
 * Baseline offset from the bottom of a word box, as a fraction of its height.
 *
 * Tesseract's box tightly bounds the ink. Sitting the baseline on the bottom
 * edge would push every descender out of the box and make selection highlights
 * ride high; a fifth of the height puts Helvetica's descender roughly on the
 * lower edge and its ascender roughly on the upper one.
 */
const BASELINE_FROM_BOTTOM = 0.2

/** Guards against a degenerate box producing an absurd horizontal scale. */
const MIN_SQUEEZE = 1
const MAX_SQUEEZE = 1000

/**
 * Write one page's OCR words as an invisible text layer.
 *
 * @param {import('pdf-lib').PDFPage} target page currently being written
 * @param {object} config `state.ocr` — pageId -> { words }, or one page's entry
 * @param {object} ctx    { pdfDoc, getFont, pageIndex, pageCount, pageId,
 *                          rgb, degrees, hexToRgb }
 * @returns {Promise<void>}
 */
export async function applyOcrLayer(target, config, ctx) {
  if (!config) return

  const words = wordsFor(config, ctx?.pageId)
  if (!words || words.length === 0) return

  const font = await ctx.getFont('Helvetica')
  // One dictionary entry per page, not per word: newFontDictionary appends a
  // fresh randomly-suffixed key each time it is called.
  const fontKey = target.node.newFontDictionary(font.name, font.ref)

  const frame = pageFrame(target)
  const ops = [
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
  ]

  for (const word of words) {
    const op = wordOperators(word, font, fontKey, frame)
    if (op) ops.push(...op)
  }

  ops.push(endText(), popGraphicsState())
  target.pushOperators(...ops)
}

// ---------------------------------------------------------------------------

/**
 * OCR results are stored per page in `state.ocr`, not as a document-wide
 * setting under `state.doc`, because recognition is a property of a page. This
 * accepts either form so it does not matter whether the caller scopes the map
 * before the call or leaves `ctx.pageId` to do it.
 */
function wordsFor(config, pageId) {
  if (Array.isArray(config.words)) return config.words
  if (!pageId) return null
  const entry = config[pageId]
  return Array.isArray(entry?.words) ? entry.words : null
}

/**
 * The page's user-space frame plus the mapping from display space into it.
 *
 * Word geometry is fractions of the page as *displayed* — cropped, rotated, y
 * measured downward. PDF user space has its origin at the MediaBox corner with
 * y upward and knows nothing about /Rotate, so both transforms are undone here.
 * Reading the MediaBox rather than assuming (0,0) matters: a cropped page is
 * exported with its box moved to the crop rectangle, so its origin is offset.
 */
function pageFrame(target) {
  const media = target.getMediaBox()
  const rotation = ((target.getRotation().angle % 360) + 360) % 360
  const quarterTurn = rotation === 90 || rotation === 270

  return {
    media,
    rotation,
    // What the viewer shows, in points.
    boxWidth: quarterTurn ? media.height : media.width,
    boxHeight: quarterTurn ? media.width : media.height,
  }
}

/**
 * Map a point from display space (x right, y down, origin top-left of the
 * displayed page) into PDF user space.
 */
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
 * Text matrix for a page's rotation.
 *
 * /Rotate turns the page clockwise for display, so text has to be pre-rotated
 * counter-clockwise by the same amount to come out level on screen.
 */
function textAxes(rotation) {
  switch (rotation) {
    case 90: return { a: 0, b: 1, c: -1, d: 0 }
    case 180: return { a: -1, b: 0, c: 0, d: -1 }
    case 270: return { a: 0, b: -1, c: 1, d: 0 }
    default: return { a: 1, b: 0, c: 0, d: 1 }
  }
}

function wordOperators(word, font, fontKey, frame) {
  const text = typeof word?.text === 'string' ? word.text.replace(/[\r\n\t]/g, ' ').trim() : ''
  if (!text) return null

  const boxWidth = (word.width ?? 0) * frame.boxWidth
  const boxHeight = (word.height ?? 0) * frame.boxHeight
  if (!(boxWidth > 0) || !(boxHeight > 0)) return null

  const encoded = encodeSafely(font, text)
  if (!encoded) return null

  const size = boxHeight
  const natural = font.widthOfTextAtSize(encoded.text, size)
  if (!(natural > 0)) return null

  // Horizontal scaling stretches Helvetica's advances onto the widths tesseract
  // actually measured, so a text selection tracks the ink underneath it instead
  // of drifting further out of step with every word on the line.
  const squeeze = Math.max(MIN_SQUEEZE, Math.min(MAX_SQUEEZE, (boxWidth / natural) * 100))

  const dx = (word.left ?? 0) * frame.boxWidth
  const baselineDy = (word.top ?? 0) * frame.boxHeight + boxHeight * (1 - BASELINE_FROM_BOTTOM)
  const origin = toUserSpace(dx, baselineDy, frame)
  const axes = textAxes(frame.rotation)

  return [
    setFontAndSize(fontKey, size),
    setCharacterSqueeze(squeeze),
    setTextMatrix(axes.a, axes.b, axes.c, axes.d, origin.x, origin.y),
    showText(encoded.hex),
  ]
}

/**
 * Encode a word for a standard-14 font.
 *
 * WinAnsi covers Latin text and nothing else, and pdf-lib throws on a character
 * it cannot map rather than substituting one. Dropping just the offending
 * characters keeps the rest of the word searchable; dropping the whole word
 * would silently lose a line to one stray glyph.
 */
function encodeSafely(font, text) {
  try {
    return { hex: font.encodeText(text), text }
  } catch {
    let kept = ''
    for (const ch of text) {
      try {
        font.encodeText(ch)
        kept += ch
      } catch {
        // No glyph for this character in WinAnsi.
      }
    }
    if (!kept.trim()) return null
    return { hex: font.encodeText(kept), text: kept }
  }
}
