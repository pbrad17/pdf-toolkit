/**
 * Shared registry of parsed pdf.js documents, keyed by source id.
 *
 * Before v2 every feature called getDocument() with its own copy of the bytes —
 * thumbnails, the annotate view, each export tool. On a large PDF that meant
 * parsing the same file a dozen times and holding a dozen copies of it in
 * memory. Sources are immutable once loaded, so a single cached proxy is safe
 * to share across the viewer, search, OCR and text extraction.
 */

import pdfjsLib from './pdfSetup'

/** sourceId -> Promise<PDFDocumentProxy> */
const docs = new Map()
/** sourceId -> Map<pageIndex, Promise<PDFPageProxy>> */
const pageCache = new Map()

/**
 * pdf.js takes ownership of the buffer it is handed and will detach it, so the
 * caller's bytes must never be passed in directly — they are needed again at
 * export time. Always hand over a copy.
 */
export function registerSource(sourceId, bytes, { password } = {}) {
  if (docs.has(sourceId)) return docs.get(sourceId)
  const task = pdfjsLib.getDocument({
    data: bytes.slice(),
    password,
    // Keeps character spacing faithful for the text layer and for measuring
    // existing text when editing it.
    disableFontFace: false,
    useSystemFonts: true,
  })
  const promise = task.promise
  docs.set(sourceId, promise)
  pageCache.set(sourceId, new Map())
  return promise
}

export function getDoc(sourceId) {
  return docs.get(sourceId) || null
}

export async function getPageProxy(sourceId, pageIndex) {
  const cache = pageCache.get(sourceId)
  if (!cache) throw new Error(`Source ${sourceId} is not registered`)
  if (cache.has(pageIndex)) return cache.get(pageIndex)
  const promise = docs.get(sourceId).then(doc => doc.getPage(pageIndex + 1))
  cache.set(pageIndex, promise)
  return promise
}

export async function releaseSource(sourceId) {
  const promise = docs.get(sourceId)
  docs.delete(sourceId)
  pageCache.delete(sourceId)
  if (promise) {
    try {
      const doc = await promise
      await doc.destroy()
    } catch {
      // A source that failed to parse has nothing to tear down.
    }
  }
}

export async function releaseAll() {
  await Promise.all([...docs.keys()].map(releaseSource))
}

/**
 * Probe a file for an open password without registering it, so the UI can
 * prompt before the source is added to the document.
 * Returns 'ok' | 'password' | 'corrupt'.
 */
export async function probeSource(bytes) {
  const task = pdfjsLib.getDocument({ data: bytes.slice() })
  try {
    const doc = await task.promise
    await doc.destroy()
    return 'ok'
  } catch (err) {
    if (err?.name === 'PasswordException') return 'password'
    return 'corrupt'
  }
}
