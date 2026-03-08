import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppContext } from '../AppContext'
import pdfjsLib from '../utils/pdfSetup'
import { buildFinalPdf, applyCrop } from '../utils/pdfOperations'

function MarginSlider({ label, value, onChange }) {
  const [localValue, setLocalValue] = useState(value)
  const dragging = useRef(false)

  // Sync from parent when not actively dragging
  useEffect(() => {
    if (!dragging.current) setLocalValue(value)
  }, [value])

  const handleSliderInput = (e) => {
    const v = Number(e.target.value)
    setLocalValue(v)
    onChange(v)
  }

  const handlePointerDown = () => { dragging.current = true }
  const handlePointerUp = () => { dragging.current = false }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-steel-blue">{label}</label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={200}
            value={localValue}
            onChange={(e) => {
              const v = Number(e.target.value) || 0
              setLocalValue(v)
              onChange(Math.max(0, Math.min(200, v)))
            }}
            onBlur={(e) => {
              const v = Math.max(0, Math.min(200, Number(e.target.value) || 0))
              setLocalValue(v)
              onChange(v)
            }}
            className="w-14 text-right px-1.5 py-0.5 rounded border border-border bg-dark-bg text-text-primary text-xs tabular-nums"
          />
          <span className="text-xs text-steel-blue">pt</span>
        </div>
      </div>
      <input
        type="range"
        min={0} max={200} step={1}
        value={localValue}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onInput={handleSliderInput}
        onChange={handleSliderInput}
        className="w-full accent-accent cursor-pointer h-2"
      />
    </div>
  )
}

