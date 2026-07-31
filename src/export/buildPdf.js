/**
 * Export: turn the working document plus its EditState into PDF bytes.
 *
 * There is exactly one export path. Previously each tool built and downloaded
 * its own file, so applying two tools meant exporting, re-uploading, and
 * exporting again — and any tool that ran second silently discarded work the
 * first had done. Everything now accumulates in EditState and is applied here,
 * once, in a defined order.
 */

import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'
import { effectiveRotation } from '../state/documentModel'
import { getSpans, resolveFontKey } from '../utils/richTextUtils'
import { drawShapePdf } from '../utils/shapeDefinitions'
import { rasterizeRedactedPage, textUnderRedactions, verifyRedaction } from './redaction'

const hexToRgb = (hex) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#000000')
  if (!m) return { r: 0, g: 0, b: 0 }
  return {
    r: parseInt(m[1], 16) / 255,
    g: parseInt(m[2], 16) / 255,
    b: parseInt(m[3], 16) / 255,
  }
}

const toRgb = (hex) => {
  const { r, g, b } = hexToRgb(hex)
  return rgb(r, g, b)
}

/**
 * Build the exported PDF.
 *
 * @param {object}   opts
 * @param {Array}    opts.sources   loaded files, for their raw bytes
 * @param {object}   opts.state     the EditState to apply
 * @param {function} opts.onProgress (fraction, label) => void
 * @returns {Promise<{bytes: Uint8Array, warnings: string[]}>}
 */
export async function buildPdf({ sources, state, onProgress = () => {} }) {
  const warnings = []
  const out = await PDFDocument.create()
  const fontCache = new Map()

  const getFont = async (key) => {
    if (!fontCache.has(key)) fontCache.set(key, await out.embedFont(StandardFonts[key]))
    return fontCache.get(key)
  }

  // Source documents are loaded once and reused; copyPages across many separate
  // loads of the same file would duplicate every shared resource in the output.
  const loaded = new Map()
  for (const src of sources) {
    loaded.set(src.id, await PDFDocument.load(src.bytes, { ignoreEncryption: true }))
  }

  // Text that redaction is expected to destroy, checked against the result.
  const redactedStrings = []

  const total = state.pages.length
  for (let i = 0; i < total; i++) {
    const page = state.pages[i]
    onProgress(i / total, `Writing page ${i + 1} of ${total}`)

    const redactions = state.redactions[page.id] || []
    const marks = (state.annotations[page.id] || []).filter(a => a.type === 'redact')
    const allRedactions = [...redactions, ...marks]

    let target

    if (allRedactions.length > 0) {
      // Redacted pages are rebuilt from a raster so nothing survives beneath
      // the marks. Collect what should disappear first, to verify afterwards.
      try {
        redactedStrings.push(...await textUnderRedactions(page, allRedactions))
      } catch {
        warnings.push(`Page ${i + 1}: could not read text under the redaction marks to verify removal.`)
      }

      const raster = await rasterizeRedactedPage(page, allRedactions)
      const img = await out.embedPng(raster.bytes)
      target = out.addPage([raster.width, raster.height])
      target.drawImage(img, { x: 0, y: 0, width: raster.width, height: raster.height })
    } else {
      const srcDoc = loaded.get(page.sourceId)
      if (!srcDoc) {
        warnings.push(`Page ${i + 1}: source file missing, page skipped.`)
        continue
      }
      const [copied] = await out.copyPages(srcDoc, [page.sourceIndex])
      target = out.addPage(copied)

      // Rotation composes with whatever the source page already carried.
      target.setRotation(degrees(effectiveRotation(page)))

      if (page.crop) {
        // MediaBox and CropBox both move so viewers that honour only one still
        // show the intended region.
        const { width: W, height: H } = page.size
        const left = page.crop.left || 0
        const bottom = page.crop.bottom || 0
        const w = Math.max(1, W - left - (page.crop.right || 0))
        const h = Math.max(1, H - bottom - (page.crop.top || 0))
        target.setMediaBox(left, bottom, w, h)
        target.setCropBox(left, bottom, w, h)
      }
    }

    await drawAnnotations({
      out, target,
      annotations: (state.annotations[page.id] || []).filter(a => a.type !== 'redact'),
      getFont, warnings, pageNumber: i + 1,
    })
  }

  if (state.doc.metadata) applyMetadata(out, state.doc.metadata)

  onProgress(0.95, 'Finalising')
  let bytes = await out.save()

  // The trust claim is only worth making if it is checked.
  if (redactedStrings.length > 0) {
    onProgress(0.98, 'Verifying redactions')
    const check = await verifyRedaction(bytes, redactedStrings)
    if (!check.ok) {
      throw new Error(
        `Redaction verification failed: text that should have been removed is still present in the output (${check.leaked.length} item(s)). ` +
        'The file has not been saved. Please report this — it is a bug, and saving anyway would give you a document that looks redacted but is not.',
      )
    }
  }

  onProgress(1, 'Done')
  return { bytes, warnings }
}

// ---------------------------------------------------------------------------

/**
 * Draw one page's annotations.
 *
 * Annotation coordinates are fractions of the page as displayed, with y
 * measured downward from the top; PDF user space has its origin at the
 * bottom-left, so every y is flipped here.
 */
