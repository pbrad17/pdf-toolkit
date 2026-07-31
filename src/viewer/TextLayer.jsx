import { useEffect, useRef } from 'react'
import { TextLayer as PdfTextLayer } from 'pdfjs-dist'
import { getPageProxy } from '../utils/pdfRegistry'
import { cropRectInViewport, viewportRotation } from './geometry'

/**
 * Transparent, selectable text positioned over the page canvas.
 *
 * This is what makes the document behave like a document rather than a picture:
 * text can be selected and copied, search can highlight real glyph positions,
 * and the text-editing tool has something to hit-test against. The previous
 * version had no text layer at all, which is why none of those existed.
 *
 * Spans are absolutely positioned by pdf.js to match the rendered glyphs, so
 * the layer must be offset by the same crop origin the canvas uses or selection
 * drifts away from the visible text on cropped pages.
 */
export default function TextLayer({ page, scale, searchMatches = [], activeMatchIndex = -1 }) {
  const containerRef = useRef(null)
  const layerRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function build() {
      const container = containerRef.current
      if (!container) return

      try {
        const proxy = await getPageProxy(page.sourceId, page.sourceIndex)
        if (cancelled) return

        const viewport = proxy.getViewport({ scale, rotation: viewportRotation(page) })
        const crop = cropRectInViewport(page, viewport)

        container.replaceChildren()
        // pdf.js sizes its spans from this variable rather than from the
        // element box, so it has to be set before render() runs.
        container.style.setProperty('--scale-factor', String(scale))
        container.style.width = `${viewport.width}px`
        container.style.height = `${viewport.height}px`
        // Shift so the cropped-away region sits outside the clipping parent.
        container.style.left = `${-crop.x}px`
        container.style.top = `${-crop.y}px`

        const layer = new PdfTextLayer({
          textContentSource: proxy.streamTextContent(),
          container,
          viewport,
        })
        layerRef.current = layer
        await layer.render()
      } catch {
        // A page with no extractable text simply yields an empty layer; that is
        // the normal case for scans and is handled by the OCR tool instead.
      }
    }

    build()
    return () => {
      cancelled = true
      layerRef.current?.cancel?.()
      layerRef.current = null
    }
  }, [page, scale])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div ref={containerRef} className="textLayer absolute origin-top-left" />
      {/* Search highlights sit above the text so they read as marks on the page
          rather than as a text selection the user did not make. */}
      {searchMatches.map((m, i) => (
        <div
          key={i}
          className={`absolute pointer-events-none rounded-[1px] ${
            i === activeMatchIndex ? 'bg-accent/60 ring-1 ring-accent' : 'bg-accent/25'
          }`}
          style={{ left: m.left, top: m.top, width: m.width, height: m.height }}
        />
      ))}
    </div>
  )
}
