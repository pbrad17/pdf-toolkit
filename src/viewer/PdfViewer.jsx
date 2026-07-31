import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useEditor } from '../state/useEditor'
import PageCanvas from './PageCanvas'
import TextLayer from './TextLayer'
import AnnotationLayer from './AnnotationLayer'
import {
  computeLayout, computeFitScale, visibleRange, dominantPageIndex,
  layoutSize, PAGE_GAP,
} from './geometry'

/**
 * The continuous document view.
 *
 * Replaces the old one-page-at-a-time editor and the thumbnail grid as the
 * primary surface. Everything the user does now happens against the page they
 * are looking at, which is what makes chained edits possible.
 *
 * Only pages near the viewport are mounted; the rest are reserved as empty
 * boxes of the correct height so the scrollbar stays honest on long documents.
 */
export default function PdfViewer({ searchMatchesByPage, activeMatch, viewerRef }) {
  const {
    state, zoom, zoomMode, setZoomRaw, setZoom, setCurrentPageId,
    selectedAnnotationId, setSelectedAnnotationId,
  } = useEditor()

  const scrollRef = useRef(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [scrollTop, setScrollTop] = useState(0)
  const pages = state.pages

  // Track the scroll container's own size so fit modes react to panel toggles
  // and window resizes, not just to zoom changes.
  //
  // The first measurement is taken synchronously rather than waiting for the
  // observer's initial callback. A fit scale computed against a zero width
  // collapses to the clamp floor, and any delay in that callback shows up as
  // pages briefly rendering at the wrong size — or staying wrong entirely in
  // environments that throttle observer delivery.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const measure = () => setViewportSize(prev => {
      const width = el.clientWidth
      const height = el.clientHeight
      return prev.width === width && prev.height === height ? prev : { width, height }
    })

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Fit modes derive their scale from the container; custom zoom is user-set.
  const scale = useMemo(() => {
    if (zoomMode === 'custom') return zoom
    return computeFitScale(pages, zoomMode, viewportSize.width, viewportSize.height)
  }, [zoomMode, zoom, pages, viewportSize])

  // Publish the derived scale so the zoom readout shows a real percentage in
  // fit modes instead of a stale number.
  useEffect(() => {
    if (zoomMode !== 'custom') setZoomRaw(scale)
  }, [scale, zoomMode, setZoomRaw])

  const layout = useMemo(() => computeLayout(pages, scale), [pages, scale])

  const range = useMemo(
    () => visibleRange(layout, scrollTop, viewportSize.height),
    [layout, scrollTop, viewportSize.height],
  )

  const handleScroll = useCallback((e) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  // Report the page under the viewport for the page indicator.
  useEffect(() => {
    if (pages.length === 0) return
    const idx = dominantPageIndex(layout, scrollTop, viewportSize.height)
    const page = pages[idx]
    if (page) setCurrentPageId(page.id)
  }, [layout, scrollTop, viewportSize.height, pages, setCurrentPageId])

  /**
   * Ctrl/Cmd + wheel zooms about the pointer rather than the scroll origin, so
   * the point under the cursor stays put — the behaviour every other document
   * viewer has trained people to expect.
   */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const pointerY = e.clientY - rect.top
      const docY = el.scrollTop + pointerY

      const factor = Math.exp(-e.deltaY * 0.002)
      const nextScale = Math.min(8, Math.max(0.1, scale * factor))
      const ratio = nextScale / scale

      setZoom(nextScale)
      // Applied after the layout reflows at the new scale.
      requestAnimationFrame(() => {
        el.scrollTop = docY * ratio - pointerY
      })
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scale, setZoom])

  /**
   * Scrolling is exposed imperatively rather than driven by a prop.
   *
   * Search results, thumbnails and the page field all need to say "go here"
   * repeatedly, sometimes to the page already shown. Modelling that as state
   * needs a nonce to make identical requests distinct, and pushes a render
   * through the whole tree for what is really a one-line DOM call.
   */
  useEffect(() => {
    if (!viewerRef) return
    viewerRef.current = {
      scrollToPage(pageId, { smooth = true } = {}) {
        const idx = pages.findIndex(p => p.id === pageId)
        const el = scrollRef.current
        const offset = layout.offsets[idx]
        if (idx < 0 || !el || !offset) return
        el.scrollTo({
          top: Math.max(0, offset.top - PAGE_GAP),
          behavior: smooth ? 'smooth' : 'auto',
        })
      },
    }
    return () => { viewerRef.current = null }
  }, [viewerRef, pages, layout])

  // Clicking empty space around a page drops the annotation selection.
  const handleBackgroundPointerDown = useCallback((e) => {
    if (e.target === e.currentTarget && selectedAnnotationId) {
      setSelectedAnnotationId(null)
    }
  }, [selectedAnnotationId, setSelectedAnnotationId])

  if (pages.length === 0) return null

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      onPointerDown={handleBackgroundPointerDown}
      className="flex-1 overflow-auto bg-title-bg"
      data-viewer-scroll
    >
      <div className="relative mx-auto" style={{ height: layout.totalHeight, width: 'min-content', minWidth: '100%' }}>
        {pages.map((page, i) => {
          const offset = layout.offsets[i]
          if (!offset) return null
          const mounted = i >= range.start && i <= range.end
          const size = layoutSize(page, scale)

          return (
            <div
              key={page.id}
              data-page-id={page.id}
              className="absolute left-1/2 -translate-x-1/2 bg-white shadow-lg"
              style={{ top: offset.top, width: size.width, height: size.height }}
            >
              {mounted ? (
                <>
                  <PageCanvas
                    page={page}
                    scale={scale}
                    width={size.width}
                    height={size.height}
                  />
                  <TextLayer
                    page={page}
                    scale={scale}
                    searchMatches={searchMatchesByPage?.[page.id] || []}
                    activeMatchIndex={
                      activeMatch?.pageId === page.id ? activeMatch.indexOnPage : -1
                    }
                  />
                  <AnnotationLayer
                    page={page}
                    width={size.width}
                    height={size.height}
                  />
                </>
              ) : (
                // Placeholder keeps scroll height stable for unmounted pages.
                <div className="w-full h-full bg-white" />
              )}

              <div className="absolute -bottom-[14px] left-0 right-0 text-center text-[10px] text-text-primary/40 select-none">
                {i + 1}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
