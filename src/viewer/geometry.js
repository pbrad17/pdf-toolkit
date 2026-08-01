/**
 * Geometry helpers shared by the canvas renderer, the text layer and the
 * annotation layer, so all three agree on exactly where a page sits.
 */

import { effectiveRotation, displaySize } from '../state/documentModel'

/** Gap between pages in the continuous scroll view, in CSS pixels. */
export const PAGE_GAP = 16

/**
 * Where a page's cropped region lands inside its rotated viewport.
 *
 * Crop insets are stored in unrotated page space — that is how the user drew
 * them and how /CropBox is written at export. Once the page is rotated for
 * display those insets no longer correspond to screen edges, so the rect is
 * pushed through pdf.js's own viewport transform rather than being swapped by
 * hand. Getting this wrong shows up as a crop that drifts to the wrong edge as
 * soon as the page is turned.
 *
 * @returns {{x:number, y:number, width:number, height:number}} in viewport px
 */
export function cropRectInViewport(page, viewport) {
  const { width: W, height: H } = page.size
  const c = page.crop
  if (!c) return { x: 0, y: 0, width: viewport.width, height: viewport.height }

  // PDF user space: origin bottom-left, so a top inset reduces the max y.
  const rect = [
    c.left || 0,
    c.bottom || 0,
    W - (c.right || 0),
    H - (c.top || 0),
  ]
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect)
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

/** Viewport rotation to hand pdf.js: intrinsic /Rotate plus the user's turns. */
export const viewportRotation = (page) => effectiveRotation(page)

/**
 * Layout size of a page at a given zoom, in CSS pixels.
 * Uses the post-crop, post-rotation size so the scroll container reserves the
 * right space before the page has actually rendered.
 */
export function layoutSize(page, scale) {
  const { width, height } = displaySize(page)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * Zoom factor for a fit mode.
 *
 * Fit-width uses the widest page in the document rather than the current one,
 * so scrolling through a document with mixed page sizes does not cause the zoom
 * to jump around underneath the user.
 */
export function computeFitScale(pages, mode, viewportWidth, viewportHeight, padding = 32) {
  if (pages.length === 0) return 1
  const availW = Math.max(120, viewportWidth - padding * 2)
  const availH = Math.max(120, viewportHeight - padding * 2)

  let maxW = 0
  let maxH = 0
  for (const p of pages) {
    const { width, height } = displaySize(p)
    if (width > maxW) maxW = width
    if (height > maxH) maxH = height
  }
  if (maxW === 0 || maxH === 0) return 1

  if (mode === 'fit-width') return availW / maxW
  if (mode === 'fit-page') return Math.min(availW / maxW, availH / maxH)
  return 1
}

/**
 * Cumulative vertical offsets of every page, plus total height.
 * Drives both virtualization and scroll-to-page.
 */
export function computeLayout(pages, scale) {
  const offsets = []
  let y = PAGE_GAP
  for (const page of pages) {
    const size = layoutSize(page, scale)
    offsets.push({ top: y, height: size.height, width: size.width })
    y += size.height + PAGE_GAP
  }
  return { offsets, totalHeight: y }
}

/**
 * Indices to keep mounted for a scroll position, with a buffer above and below
 * so a page is already warm by the time it scrolls into view.
 */
export function visibleRange(layout, scrollTop, viewportHeight, buffer = 1) {
  const { offsets } = layout
  if (offsets.length === 0) return { start: 0, end: -1 }

  let start = offsets.findIndex(o => o.top + o.height >= scrollTop)
  if (start === -1) start = offsets.length - 1

  let end = start
  while (end + 1 < offsets.length && offsets[end + 1].top <= scrollTop + viewportHeight) end++

  return {
    start: Math.max(0, start - buffer),
    end: Math.min(offsets.length - 1, end + buffer),
  }
}

/** Page whose area dominates the viewport — what the page indicator reports. */
export function dominantPageIndex(layout, scrollTop, viewportHeight) {
  const { offsets } = layout
  let best = 0
  let bestVisible = -1
  for (let i = 0; i < offsets.length; i++) {
    const { top, height } = offsets[i]
    const visible = Math.min(top + height, scrollTop + viewportHeight) - Math.max(top, scrollTop)
    if (visible > bestVisible) { bestVisible = visible; best = i }
    // Offsets ascend, so once a page starts below the fold nothing later can win.
    if (top > scrollTop + viewportHeight) break
  }
  return best
}
