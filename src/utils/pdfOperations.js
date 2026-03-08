import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib'
import { getSpans, resolveFontKey, getBaseFamily } from './richTextUtils'
import { drawShapePdf } from './shapeDefinitions'

export async function buildFinalPdf(documents, pages, annotations = {}) {
  const finalPdf = await PDFDocument.create()
  const docCache = new Map()
  const fontCache = new Map()
  async function getFont(fontFamily) {
    const key = fontFamily || 'Helvetica'
    if (!fontCache.has(key)) {
      fontCache.set(key, await finalPdf.embedFont(StandardFonts[key]))
    }
    return fontCache.get(key)
  }

  for (const page of pages) {
    if (!docCache.has(page.docId)) {
      const srcDoc = await PDFDocument.load(
        documents.find(d => d.id === page.docId).bytes,
      )
      docCache.set(page.docId, srcDoc)
    }
    const srcDoc = docCache.get(page.docId)
    const [copiedPage] = await finalPdf.copyPages(srcDoc, [page.pageIndex])
    if (page.rotation) {
      const currentRotation = copiedPage.getRotation().angle
      copiedPage.setRotation(degrees(currentRotation + page.rotation))
    }
    finalPdf.addPage(copiedPage)

    // Apply annotations for this page
    const pageAnnotations = annotations[page.id] || []
    const { width: pageW, height: pageH } = copiedPage.getSize()

    for (const ann of pageAnnotations) {
      if (ann.type === 'text') {
        const color = hexToRgb(ann.color || '#000000')
        const size = ann.fontSize || 14
        const x = ann.x * pageW
        const boxWidth = (ann.width || 0.2) * pageW
        const boxHeight = (ann.height || 0.05) * pageH
        const lineHeight = size * 1.2
        const topY = (1 - ann.y) * pageH

        const spans = getSpans(ann)
        const baseFamily = getBaseFamily(ann.fontFamily)

        // Wrap spans into lines
        const lines = await wrapSpanText(spans, baseFamily, size, boxWidth, getFont)
        const maxLines = Math.floor(boxHeight / lineHeight)
        const clippedLines = lines.slice(0, maxLines || 1)

        for (let i = 0; i < clippedLines.length; i++) {
          const lineY = topY - (i + 1) * lineHeight
          if (lineY < topY - boxHeight) break

          let xOffset = x
          for (const seg of clippedLines[i]) {
            if (!seg.text) continue
            const segFont = await getFont(seg.fontKey)
            copiedPage.drawText(seg.text, {
              x: xOffset,
              y: lineY,
              size,
              font: segFont,
              color: rgb(color.r, color.g, color.b),
            })
            const segWidth = segFont.widthOfTextAtSize(seg.text, size)
            // Draw underline
            if (seg.underline) {
              copiedPage.drawLine({
                start: { x: xOffset, y: lineY - size * 0.15 },
                end: { x: xOffset + segWidth, y: lineY - size * 0.15 },
                thickness: size * 0.05,
                color: rgb(color.r, color.g, color.b),
              })
            }
            xOffset += segWidth
          }
        }
      } else if (ann.type === 'stamp') {
        drawShapePdf(copiedPage, ann, pageW, pageH, rgb, hexToRgb)
      } else if (ann.type === 'draw' && ann.points && ann.points.length >= 2) {
        const color = hexToRgb(ann.strokeColor || '#000000')
        const borderColor = rgb(color.r, color.g, color.b)
        const bboxW = (ann.width || 0.1) * pageW
        const bboxH = (ann.height || 0.05) * pageH
        const bboxX = ann.x * pageW
        const bboxTopY = (1 - ann.y) * pageH
        const scaledThickness = (ann.strokeWidth || 2) * (pageW / 700)

        for (let i = 0; i < ann.points.length - 1; i++) {
          const [x1n, y1n] = ann.points[i]
          const [x2n, y2n] = ann.points[i + 1]
          copiedPage.drawLine({
            start: { x: bboxX + x1n * bboxW, y: bboxTopY - y1n * bboxH },
            end: { x: bboxX + x2n * bboxW, y: bboxTopY - y2n * bboxH },
            thickness: scaledThickness,
            color: borderColor,
          })
        }
      } else if (ann.type === 'signature' || ann.type === 'image') {
        const imgBytes = dataUrlToBytes(ann.dataUrl)
        const isJpeg = ann.dataUrl.startsWith('data:image/jpeg') || ann.dataUrl.startsWith('data:image/jpg')
        const embeddedImage = isJpeg
          ? await finalPdf.embedJpg(imgBytes)
          : await finalPdf.embedPng(imgBytes)
        const imgDims = embeddedImage.scale(1)
        const imgWidth = ann.width * pageW
        const imgHeight = (imgDims.height / imgDims.width) * imgWidth
        const x = ann.x * pageW
        const y = (1 - ann.y) * pageH - imgHeight
        copiedPage.drawImage(embeddedImage, {
          x,
          y,
          width: imgWidth,
          height: imgHeight,
        })
      }
    }
  }

  return finalPdf.save()
}

export async function buildExtractPdf(documents, pages, selectedIds, annotations = {}) {
  const selected = pages.filter(p => selectedIds.has(p.id))
  return buildFinalPdf(documents, selected, annotations)
}

export async function countFormFields(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  try {
    const form = doc.getForm()
    return form.getFields().length
  } catch {
    return 0
  }
}

export async function flattenForms(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes)
  try {
    const form = doc.getForm()
    form.flatten()
  } catch {
    // no form to flatten
  }
  return doc.save()
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? { r: parseInt(result[1], 16) / 255, g: parseInt(result[2], 16) / 255, b: parseInt(result[3], 16) / 255 }
    : { r: 0, g: 0, b: 0 }
}

async function wrapSpanText(spans, baseFamily, fontSize, maxWidth, getFontFn) {
  // lines = array of arrays of { text, fontKey, underline }
  const lines = [[]]

  for (const span of spans) {
    const fontKey = resolveFontKey(baseFamily, span.bold, span.italic)
    const font = await getFontFn(fontKey)
    // Split on explicit newlines first
    const parts = span.text.split('\n')

    for (let p = 0; p < parts.length; p++) {
      if (p > 0) lines.push([]) // newline → new line
      const part = parts[p]
      if (!part) continue

      const words = part.split(/( +)/) // preserve spaces as separate tokens
      for (const word of words) {
        if (!word) continue
        const currentLine = lines[lines.length - 1]
        // Calculate current line width
        let lineWidth = 0
        for (const seg of currentLine) {
          const segFont = await getFontFn(seg.fontKey)
          lineWidth += segFont.widthOfTextAtSize(seg.text, fontSize)
        }
        const wordWidth = font.widthOfTextAtSize(word, fontSize)

        if (lineWidth + wordWidth > maxWidth && currentLine.length > 0 && word.trim()) {
          // Wrap to new line
          lines.push([{ text: word, fontKey, underline: span.underline }])
        } else {
          // Append to current line — merge with last segment if same fontKey+underline
          const last = currentLine[currentLine.length - 1]
          if (last && last.fontKey === fontKey && last.underline === span.underline) {
            last.text += word
          } else {
            currentLine.push({ text: word, fontKey, underline: span.underline })
          }
        }
      }
    }
  }

  return lines
}

function wrapText(text, font, fontSize, maxWidth) {
  const words = text.split(/\s+/)
  const lines = []
  let currentLine = ''

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    const testWidth = font.widthOfTextAtSize(testLine, fontSize)
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = testLine
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines.length > 0 ? lines : ['']
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
