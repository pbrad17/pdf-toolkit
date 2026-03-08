import { useEffect, useRef, useState } from 'react'
import { useAppContext } from '../AppContext'
import pdfjsLib from '../utils/pdfSetup'
import { buildFinalPdf, applyHeadersFooters } from '../utils/pdfOperations'

const ZONE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'pageNumber', label: '#  Page' },
  { value: 'date', label: 'Date' },
  { value: 'custom', label: 'Custom' },
]

const PAGE_NUM_FORMATS = [
  { value: '1', label: '1' },
  { value: 'Page 1', label: 'Page 1' },
  { value: 'Page 1 of N', label: 'Page 1 of N' },
  { value: '1 of N', label: '1 of N' },
]

function resolveZoneText(zone, pageNum, totalPages, dateStr, pageNumFormat) {
  if (!zone || zone.type === 'none') return ''
  if (zone.type === 'date') return dateStr
  if (zone.type === 'custom') return zone.customText || ''
  if (zone.type === 'pageNumber') {
    switch (pageNumFormat) {
      case 'Page 1': return `Page ${pageNum}`
      case 'Page 1 of N': return `Page ${pageNum} of ${totalPages}`
      case '1 of N': return `${pageNum} of ${totalPages}`
      default: return `${pageNum}`
    }
  }
  return ''
}

const DEFAULT_ZONES = {
  headerLeft:   { type: 'none', customText: '' },
  headerCenter: { type: 'none', customText: '' },
  headerRight:  { type: 'none', customText: '' },
  footerLeft:   { type: 'none', customText: '' },
  footerCenter: { type: 'pageNumber', customText: '' },
  footerRight:  { type: 'none', customText: '' },
}

