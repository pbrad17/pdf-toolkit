import { PDFDocument, degrees, rgb, StandardFonts, PDFName, PDFArray, PDFDict, PDFString, PDFNumber } from 'pdf-lib'
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
              opacity: ann.opacity ?? 1,
            })
            const segWidth = segFont.widthOfTextAtSize(seg.text, size)
            // Draw underline
            if (seg.underline) {
              copiedPage.drawLine({
                start: { x: xOffset, y: lineY - size * 0.15 },
                end: { x: xOffset + segWidth, y: lineY - size * 0.15 },
                thickness: size * 0.05,
                color: rgb(color.r, color.g, color.b),
                opacity: ann.opacity ?? 1,
              })
            }
            xOffset += segWidth
          }
        }
      } else if (ann.type === 'redact') {
        const x = ann.x * pageW
        const w = (ann.width || 0.15) * pageW
        const h = (ann.height || 0.03) * pageH
        const y = (1 - ann.y) * pageH - h
        copiedPage.drawRectangle({ x, y, width: w, height: h, color: rgb(0, 0, 0) })
      } else if (ann.type === 'highlight') {
        const hColor = hexToRgb(ann.color || '#FFFF00')
        const x = ann.x * pageW
        const w = (ann.width || 0.15) * pageW
        const h = (ann.height || 0.03) * pageH
        const y = (1 - ann.y) * pageH - h
        copiedPage.drawRectangle({ x, y, width: w, height: h, color: rgb(hColor.r, hColor.g, hColor.b), opacity: ann.opacity ?? 0.35 })
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
            opacity: ann.opacity ?? 1,
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
          opacity: ann.opacity ?? 1,
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

export async function applyWatermark(pdfBytes, config) {
  const doc = await PDFDocument.load(pdfBytes)
  const pages = doc.getPages()

  if (config.mode === 'text') {
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const colorObj = hexToRgb(config.color || '#FF0000')
    const textColor = rgb(colorObj.r, colorObj.g, colorObj.b)
    const size = config.fontSize || 60
    const opac = config.opacity ?? 0.3
    const rot = config.rotation ?? -45
    const rad = (rot * Math.PI) / 180

    for (const page of pages) {
      const { width, height } = page.getSize()
      const textWidth = font.widthOfTextAtSize(config.text, size)
      const textHeight = font.heightAtSize(size)
      // Position so text center aligns with page center after rotation
      const cx = width / 2
      const cy = height / 2
      const x = cx - (textWidth / 2) * Math.cos(rad) + (textHeight / 2) * Math.sin(rad)
      const y = cy - (textWidth / 2) * Math.sin(rad) - (textHeight / 2) * Math.cos(rad)

      page.drawText(config.text, {
        x, y, size, font,
        color: textColor,
        opacity: opac,
        rotate: degrees(rot),
      })
    }
  } else if (config.mode === 'image' && config.imageBytes) {
    const image = config.isJpeg
      ? await doc.embedJpg(config.imageBytes)
      : await doc.embedPng(config.imageBytes)
    const dims = image.scale(1)
    const opac = config.imageOpacity ?? 0.3
    const pos = config.position || 'center'

    for (const page of pages) {
      const { width, height } = page.getSize()

      if (pos === 'tile') {
        const tileW = width * 0.2
        const tileH = tileW * (dims.height / dims.width)
        const gapX = tileW * 0.5
        const gapY = tileH * 0.5
        for (let tx = 0; tx < width; tx += tileW + gapX) {
          for (let ty = 0; ty < height; ty += tileH + gapY) {
            page.drawImage(image, { x: tx, y: ty, width: tileW, height: tileH, opacity: opac })
          }
        }
      } else {
        // Single placement — scale to 40% of page, preserve aspect ratio
        const maxW = width * 0.4
        const maxH = height * 0.4
        const scale = Math.min(maxW / dims.width, maxH / dims.height)
        const imgW = dims.width * scale
        const imgH = dims.height * scale
        let x, y
        if (pos === 'center') {
          x = width / 2 - imgW / 2; y = height / 2 - imgH / 2
        } else if (pos === 'top-left') {
          x = width * 0.05; y = height - imgH - height * 0.05
        } else if (pos === 'top-right') {
          x = width - imgW - width * 0.05; y = height - imgH - height * 0.05
        } else if (pos === 'bottom-left') {
          x = width * 0.05; y = height * 0.05
        } else { // bottom-right
          x = width - imgW - width * 0.05; y = height * 0.05
        }
        page.drawImage(image, { x, y, width: imgW, height: imgH, opacity: opac })
      }
    }
  }

  return doc.save()
}

export async function applyCrop(pdfBytes, margins) {
  const doc = await PDFDocument.load(pdfBytes)
  const pages = doc.getPages()
  for (const page of pages) {
    const { x, y, width, height } = page.getMediaBox()
    const newX = x + margins.left
    const newY = y + margins.bottom
    const newW = width - margins.left - margins.right
    const newH = height - margins.top - margins.bottom
    if (newW > 0 && newH > 0) {
      page.setMediaBox(newX, newY, newW, newH)
      page.setCropBox(newX, newY, newW, newH)
    }
  }
  return doc.save()
}

export async function addBookmarks(pdfBytes, bookmarks) {
  const doc = await PDFDocument.load(pdfBytes)
  const context = doc.context
  const pdfPages = doc.getPages()

  // Build outline items
  const outlineItems = bookmarks.map((bm) => {
    const pageIdx = Math.max(0, Math.min(pdfPages.length - 1, bm.page - 1))
    const pageRef = pdfPages[pageIdx].ref
    const { height } = pdfPages[pageIdx].getSize()

    const itemDict = context.obj({
      Title: PDFString.of(bm.title),
      Dest: [pageRef, PDFName.of('XYZ'), null, PDFNumber.of(height), null],
    })
    return context.register(itemDict)
  })

  // Link items: each has /Next and /Prev pointers, plus /Parent
  const outlineDict = context.obj({
    Type: PDFName.of('Outlines'),
    First: outlineItems[0],
    Last: outlineItems[outlineItems.length - 1],
    Count: PDFNumber.of(outlineItems.length),
  })
  const outlineRef = context.register(outlineDict)

  for (let i = 0; i < outlineItems.length; i++) {
    const item = context.lookup(outlineItems[i])
    item.set(PDFName.of('Parent'), outlineRef)
    if (i > 0) item.set(PDFName.of('Prev'), outlineItems[i - 1])
    if (i < outlineItems.length - 1) item.set(PDFName.of('Next'), outlineItems[i + 1])
  }

  // Set the document's Outlines reference
  const catalog = context.lookup(context.trailerInfo.Root)
  catalog.set(PDFName.of('Outlines'), outlineRef)
  // Open outline panel by default
  catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))

  return doc.save()
}

