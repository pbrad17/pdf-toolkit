/**
 * Writing edits to pre-existing PDF text into the exported file.
 *
 * pdf-lib cannot rewrite a page's content stream, so an edit cannot literally
 * replace the glyphs that are already there. What it does instead is cover the
 * original run with a rectangle in the page's own paper colour and draw the
 * replacement on top. That is the same technique every client-side editor uses,
 * and it comes with two limits worth stating plainly rather than discovering
 * after saving:
 *
 *   1. The original glyphs are still in the file. They are hidden, not removed,
 *      and a text extractor will still find them. This is an editing tool, not
 *      a redaction tool — Redact is the one that actually destroys content.
 *   2. Embedded and subsetted fonts cannot be reproduced from pdf-lib's
 *      fourteen standard fonts, so replacement text is drawn in the nearest of
 *      Helvetica, Times or Courier and will not always match the original.
 *
 * Both are surfaced in the Edit Text panel before the user commits to them.
 */

import { layoutTextInBox } from '../textedit/textBlocks'
import { resolveFontKey } from '../utils/richTextUtils'

/**
 * Characters the standard-font WinAnsi encoding can represent. pdf-lib throws
 * on anything else, which would fail the whole export over one pasted glyph, so
 * unrepresentable characters are replaced instead.
 *
 * Written as escapes rather than literal glyphs: the set includes a non-breaking
 * space and a run of look-alike punctuation nobody could verify by eye.
 */
const WIN_ANSI = new RegExp(
  '[\\u0020-\\u007E\\u00A0-\\u00FF'
  + '\\u20AC\\u201A\\u0192\\u201E\\u2026\\u2020\\u2021\\u02C6\\u2030\\u0160\\u2039\\u0152\\u017D'
  + '\\u2018\\u2019\\u201C\\u201D\\u2022\\u2013\\u2014\\u02DC\\u2122\\u0161\\u203A\\u0153\\u017E\\u0178]',
)

/**
 * Apply this page's text edits.
 *
 * @param {import('pdf-lib').PDFPage} target  page currently being written
 * @param {object} config  state.textEdits — a map of pageId -> edit[]. An array
 *                         of edits for this page alone is also accepted.
 * @param {object} ctx     {pdfDoc, getFont, pageIndex, pageCount, pageId, rgb,
 *                          degrees, hexToRgb}
 * @returns {Promise<void>}
 */
export async function applyTextEdits(target, config, ctx) {
  if (!config) return

  const { getFont, rgb, degrees, hexToRgb, pageId } = ctx
  const edits = Array.isArray(config) ? config : config[pageId]
  if (!Array.isArray(edits) || edits.length === 0) return

  // The CropBox, not the MediaBox: pdf.js measures pages against their crop, so
  // that is the box the stored fractions were computed from. On a source file
  // whose CropBox is smaller than its MediaBox the two differ, and using the
  // wrong one puts every edit at an offset.
  const box = target.getCropBox()
  const rotation = ((target.getRotation().angle % 360) + 360) % 360
  const quarterTurned = rotation === 90 || rotation === 270
  const displayWidth = quarterTurned ? box.height : box.width
  const displayHeight = quarterTurned ? box.width : box.height
  if (!(displayWidth > 0) || !(displayHeight > 0)) return

  const toUserSpace = displayMapper(rotation, box)

  for (const edit of edits) {
    if (!edit?.rect) continue

    const left = (edit.rect.x || 0) * displayWidth
    const top = (edit.rect.y || 0) * displayHeight
    const boxWidth = Math.max(0, (edit.rect.width || 0) * displayWidth)
    const boxHeight = Math.max(0, (edit.rect.height || 0) * displayHeight)

    // Every rotation here is a quarter turn, so the mapped rectangle stays
    // axis-aligned in user space and needs no rotation of its own.
    const nearCorner = toUserSpace(left, top)
    const farCorner = toUserSpace(left + boxWidth, top + boxHeight)
    const paper = hexToRgb(edit.background || '#FFFFFF')
    target.drawRectangle({
      x: Math.min(nearCorner.x, farCorner.x),
      y: Math.min(nearCorner.y, farCorner.y),
      width: Math.abs(farCorner.x - nearCorner.x),
      height: Math.abs(farCorner.y - nearCorner.y),
      color: rgb(paper.r, paper.g, paper.b),
      borderWidth: 0,
    })

    const newText = typeof edit.newText === 'string' ? edit.newText : ''
    if (newText.trim() === '') continue // an emptied block is just the cover

    const font = await getFont(resolveFontKey(edit.fontFamily || 'Helvetica', edit.bold, edit.italic))
    const measure = (text, size) => font.widthOfTextAtSize(toWinAnsi(text), size)
    const layout = layoutTextInBox(newText, {
      boxWidth,
      boxHeight,
      fontSize: edit.fontSize,
      lineHeight: edit.lineHeight,
    }, measure)

    const ink = hexToRgb(edit.color || '#000000')
    const color = rgb(ink.r, ink.g, ink.b)
    // Keep the replacement sitting on the original's baseline. The fallback
    // reproduces how the box was measured in the first place, for any edit
    // recorded without one.
    const firstBaseline = edit.baseline != null
      ? edit.baseline * displayHeight
      : top + layout.fontSize

    for (let i = 0; i < layout.lines.length; i++) {
      const line = toWinAnsi(layout.lines[i])
      if (line.trim() === '') continue

      let x = left
      if (edit.align === 'right' || edit.align === 'center') {
        const slack = boxWidth - font.widthOfTextAtSize(line, layout.fontSize)
        x = left + (edit.align === 'right' ? slack : slack / 2)
      }

      const at = toUserSpace(x, firstBaseline + i * layout.lineHeight)
      target.drawText(line, {
        x: at.x,
        y: at.y,
        size: layout.fontSize,
        font,
        color,
        rotate: degrees(rotation),
      })
    }
  }
}

/**
 * Map a point in display space — origin at the top-left of the page as the user
 * sees it, y increasing downward — to PDF user space.
 *
 * Rotation is undone here rather than at edit time because /Rotate is applied by
 * the viewer after the content stream is drawn: text written for a rotated page
 * has to be placed in the unrotated frame and then turned to match.
 */
function displayMapper(rotation, box) {
  const { x, y, width, height } = box
  switch (rotation) {
    case 90: return (dx, dy) => ({ x: x + dy, y: y + dx })
    case 180: return (dx, dy) => ({ x: x + width - dx, y: y + dy })
    case 270: return (dx, dy) => ({ x: x + width - dy, y: y + height - dx })
    default: return (dx, dy) => ({ x: x + dx, y: y + height - dy })
  }
}

function toWinAnsi(text) {
  let out = ''
  for (const character of String(text ?? '').replace(/\t/g, '    ').replace(/\r/g, '')) {
    out += WIN_ANSI.test(character) ? character : '?'
  }
  return out
}
