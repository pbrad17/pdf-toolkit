/**
 * Shared page-edge stamping for header/footer and Bates numbering.
 *
 * Both features put a short line of text against an edge of the page, and both
 * have to survive the same two things: a page the user has rotated, and a page
 * whose boxes were moved by a crop. That maths lives here once. In the old build
 * the two tools each carried their own copy of it and neither handled rotation,
 * so a footer on a turned page came out running down the side.
 *
 * Positions are expressed in DISPLAY space: origin at the top-left of the page
 * as the reader sees it, x right, y down. PDF user space has its origin at the
 * MediaBox corner with y upward and knows nothing about /Rotate, so both are
 * undone here.
 */

import { degrees } from 'pdf-lib'

/** Standard-14 faces offered for stamps. */
export const STAMP_FONTS = ['Helvetica', 'TimesRoman', 'Courier']

/** Largest margin the UI offers, in points. Beyond 1.5in a "margin" is a layout. */
export const MAX_MARGIN = 108

/** Clearance always kept between drawn text and the trimmed page edge, in points. */
const EDGE_CLEARANCE = 2

/** Floor for the shrink-to-fit below. Smaller than this is not a stamp, it is dirt. */
const MIN_FONT_SIZE = 4

/**
 * WinAnsi codepoints outside Latin-1 that the standard-14 fonts still carry.
 * The remaining CP1252 slots (0x81, 0x8D, 0x8F, 0x90, 0x9D) are undefined.
 */
const WINANSI_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'

export const stampFontKey = (family) => (STAMP_FONTS.includes(family) ? family : 'Helvetica')

/**
 * Whether a standard PDF font can draw this character.
 *
 * The standard-14 fonts are WinAnsi-encoded and pdf-lib throws on anything
 * outside that repertoire rather than substituting a glyph. Both the export and
 * the panel warning test against this one predicate, so what the user is told
 * and what actually gets drawn cannot disagree.
 */
function drawable(ch) {
  const cp = ch.codePointAt(0)
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRAS.includes(ch)
}

/** Distinct characters in `text` that no standard font can draw. */
export function unsupportedCharacters(text) {
  const bad = new Set()
  for (const ch of String(text ?? '')) {
    if (!drawable(ch)) bad.add(ch)
  }
  return [...bad]
}

/** One line of drawable text, or '' if nothing survives. */
export function stampableText(raw) {
  let out = ''
  // Newlines and tabs would be drawn as literal glyphs or silently split the
  // line; a stamp is one line by definition, so they collapse to spaces.
  for (const ch of String(raw ?? '').replace(/[\r\n\t]+/g, ' ')) {
    if (drawable(ch)) out += ch
  }
  return out.trim()
}

/**
 * The page's user-space box plus the size the reader actually sees.
 *
 * The MediaBox is read rather than assumed to start at (0,0): export moves both
 * boxes to the crop rectangle, so a cropped page has a non-zero origin and text
 * placed at absolute coordinates would land off the visible area.
 */
export function pageFrame(target) {
  const media = target.getMediaBox()
  // /Rotate is defined only in quarter turns; snapping keeps a malformed file
  // from falling through to the unrotated branch and stamping sideways.
  const raw = Math.round((target.getRotation().angle || 0) / 90) * 90
  const rotation = ((raw % 360) + 360) % 360
  const quarterTurn = rotation === 90 || rotation === 270

  return {
    media,
    rotation,
    width: quarterTurn ? media.height : media.width,
    height: quarterTurn ? media.width : media.height,
  }
}

/** Map a display-space point (x right, y down, origin top-left) into user space. */
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

const clampMargin = (value, extent) => {
  const n = Number(value)
  return Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), extent / 2)
}

/**
 * Size coerced into something pdf-lib will accept.
 *
 * pdf-lib asserts the argument type and throws, and this runs inside the single
 * export pass — a NaN, a negative, or a numeric string arriving from a restored
 * session would abort the user's whole save rather than producing one wrong
 * stamp. Margins were already defended this way; the size was not. `|| 10` in
 * the callers catches NaN and 0 but passes '12' and -5 straight through.
 */
const usableSize = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 10
}

/**
 * Font size reduced until the text fits between the page edges.
 *
 * A Bates number that runs off the paper is worthless in discovery and a header
 * that does is just wrong, so the size gives way rather than the text. The
 * budget is the full page width, not the width between the margins: a long
 * custom header should keep its size and merely eat into its margin, and only
 * shrink once the page itself has run out.
 */
function fittedSize(text, font, size, maxWidth) {
  const width = font.widthOfTextAtSize(text, size)
  if (!(width > maxWidth) || !(maxWidth > 0)) return size
  return Math.max(MIN_FONT_SIZE, (size * maxWidth) / width)
}

/**
 * Draw one line of text against a page edge.
 *
 * @param {import('pdf-lib').PDFPage} target
 * @param {object} frame  from pageFrame(target)
 * @param {object} spec   { text, font, size, color, align, edge, marginX, marginY }
 *                        align: 'left' | 'center' | 'right'; edge: 'top' | 'bottom'
 */
export function drawStamp(target, frame, spec) {
  const text = stampableText(spec.text)
  if (!text) return

  const { font, color, align = 'left', edge = 'bottom' } = spec
  const marginX = clampMargin(spec.marginX, frame.width)
  const marginY = clampMargin(spec.marginY, frame.height)

  const size = fittedSize(text, font, usableSize(spec.size), frame.width - EDGE_CLEARANCE * 2)
  const textWidth = font.widthOfTextAtSize(text, size)
  const ascent = font.heightAtSize(size, { descender: false })
  const descent = Math.max(0, font.heightAtSize(size) - ascent)

  let x
  if (align === 'center') x = (frame.width - textWidth) / 2
  else if (align === 'right') x = frame.width - marginX - textWidth
  else x = marginX
  // Clamped after alignment so a wide string in a right-hand zone slides left
  // instead of hanging off the paper.
  const maxX = Math.max(EDGE_CLEARANCE, frame.width - EDGE_CLEARANCE - textWidth)
  x = Math.min(Math.max(x, EDGE_CLEARANCE), maxX)

  // The margin measures to the ink, not to the baseline: a header sits its
  // ascenders on the margin line and a footer keeps its descenders above the
  // bottom one, so the gap looks the same top and bottom at the same setting.
  const minBaseline = EDGE_CLEARANCE + ascent
  const maxBaseline = Math.max(minBaseline, frame.height - EDGE_CLEARANCE - descent)
  const wanted = edge === 'top' ? marginY + ascent : frame.height - marginY - descent
  const baseline = Math.min(Math.max(wanted, minBaseline), maxBaseline)

  const origin = toUserSpace(x, baseline, frame)

  target.drawText(text, {
    x: origin.x,
    y: origin.y,
    size,
    font,
    color,
    // /Rotate turns the page clockwise for display, so the glyph axes are
    // pre-turned counter-clockwise by the same amount to come out level.
    rotate: degrees(frame.rotation),
  })
}