function resolveHeaderFooterText(zone, pageNum, totalPages, dateStr, format) {
  if (!zone || zone.type === 'none') return ''
  if (zone.type === 'date') return dateStr
  if (zone.type === 'custom') return zone.customText || ''
  if (zone.type === 'pageNumber') {
    switch (format) {
      case 'Page 1': return `Page ${pageNum}`
      case 'Page 1 of N': return `Page ${pageNum} of ${totalPages}`
      case '1 of N': return `${pageNum} of ${totalPages}`
      default: return `${pageNum}`
    }
  }
  return ''
}

export async function applyHeadersFooters(pdfBytes, config) {
  const doc = await PDFDocument.load(pdfBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pdfPages = doc.getPages()
  const colorObj = hexToRgb(config.color || '#000000')
  const textColor = rgb(colorObj.r, colorObj.g, colorObj.b)
  const size = config.fontSize || 10
  const mgn = config.margin || 36
  const dateStr = new Date().toLocaleDateString()
  const totalPages = pdfPages.length + (config.startingPage || 1) - 1

  const zoneKeys = ['headerLeft', 'headerCenter', 'headerRight', 'footerLeft', 'footerCenter', 'footerRight']

  for (let i = 0; i < pdfPages.length; i++) {
    const page = pdfPages[i]
    const { width, height } = page.getSize()
    const rot = page.getRotation().angle % 360
    const isRotated = rot === 90 || rot === 270
    const w = isRotated ? height : width
    const h = isRotated ? width : height
    const pageNum = i + (config.startingPage || 1)

    for (const key of zoneKeys) {
      const zone = config.zones[key]
      const text = resolveHeaderFooterText(zone, pageNum, totalPages, dateStr, config.pageNumFormat)
      if (!text) continue

      const textWidth = font.widthOfTextAtSize(text, size)
      const isHeader = key.startsWith('header')
      const y = isHeader ? h - mgn : mgn - size

      let x
      if (key.endsWith('Left')) {
        x = mgn
      } else if (key.endsWith('Center')) {
        x = (w - textWidth) / 2
      } else {
        x = w - mgn - textWidth
      }

      page.drawText(text, { x, y, size, font, color: textColor })
    }
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
