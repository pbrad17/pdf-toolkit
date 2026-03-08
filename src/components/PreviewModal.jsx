import { useEffect, useRef, useState } from 'react'
import { useAppContext } from '../AppContext'
import pdfjsLib from '../utils/pdfSetup'

export default function PreviewModal() {
  const { previewPageId, setPreviewPageId, pages, documents } = useAppContext()
  const canvasRef = useRef(null)
  const [loading, setLoading] = useState(false)

  const page = pages.find(p => p.id === previewPageId)
  const pageIndex = pages.indexOf(page)

  useEffect(() => {
    if (!page) return
    const doc = documents.find(d => d.id === page.docId)
    if (!doc) return

    let cancelled = false
    setLoading(true)

    ;(async () => {
      const loadingTask = pdfjsLib.getDocument({ data: doc.bytes.slice() })
      const pdf = await loadingTask.promise
      const pdfPage = await pdf.getPage(page.pageIndex + 1)
      if (cancelled) { pdf.destroy(); return }

      const canvas = canvasRef.current
      if (!canvas) { pdf.destroy(); return }

      const maxWidth = Math.min(window.innerWidth * 0.85, 900)
      const maxHeight = window.innerHeight * 0.8
      const baseViewport = pdfPage.getViewport({ scale: 1, rotation: page.rotation })
      const scaleW = maxWidth / baseViewport.width
      const scaleH = maxHeight / baseViewport.height
      const scale = Math.min(scaleW, scaleH)
      const viewport = pdfPage.getViewport({ scale, rotation: page.rotation })

      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      await pdfPage.render({ canvasContext: ctx, viewport }).promise
      pdf.destroy()
      if (!cancelled) setLoading(false)
    })()

    return () => { cancelled = true }
  }, [page, documents])

  useEffect(() => {
    if (!previewPageId) return
    const onKey = (e) => {
      if (e.key === 'Escape') setPreviewPageId(null)
      if (e.key === 'ArrowLeft' && pageIndex > 0) setPreviewPageId(pages[pageIndex - 1].id)
      if (e.key === 'ArrowRight' && pageIndex < pages.length - 1) setPreviewPageId(pages[pageIndex + 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewPageId, pageIndex, pages, setPreviewPageId])

  if (!previewPageId || !page) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
      onClick={() => setPreviewPageId(null)}
    >
      <div
        className="relative bg-dark-bg rounded-xl border border-border shadow-2xl p-4 max-w-[95vw] max-h-[95vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between w-full mb-3">
          <p className="text-sm text-steel-blue">
            Page {pageIndex + 1} of {pages.length}
            {page.rotation !== 0 && ` — rotated ${page.rotation}°`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => pageIndex > 0 && setPreviewPageId(pages[pageIndex - 1].id)}
              disabled={pageIndex === 0}
              className="px-2 py-1 rounded border border-border hover:border-accent text-sm disabled:opacity-30 transition-colors"
            >
              Prev
            </button>
            <button
              onClick={() => pageIndex < pages.length - 1 && setPreviewPageId(pages[pageIndex + 1].id)}
              disabled={pageIndex === pages.length - 1}
              className="px-2 py-1 rounded border border-border hover:border-accent text-sm disabled:opacity-30 transition-colors"
            >
              Next
            </button>
            <button
              onClick={() => setPreviewPageId(null)}
              className="p-1.5 rounded border border-border hover:border-negative transition-colors"
              title="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-steel-blue">Rendering...</p>
            </div>
          )}
          <canvas ref={canvasRef} className="rounded shadow-lg" />
        </div>
      </div>
    </div>
  )
}
