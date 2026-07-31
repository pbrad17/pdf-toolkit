/**
 * True redaction.
 *
 * The previous implementation drew a black rectangle over the content and
 * called it redacted. The underlying text remained fully intact in the file —
 * selectable, copyable, and trivially recoverable with any text extractor. For
 * a tool whose entire pitch is that it can be trusted with private documents,
 * that is the most serious thing it could get wrong.
 *
 * What this does instead: any page carrying redaction marks is re-rendered to a
 * raster with the marks burned in, and the original page's contents are
 * replaced by that image. The exported page then contains no text or vector
 * objects at all, so there is nothing left underneath to recover.
 *
 * The cost is honest and unavoidable client-side: a redacted page stops being
 * searchable text and becomes an image. Selectively deleting only the
 * intersecting glyphs would need full content-stream rewriting, which pdf-lib
 * does not support, and a partial job here is worse than none — it would look
 * redacted while leaving data behind. The UI states the tradeoff, and OCR can
 * restore a searchable layer afterwards.
 */

import { getPageProxy } from '../utils/pdfRegistry'
import { cropRectInViewport, viewportRotation } from '../viewer/geometry'
import { extractPageText } from '../search/searchIndex'

/** Render scale for redacted pages. Higher keeps small type legible. */
const REDACT_RENDER_SCALE = 2

/** Ceiling on a single page render before the save is failed rather than hung. */
const RENDER_TIMEOUT_MS = 30_000

/**
 * Rasterize one page with its redaction rectangles painted opaque.
 *
 * @returns {Promise<{bytes: Uint8Array, width: number, height: number}>}
 *          PNG bytes plus the page size in points.
 */
export async function rasterizeRedactedPage(page, redactions) {
  const proxy = await getPageProxy(page.sourceId, page.sourceIndex)
  const rotation = viewportRotation(page)
  const viewport = proxy.getViewport({ scale: REDACT_RENDER_SCALE, rotation })
  const crop = cropRectInViewport(page, viewport)

  const width = Math.max(1, Math.round(crop.width))
  const height = Math.max(1, Math.round(crop.height))

  // OffscreenCanvas keeps this off the DOM entirely. Besides being the right
  // tool for a pure rasterization job, HTMLCanvasElement.toBlob is tied to the
  // document's rendering pipeline and can stall indefinitely when the page is
  // not compositing (background tabs, headless contexts) — which would hang a
  // save with no error. convertToBlob has no such dependency.
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height })

  const ctx = canvas.getContext('2d', { alpha: false })
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  // pdf.js drives rasterization through the document's rendering pipeline, so a
  // render can stall indefinitely when the page is not compositing — a
  // backgrounded or hidden tab being the common case. Left unguarded that turns
  // into a save that spins forever with no explanation. Failing loudly is the
  // only safe outcome here: silently writing an unrasterized page would emit a
  // file the user believes is redacted when it is not.
  const task = proxy.render({
    canvasContext: ctx,
    viewport,
    transform: [1, 0, 0, 1, -crop.x, -crop.y],
  })

  let timer
  try {
    await Promise.race([
      task.promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(
            'Rendering a redacted page timed out. This usually means the tab was in the background — ' +
            'bring the window to the front and save again.',
          )),
          RENDER_TIMEOUT_MS,
        )
      }),
    ])
  } catch (err) {
    task.cancel()
    throw err
  } finally {
    clearTimeout(timer)
  }

  // Marks are stored as fractions of the displayed (cropped) page, matching
  // how they were drawn on screen.
  ctx.fillStyle = '#000000'
  for (const r of redactions) {
    ctx.fillRect(r.x * width, r.y * height, r.width * width, r.height * height)
  }

  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  const bytes = new Uint8Array(await blob.arrayBuffer())

  // Free the backing store promptly; redacting a long document otherwise holds
  // every intermediate canvas alive until GC catches up.
  canvas.width = 0
  canvas.height = 0

  return {
    bytes,
    width: crop.width / REDACT_RENDER_SCALE,
    height: crop.height / REDACT_RENDER_SCALE,
  }
}

/**
 * Text covered by redaction marks on a page, used to verify the export.
 *
 * Matching is by glyph-box intersection against the mark rectangles, in the
 * same fractional space the marks were drawn in.
 */
export async function textUnderRedactions(page, redactions) {
  if (redactions.length === 0) return []

  const { Util } = await import('pdfjs-dist')
  const entry = await extractPageText(page)
  const proxy = await getPageProxy(page.sourceId, page.sourceIndex)
  const viewport = proxy.getViewport({ scale: 1, rotation: viewportRotation(page) })
  const crop = cropRectInViewport(page, viewport)
  if (crop.width <= 0 || crop.height <= 0) return []

  const covered = []
  for (const item of entry.items) {
    if (typeof item.str !== 'string' || !item.str.trim() || !item.width) continue

    const tx = Util.transform(viewport.transform, item.transform)
    const h = Math.hypot(tx[2], tx[3]) || item.height || 10
    const box = {
      left: (tx[4] - crop.x) / crop.width,
      top: (tx[5] - h - crop.y) / crop.height,
      right: (tx[4] + item.width * viewport.scale - crop.x) / crop.width,
      bottom: (tx[5] - crop.y) / crop.height,
    }

    const hit = redactions.some(r => (
      box.left < r.x + r.width && box.right > r.x &&
      box.top < r.y + r.height && box.bottom > r.y
    ))
    if (hit) covered.push(item.str.trim())
  }
  return covered
}

/**
 * Confirm redacted strings really are absent from the exported bytes.
 *
 * This is the check that turns the promise into something demonstrable rather
 * than asserted. If it ever fails the export is rejected outright — shipping a
 * file the user believes is sanitised, when it is not, is the worst possible
 * outcome, and failing loudly is strictly better.
 *
 * @returns {Promise<{ok: boolean, leaked: string[]}>}
 */
export async function verifyRedaction(pdfBytes, expectedRemoved) {
  const phrases = expectedRemoved
    .map(s => s.trim())
    .filter(s => s.length >= 3) // very short fragments collide with ordinary text
  if (phrases.length === 0) return { ok: true, leaked: [] }

  const pdfjsLib = (await import('../utils/pdfSetup')).default
  const doc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise

  let all = ''
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i)
      const content = await p.getTextContent()
      all += content.items.map(it => (typeof it.str === 'string' ? it.str : '')).join(' ')
    }
  } finally {
    await doc.destroy()
  }

  const haystack = all.replace(/\s+/g, ' ')
  const leaked = [...new Set(phrases.filter(p => haystack.includes(p)))]
  return { ok: leaked.length === 0, leaked }
}
