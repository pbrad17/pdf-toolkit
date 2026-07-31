/**
 * Page rasterization for the output-side tools — compress, greyscale and image
 * export.
 *
 * These three all need the same thing: one page, drawn exactly as the user sees
 * it (cropped and rotated), encoded as an image. redaction.js already does this
 * for its own purposes and the two must not drift apart, so the shared parts
 * live here: the pixel ceiling, the OffscreenCanvas choice, and above all the
 * render timeout.
 *
 * The timeout is not defensive padding. pdf.js drives rasterization through the
 * document's rendering pipeline, so a render stalls indefinitely when the tab is
 * not compositing — a backgrounded window being the ordinary case. Unguarded,
 * a user who starts a compression run and switches tabs gets a progress bar that
 * never moves and no way to tell that from a slow document. Failing loudly after
 * a bounded wait is the only honest outcome.
 */

import { getPageProxy } from '../utils/pdfRegistry'
import { cropRectInViewport, viewportRotation } from '../viewer/geometry'

/** Ceiling on one page render before the run is failed rather than hung. */
const RENDER_TIMEOUT_MS = 30_000

/**
 * Ceiling on the long edge in pixels. A poster-sized page at 4x would otherwise
 * ask for a canvas the browser silently refuses to allocate, which comes back
 * as a blank image rather than an error.
 */
const MAX_RENDER_PX = 6000

/** PDF user space is 72 units to the inch; render scale multiplies that. */
export const PDF_DPI = 72

/**
 * Convert a canvas to greyscale in place using ITU-R BT.709 luma coefficients.
 *
 * Applied to the gamma-encoded sRGB values as they sit in the buffer, which is
 * what every other tool that offers "convert to greyscale" does. Doing it
 * properly — linearise, weight, re-encode — is more defensible colour science
 * but produces visibly darker midtones than the file the user would get from
 * anywhere else, and a page that does not match expectations reads as a bug.
 */
function toGreyscale(ctx, width, height) {
  const image = ctx.getImageData(0, 0, width, height)
  const px = image.data
  for (let i = 0; i < px.length; i += 4) {
    const luma = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722 + 0.5) | 0
    px[i] = luma
    px[i + 1] = luma
    px[i + 2] = luma
  }
  ctx.putImageData(image, 0, 0)
}

/**
 * Rasterize one page.
 *
 * @param {object} page   EditState page
 * @param {object} [opts]
 * @param {number} [opts.scale]      render scale, 1 = 72 dpi
 * @param {string} [opts.mime]       'image/png' or 'image/jpeg'
 * @param {number} [opts.quality]    0..1, JPEG only
 * @param {boolean} [opts.grayscale] convert before encoding
 * @param {Array}  [opts.marks]      redaction rects, fractions of the cropped
 *                                   page, painted opaque before encoding
 * @returns {Promise<{bytes: Uint8Array, mime: string, width: number,
 *   height: number, pixelWidth: number, pixelHeight: number,
 *   grayscale: boolean, scale: number}>}
 *   width/height are the page box in POINTS; pixelWidth/pixelHeight are the
 *   encoded image's own dimensions.
 */
export async function renderPageImage(page, {
  scale = 2, mime = 'image/png', quality, grayscale = false, marks = [],
} = {}) {
  const proxy = await getPageProxy(page.sourceId, page.sourceIndex)
  const rotation = viewportRotation(page)

  // Measure the cropped region at scale 1 first, so the pixel ceiling applies to
  // what is actually drawn. Applying it to the full sheet would render a page
  // cropped down to a single paragraph at thumbnail resolution.
  const unit = cropRectInViewport(page, proxy.getViewport({ scale: 1, rotation }))
  const longEdge = Math.max(unit.width, unit.height, 1)
  const effectiveScale = Math.min(scale, MAX_RENDER_PX / longEdge)

  const viewport = proxy.getViewport({ scale: effectiveScale, rotation })
  const crop = cropRectInViewport(page, viewport)
  const pixelWidth = Math.max(1, Math.round(crop.width))
  const pixelHeight = Math.max(1, Math.round(crop.height))

  // OffscreenCanvas for the reason redaction.js gives: HTMLCanvasElement.toBlob
  // is tied to the document's rendering pipeline and can stall forever when the
  // page is not compositing. convertToBlob has no such dependency.
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(pixelWidth, pixelHeight)
    : Object.assign(document.createElement('canvas'), { width: pixelWidth, height: pixelHeight })

  const ctx = canvas.getContext('2d', { alpha: false })
  // An unpainted canvas is transparent black, which JPEG flattens to a solid
  // black page. Paper is white.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, pixelWidth, pixelHeight)

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
            'Rendering a page timed out. This usually means the tab was in the background — '
            + 'bring the window to the front and run it again.',
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

  // Marks are burned in before anything reads the pixels back out. Every caller
  // of this function produces something the user can keep — a downloaded image,
  // a page image that replaces the page at export — so a render that omitted
  // them would hand back the very content the user marked for removal. Painted
  // after the greyscale pass would also work; painted before it is one less
  // thing to get wrong if a caller ever skips the encode.
  if (marks.length > 0) {
    ctx.fillStyle = '#000000'
    for (const r of marks) {
      ctx.fillRect(r.x * pixelWidth, r.y * pixelHeight, r.width * pixelWidth, r.height * pixelHeight)
    }
  }

  if (grayscale) toGreyscale(ctx, pixelWidth, pixelHeight)

  const options = mime === 'image/jpeg' && quality != null ? { type: mime, quality } : { type: mime }
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob(options)
    : await new Promise(resolve => canvas.toBlob(resolve, mime, quality))
  const bytes = new Uint8Array(await blob.arrayBuffer())

  // Free the backing store now; a long document otherwise holds every
  // intermediate page-sized canvas alive until GC catches up.
  canvas.width = 0
  canvas.height = 0

  return {
    bytes,
    mime,
    width: unit.width,
    height: unit.height,
    pixelWidth,
    pixelHeight,
    grayscale,
    scale: effectiveScale,
  }
}

/**
 * Every redaction mark on a page, from both places they can live.
 *
 * Marks drawn with the redact tool arrive as annotations; anything promoted to a
 * committed redaction lives in state.redactions. buildPdf merges the same two
 * lists — they must not diverge, or a mark would be honoured on save and ignored
 * by an image export, which is the worse of the two failures.
 */
export function redactionMarksFor(state, pageId) {
  return [
    ...(state.redactions[pageId] || []),
    ...(state.annotations[pageId] || []).filter(a => a.type === 'redact'),
  ]
}

/**
 * Shape a render result into the record stored on `page.raster`.
 *
 * Contract for export: a page carrying a raster is already fully baked. Crop and
 * rotation are burned into the pixels, so export must add a page of
 * `[raster.width, raster.height]`, draw the image at full size, and must NOT
 * also call setRotation or setMediaBox for that page — the same handling the
 * redaction branch of buildPdf.js already applies to a rasterized page.
 *
 * `source` records which tool produced it ('compress' | 'grayscale') so each
 * tool can undo only its own work.
 */
export function makeRaster(image, source) {
  return {
    bytes: image.bytes,
    mime: image.mime,
    width: image.width,
    height: image.height,
    pixelWidth: image.pixelWidth,
    pixelHeight: image.pixelHeight,
    grayscale: image.grayscale,
    source,
  }
}