export default function CropTool() {
  const { documents, pages, annotations, isProcessing, setIsProcessing } = useAppContext()

  const [top, setTop] = useState(0)
  const [bottom, setBottom] = useState(0)
  const [left, setLeft] = useState(0)
  const [right, setRight] = useState(0)
  const [linked, setLinked] = useState(false)

  // Preview
  const [activePageId, setActivePageId] = useState(null)
  const [pageInputValue, setPageInputValue] = useState('1')
  const [viewport, setViewport] = useState(null)
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const [status, setStatus] = useState('')

  const activePageIndex = pages.findIndex(p => p.id === activePageId)
  const activePage = pages.find(p => p.id === activePageId)
  const hasAnyCrop = top > 0 || bottom > 0 || left > 0 || right > 0

  useEffect(() => {
    if (pages.length > 0 && !activePageId) setActivePageId(pages[0].id)
  }, [pages, activePageId])

  useEffect(() => {
    const idx = pages.findIndex(p => p.id === activePageId)
    if (idx >= 0) setPageInputValue(String(idx + 1))
  }, [activePageId, pages])

  // Render preview page
  useEffect(() => {
    if (!activePage) return
    const doc = documents.find(d => d.id === activePage.docId)
    if (!doc) return
    let cancelled = false
    ;(async () => {
      const loadingTask = pdfjsLib.getDocument({ data: doc.bytes.slice() })
      const pdf = await loadingTask.promise
      const pdfPage = await pdf.getPage(activePage.pageIndex + 1)
      if (cancelled) { pdf.destroy(); return }
      const canvas = canvasRef.current
      if (!canvas) { pdf.destroy(); return }
      const container = containerRef.current
      const maxWidth = container ? container.clientWidth - 32 : 700
      const maxHeight = window.innerHeight * 0.7
      const baseVp = pdfPage.getViewport({ scale: 1, rotation: activePage.rotation })
      const scaleW = maxWidth / baseVp.width
      const scaleH = maxHeight / baseVp.height
      const scale = Math.min(scaleW, scaleH)
      const vp = pdfPage.getViewport({ scale, rotation: activePage.rotation })
      canvas.width = vp.width
      canvas.height = vp.height
      setViewport(vp)
      const ctx = canvas.getContext('2d')
      await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise
      pdf.destroy()
    })()
    return () => { cancelled = true }
  }, [activePage, documents])

  const setMargin = (setter, value) => {
    const v = Math.max(0, Number(value) || 0)
    if (linked) {
      setTop(v); setBottom(v); setLeft(v); setRight(v)
    } else {
      setter(v)
    }
  }

  const handleApply = async () => {
    if (pages.length === 0 || !hasAnyCrop) return
    setIsProcessing(true)
    setStatus('Building combined PDF...')
    try {
      const combinedBytes = await buildFinalPdf(documents, pages, annotations)
      setStatus('Cropping pages...')
      const result = await applyCrop(combinedBytes, { top, bottom, left, right })
      const blob = new Blob([result], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'cropped.pdf'
      a.click()
      URL.revokeObjectURL(url)
      setStatus('Done! Cropped PDF downloaded.')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  // Preview overlay
  const renderPreview = () => {
    if (!viewport) return null
    const w = viewport.width
    const h = viewport.height
    // Scale: PDF default is 72pt/inch, canvas scale = viewport.width / (page width in pt)
    // We use the same scale ratio from the viewport
    const scale = w / 612 // approximate — actual depends on page size
    const sT = top * scale
    const sB = bottom * scale
    const sL = left * scale
    const sR = right * scale

    return (
      <>
        {/* Darkened crop areas */}
        <rect x={0} y={0} width={w} height={sT} fill="#000" opacity={0.4} />
        <rect x={0} y={h - sB} width={w} height={sB} fill="#000" opacity={0.4} />
        <rect x={0} y={sT} width={sL} height={h - sT - sB} fill="#000" opacity={0.4} />
        <rect x={w - sR} y={sT} width={sR} height={h - sT - sB} fill="#000" opacity={0.4} />
        {/* Crop boundary */}
        <rect
          x={sL} y={sT}
          width={Math.max(0, w - sL - sR)}
          height={Math.max(0, h - sT - sB)}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2}
          strokeDasharray="6 3"
        />
      </>
    )
  }

  if (pages.length === 0) {
    return (
      <div className="text-center text-steel-blue py-12">
        <p>No pages loaded. Upload a PDF first.</p>
      </div>
    )
  }

  const handleMargin = useCallback((setter, value) => {
    setMargin(setter, value)
  }, [linked, top])

  return (
    <div className="flex gap-4" ref={containerRef}>
      {/* Left: Controls */}
      <div className="w-56 shrink-0 space-y-4">
        {/* Page navigator */}
        <div>
          <label className="text-xs font-medium text-steel-blue block mb-1">Preview Page</label>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { if (activePageIndex > 0) setActivePageId(pages[activePageIndex - 1].id) }}
              disabled={activePageIndex <= 0}
              className="px-1.5 py-1.5 rounded border border-border text-text-primary text-sm hover:border-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" /></svg>
            </button>
            <input
              type="text"
              inputMode="numeric"
              value={pageInputValue}
              onChange={(e) => setPageInputValue(e.target.value)}
              onBlur={() => {
                const n = Math.max(1, Math.min(pages.length, parseInt(pageInputValue) || 1))
                setActivePageId(pages[n - 1].id)
                setPageInputValue(String(n))
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
              className="w-10 text-center px-1 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
            />
            <span className="text-xs text-steel-blue whitespace-nowrap">of {pages.length}</span>
            <button
              onClick={() => { if (activePageIndex < pages.length - 1) setActivePageId(pages[activePageIndex + 1].id) }}
              disabled={activePageIndex >= pages.length - 1}
              className="px-1.5 py-1.5 rounded border border-border text-text-primary text-sm hover:border-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 1 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
            </button>
          </div>
        </div>

        {/* Link margins toggle */}
        <label className="text-xs font-medium text-steel-blue flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={linked}
            onChange={(e) => {
              setLinked(e.target.checked)
              if (e.target.checked) {
                setBottom(top); setLeft(top); setRight(top)
              }
            }}
            className="accent-accent"
          />
          Link all margins
        </label>

        {/* Margin sliders */}
        <MarginSlider label="Top" value={top} onChange={(v) => handleMargin(setTop, v)} />
        <MarginSlider label="Bottom" value={bottom} onChange={(v) => handleMargin(setBottom, v)} />
        <MarginSlider label="Left" value={left} onChange={(v) => handleMargin(setLeft, v)} />
        <MarginSlider label="Right" value={right} onChange={(v) => handleMargin(setRight, v)} />

        <button
          onClick={handleApply}
          disabled={isProcessing || !hasAnyCrop}
          className="w-full py-2.5 rounded-lg font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : 'Crop & Download'}
        </button>
        <p className="text-xs text-steel-blue">
          Crop will be applied to all {pages.length} page{pages.length !== 1 ? 's' : ''}. Darkened areas will be removed.
        </p>
        {status && <p className="text-sm text-steel-blue">{status}</p>}
      </div>

      {/* Right: Preview */}
      <div className="flex-1 flex flex-col items-center">
        <div className="relative inline-block">
          <canvas
            ref={canvasRef}
            className="rounded shadow-lg border border-border"
          />
          {viewport && (
            <svg
              style={{
                position: 'absolute', top: 0, left: 0,
                width: viewport.width, height: viewport.height,
                pointerEvents: 'none',
              }}
              viewBox={`0 0 ${viewport.width} ${viewport.height}`}
            >
              {renderPreview()}
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}
