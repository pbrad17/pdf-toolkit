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
    // z-10 puts this above the canvas and, because an absolutely positioned
    // element with a z-index forms its own stacking context, it also confines
    // pdf.js's internal `.textLayer { z-index: 1 }` to this subtree — which is
    // what lets the annotation layer above it actually receive clicks.
    <div className="absolute inset-0 overflow-hidden z-10">
      <div ref={containerRef} className="textLayer absolute origin-top-left" />
      {/* Search highlights sit above the text so they read as marks on the page
          rather than as a text selection the user did not make.

          accent-soft-border, not accent — the same call AnnotationItem and
          AnnotationLayer make, and for the same reason: this is drawn on paper,
          which is white in both themes, so it cannot use a token that flips.
          `--theme-accent` is #F9AC2A on dark (1.92:1 on paper, invisible) and
          #8F5B00 on light (a dark brown that at 60% blacks out the very words
          the user is looking for). accent-soft-border is mid-amber at both ends
          of the ramp, so the mark lands in the same place on paper either way.

          Translucent on purpose, and the one place in this file an alpha is
          right: the mark has to let the glyphs under it through.

          The fill deliberately does not chase the 3:1 that non-text UI normally
          owes its background — it cannot. A translucent amber only reaches 3:1
          on white by becoming opaque enough to bury the word it is marking, and
          the word is the thing the user came to read. The ACTIVE match — the one
          the viewer has just scrolled to, and the only one the user is being
          directed at — carries that job in its ring instead: accent-soft-border
          is 4.22:1 on paper light and 3.75:1 dark, so the current match always
          has a boundary that clears 3:1. Idle matches stay a wash, which is what
          every PDF reader does, and they are never the sole signal: the search
          rail lists every hit with its page and snippet, and shows "n of m".

          Measured over white, both themes:
            idle   25%  1.36:1 vs paper, page ink still 15.4:1 through it
            active 55%  2.06:1 vs paper, page ink still 10.2:1 through it */}
      {searchMatches.map((m, i) => (
        <div
          key={i}
          className={`absolute pointer-events-none rounded-[1px] ${
            i === activeMatchIndex
              ? 'bg-accent-soft-border/55 ring-1 ring-accent-soft-border'
              : 'bg-accent-soft-border/25'
          }`}
          style={{ left: m.left, top: m.top, width: m.width, height: m.height }}
        />
      ))}
    </div>
  )
}
