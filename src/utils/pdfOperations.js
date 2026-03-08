import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib'

export async function buildFinalPdf(documents, pages, annotations = {}) {
  const finalPdf = await PDFDocument.create()
  const docCache = new Map()
  const font = await finalPdf.embedFont(StandardFonts.Helvetica)

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
        // ann.x and ann.y are fractions (0-1) of the rendered viewport
        // PDF coordinate system: origin at bottom-left
        const x = ann.x * pageW
        const y = (1 - ann.y) * pageH - ann.fontSize
        copiedPage.drawText(ann.text, {
          x,
          y,
          size: ann.fontSize || 14,
          font,
          color: rgb(color.r, color.g, color.b),
        })
      } else if (ann.type === 'signature') {
        // ann.dataUrl is a PNG data URL
        const pngBytes = dataUrlToBytes(ann.dataUrl)
        const pngImage = await finalPdf.embedPng(pngBytes)
        const imgDims = pngImage.scale(1)
        const sigWidth = ann.width * pageW
        const sigHeight = (imgDims.height / imgDims.width) * sigWidth
        const x = ann.x * pageW
        const y = (1 - ann.y) * pageH - sigHeight
        copiedPage.drawImage(pngImage, {
          x,
          y,
          width: sigWidth,
          height: sigHeight,
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

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