async function drawAnnotations({ out, target, annotations, getFont, warnings, pageNumber }) {
  if (annotations.length === 0) return

  const { width: pw, height: ph } = target.getSize()

  for (const ann of annotations) {
    const x = (ann.x ?? 0) * pw
    const w = (ann.width ?? 0.15) * pw
    const h = (ann.height ?? 0.04) * ph
    const y = (1 - (ann.y ?? 0)) * ph - h
    const opacity = ann.opacity ?? 1

    try {
      switch (ann.type) {
        case 'highlight':
          target.drawRectangle({
            x, y, width: w, height: h,
            color: toRgb(ann.color || '#FFEB3B'),
            opacity,
          })
          break

        case 'text':
          await drawTextAnnotation({ target, ann, x, y, w, h, pw, getFont, opacity })
          break

        case 'signature':
        case 'image': {
          const isJpeg = /^data:image\/jpe?g/i.test(ann.dataUrl || '')
          const img = isJpeg ? await out.embedJpg(ann.dataUrl) : await out.embedPng(ann.dataUrl)
          const aspect = ann.aspect || img.width / img.height
          const drawH = w / aspect
          target.drawImage(img, { x, y: (1 - ann.y) * ph - drawH, width: w, height: drawH, opacity })
          break
        }

        case 'stamp':
          // Takes the annotation in fractional form and converts internally —
          // passing pre-scaled values here would apply the page size twice.
          drawShapePdf(target, ann, pw, ph, rgb, hexToRgb)
          break

        case 'draw': {
          const pts = ann.points || []
          if (pts.length < 2) break
          const color = toRgb(ann.color || '#000000')
          for (let i = 1; i < pts.length; i++) {
            target.drawLine({
              start: { x: x + pts[i - 1].x * w, y: y + h - pts[i - 1].y * h },
              end: { x: x + pts[i].x * w, y: y + h - pts[i].y * h },
              thickness: ann.strokeWidth || 2,
              color,
              opacity,
            })
          }
          break
        }

        case 'note': {
          // Notes export as a small visible marker plus their text beside it,
          // so the comment survives in viewers that ignore PDF annotations.
          const size = 14
          const noteY = (1 - ann.y) * ph - size
          target.drawRectangle({
            x, y: noteY, width: size, height: size,
            color: toRgb(ann.color || '#FFF176'),
            borderColor: rgb(0.4, 0.4, 0.4),
            borderWidth: 0.5,
          })
          if (ann.text) {
            const font = await getFont('Helvetica')
            target.drawText(ann.text, {
              x: x + size + 4,
              y: noteY + 3,
              size: 8,
              font,
              color: rgb(0.15, 0.15, 0.15),
              maxWidth: pw - x - size - 12,
              lineHeight: 9,
            })
          }
          break
        }

        default:
          break
      }
    } catch (err) {
      warnings.push(`Page ${pageNumber}: could not draw a ${ann.type} annotation (${err.message}).`)
    }
  }
}

/**
 * Rich text with per-span bold/italic, wrapped inside the annotation box.
 *
 * Wrapping measures each word in the font that will actually draw it, because
 * spans within one box can use different faces and a single-font measurement
 * drifts badly by the end of a mixed line.
 */
async function drawTextAnnotation({ target, ann, x, y, w, h, pw, getFont, opacity }) {
  const spans = getSpans(ann)
  if (spans.length === 0) return

  const base = ann.fontFamily || 'Helvetica'
  // Sizes are authored against the page width the annotation was placed on, so
  // they stay proportional if the page is later resized.
  const scale = ann.refWidthPt ? pw / ann.refWidthPt : 1
  const size = (ann.fontSize || 14) * scale
  const lineHeight = size * 1.18
  const color = toRgb(ann.color || '#000000')

  // Flatten spans into words that each remember their own styling.
  const words = []
  for (const span of spans) {
    const fontKey = resolveFontKey(base, span.bold, span.italic)
    const font = await getFont(fontKey)
    for (const part of String(span.text ?? '').split(/(\s+)/)) {
      if (part === '') continue
      words.push({ text: part, font, underline: span.underline, space: /^\s+$/.test(part) })
    }
  }

  let cursorX = x
  let cursorY = y + h - size
  const right = x + w

  for (const word of words) {
    const advance = word.font.widthOfTextAtSize(word.text, size)

    if (word.text.includes('\n')) {
      cursorX = x
      cursorY -= lineHeight * (word.text.split('\n').length - 1)
      continue
    }

    if (cursorX + advance > right && cursorX > x) {
      cursorX = x
      cursorY -= lineHeight
      if (word.space) continue // a wrap absorbs the space that caused it
    }
    if (cursorY < y - lineHeight) break // overflowed the box

    target.drawText(word.text, { x: cursorX, y: cursorY, size, font: word.font, color, opacity })

    if (word.underline && !word.space) {
      target.drawLine({
        start: { x: cursorX, y: cursorY - size * 0.12 },
        end: { x: cursorX + advance, y: cursorY - size * 0.12 },
        thickness: Math.max(0.4, size * 0.06),
        color,
        opacity,
      })
    }
    cursorX += advance
  }
}

function applyMetadata(doc, meta) {
  if (meta.title != null) doc.setTitle(meta.title)
  if (meta.author != null) doc.setAuthor(meta.author)
  if (meta.subject != null) doc.setSubject(meta.subject)
  if (meta.keywords) doc.setKeywords(meta.keywords.split(',').map(s => s.trim()).filter(Boolean))
}
