/**
 * Local OCR.
 *
 * tesseract.js resolves its worker script, its wasm core and its language model
 * from jsdelivr unless every path is given explicitly. That would quietly break
 * the one promise this app is built on — nothing leaves the browser — in the
 * place it is hardest to notice, because those requests carry no document data
 * and so look harmless in a network log. Every asset is therefore served from
 * this app's own origin under /tesseract, and all three paths are passed
 * explicitly so no default is left that could resolve to a CDN.
 *
 * The library is reached through a dynamic import: the wrapper plus the wasm
 * core behind it is roughly 4 MB, and a user who never runs OCR should never
 * pay for it.
 */

import { getPageProxy } from '../utils/pdfRegistry'
import { cropRectInViewport, viewportRotation } from '../viewer/geometry'
import { extractPageText } from '../search/searchIndex'

/** Everything the OCR engine loads comes from here. Nothing else is fetched. */
const ASSET_BASE = `${import.meta.env.BASE_URL}tesseract`

/** Tesseract is trained around 300 dpi; PDF user space is 72. */
const OCR_DPI = 300
const PDF_DPI = 72

/** Ceiling on the long edge so an oversized page cannot exhaust memory. */
const MAX_RENDER_PX = 4200

/** Ceiling on one page render before the run is failed rather than hung. */
const RENDER_TIMEOUT_MS = 30_000

/**
 * Character count below which a page is treated as image-only.
 *
 * Scanned pages are rarely at exactly zero: a fax header, a Bates stamp or a
 * stray ligature routinely yields a handful of characters, so testing for empty
 * text would miss most of the pages that actually need recognizing.
 */
export const TEXT_CHARS_THRESHOLD = 24

export const isImageOnly = (charCount) => charCount < TEXT_CHARS_THRESHOLD

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Extractable characters per page, for deciding what is worth recognizing.
 *
 * Extraction failures count as zero. A page whose text cannot be read is
 * precisely a page that needs OCR, so treating the failure as "no text" points
 * the user at the right answer instead of hiding the page from the list.
 *
 * @param {Array} pages EditState pages
 * @returns {Promise<Record<string, number>>} pageId -> character count
 */
export async function measureTextCoverage(pages) {
  const counts = {}
  for (const page of pages) {
    try {
      const entry = await extractPageText(page)
      counts[page.id] = entry.text.replace(/\s+/g, '').length
    } catch {
      counts[page.id] = 0
    }
  }
  return counts
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

/** @type {Promise<object>|null} the one worker, created on first recognition. */
let workerPromise = null

/** Receives tesseract's logger events for the job currently running. */
let progressSink = null

/** Tail of the job chain, so recognitions never overlap. */
let queue = Promise.resolve()

async function getWorker() {
  if (!workerPromise) {
    const pending = (async () => {
      const mod = await import('tesseract.js')
      // tesseract.js is CommonJS and builds its exports object with a spread,
      // which bundlers cannot see past — esbuild reduces the whole package to a
      // single default export. Take the named bindings when the bundler managed
      // to produce them and fall back to the default object when it did not.
      const { createWorker, OEM } = mod.createWorker ? mod : (mod.default || {})
      if (typeof createWorker !== 'function') {
        throw new Error('tesseract.js did not expose createWorker')
      }

      return createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: `${ASSET_BASE}/worker.min.js`,
        // A directory rather than a file: the worker picks the SIMD variant the
        // browser can actually run, and all three LSTM cores are shipped.
        corePath: ASSET_BASE,
        langPath: ASSET_BASE,
        // The default wraps the worker in a Blob URL so a cross-origin CDN
        // script can be imported. Ours is same-origin, so the indirection buys
        // nothing and only obscures which script is really being run.
        workerBlobURL: false,
        gzip: true,
        // Keeps the 2.8 MB language model in IndexedDB after first use. Only
        // the shipped model is cached — no part of the user's document is.
        cacheMethod: 'write',
        logger: (m) => { if (progressSink) progressSink(m) },
      })
    })()

    workerPromise = pending.catch((err) => {
      // Drop the failed promise so the next attempt starts clean rather than
      // replaying the same error forever.
      workerPromise = null
      throw new Error(`Could not start the OCR engine: ${err?.message || err}`)
    })
  }
  return workerPromise
}