export default function HeaderFooterTool() {
  const { documents, pages, annotations, isProcessing, setIsProcessing } = useAppContext()

  const [zones, setZones] = useState(DEFAULT_ZONES)
  const [pageNumFormat, setPageNumFormat] = useState('1')
  const [startingPage, setStartingPage] = useState(1)
  const [fontSize, setFontSize] = useState(10)
  const [color, setColor] = useState('#000000')
  const [margin, setMargin] = useState(36)

  // Preview
  const [activePageId, setActivePageId] = useState(null)
  const [pageInputValue, setPageInputValue] = useState('1')
  const [viewport, setViewport] = useState(null)
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const [status, setStatus] = useState('')

  const activePageIndex = pages.findIndex(p => p.id === activePageId)
  const activePage = pages.find(p => p.id === activePageId)
  const hasAnyZone = Object.values(zones).some(z => z.type !== 'none')
  const hasPageNumber = Object.values(zones).some(z => z.type === 'pageNumber')

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

  const updateZone = (key, field, value) => {
    setZones(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }))
  }

  const handleApply = async () => {
    if (pages.length === 0 || !hasAnyZone) return
    setIsProcessing(true)
    setStatus('Building combined PDF...')
    try {
      const combinedBytes = await buildFinalPdf(documents, pages, annotations)
      setStatus('Adding headers & footers...')
      const result = await applyHeadersFooters(combinedBytes, {
        zones, pageNumFormat, startingPage, fontSize, color, margin,
      })
      const blob = new Blob([result], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'numbered.pdf'
      a.click()
      URL.revokeObjectURL(url)
      setStatus('Done! PDF with headers/footers downloaded.')
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
    const scaledSize = fontSize * (w / 612)
    const scaledMargin = margin * (w / 612)
    const pageNum = activePageIndex + startingPage
    const totalPages = pages.length + startingPage - 1
    const dateStr = new Date().toLocaleDateString()

    const textElements = []
    const zonePositions = {
      headerLeft:   { x: scaledMargin, y: scaledMargin + scaledSize, anchor: 'start' },
      headerCenter: { x: w / 2, y: scaledMargin + scaledSize, anchor: 'middle' },
      headerRight:  { x: w - scaledMargin, y: scaledMargin + scaledSize, anchor: 'end' },
      footerLeft:   { x: scaledMargin, y: h - scaledMargin, anchor: 'start' },
      footerCenter: { x: w / 2, y: h - scaledMargin, anchor: 'middle' },
      footerRight:  { x: w - scaledMargin, y: h - scaledMargin, anchor: 'end' },
    }

    for (const [key, pos] of Object.entries(zonePositions)) {
      const text = resolveZoneText(zones[key], pageNum, totalPages, dateStr, pageNumFormat)
      if (!text) continue
      textElements.push(
        <text
          key={key}
          x={pos.x}
          y={pos.y}
          textAnchor={pos.anchor}
          fill={color}
          fontSize={scaledSize}
          fontFamily="Helvetica, Arial, sans-serif"
        >
          {text}
        </text>
      )
    }
    return textElements
  }

  if (pages.length === 0) {
    return (
      <div className="text-center text-steel-blue py-12">
        <p>No pages loaded. Upload a PDF first.</p>
      </div>
    )
  }

  const ZoneDropdown = ({ zoneKey, label }) => (
    <div className="flex-1 min-w-0">
      <label className="text-[10px] text-steel-blue block mb-0.5">{label}</label>
      <select
        value={zones[zoneKey].type}
        onChange={(e) => updateZone(zoneKey, 'type', e.target.value)}
        className="w-full px-1 py-1 rounded border border-border bg-dark-bg text-text-primary text-[11px]"
      >
        {ZONE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {zones[zoneKey].type === 'custom' && (
        <input
          type="text"
          value={zones[zoneKey].customText}
          onChange={(e) => updateZone(zoneKey, 'customText', e.target.value)}
          placeholder="Text..."
          className="w-full mt-1 px-1 py-0.5 rounded border border-border bg-dark-bg text-text-primary text-[11px]"
        />
      )}
    </div>
  )

  return (
    <div className="flex gap-4" ref={containerRef}>
      {/* Left: Controls */}
      <div className="w-60 shrink-0 space-y-4">
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

        {/* Zone grid */}
        <div>
          <label className="text-xs font-medium text-steel-blue block mb-1">Header</label>
          <div className="flex gap-1">
            <ZoneDropdown zoneKey="headerLeft" label="Left" />
            <ZoneDropdown zoneKey="headerCenter" label="Center" />
            <ZoneDropdown zoneKey="headerRight" label="Right" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-steel-blue block mb-1">Footer</label>
          <div className="flex gap-1">
            <ZoneDropdown zoneKey="footerLeft" label="Left" />
            <ZoneDropdown zoneKey="footerCenter" label="Center" />
            <ZoneDropdown zoneKey="footerRight" label="Right" />
          </div>
        </div>

        {/* Page number format + starting page (conditional) */}
        {hasPageNumber && (
          <>
            <div>
              <label className="text-xs font-medium text-steel-blue block mb-1">Page # Format</label>
              <select
                value={pageNumFormat}
                onChange={(e) => setPageNumFormat(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
              >
                {PAGE_NUM_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-steel-blue block mb-1">Starting Page #</label>
              <input
                type="number"
                value={startingPage}
                onChange={(e) => setStartingPage(Math.max(1, Number(e.target.value) || 1))}
                min={1}
                className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
              />
            </div>
          </>
        )}

        {/* Font size + color */}
        <div className="flex gap-2">
          <div>
            <label className="text-xs font-medium text-steel-blue block mb-1">Color</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-10 h-8 rounded border border-border cursor-pointer"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-steel-blue block mb-1">Size ({fontSize}pt)</label>
            <input
              type="range"
              min={6} max={24} step={1}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="w-full accent-accent"
            />
          </div>
        </div>

        {/* Margin */}
        <div>
          <label className="text-xs font-medium text-steel-blue block mb-1">Margin ({Math.round(margin / 72 * 100) / 100}")</label>
          <input
            type="range"
            min={18} max={72} step={1}
            value={margin}
            onChange={(e) => setMargin(Number(e.target.value))}
            className="w-full accent-accent"
          />
        </div>

        <button
          onClick={handleApply}
          disabled={isProcessing || !hasAnyZone}
          className="w-full py-2.5 rounded-lg font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : 'Apply & Download'}
        </button>
        <p className="text-xs text-steel-blue">
          Headers & footers will be added to all {pages.length} page{pages.length !== 1 ? 's' : ''} and downloaded as a new PDF.
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
