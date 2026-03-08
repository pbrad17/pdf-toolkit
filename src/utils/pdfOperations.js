import { PDFDocument, degrees } from 'pdf-lib'

export async function buildFinalPdf(documents, pages) {
  const finalPdf = await PDFDocument.create()
  const docCache = new Map()

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
  }

  return finalPdf.save()
}

export async function buildExtractPdf(documents, pages, selectedIds) {
  const selected = pages.filter(p => selectedIds.has(p.id))
  return buildFinalPdf(documents, selected)
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