/** Release the worker and the wasm heap behind it. */
export async function terminateOcr() {
  const pending = workerPromise
  workerPromise = null
  if (!pending) return
  try {
    const worker = await pending
    await worker.terminate()
  } catch {
    // A worker that never started has nothing to tear down.
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Rasterize a page exactly as the user sees it — cropped and rotated — so the
 * word boxes that come back are already in the fractional display space the
 * rest of the app stores geometry in.
 *
 * @returns {Promise<{bytes: Uint8Array, width: number, height: number}>}
 */
async function renderPageRaster(page) {
  const proxy = await getPageProxy(page.sourceId, page.sourceIndex)
  const rotation = viewportRotation(page)

  // Measure at scale 1 first: the cap has to apply to the cropped region, not
  // to the full page, or cropping a poster-sized sheet down to a paragraph
  // would still be rendered at thumbnail resolution.
  const unit = cropRectInViewport(page, proxy.getViewport({ scale: 1, rotation }))
  const longEdge = Math.max(unit.width, unit.height, 1)
  const scale = Math.min(OCR_DPI / PDF_DPI, MAX_RENDER_PX / longEdge)

  const viewport = proxy.getViewport({ scale, rotation })
  const crop = cropRectInViewport(page, viewport)
  const width = Math.max(1, Math.round(crop.width))
  const height = Math.max(1, Math.round(crop.height))

  // OffscreenCanvas for the same reason redaction uses it: HTMLCanvasElement's
  // toBlob is tied to the document's rendering pipeline and can stall forever
  // when the page is not compositing.
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height })

  const ctx = canvas.getContext('2d', { alpha: false })
  // Tesseract binarizes against the background; an unpainted canvas is
  // transparent black, which turns a whole page into one solid blob.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const task = proxy.render({
    canvasContext: ctx,
    viewport,
    transform: [1, 0, 0, 1, -crop.x, -crop.y],
  })

  // pdf.js drives rasterization through the document's rendering pipeline, so a
  // render stalls indefinitely when the tab is not compositing. Unguarded that
  // is an OCR run that spins with no explanation and no way to tell it apart
  // from a slow page.
  let timer
  try {
    await Promise.race([
      task.promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(
            'Rendering a page for OCR timed out. This usually means the tab was in the background — ' +
            'bring the window to the front and run OCR again.',
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

  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  const bytes = new Uint8Array(await blob.arrayBuffer())

  // Free the backing store now; OCR-ing a long document otherwise keeps every
  // intermediate page-sized canvas alive until GC catches up.
  canvas.width = 0
  canvas.height = 0

  return { bytes, width, height }
}

// ---------------------------------------------------------------------------
// Recognition
// ---------------------------------------------------------------------------

/**
 * Recognize one page.
 *
 * Jobs are serialized onto a single worker. Tesseract binds its logger when the
 * worker is created, so parallel jobs could not tell their progress apart, and
 * a second worker would mean a second wasm heap on top of an already large one.
 *
 * @param {object} page EditState page
 * @param {object} [opts]
 * @param {(stage: string, fraction: number) => void} [opts.onProgress]
 * @returns {Promise<{words: Array<{text: string, left: number, top: number,
 *   width: number, height: number, confidence: number}>, confidence: number}>}
 *   Geometry is 0..1 of the page's cropped display box, y measured downward.
 */
export function recognizePage(page, { onProgress } = {}) {
  const run = queue.then(() => runRecognition(page, onProgress))
  // Swallow the rejection on the chain only — the caller still sees it through
  // `run`, but one failed page must not wedge every page queued behind it.
  queue = run.catch(() => {})
  return run
}

async function runRecognition(page, onProgress) {
  const report = (stage, fraction) => {
    if (onProgress) onProgress(stage, Math.max(0, Math.min(1, fraction)))
  }

  progressSink = (m) => {
    if (m && typeof m.progress === 'number') report(m.status || 'working', m.progress)
  }

  try {
    report('starting engine', 0)
    const worker = await getWorker()

    report('rendering page', 0)
    const raster = await renderPageRaster(page)

    const { data } = await worker.recognize(raster.bytes, {}, { blocks: true })
    report('done', 1)

    return {
      words: collectWords(data, raster.width, raster.height),
      confidence: Math.round(data?.confidence ?? 0),
    }
  } finally {
    progressSink = null
  }
}

/**
 * Flatten tesseract's block/paragraph/line tree into words, in the fractional
 * coordinate space annotations already use.
 */
function collectWords(data, width, height) {
  const words = []
  for (const block of data?.blocks || []) {
    for (const paragraph of block?.paragraphs || []) {
      for (const line of paragraph?.lines || []) {
        for (const word of line?.words || []) {
          const text = (word?.text || '').trim()
          const bbox = word?.bbox
          if (!text || !bbox) continue

          const w = bbox.x1 - bbox.x0
          const h = bbox.y1 - bbox.y0
          if (!(w > 0) || !(h > 0)) continue

          words.push({
            text,
            left: bbox.x0 / width,
            top: bbox.y0 / height,
            width: w / width,
            height: h / height,
            confidence: Math.round(word.confidence ?? 0),
          })
        }
      }
    }
  }
  return words
}
