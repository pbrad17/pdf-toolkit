import { useEffect, useRef, useState } from 'react'
import { useAppContext } from '../AppContext'
import pdfjsLib from '../utils/pdfSetup'
import { buildFinalPdf, applyWatermark } from '../utils/pdfOperations'

const STOCK_TEXTS = ['DRAFT', 'CONFIDENTIAL', 'COPY', 'SAMPLE', 'VOID', 'DO NOT COPY', 'APPROVED', 'FINAL']

export default function WatermarkTool() {
  const { documents, pages, annotations, isProcessing, setIsProcessing } = useAppContext()

  // Mode
  const [mode, setMode] = useState('text') // 'text' | 'image'

  // Text watermark settings
  const [textPreset, setTextPreset] = useState('DRAFT')
  const [customText, setCustomText] = useState('')
  const [color, setColor] = useState('#FF0000')
  const [fontSize, setFontSize] = useState(60)
  const [opacity, setOpacity] = useState(0.3)
  const [rotation, setRotation] = useState(-45)

  // Image watermark settings
  const [imageDataUrl, setImageDataUrl] = useState(null)
  const [imageName, setImageName] = useState('')
  const [imagePosition, setImagePosition] = useState('center')
  const [imageOpacity, setImageOpacity] = useState(0.3)
  const imageInputRef = useRef(null)

  // Preview
  const [activePageId, setActivePageId] = useState(null)
  const [pageInputValue, setPageInputValue] = useState('1')
  const [viewport, setViewport] = useState(null)
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const [status, setStatus] = useState('')

  const activePageIndex = pages.findIndex(p => p.id === activePageId)
  const activePage = pages.find(p => p.id === activePageId)
  const watermarkText = textPreset === 'Custom' ? customText : textPreset

  // Auto-select first page
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

  const handleApply = async () => {
    if (pages.length === 0) return
    setIsProcessing(true)
    setStatus('Building combined PDF...')
    try {
      const combinedBytes = await buildFinalPdf(documents, pages, annotations)
      setStatus('Applying watermark...')

      const config = { mode }
      if (mode === 'text') {
        Object.assign(config, { text: watermarkText, color, fontSize, opacity, rotation })
      } else {
        // Convert dataUrl to bytes
        const base64 = imageDataUrl.split(',')[1]
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const isJpeg = imageDataUrl.startsWith('data:image/jpeg') || imageDataUrl.startsWith('data:image/jpg')
        Object.assign(config, { imageBytes: bytes, isJpeg, imageOpacity, position: imagePosition })
      }

      const watermarkedBytes = await applyWatermark(combinedBytes, config)
      const blob = new Blob([watermarkedBytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'watermarked.pdf'
      a.click()
      URL.revokeObjectURL(url)
      setStatus('Done! Watermarked PDF downloaded.')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const canApply = mode === 'text' ? watermarkText.trim().length > 0 : !!imageDataUrl

  if (pages.length === 0) {
    return (
      <div className="text-center text-steel-blue py-12">
        <p>No pages loaded. Upload a PDF first.</p>
      </div>
    )
  }

  // Compute preview SVG elements
  const renderTextPreview = () => {
    if (!viewport || !watermarkText.trim()) return null
    const w = viewport.width
    const h = viewport.height
    // Scale font size relative to canvas (approximate Helvetica at ~0.6 width ratio)
    const scaledSize = fontSize * (w / 612)
    return (
      <text
        x={w / 2}
        y={h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        opacity={opacity}
        fontSize={scaledSize}
        fontFamily="Helvetica, Arial, sans-serif"
        transform={`rotate(${rotation} ${w / 2} ${h / 2})`}
      >
        {watermarkText}
      </text>
    )
  }

  const renderImagePreview = () => {
    if (!viewport || !imageDataUrl) return null
    const w = viewport.width
    const h = viewport.height

    if (imagePosition === 'tile') {
      const tileW = w * 0.2
      const tileH = tileW // approximate; actual aspect ratio applied via preserveAspectRatio
      const gapX = tileW * 0.5
      const gapY = tileH * 0.5
      const tiles = []
      let key = 0
      for (let tx = 0; tx < w; tx += tileW + gapX) {
        for (let ty = 0; ty < h; ty += tileH + gapY) {
          tiles.push(
            <image
              key={key++}
              href={imageDataUrl}
              x={tx} y={ty}
              width={tileW} height={tileH}
              opacity={imageOpacity}
              preserveAspectRatio="xMidYMid meet"
            />
          )
        }
      }
      return tiles
    }

    // Single placement
    const imgW = w * 0.4
    const imgH = h * 0.4
    let x, y
    if (imagePosition === 'center') {
      x = w / 2 - imgW / 2; y = h / 2 - imgH / 2
    } else if (imagePosition === 'top-left') {
      x = w * 0.05; y = h * 0.05
    } else if (imagePosition === 'top-right') {
      x = w - imgW - w * 0.05; y = h * 0.05
    } else if (imagePosition === 'bottom-left') {
      x = w * 0.05; y = h - imgH - h * 0.05
    } else {
      x = w - imgW - w * 0.05; y = h - imgH - h * 0.05
    }
    return (
      <image
        href={imageDataUrl}
        x={x} y={y}
        width={imgW} height={imgH}
        opacity={imageOpacity}
        preserveAspectRatio="xMidYMid meet"
      />
    )
  }

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

        {/* Mode toggle */}
        <div>
          <label className="text-xs font-medium text-steel-blue block mb-1">Type</label>
          <div className="flex gap-1">
            {['text', 'image'].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
                  mode === m ? 'bg-accent text-white border-accent' : 'border-border hover:border-accent'
                }`}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {mode === 'text' && (
          <>
            <div>
              <label className="text-xs font-medium text-steel-blue block mb-1">Text</label>
              <select
                value={textPreset}
                onChange={(e) => setTextPreset(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
              >
                {STOCK_TEXTS.map(t => <option key={t} value={t}>{t}</option>)}
                <option value="Custom">Custom...</option>
              </select>
            </div>
            {textPreset === 'Custom' && (
              <div>
                <input
                  type="text"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder="Enter custom text"
                  className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
                />
              </div>
            )}
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
                  min={24} max={120} step={1}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-full accent-accent"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-steel-blue block mb-1">Opacity ({Math.round(opacity * 100)}%)</label>
              <input
                type="range"
                min={0.05} max={1} step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-steel-blue block mb-1">Rotation ({rotation}°)</label>
              <input
                type="range"
                min={-90} max={90} step={1}
                value={rotation}
                onChange={(e) => setRotation(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </div>
          </>
        )}

        {mode === 'image' && (
          <>
            <div>
              <label className="text-xs font-medium text-steel-blue block mb-1">Upload Image</label>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = () => {
                    setImageDataUrl(reader.result)
                    setImageName(file.name)
                  }
                  reader.readAsDataURL(file)
                  e.target.value = ''
                }}
              />
              <button
                onClick={() => imageInputRef.current?.click()}
                className="w-full py-1.5 text-xs rounded border border-border hover:border-accent transition-colors"
              >
                {imageDataUrl ? 'Change Image…' : 'Choose File…'}
              </button>
            </div>
            {imageDataUrl && (
              <>
                <div className="p-2 rounded border border-border bg-alt-bg">
                  <img src={imageDataUrl} alt={imageName} className="h-16 mx-auto object-contain" />
                  <p className="text-xs text-steel-blue text-center mt-1 truncate">{imageName}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-steel-blue block mb-1">Position</label>
                  <select
                    value={imagePosition}
                    onChange={(e) => setImagePosition(e.target.value)}
                    className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
                  >
                    <option value="center">Center</option>
                    <option value="tile">Tiled</option>
                    <option value="top-left">Top Left</option>
                    <option value="top-right">Top Right</option>
                    <option value="bottom-left">Bottom Left</option>
                    <option value="bottom-right">Bottom Right</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-steel-blue block mb-1">Opacity ({Math.round(imageOpacity * 100)}%)</label>
                  <input
                    type="range"
                    min={0.05} max={1} step={0.05}
                    value={imageOpacity}
                    onChange={(e) => setImageOpacity(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                </div>
              </>
            )}
          </>
        )}

        <button
          onClick={handleApply}
          disabled={isProcessing || !canApply}
          className="w-full py-2.5 rounded-lg font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : 'Apply Watermark & Download'}
        </button>
        <p className="text-xs text-steel-blue">
          Watermark will be applied to all {pages.length} page{pages.length !== 1 ? 's' : ''} and downloaded as a new PDF.
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
              {mode === 'text' && renderTextPreview()}
              {mode === 'image' && renderImagePreview()}
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}
